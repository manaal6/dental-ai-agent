// ─── Stage 3: Qualification Scoring ──────────────────────────────────────────
// Rank leads by conversion likelihood using a weighted scoring model.
// Only leads scoring ABOVE the threshold AND with CONTACT_VERIFIED=true pass.
//
// Scoring factors:
//   - Review volume (call volume proxy)
//   - Absence of online booking
//   - Phone/reachability complaints in reviews
//   - Business size (single-location preferred)
//   - Industry vertical weight
//   - Email confidence from enrichment
//
// Usage:
//   node score.js                         # Score all Stage 2 verified leads
//   node score.js --threshold 80          # Custom threshold
//   node score.js --input stage2-foo.json # Custom input
//   node score.js --dry-run               # Preview without saving

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  config, logLead, logPipeline,
  getLeads, upsertLead, advanceStage, dropLead,
} from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: null,
    threshold: config.scoring.passingScore,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input": opts.input = args[++i]; break;
      case "--threshold": opts.threshold = parseInt(args[++i], 10); break;
      case "--dry-run": opts.dryRun = true; break;
    }
  }
  return opts;
}

// ── Scoring Functions ───────────────────────────────────────────────────────

/**
 * Score review volume (call volume proxy).
 * 20-200 reviews = sweet spot (active but not huge chain).
 */
function scoreReviewVolume(reviewCount) {
  if (reviewCount >= 50 && reviewCount < 150) return 25;   // Prime sweet spot
  if (reviewCount >= 20 && reviewCount < 50)  return 20;   // Good
  if (reviewCount >= 150 && reviewCount < 500) return 15;  // Large but still local
  if (reviewCount >= 500) return 10;                        // Big chain, slower decision
  if (reviewCount >= 20) return 15;                         // Minimum viable
  return 0;
}

/**
 * Score online booking presence.
 * No booking system = strong buying signal.
 */
function scoreBookingPresence(signals) {
  if (signals.noOnlineBooking) return 25;  // Strong signal
  if (signals.noWebsite) return 20;        // No website at all
  return 0;
}

/**
 * Score phone complaints from reviews.
 * More complaints = more pain = higher conversion likelihood.
 */
function scorePhoneComplaints(complaints) {
  if (complaints.length >= 3) return 25;   // Severe pain
  if (complaints.length >= 2) return 20;   // Clear pattern
  if (complaints.length === 1) return 15;  // Some signal
  return 0;
}

/**
 * Score business size. Single-location preferred (faster decision cycle).
 */
function scoreBusinessSize(signals) {
  if (signals.singleLocation) return 15;   // Decision maker = owner, fast cycle
  return 5;                                // Multi-location = slower procurement
}

/**
 * Score vertical weight. Dental/med spa/HVAC weighted higher per market data.
 */
function scoreVertical(vertical) {
  const weights = config.scoring.verticalWeights;
  const key = vertical?.toLowerCase() || "default";
  return Math.round((weights[key] || weights.default) / 10); // Scale to 0-10
}

/**
 * Score email confidence from enrichment.
 * Higher confidence = more reachable = easier outreach.
 */
function scoreEmailConfidence(lead) {
  if (!lead.verifiedEmail) return 0;
  const conf = lead.emailConfidence || 0;
  if (conf >= 95) return 15;
  if (conf >= 85) return 12;
  if (conf >= 80) return 10;
  return 5;
}

/**
 * Calculate composite qualification score (0-100).
 */
