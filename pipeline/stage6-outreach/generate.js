// ─── Stage 6: Outreach Generation ────────────────────────────────────────────
// Generate a short (under 100 words) personalized cold email/DM per lead.
// References: specific business name, one specific pain signal from Stage 1,
// and the live demo link.
//
// NO generic template language — must pull the real signal found for that lead.
// Output: subject line + body, ready to paste (not auto-sent).
//
// Usage:
//   node generate.js                        # Generate outreach for all deployed leads
//   node generate.js --input stage5-deployed.json
//   node generate.js --lead-id foo-123      # Single lead
//   node generate.js --dry-run              # Preview without saving

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import {
  config, logLead, logPipeline,
  getLead, upsertLead, advanceStage,
} from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const groq = new Groq({ apiKey: config.env.GROQ_API_KEY });

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: null,
    leadId: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input": opts.input = args[++i]; break;
      case "--lead-id": opts.leadId = args[++i]; break;
      case "--dry-run": opts.dryRun = true; break;
    }
  }
  return opts;
}

// ── Pain Signal Extraction ──────────────────────────────────────────────────

/**
 * Extract the strongest pain signal from Stage 1 data.
 */
function extractPainSignal(lead) {
  const signals = lead.stage1Signals || lead.signals || {};

  // Priority 1: Phone complaints from reviews (strongest signal)
  if (signals.phoneComplaints?.length > 0) {
    const complaint = signals.phoneComplaints[0];
    return {
      type: "phone_complaint",
      text: complaint.text,
      source: `Google review by ${complaint.author}`,
      summary: "phone reachability issues",
    };
  }

  // Priority 2: No online booking
  if (signals.noOnlineBooking) {
    return {
      type: "no_booking",
      text: "No online booking system detected",
      source: "website analysis",
      summary: "missing online booking",
    };
  }

  // Priority 3: No website at all
  if (signals.noWebsite) {
    return {
      type: "no_website",
      text: "No website found",
      source: "Google Places listing",
      summary: "no web presence",
    };
  }

  // Priority 4: Lower rating (service issues)
  if (signals.rating && signals.rating < 4.0) {
    return {
      type: "low_rating",
      text: `Rated ${signals.rating}/5 stars on Google`,
      source: "Google reviews",
      summary: "room for service improvement",
    };
  }

  // Fallback: generic but still personalized
  return {
    type: "general",
    text: "Looking for ways to improve customer experience",
    source: "market research",
    summary: "customer experience optimization",
  };
}

// ── LLM Outreach Generation ─────────────────────────────────────────────────

/**
 * Generate personalized outreach email using Groq LLM.
 */
async function generateOutreach(lead, painSignal, demoUrl) {
  const businessName = lead.businessName || lead.name || "your business";
  const vertical = lead.vertical || "dental";
  const ownerName = lead.ownerName || null;

  const prompt = `Write a cold outreach email for an AI receptionist product.

RULES:
- Under 100 words total (subject + body)
- Reference the SPECIFIC business name: ${businessName}
- Reference the SPECIFIC pain signal: ${painSignal.text} (${painSignal.source})
- Include the demo link: ${demoUrl}
- Tone: friendly, professional, NOT salesy
- No generic phrases like "I hope this email finds you well"
- Get straight to the point
- Subject line should be specific and intriguing, not generic
${ownerName ? `- Address to: ${ownerName}` : ""}

OUTPUT FORMAT (exactly this structure):
SUBJECT: [your subject line]
BODY: [your email body]`;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are an expert cold email copywriter. Write concise, personalized outreach that gets responses. Never use generic template language.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const text = response.choices[0]?.message?.content?.trim();

    // Parse subject and body
    const subjectMatch = text.match(/SUBJECT:\s*(.+)/i);
    const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);

    return {
      subject: subjectMatch?.[1]?.trim() || `Quick question about ${businessName}`,
      body: bodyMatch?.[1]?.trim() || text,
      raw: text,
    };
  } catch (err) {
    throw new Error(`LLM outreach generation failed: ${err.message}`);
  }
}

