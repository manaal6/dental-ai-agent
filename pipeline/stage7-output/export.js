// ─── Stage 7: Output Export ──────────────────────────────────────────────────
// Produces clean, human-readable output files:
//   - REPORT.md      — Full pipeline report with every lead
//   - OUTREACH.txt   — Copy-paste ready cold emails
//   - LEADS.txt      — Clean contact table
//   - leads.csv      — Spreadsheet import
//
// Usage:
//   node export.js                    # Generate all output files
//   node export.js --format csv       # CSV only
//   node export.js --format report    # Report only
//   node export.js --format outreach  # Outreach emails only

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  config, logPipeline, getLeads,
} from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    format: "all",
    status: null,
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--format": opts.format = args[++i]; break;
      case "--status": opts.status = args[++i]; break;
      case "--output": opts.output = args[++i]; break;
    }
  }
  return opts;
}

// ── Data Loading ────────────────────────────────────────────────────────────

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadOutreachData() {
  const file = path.join(config.leadsDir, "stage6-outreach.json");
  const data = loadJSON(file);
  if (!data?.generated) return {};
  const map = {};
  for (const item of data.generated) {
    map[item.leadId] = item;
  }
  return map;
}

function loadDeployData() {
  const file = path.join(config.leadsDir, "stage5-deployed.json");
  const data = loadJSON(file);
  if (!data?.deployed) return {};
  const map = {};
  for (const item of data.deployed) {
    map[item.leadId] = item;
  }
  return map;
}

function loadEnrichmentData() {
  // Try verified first, then enriched
  const verifiedFile = path.join(config.leadsDir, "stage2-verified.json");
  const enrichedFile = path.join(config.leadsDir, "stage2-enriched.json");
  let items = [];
  const verified = loadJSON(verifiedFile);
  if (Array.isArray(verified)) {
    items = verified;
  } else if (verified?.verified) {
    items = verified.verified;
  }
  if (items.length === 0) {
    const enriched = loadJSON(enrichedFile);
    if (Array.isArray(enriched)) items = enriched;
    else if (enriched?.verified) items = enriched.verified;
    else if (enriched?.enriched) items = enriched.enriched;
  }
  const map = {};
  for (const item of items) {
    const id = item.leadId || item.id;
    if (id) map[id] = item;
  }
  return map;
}

// ── Report Generator ────────────────────────────────────────────────────────

