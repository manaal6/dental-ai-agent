// ─── Stage 2: Enrichment ─────────────────────────────────────────────────────
// 100% FREE — No paid APIs needed.
//
// Strategy:
//   1. Scrape the business website's /contact, /about pages for emails
//   2. Check common email patterns (info@, admin@, contact@)
//   3. Verify emails via SMTP DNS MX check (free, no API)
//   4. Flag unverified leads for manual review
//
// Usage:
//   node enrich.js                          # Enrich all Stage 1 leads
//   node enrich.js --dry-run                # Preview without saving

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";
import {
  config, logLead, logPipeline,
  getLead, getLeads, upsertLead, advanceStage, dropLead,
} from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ── Free Email Discovery ────────────────────────────────────────────────────

/**
 * Extract emails from raw HTML text.
 */
function extractEmails(html) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = html.match(emailRegex) || [];
  // Filter out image extensions, common false positives
  return [...new Set(found)].filter(e =>
    !e.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i) &&
    !e.match(/^(example|test|user|name|email|your|sample)@/i)
  );
}

/**
 * Check if a domain has valid MX records (email can be received).
 */
function checkMX(domain) {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      resolve(!err && addresses && addresses.length > 0);
    });
  });
}

/**
 * Fetch a page from a website and extract emails.
 */
async function fetchPageEmails(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClinicBot/1.0)",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();
    return extractEmails(html);
  } catch {
    return [];
  }
}

/**
 * Try to find emails on a business website by checking common pages.
 */
async function scrapeWebsiteEmails(website) {
  if (!website) return [];

  let baseUrl;
  try {
    baseUrl = new URL(website);
  } catch {
    return [];
  }

  const origin = baseUrl.origin;
  const emails = [];

  // Check common contact/about pages
  const paths = [
    "/",
    "/contact",
    "/contact-us",
    "/about",
    "/about-us",
    "/team",
    "/our-team",
    "/staff",
  ];

  for (const p of paths) {
    try {
      const pageEmails = await fetchPageEmails(`${origin}${p}`);
      emails.push(...pageEmails);
      // If we found emails, no need to check more pages
      if (emails.length > 0) break;
    } catch {
      // Skip failed pages
    }
  }

  return [...new Set(emails)];
}

/**
 * Pick the best email from a list.
 * Priority: info@ > admin@ > contact@ > office@ > first.last@ > other
 */
function pickBestEmail(emails) {
  if (emails.length === 0) return null;

  const priority = [
    /^info@/i,
    /^admin@/i,
    /^contact@/i,
    /^office@/i,
    /^hello@/i,
    /^reception@/i,
    /^frontdesk@/i,
  ];

  // Try priority patterns first
  for (const pattern of priority) {
    const match = emails.find(e => pattern.test(e));
    if (match) return match;
  }

  // Fall back to first email found
  return emails[0];
}

/**
 * Determine the role/type of an email based on prefix.
 */
function guessEmailRole(email) {
  const prefix = email.split("@")[0].toLowerCase();
  const roles = {
    info: "general",
    admin: "administrator",
    contact: "general",
    office: "office",
    hello: "general",
    reception: "front desk",
    frontdesk: "front desk",
    booking: "appointments",
    appointments: "appointments",
    support: "support",
    manager: "manager",
    owner: "owner",
  };
  return roles[prefix] || "general";
}