function calculateScore(lead) {
  const signals = lead.stage1Signals || lead.signals || {};

  const breakdown = {
    reviewVolume: scoreReviewVolume(lead.reviewCount || 0),
    bookingPresence: scoreBookingPresence(signals),
    phoneComplaints: scorePhoneComplaints(signals.phoneComplaints || []),
    businessSize: scoreBusinessSize(signals),
    vertical: scoreVertical(lead.vertical),
    emailConfidence: scoreEmailConfidence(lead),
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Cap at 100
  return {
    total: Math.min(total, 100),
    breakdown,
  };
}

// ── Main Scoring Flow ───────────────────────────────────────────────────────
async function score(opts) {
  logPipeline("scoring", "Starting qualification scoring");

  // Load leads from Stage 2 output
  let leads;
  if (opts.input) {
    const inputPath = path.join(config.leadsDir, opts.input);
    leads = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } else {
    // Try verified leads first, fall back to all leads in DB
    const verifiedFile = path.join(config.leadsDir, "stage2-verified.json");
    if (fs.existsSync(verifiedFile)) {
      leads = JSON.parse(fs.readFileSync(verifiedFile, "utf8"));
    } else {
      leads = getLeads({ stage: "enrichment", status: "active" });
      if (leads.length === 0) {
        console.error("❌ No leads found. Run Stages 1-2 first.");
        process.exit(1);
      }
    }
  }

  logPipeline("scoring", `Scoring ${leads.length} leads (threshold: ${opts.threshold})`);

  const results = {
    qualified: [],
    disqualified: [],
  };

  for (const lead of leads) {
    const leadId = lead.id || lead.leadId || lead.placeId;

    // HARD GATE: Must have verified contact
    if (!lead.contactVerified) {
      logLead({
        leadId, stage: "scoring", status: "skip",
        message: `No verified contact — cannot proceed`,
      });
      if (!opts.dryRun) {
        dropLead(leadId, "scoring", "No verified contact");
      }
      results.disqualified.push({ leadId, ...lead, score: 0, reason: "no_verified_contact" });
      continue;
    }

    const { total, breakdown } = calculateScore(lead);

    logLead({
      leadId, stage: "scoring", status: "info",
      message: `Score: ${total}/100 | Reviews: ${breakdown.reviewVolume} | Booking: ${breakdown.bookingPresence} | Phone: ${breakdown.phoneComplaints} | Size: ${breakdown.businessSize} | Vertical: ${breakdown.vertical} | Email: ${breakdown.emailConfidence}`,
    });

    if (total >= opts.threshold) {
      logLead({
        leadId, stage: "scoring", status: "pass",
        message: `✅ QUALIFIED — Score ${total}/100 >= ${opts.threshold} threshold`,
      });

      if (!opts.dryRun) {
        upsertLead(leadId, {
          qualificationScore: total,
          scoreBreakdown: breakdown,
          stage: "scoring",
        });
        advanceStage(leadId, "scoring", `Scored ${total}/100, above ${opts.threshold} threshold`);
      }

      results.qualified.push({
        leadId,
        ...lead,
        qualificationScore: total,
        scoreBreakdown: breakdown,
      });
    } else {
      logLead({
        leadId, stage: "scoring", status: "fail",
        message: `❌ DISQUALIFIED — Score ${total}/100 < ${opts.threshold} threshold`,
      });

      if (!opts.dryRun) {
        dropLead(leadId, "scoring", `Score ${total}/100 below ${opts.threshold} threshold`);
      }

      results.disqualified.push({
        leadId,
        ...lead,
        qualificationScore: total,
        scoreBreakdown: breakdown,
        reason: "below_threshold",
      });
    }
  }

  // Summary
  logPipeline("scoring", `Complete: ${results.qualified.length} qualified, ${results.disqualified.length} disqualified`);

  // Save results
  const outputFile = path.join(config.leadsDir, "stage3-scored.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  logPipeline("scoring", `Results saved to ${outputFile}`);

  return results;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
score(opts)
  .then((result) => {
    console.log(`\n✅ Stage 3 complete:`);
    console.log(`   ✅ Qualified: ${result.qualified.length}`);
    console.log(`   ❌ Disqualified: ${result.disqualified.length}`);

    if (result.qualified.length > 0) {
      console.log("\n   Qualified leads (ready for Stage 4):");
      for (const lead of result.qualified) {
        console.log(`     - ${lead.businessName || lead.name}: ${lead.qualificationScore}/100`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 3 failed:", err.message);
    process.exit(1);
  });
