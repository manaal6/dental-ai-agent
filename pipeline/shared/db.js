// ─── Lead Database ───────────────────────────────────────────────────────────
// Simple JSON-file-based persistence for lead pipeline state.
// Each lead gets a unique ID and tracks its journey through all stages.

import fs from "fs";
import path from "path";
import config from "./config.js";

const DB_FILE = path.join(config.leadsDir, "pipeline-leads.json");

// Ensure directory exists
if (!fs.existsSync(config.leadsDir)) {
  fs.mkdirSync(config.leadsDir, { recursive: true });
}

function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/**
 * Generate a unique lead ID from business name + place ID.
 */
export function makeLeadId(name, placeId) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const shortId = placeId ? placeId.slice(-8) : Date.now().toString(36);
  return `${slug}-${shortId}`;
}

/**
 * Create or update a lead record.
 */
export function upsertLead(leadId, data) {
  const db = readDB();
  if (!db[leadId]) {
    db[leadId] = {
      id: leadId,
      createdAt: new Date().toISOString(),
      stage: "discovery",
      status: "active",
      contactVerified: false,
      qualificationScore: 0,
      demoUrl: null,
      outreachGenerated: false,
    };
  }
  Object.assign(db[leadId], data, { updatedAt: new Date().toISOString() });
  writeDB(db);
  return db[leadId];
}

/**
 * Get a single lead by ID.
 */
export function getLead(leadId) {
  const db = readDB();
  return db[leadId] || null;
}

/**
 * Get all leads, optionally filtered by status or stage.
 */
export function getLeads({ stage, status, contactVerified } = {}) {
  const db = readDB();
  let leads = Object.values(db);

  if (stage) leads = leads.filter((l) => l.stage === stage);
  if (status) leads = leads.filter((l) => l.status === status);
  if (typeof contactVerified === "boolean") {
    leads = leads.filter((l) => l.contactVerified === contactVerified);
  }

  return leads;
}

/**
 * Update lead stage (tracks progression through pipeline).
 */
export function advanceStage(leadId, newStage, reason) {
  const db = readDB();
  if (!db[leadId]) throw new Error(`Lead ${leadId} not found`);

  const oldStage = db[leadId].stage;
  db[leadId].stage = newStage;
  db[leadId].updatedAt = new Date().toISOString();

  if (!db[leadId].stageHistory) db[leadId].stageHistory = [];
  db[leadId].stageHistory.push({
    from: oldStage,
    to: newStage,
    reason,
    timestamp: new Date().toISOString(),
  });

  writeDB(db);
  return db[leadId];
}

/**
 * Mark a lead as dropped (failed at a stage).
 */
export function dropLead(leadId, stage, reason) {
  const db = readDB();
  if (!db[leadId]) throw new Error(`Lead ${leadId} not found`);

  db[leadId].status = "dropped";
  db[leadId].dropStage = stage;
  db[leadId].dropReason = reason;
  db[leadId].updatedAt = new Date().toISOString();

  writeDB(db);
  return db[leadId];
}

/**
 * Get leads that were dropped (for debugging/review).
 */
export function getDroppedLeads() {
  const db = readDB();
  return Object.values(db).filter((l) => l.status === "dropped");
}

/**
 * Check if a demo has already been deployed for a lead (prevent redeployment).
 */
export function hasDeployedDemo(leadId) {
  const db = readDB();
  return !!(db[leadId]?.demoUrl);
}

/**
 * Export all leads as CSV-ready array.
 */
export function exportLeadsCSV() {
  const db = readDB();
  return Object.values(db).map((l) => ({
    "Business Name": l.businessName || "",
    "Owner Name": l.ownerName || "",
    "Verified Contact": l.verifiedEmail || l.verifiedPhone || "",
    "Score": l.qualificationScore || 0,
    "Demo URL": l.demoUrl || "",
    "Outreach Generated": l.outreachGenerated ? "Yes" : "No",
    "Status": l.status || "",
    "Drop Reason": l.dropReason || "",
  }));
}
