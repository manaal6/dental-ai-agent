// ─── Pipeline Logger ─────────────────────────────────────────────────────────
// Logs every lead's pipeline status and failure reason at each stage.
// Output: JSON lines to data/logs/pipeline-YYYY-MM-DD.jsonl

import fs from "fs";
import path from "path";
import config from "./config.js";

const LOG_DIR = config.logsDir;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile() {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `pipeline-${date}.jsonl`);
}

/**
 * Log a pipeline event for a specific lead.
 * @param {Object} params
 * @param {string} params.leadId - Unique lead identifier (place ID or slug)
 * @param {string} params.stage - Stage name (e.g. "discovery", "enrichment")
 * @param {string} params.status - "pass", "fail", "skip", "error"
 * @param {string} params.message - Human-readable description
 * @param {Object} [params.data] - Additional structured data
 */
export function logLead({ leadId, stage, status, message, data = {} }) {
  const entry = {
    timestamp: new Date().toISOString(),
    leadId,
    stage,
    status,
    message,
    ...data,
  };

  const line = JSON.stringify(entry);
  fs.appendFileSync(getLogFile(), line + "\n");

  // Also print to console with emoji
  const emoji = { pass: "✅", fail: "❌", skip: "⏭️", error: "💥", info: "ℹ️" }[status] || "📝";
  console.log(`  ${emoji} [${stage}] ${leadId}: ${message}`);
}

/**
 * Log a general pipeline event (not lead-specific).
 */
export function logPipeline(stage, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    leadId: null,
    stage,
    status: "info",
    message,
    ...data,
  };

  const line = JSON.stringify(entry);
  fs.appendFileSync(getLogFile(), line + "\n");
  console.log(`  📋 [${stage}] ${message}`);
}

/**
 * Get all log entries for a specific lead.
 */
export function getLeadLogs(leadId) {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return [];

  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  return lines
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((entry) => entry && entry.leadId === leadId);
}

/**
 * Get summary of all leads processed today.
 */
export function getDailySummary() {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return { total: 0, passed: 0, failed: 0, skipped: 0 };

  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  const entries = lines
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  // Group by leadId and take the final status per stage
  const leads = {};
  for (const entry of entries) {
    if (!entry.leadId) continue;
    if (!leads[entry.leadId]) leads[entry.leadId] = {};
    leads[entry.leadId][entry.stage] = entry.status;
  }

  const total = Object.keys(leads).length;
  const passed = Object.values(leads).filter((s) => s.enrichment === "pass").length;
  const failed = Object.values(leads).filter((s) =>
    Object.values(s).includes("fail") || Object.values(s).includes("error")
  ).length;
  const skipped = total - passed - failed;

  return { total, passed, failed, skipped, leads };
}
