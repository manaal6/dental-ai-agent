// ─── Shared Pipeline Configuration ──────────────────────────────────────────
// All thresholds, API endpoints, and tunables live here.
// Edit this file to adjust pipeline behavior without touching stage code.

import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

export default {
  // ── Paths ────────────────────────────────────────────────────────────────
  root: ROOT,
  dataDir: path.join(ROOT, "data"),
  leadsDir: path.join(ROOT, "data/leads"),
  configsDir: path.join(ROOT, "data/configs"),
  logsDir: path.join(ROOT, "data/logs"),
  templateDir: path.join(ROOT, "template"),

  // ── Stage 1 — Lead Discovery ─────────────────────────────────────────────
  discovery: {
    // Default search parameters
    vertical: "dental clinic",
    city: "Austin",
    state: "TX",
    country: "US",
    // Minimum review count to prove real call volume
    minReviewCount: 20,
    // Search radius in meters (32km ≈ 20 miles)
    searchRadius: 32000,
    // Max results per search
    maxResults: 60,
  },

  // ── Stage 2 — Enrichment (100% FREE) ──────────────────────────────────────
  // Scrapes emails from business websites. No paid APIs needed.
  enrichment: {
    provider: "free",
    minConfidence: 60,
    rateLimitMs: 500,
    requireVerifiedContact: true,
  },

  // ── Stage 3 — Qualification Scoring ──────────────────────────────────────
  scoring: {
    // Minimum score (0-100) to pass to Stage 4
    passingScore: 70,
    // Vertical weights (higher = more qualified)
    verticalWeights: {
      dental: 95,
      "med spa": 85,
      hvac: 80,
      salon: 60,
      default: 50,
    },
  },

  // ── Stage 5 — Deployment ─────────────────────────────────────────────────
  deployment: {
    // Which provider to use: "vercel" | "render" | "netlify"
    provider: process.env.DEPLOY_PROVIDER || "vercel",

    // Vercel API settings (FREE: unlimited deploys)
    vercel: {
      baseUrl: "https://api.vercel.com",
      // Team ID (optional, for personal accounts)
      teamId: process.env.VERCEL_TEAM_ID || "",
    },

    // Render API settings
    render: {
      baseUrl: "https://api.render.com/v1",
      plan: "starter",
      region: "oregon",
    },

    // Git settings for demo repos
    git: {
      branchPrefix: "demo-",
      repoPrefix: "dental-demo-",
    },
  },

  // ── Stage 1 — Discovery Provider ────────────────────────────────────────
  discoveryProvider: process.env.DISCOVERY_PROVIDER || "google", // "google" | "serpapi"

  // SerpAPI settings (FREE: 100 searches/month, no credit card)
  serpapi: {
    baseUrl: "https://serpapi.com/search.json",
    rateLimitMs: 2000,
  },

  // ── API Keys (loaded from .env) ──────────────────────────────────────────
  env: {
    // Discovery
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || "",
    SERP_API_KEY: process.env.SERP_API_KEY || "",

    // Enrichment (pick one)
    HUNTER_API_KEY: process.env.HUNTER_API_KEY || "",
    SNOV_CLIENT_ID: process.env.SNOV_CLIENT_ID || "",
    SNOV_CLIENT_SECRET: process.env.SNOV_CLIENT_SECRET || "",
    APOLLO_API_KEY: process.env.APOLLO_API_KEY || "",

    // Deployment (pick one)
    RENDER_API_KEY: process.env.RENDER_API_KEY || "",
    VERCEL_TOKEN: process.env.VERCEL_TOKEN || "",

    // LLM (already have)
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || "",
    GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  },

  // ── Dry Run ──────────────────────────────────────────────────────────────
  // When true, Stages 4-5 generate config but skip git push/deploy
  // Default: false (live mode). Pass --dry-run to preview without saving.
  dryRun: process.env.DRY_RUN === "true",
};