// ── Main Outreach Flow ──────────────────────────────────────────────────────
async function generate(opts) {
  if (!config.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY not set in .env");
    process.exit(1);
  }

  logPipeline("outreach", "Starting outreach generation");

  // Load leads from Stage 5 output
  let leads;
  if (opts.input) {
    const inputPath = path.join(config.leadsDir, opts.input);
    const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    leads = data.deployed || data;
  } else if (opts.leadId) {
    const lead = getLead(opts.leadId);
    if (!lead) {
      console.error(`❌ Lead ${opts.leadId} not found`);
      process.exit(1);
    }
    leads = [lead];
  } else {
    // Try Stage 5 output first, fall back to all leads with demo URLs
    const stage5File = path.join(config.leadsDir, "stage5-deployed.json");
    if (fs.existsSync(stage5File)) {
      const data = JSON.parse(fs.readFileSync(stage5File, "utf8"));
      leads = data.deployed || [];
    } else {
      // Fall back to all leads with demo URLs
      const allLeadsFile = path.join(config.leadsDir, "pipeline-leads.json");
      if (fs.existsSync(allLeadsFile)) {
        const allLeads = JSON.parse(fs.readFileSync(allLeadsFile, "utf8"));
        leads = Object.values(allLeads).filter((l) => l.demoUrl);
      } else {
        console.error("❌ No leads found. Run previous stages first.");
        process.exit(1);
      }
    }
  }

  if (leads.length === 0) {
    console.error("❌ No leads with demo URLs to generate outreach for.");
    process.exit(1);
  }

  logPipeline("outreach", `Generating outreach for ${leads.length} leads`);

  const results = {
    generated: [],
    errors: [],
  };

  for (const lead of leads) {
    const leadId = lead.id || lead.leadId || lead.placeId;
    const demoUrl = lead.demoUrl || `https://demo-${leadId}.onrender.com`;

    try {
      logLead({
        leadId, stage: "outreach", status: "info",
        message: `Generating outreach for: ${lead.businessName || lead.name}`,
      });

      // Extract pain signal
      const painSignal = extractPainSignal(lead);

      logLead({
        leadId, stage: "outreach", status: "info",
        message: `Pain signal: ${painSignal.summary} (${painSignal.type})`,
      });

      // Generate outreach via LLM
      const outreach = await generateOutreach(lead, painSignal, demoUrl);

      logLead({
        leadId, stage: "outreach", status: "info",
        message: `Generated: "${outreach.subject}"`,
      });

      if (!opts.dryRun) {
        upsertLead(leadId, {
          outreachSubject: outreach.subject,
          outreachBody: outreach.body,
          outreachRaw: outreach.raw,
          outreachPainSignal: painSignal,
          outreachGenerated: true,
          outreachStatus: "needs_review",
          stage: "outreach",
        });
        advanceStage(leadId, "outreach", "Outreach email generated");
      }

      logLead({
        leadId, stage: "outreach", status: "pass",
        message: `✅ Outreach generated (${outreach.body.split(" ").length} words)`,
      });

      results.generated.push({
        leadId,
        businessName: lead.businessName || lead.name,
        subject: outreach.subject,
        body: outreach.body,
        painSignal: painSignal.summary,
        demoUrl,
        status: "needs_review",
      });

    } catch (err) {
      logLead({
        leadId, stage: "outreach", status: "error",
        message: `Outreach generation failed: ${err.message}`,
      });
      results.errors.push({ leadId, error: err.message });
    }

    // Rate limit: 500ms between LLM calls
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  logPipeline("outreach", `Complete: ${results.generated.length} generated, ${results.errors.length} errors`);

  // Save results
  const outputFile = path.join(config.leadsDir, "stage6-outreach.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  return results;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
generate(opts)
  .then((result) => {
    console.log(`\n✅ Stage 6 complete:`);
    console.log(`   ✅ Generated: ${result.generated.length}`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.generated.length > 0) {
      console.log("\n   Outreach emails (ready for review):");
      for (const email of result.generated) {
        console.log(`\n   ── ${email.businessName} ──`);
        console.log(`   Subject: ${email.subject}`);
        console.log(`   Body: ${email.body}`);
        console.log(`   Demo: ${email.demoUrl}`);
        console.log(`   Pain: ${email.painSignal}`);
        console.log(`   Status: ${email.status}`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 6 failed:", err.message);
    process.exit(1);
  });
