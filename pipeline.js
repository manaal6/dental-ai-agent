// ─── Pipeline Runner ─────────────────────────────────────────────────────────
// Main entry point for the lead pipeline.
// Can run all stages or individual stages, with dry-run support.
//
// Usage:
//   node pipeline.js                           # Run Stages 1-2 (default)
//   node pipeline.js --stage 1                 # Run only Stage 1
//   node pipeline.js --stage 2                 # Run only Stage 2
//   node pipeline.js --all                     # Run all stages (1-7)
//   node pipeline.js --vertical HVAC --city Dallas --state TX
//   node pipeline.js --dry-run                 # Dry run (no saves/deploys)
//   node pipeline.js --summary                 # Show today's pipeline summary

import { config, logPipeline, getDailySummary, exportLeadsCSV } from "./pipeline/shared/index.js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    stage: null,
    all: false,
    dryRun: false,
    summary: false,
    vertical: config.discovery.vertical,
    city: config.discovery.city,
    state: config.discovery.state,
    limit: 20,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--stage": opts.stage = parseInt(args[++i], 10); break;
      case "--all": opts.all = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--summary": opts.summary = true; break;
      case "--vertical": opts.vertical = args[++i]; break;
      case "--city": opts.city = args[++i]; break;
      case "--state": opts.state = args[++i]; break;
      case "--limit": opts.limit = parseInt(args[++i], 10); break;
    }
  }
  return opts;
}

// ── Stage Runners ───────────────────────────────────────────────────────────
async function runStage1(opts) {
  logPipeline("pipeline", `Stage 1: Lead Discovery — ${opts.vertical} in ${opts.city}, ${opts.state}`);
  execSync(`node pipeline/stage1-discovery/discover.js --vertical "${opts.vertical}" --city "${opts.city}" --state "${opts.state}" --limit ${opts.limit}${opts.dryRun ? " --dry-run" : ""}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage2(opts) {
  logPipeline("pipeline", "Stage 2: Enrichment (Free — Website Scraping)");
  execSync(`node pipeline/stage2-enrichment/enrich.js${opts.dryRun ? " --dry-run" : ""}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage3(opts) {
  logPipeline("pipeline", "Stage 3: Qualification Scoring");
  execSync(`node pipeline/stage3-qualification/score.js${opts.dryRun ? " --dry-run" : ""}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage4(opts) {
  logPipeline("pipeline", "Stage 4: Demo Customization");
  execSync(`node pipeline/stage4-demo/customize.js${opts.dryRun ? " --dry-run" : ""}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage5(opts) {
  logPipeline("pipeline", "Stage 5: Deployment to Vercel");
  const liveFlag = opts.dryRun ? "" : " --live";
  execSync(`node pipeline/stage5-deploy/deploy.js${opts.dryRun ? " --dry-run" : liveFlag}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage6(opts) {
  logPipeline("pipeline", "Stage 6: Outreach Generation");
  execSync(`node pipeline/stage6-outreach/generate.js${opts.dryRun ? " --dry-run" : ""}`, { cwd: config.root, stdio: "inherit" });
}

async function runStage7(opts) {
  logPipeline("pipeline", "Stage 7: Output Export");
  execSync(`node pipeline/stage7-output/export.js --format all`, { cwd: config.root, stdio: "inherit" });
}

// ── Summary ─────────────────────────────────────────────────────────────────
function showSummary() {
  const summary = getDailySummary();
  console.log("\n📊 Pipeline Summary (Today)");
  console.log("─".repeat(40));
  console.log(`  Total leads processed: ${summary.total}`);
  console.log(`  ✅ Verified & passed:  ${summary.passed}`);
  console.log(`  ❌ Dropped:            ${summary.failed}`);
  console.log(`  ⏭️  Skipped:            ${summary.skipped}`);

  if (summary.total > 0) {
    console.log("\n  Lead details:");
    for (const [id, stages] of Object.entries(summary.leads)) {
      const stageStr = Object.entries(stages)
        .map(([s, st]) => `${s}:${st}`)
        .join(" → ");
      console.log(`    ${id}: ${stageStr}`);
    }
  }
}

// ── Export CSV ──────────────────────────────────────────────────────────────
function exportCSV() {
  const leads = exportLeadsCSV();
  if (leads.length === 0) {
    console.log("   No leads to export");
    return;
  }

  const headers = Object.keys(leads[0]);
  const csv = [
    headers.join(","),
    ...leads.map((row) =>
      headers.map((h) => `"${(row[h] || "").toString().replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const outFile = path.join(config.leadsDir, `pipeline-export-${new Date().toISOString().split("T")[0]}.csv`);
  fs.writeFileSync(outFile, csv);
  console.log(`\n📄 CSV exported: ${outFile}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log("\n🚀 AI Receptionist — Lead Pipeline");
  console.log("═".repeat(50));
  console.log(`  Target: ${opts.vertical} in ${opts.city}, ${opts.state}`);
  console.log(`  Mode: ${opts.dryRun ? "🧪 DRY RUN" : "🔴 LIVE"}`);
  console.log("═".repeat(50));

  if (opts.summary) {
    showSummary();
    return;
  }

  try {
    if (opts.all) {
      // Run all stages
      console.log("\n📋 Running ALL stages (1-7)");
      await runStage1(opts);
      await runStage2(opts);
      await runStage3(opts);
      await runStage4(opts);
      await runStage5(opts);
      await runStage6(opts);
      await runStage7(opts);
    } else if (opts.stage) {
      // Run specific stage
      switch (opts.stage) {
        case 1: await runStage1(opts); break;
        case 2: await runStage2(opts); break;
        case 3: await runStage3(opts); break;
        case 4: await runStage4(opts); break;
        case 5: await runStage5(opts); break;
        case 6: await runStage6(opts); break;
        case 7: await runStage7(opts); break;
        default:
          console.error(`❌ Invalid stage: ${opts.stage}. Must be 1-7.`);
          process.exit(1);
      }
    } else {
      // Default: run Stages 1-2 (build & validate before scaling)
      console.log("\n📋 Running Stages 1-2 (default — build & validate first)");
      await runStage1(opts);
      await runStage2(opts);
    }

    // Show summary after run
    showSummary();

    // Export CSV if any leads passed
    exportCSV();

  } catch (err) {
    console.error("\n❌ Pipeline failed:", err.message);
    process.exit(1);
  }
}

main();