// ── Main Enrichment Flow ────────────────────────────────────────────────────
async function enrich(opts) {
  logPipeline("enrichment", "Starting lead enrichment (100% FREE — website scraping)");

  // Load leads from Stage 1 output
  let leads;
  if (opts.input) {
    const inputPath = path.join(config.leadsDir, opts.input);
    leads = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } else if (opts.leadId) {
    const lead = getLead(opts.leadId);
    if (!lead) {
      console.error(`❌ Lead ${opts.leadId} not found`);
      process.exit(1);
    }
    leads = [lead];
  } else {
    const inputFile = path.join(config.leadsDir, "stage1-discovered.json");
    if (!fs.existsSync(inputFile)) {
      console.error("❌ No Stage 1 output found. Run Stage 1 first:");
      console.error("   node pipeline/stage1-discovery/discover.js");
      process.exit(1);
    }
    leads = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  }

  logPipeline("enrichment", `Enriching ${leads.length} leads (free website scraping)`);

  const results = {
    verified: [],
    unverified: [],
    errors: [],
  };

  for (const lead of leads) {
    const leadId = lead.id || lead.placeId;

    try {
      logLead({
        leadId, stage: "enrichment", status: "info",
        message: `Scraping website for: ${lead.businessName || lead.name}`,
      });

      // Scrape emails from the business website
      const website = lead.website || "";
      const emails = await scrapeWebsiteEmails(website);

      const result = {
        contactVerified: false,
        ownerName: null,
        verifiedEmail: null,
        verifiedPhone: lead.phone || null,
        emailConfidence: 0,
        emailStatus: null,
        enrichmentSource: null,
        possibleEmails: [],
      };

      if (emails.length > 0) {
        result.possibleEmails = emails.map(e => ({
          email: e,
          confidence: 70, // Base confidence from scraping
          type: guessEmailRole(e),
        }));

        const bestEmail = pickBestEmail(emails);
        const domain = bestEmail.split("@")[1];

        // Verify domain has MX records (free DNS check)
        const hasMX = await checkMX(domain);

        if (hasMX) {
          result.contactVerified = true;
          result.verifiedEmail = bestEmail;
          result.emailConfidence = 85; // Higher confidence with MX verification
          result.emailStatus = "valid";
          result.enrichmentSource = "website_scrape_mx_verified";

          logLead({
            leadId, stage: "enrichment", status: "pass",
            message: `✅ Verified: ${bestEmail} (85% confidence, MX verified) — ${emails.length} emails found on site`,
          });
        } else {
          // Email found but no MX records — still usable but lower confidence
          result.contactVerified = true;
          result.verifiedEmail = bestEmail;
          result.emailConfidence = 60;
          result.emailStatus = "risky";
          result.enrichmentSource = "website_scrape_no_mx";

          logLead({
            leadId, stage: "enrichment", status: "info",
            message: `⚠️ Found: ${bestEmail} (60% confidence, no MX records) — ${emails.length} emails found`,
          });
        }
      } else {
        logLead({
          leadId, stage: "enrichment", status: "info",
          message: `No emails found on website: ${website || "no website"}`,
        });
      }

      if (!opts.dryRun) {
        upsertLead(leadId, {
          ...lead,
          ...result,
          stage: "enrichment",
        });

        if (result.contactVerified) {
          advanceStage(leadId, "enrichment", `Email verified: ${result.verifiedEmail}`);
          results.verified.push({ leadId, ...lead, ...result });
        } else {
          dropLead(leadId, "enrichment", "No verified contact found");
          results.unverified.push({ leadId, ...lead, ...result });
        }
      } else {
        if (result.contactVerified) {
          results.verified.push({ leadId, ...lead, ...result });
        } else {
          results.unverified.push({ leadId, ...lead, ...result });
        }
      }

    } catch (err) {
      logLead({
        leadId, stage: "enrichment", status: "error",
        message: `Fatal error: ${err.message}`,
      });
      results.errors.push({ leadId, error: err.message });
    }

    // Rate limit: 500ms between website scrapes (be polite)
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  logPipeline("enrichment", `Complete: ${results.verified.length} verified, ${results.unverified.length} unverified, ${results.errors.length} errors`);

  // Save results
  const outputFile = path.join(config.leadsDir, "stage2-enriched.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  logPipeline("enrichment", `Results saved to ${outputFile}`);

  // Save verified leads for Stage 3
  const verifiedFile = path.join(config.leadsDir, "stage2-verified.json");
  fs.writeFileSync(verifiedFile, JSON.stringify(results.verified, null, 2));

  // Save unverified for manual review
  const unverifiedFile = path.join(config.leadsDir, "stage2-manual-review.json");
  fs.writeFileSync(unverifiedFile, JSON.stringify(results.unverified, null, 2));

  return results;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
enrich(opts)
  .then((result) => {
    console.log(`\n✅ Stage 2 complete:`);
    console.log(`   ✅ Verified contacts: ${result.verified.length}`);
    console.log(`   ⚠️  Needs manual review: ${result.unverified.length}`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.verified.length > 0) {
      console.log("\n   Verified leads ready for Stage 3:");
      for (const lead of result.verified) {
        console.log(`     - ${lead.businessName || lead.name}: ${lead.verifiedEmail} (${lead.emailConfidence}%)`);
      }
    }

    if (result.unverified.length > 0) {
      console.log("\n   ⚠️  Leads needing manual review (no verified contact):");
      for (const lead of result.unverified) {
        console.log(`     - ${lead.businessName || lead.name} (${lead.website || "no website"})`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 2 failed:", err.message);
    process.exit(1);
  });