function generateReport(leads, outreachMap, deployMap) {
  const date = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push(`# Pipeline Report — ${date}`);
  lines.push("");

  // Summary stats
  const total = leads.length;
  const active = leads.filter(l => l.status === "active").length;
  const dropped = leads.filter(l => l.status === "dropped").length;
  const withDemo = leads.filter(l => l.demoUrl).length;
  const withOutreach = leads.filter(l => outreachMap[l.id]).length;
  const avgScore = total > 0
    ? Math.round(leads.reduce((a, l) => a + (l.qualificationScore || 0), 0) / total)
    : 0;

  lines.push("## Summary");
  lines.push("");
  lines.push(`  Total leads found:     ${total}`);
  lines.push(`  Active leads:          ${active}`);
  lines.push(`  Dropped leads:         ${dropped}`);
  lines.push(`  Demos deployed:        ${withDemo}`);
  lines.push(`  Outreach emails ready: ${withOutreach}`);
  lines.push(`  Average score:         ${avgScore}/100`);
  lines.push("");

  // ── All Deployed Demos ──
  const deployed = leads
    .filter(l => l.demoUrl)
    .sort((a, b) => (b.qualificationScore || 0) - (a.qualificationScore || 0));

  if (deployed.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## All Deployed Demos");
    lines.push("");

    for (let i = 0; i < deployed.length; i++) {
      const lead = deployed[i];
      const outreach = outreachMap[lead.id];
      const score = lead.qualificationScore || 0;

      lines.push(`### ${i + 1}. ${lead.businessName}`);
      lines.push("");
      lines.push(`  Score:        ${score}/100`);
      lines.push(`  Phone:        ${lead.phone || "N/A"}`);
      lines.push(`  Email:        ${lead.verifiedEmail || "N/A"}`);
      lines.push(`  Owner:        ${lead.ownerName || "N/A"}`);
      lines.push(`  Address:      ${lead.address || "N/A"}`);
      lines.push(`  Website:      ${lead.website || "N/A"}`);
      lines.push(`  Reviews:      ${lead.reviewCount || 0} (avg ${lead.rating || 0} stars)`);
      lines.push(`  Demo URL:     https://${lead.demoUrl}`);
      lines.push(`  Status:       ${lead.status}`);
      lines.push("");

      if (outreach) {
        lines.push(`  Email Subject: ${outreach.subject}`);
        lines.push("");
        lines.push(`  Email Body:`);
        lines.push(`  ${"·".repeat(60)}`);
        const bodyLines = outreach.body.split("\n");
        for (const bl of bodyLines) {
          lines.push(`  ${bl}`);
        }
        lines.push(`  ${"·".repeat(60)}`);
        lines.push("");
      }

      lines.push("");
    }
  }

  // ── Qualified leads (with outreach) ──
  const qualified = leads
    .filter(l => outreachMap[l.id])
    .sort((a, b) => (b.qualificationScore || 0) - (a.qualificationScore || 0));

  if (qualified.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Qualified Leads (Ready to Contact)");
    lines.push("");

    for (let i = 0; i < qualified.length; i++) {
      const lead = qualified[i];
      const outreach = outreachMap[lead.id];
      const deploy = deployMap[lead.id];
      const score = lead.qualificationScore || 0;

      lines.push(`### ${i + 1}. ${lead.businessName}`);
      lines.push("");
      lines.push(`  Score:        ${score}/100`);
      lines.push(`  Phone:        ${lead.phone || "N/A"}`);
      lines.push(`  Email:        ${lead.verifiedEmail || "N/A"}`);
      lines.push(`  Owner:        ${lead.ownerName || "N/A"}`);
      lines.push(`  Address:      ${lead.address || "N/A"}`);
      lines.push(`  Website:      ${lead.website || "N/A"}`);
      lines.push(`  Reviews:      ${lead.reviewCount || 0} (avg ${lead.rating || 0} stars)`);
      lines.push(`  Demo URL:     https://${outreach.demoUrl || deploy?.demoUrl || "N/A"}`);
      lines.push("");

      if (outreach) {
        lines.push(`  Email Subject: ${outreach.subject}`);
        lines.push("");
        lines.push(`  Email Body:`);
        lines.push(`  ${"·".repeat(60)}`);
        const bodyLines = outreach.body.split("\n");
        for (const bl of bodyLines) {
          lines.push(`  ${bl}`);
        }
        lines.push(`  ${"·".repeat(60)}`);
        lines.push("");
      }

      lines.push(`  Status: ${outreach.status || "needs_review"}`);
      lines.push("");
    }
  }

  // ── Leads needing manual review (exclude already deployed) ──
  const manualReview = leads.filter(l =>
    l.status === "active" && !outreachMap[l.id] && l.verifiedEmail && !l.demoUrl
  );

  if (manualReview.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Leads Needing Attention");
    lines.push("");

    for (const lead of manualReview) {
      lines.push(`  - ${lead.businessName}`);
      lines.push(`    Phone: ${lead.phone || "N/A"} | Email: ${lead.verifiedEmail || "N/A"}`);
      lines.push(`    Reason: No outreach generated (run stage 6 again if needed)`);
      lines.push("");
    }
  }

  // ── Dropped leads ──
  const droppedLeads = leads.filter(l => l.status === "dropped");

  if (droppedLeads.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Dropped Leads");
    lines.push("");

    for (const lead of droppedLeads) {
      lines.push(`  - ${lead.businessName || lead.id}`);
      lines.push(`    Reason: ${lead.dropReason || "unknown"}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  return lines.join("\n");
}

// ── Outreach File Generator ─────────────────────────────────────────────────

function generateOutreach(leads, outreachMap) {
  const lines = [];

  const qualified = leads
    .filter(l => outreachMap[l.id])
    .sort((a, b) => (b.qualificationScore || 0) - (a.qualificationScore || 0));

  for (let i = 0; i < qualified.length; i++) {
    const lead = qualified[i];
    const outreach = outreachMap[lead.id];

    lines.push(`${"═".repeat(70)}`);
    lines.push(`  ${i + 1}. ${lead.businessName}`);
    lines.push(`  Score: ${lead.qualificationScore || 0}/100 | Phone: ${lead.phone || "N/A"}`);
    lines.push(`  Demo: https://${outreach.demoUrl}`);
    lines.push(`${"═".repeat(70)}`);
    lines.push("");
    lines.push(`  Subject: ${outreach.subject}`);
    lines.push("");
    lines.push(outreach.body);
    lines.push("");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Leads Table Generator ───────────────────────────────────────────────────

function generateLeadsTable(leads, outreachMap, deployMap) {
  const lines = [];

  lines.push("LEAD CONTACTS");
  lines.push(`${"═".repeat(70)}`);
  lines.push("");

  // Deduplicate by businessName (keep the one with higher score or demoUrl)
  const seen = new Map();
  for (const lead of leads) {
    if (!lead.verifiedEmail && !lead.phone) continue;
    const key = lead.businessName;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, lead);
    } else {
      // Keep the one with demoUrl, or higher score
      if (lead.demoUrl && !existing.demoUrl) seen.set(key, lead);
      else if (!lead.demoUrl && !existing.demoUrl && (lead.qualificationScore || 0) > (existing.qualificationScore || 0)) seen.set(key, lead);
    }
  }

  const unique = [...seen.values()].sort((a, b) => {
    if (a.demoUrl && !b.demoUrl) return -1;
    if (!a.demoUrl && b.demoUrl) return 1;
    return (b.qualificationScore || 0) - (a.qualificationScore || 0);
  });

  for (const lead of unique) {
    const outreach = outreachMap[lead.id];
    const deployed = lead.demoUrl ? "DEPLOYED" : "";
    const outreachStatus = outreach ? "EMAILED" : (lead.verifiedEmail ? "NO EMAIL" : "NEEDS EMAIL");
    const status = deployed || outreachStatus;

    lines.push(`${lead.businessName}`);
    lines.push(`  Phone:    ${lead.phone || "N/A"}`);
    lines.push(`  Email:    ${lead.verifiedEmail || "N/A"}`);
    lines.push(`  Owner:    ${lead.ownerName || "N/A"}`);
    lines.push(`  Website:  ${lead.website || "N/A"}`);
    lines.push(`  Address:  ${lead.address || "N/A"}`);
    lines.push(`  Score:    ${lead.qualificationScore || 0}/100`);
    if (lead.demoUrl) lines.push(`  Demo:     https://${lead.demoUrl}`);
    lines.push(`  Status:   ${status}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── CSV Generator ───────────────────────────────────────────────────────────

function generateCSV(leads, outreachMap, deployMap) {
  const headers = [
    "Business Name", "Phone", "Email", "Owner", "Score",
    "Reviews", "Website", "Demo URL", "Outreach Subject", "Status"
  ];

  // Deduplicate by businessName
  const seenCsv = new Map();
  for (const l of leads) {
    if (!l.verifiedEmail && !l.phone) continue;
    const key = l.businessName;
    const existing = seenCsv.get(key);
    if (!existing) seenCsv.set(key, l);
    else if (l.demoUrl && !existing.demoUrl) seenCsv.set(key, l);
    else if (!l.demoUrl && !existing.demoUrl && (l.qualificationScore || 0) > (existing.qualificationScore || 0)) seenCsv.set(key, l);
  }

  const rows = [...seenCsv.values()]
    .sort((a, b) => {
      if (a.demoUrl && !b.demoUrl) return -1;
      if (!a.demoUrl && b.demoUrl) return 1;
      return (b.qualificationScore || 0) - (a.qualificationScore || 0);
    })
    .map(l => {
      const outreach = outreachMap[l.id];
      const demoUrl = outreach?.demoUrl || deployMap[l.id]?.demoUrl || "";
      return [
        l.businessName || "",
        l.phone || "",
        l.verifiedEmail || "",
        l.ownerName || "",
        l.qualificationScore || 0,
        l.reviewCount || 0,
        l.website || "",
        demoUrl ? `https://${demoUrl}` : "",
        outreach?.subject || "",
        outreach?.status || (l.status === "dropped" ? "dropped" : "no_outreach"),
      ];
    });

  const csvLines = [headers.join(",")];
  for (const row of rows) {
    csvLines.push(row.map(v => {
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
  }

  return csvLines.join("\n");
}

// ── Console Summary ─────────────────────────────────────────────────────────

function printSummary(leads, outreachMap, deployMap, outputDir) {
  const total = leads.length;
  const active = leads.filter(l => l.status === "active").length;
  const dropped = leads.filter(l => l.status === "dropped").length;
  const withDemo = leads.filter(l => outreachMap[l.id]).length;

  console.log("");
  console.log("Pipeline Run Complete");
  console.log(`${"─".repeat(50)}`);
  console.log(`  Leads found:       ${total}`);
  console.log(`  Active:            ${active}`);
  console.log(`  Dropped:           ${dropped}`);
  console.log(`  Demos + Outreach:  ${withDemo}`);
  console.log("");

  const qualified = leads
    .filter(l => outreachMap[l.id])
    .sort((a, b) => (b.qualificationScore || 0) - (a.qualificationScore || 0));

  if (qualified.length > 0) {
    console.log("Ready to contact:");
    console.log("");
    for (let i = 0; i < qualified.length; i++) {
      const l = qualified[i];
      const o = outreachMap[l.id];
      const score = l.qualificationScore || 0;
      console.log(`  ${i + 1}. ${l.businessName}`);
      console.log(`     Score: ${score}/100 | Phone: ${l.phone || "N/A"} | Email: ${l.verifiedEmail || "N/A"}`);
      console.log(`     Demo:  https://${o.demoUrl}`);
      console.log("");
    }
  }

  const noOutreach = leads.filter(l =>
    l.status === "active" && !outreachMap[l.id] && (l.verifiedEmail || l.phone)
  );

  if (noOutreach.length > 0) {
    console.log("Needs attention (no outreach generated):");
    console.log("");
    for (const l of noOutreach) {
      console.log(`  - ${l.businessName} | ${l.phone || "N/A"} | ${l.verifiedEmail || "N/A"}`);
    }
    console.log("");
  }

  console.log(`Output files saved to:`);
  console.log(`  ${outputDir}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

function runExport(opts) {
  logPipeline("export", "Starting output export");

  const leads = getLeads();

  if (leads.length === 0) {
    console.error("No leads found. Run the pipeline first.");
    process.exit(1);
  }

  const outreachMap = loadOutreachData();
  const deployMap = loadDeployData();
  const enrichmentMap = loadEnrichmentData();

  // Create date-stamped output folder
  const dateStr = new Date().toISOString().split("T")[0];
  const outputDir = path.join(config.leadsDir, dateStr);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Merge enrichment data (verified emails, owner names) into leads
  for (const lead of leads) {
    const enriched = enrichmentMap[lead.id];
    if (enriched) {
      if (enriched.verifiedEmail && !lead.verifiedEmail) {
        lead.verifiedEmail = enriched.verifiedEmail;
      }
      if (enriched.ownerName && !lead.ownerName) {
        lead.ownerName = enriched.ownerName;
      }
      if (enriched.contactVerified) {
        lead.contactVerified = true;
      }
      if (enriched.emailConfidence) {
        lead.emailConfidence = enriched.emailConfidence;
      }
    }
    // Also merge demo URL from outreach or deploy data
    if (!lead.demoUrl) {
      const outreach = outreachMap[lead.id];
      const deploy = deployMap[lead.id];
      if (outreach?.demoUrl) lead.demoUrl = outreach.demoUrl;
      else if (deploy?.demoUrl) lead.demoUrl = deploy.demoUrl;
    }
    // Merge outreach data from pipeline-leads.json if not in stage6
    if (!outreachMap[lead.id] && lead.outreachSubject && lead.outreachBody) {
      // Extract demo URL from outreach body if not set
      let demoUrl = lead.demoUrl || "";
      if (!demoUrl) {
        const urlMatch = lead.outreachBody.match(/(demo-[a-z0-9-]+\.vercel\.app)/i);
        if (urlMatch) demoUrl = urlMatch[1];
      }
      outreachMap[lead.id] = {
        leadId: lead.id,
        subject: lead.outreachSubject,
        body: lead.outreachBody,
        demoUrl: demoUrl,
        status: lead.outreachStatus || "needs_review",
      };
      // Also set lead.demoUrl if found
      if (!lead.demoUrl && demoUrl) lead.demoUrl = demoUrl;
    }
    // For deployed leads with no outreach data, create a placeholder
    if (!outreachMap[lead.id] && lead.demoUrl && lead.outreachGenerated) {
      outreachMap[lead.id] = {
        leadId: lead.id,
        subject: `AI Receptionist Demo for ${lead.businessName}`,
        body: `Hi ${lead.businessName} team,\n\nWe've set up a personalized AI receptionist demo for your practice. Check it out here: ${lead.demoUrl}\n\nLet us know if you have any questions!`,
        demoUrl: lead.demoUrl,
        status: "needs_review",
      };
    }
  }

  const format = opts.format;

  // Generate report
  if (format === "all" || format === "report") {
    const report = generateReport(leads, outreachMap, deployMap);
    const reportFile = path.join(outputDir, `REPORT.md`);
    fs.writeFileSync(reportFile, report);
    console.log(`Report:     ${reportFile}`);
  }

  // Generate outreach file
  if (format === "all" || format === "outreach") {
    const outreach = generateOutreach(leads, outreachMap);
    const outreachFile = path.join(outputDir, `OUTREACH.txt`);
    fs.writeFileSync(outreachFile, outreach);
    console.log(`Outreach:   ${outreachFile}`);
  }

  // Generate leads table
  if (format === "all" || format === "leads") {
    const leadsTable = generateLeadsTable(leads, outreachMap, deployMap);
    const leadsFile = path.join(outputDir, `LEADS.txt`);
    fs.writeFileSync(leadsFile, leadsTable);
    console.log(`Contacts:   ${leadsFile}`);
  }

  // Generate CSV
  if (format === "all" || format === "csv") {
    const csv = generateCSV(leads, outreachMap, deployMap);
    const csvFile = path.join(outputDir, `leads.csv`);
    fs.writeFileSync(csvFile, csv);
    console.log(`CSV:        ${csvFile}`);
  }

  // Print console summary
  printSummary(leads, outreachMap, deployMap, outputDir);

  logPipeline("export", "Export complete");
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
runExport(opts);
