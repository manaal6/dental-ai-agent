// ─── Stage 1: Manual Discovery (No API Key Needed) ──────────────────────────
// Alternative to Google Places API — lets you manually input businesses
// or use a CSV file. Useful for testing the pipeline without any API keys.
//
// Usage:
//   node discover-manual.js --csv businesses.csv
//   node discover-manual.js --interactive
//   node discover-manual.js --sample  # Use built-in sample data

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config, logLead, logPipeline, upsertLead, makeLeadId } from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    csv: null,
    interactive: false,
    sample: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--csv": opts.csv = args[++i]; break;
      case "--interactive": opts.interactive = true; break;
      case "--sample": opts.sample = true; break;
      case "--dry-run": opts.dryRun = true; break;
    }
  }
  return opts;
}

// ── Sample Data (Austin TX dental clinics) ──────────────────────────────────
const SAMPLE_DATA = [
  {
    businessName: "Austin Dental Care",
    address: "1234 Main St, Austin, TX 78701",
    phone: "(512) 555-0101",
    website: "https://austindentalcare.com",
    rating: 4.5,
    reviewCount: 85,
    vertical: "dental",
    city: "Austin",
    state: "TX",
    hours: ["Mon-Fri 8am-5pm", "Sat 9am-1pm"],
    signals: {
      noWebsite: false,
      noOnlineBooking: true,
      phoneComplaints: [
        { author: "John D.", text: "Hard to reach them by phone, always goes to voicemail", pattern: "hard.*reach" }
      ],
      reviewCount: 85,
      rating: 4.5,
      hasPhone: true,
      singleLocation: true,
    },
  },
  {
    businessName: "Lone Star Smiles",
    address: "5678 Oak Ave, Austin, TX 78702",
    phone: "(512) 555-0102",
    website: "",
    rating: 4.2,
    reviewCount: 42,
    vertical: "dental",
    city: "Austin",
    state: "TX",
    hours: ["Mon-Thu 9am-6pm"],
    signals: {
      noWebsite: true,
      noOnlineBooking: true,
      phoneComplaints: [],
      reviewCount: 42,
      rating: 4.2,
      hasPhone: true,
      singleLocation: true,
    },
  },
  {
    businessName: "Capital City Dentistry",
    address: "901 Congress Ave, Austin, TX 78701",
    phone: "(512) 555-0103",
    website: "https://capitalcitydentistry.com",
    rating: 3.8,
    reviewCount: 156,
    vertical: "dental",
    city: "Austin",
    state: "TX",
    hours: ["Mon-Fri 7am-7pm", "Sat 8am-2pm"],
    signals: {
      noWebsite: false,
      noOnlineBooking: true,
      phoneComplaints: [
        { author: "Sarah M.", text: "No one answered the phone, had to leave a voicemail and wait 2 days for a call back", pattern: "no one answered" },
        { author: "Mike R.", text: "Phone tag for days before I could book an appointment", pattern: "phone tag" },
      ],
      reviewCount: 156,
      rating: 3.8,
      hasPhone: true,
      singleLocation: true,
    },
  },
  {
    businessName: "Sunrise Dental Austin",
    address: "2345 Lamar Blvd, Austin, TX 78704",
    phone: "(512) 555-0104",
    website: "https://sunrisedentalaustin.com",
    rating: 4.7,
    reviewCount: 230,
    vertical: "dental",
    city: "Austin",
    state: "TX",
    hours: ["Mon-Fri 8am-6pm"],
    signals: {
      noWebsite: false,
      noOnlineBooking: false,
      phoneComplaints: [],
      reviewCount: 230,
      rating: 4.7,
      hasPhone: true,
      singleLocation: true,
    },
  },
  {
    businessName: "ATX Family Dental",
    address: "6789 Burnet Rd, Austin, TX 78757",
    phone: "(512) 555-0105",
    website: "",
    rating: 4.0,
    reviewCount: 67,
    vertical: "dental",
    city: "Austin",
    state: "TX",
    hours: ["Mon-Fri 9am-5pm"],
    signals: {
      noWebsite: true,
      noOnlineBooking: true,
      phoneComplaints: [
        { author: "Lisa K.", text: "Couldn't get through to schedule an appointment, voicemail was full", pattern: "couldn.*get through" }
      ],
      reviewCount: 67,
      rating: 4.0,
      hasPhone: true,
      singleLocation: true,
    },
  },
];

// ── CSV Parser (simple) ────────────────────────────────────────────────────
function parseCSV(csvContent) {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    data.push({
      businessName: row.name || row.business_name || row.businessname || "",
      address: row.address || "",
      phone: row.phone || row.phone_number || "",
      website: row.website || row.url || "",
      rating: parseFloat(row.rating) || 4.0,
      reviewCount: parseInt(row.reviews || row.review_count || "50", 10),
      vertical: row.vertical || row.industry || "dental",
      city: row.city || "Austin",
      state: row.state || "TX",
      hours: row.hours ? row.hours.split(";") : ["Mon-Fri 9am-5pm"],
      signals: {
        noWebsite: !row.website,
        noOnlineBooking: true, // Assume no booking unless told otherwise
        phoneComplaints: [],
        reviewCount: parseInt(row.reviews || row.review_count || "50", 10),
        rating: parseFloat(row.rating) || 4.0,
        hasPhone: !!row.phone,
        singleLocation: true,
      },
    });
  }
  return data;
}

// ── Main Discovery Flow ─────────────────────────────────────────────────────
async function discover(opts) {
  logPipeline("discovery", "Starting manual lead discovery (no API key needed)");

  let businesses;

  if (opts.sample) {
    logPipeline("discovery", `Using sample data: ${SAMPLE_DATA.length} businesses`);
    businesses = SAMPLE_DATA;
  } else if (opts.csv) {
    const csvPath = path.resolve(opts.csv);
    if (!fs.existsSync(csvPath)) {
      console.error(`❌ CSV file not found: ${csvPath}`);
      process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    businesses = parseCSV(csvContent);
    logPipeline("discovery", `Loaded ${businesses.length} businesses from CSV`);
  } else {
    console.error("❌ Provide --sample, --csv <file>, or --interactive");
    console.error("   Example: node discover-manual.js --sample");
    process.exit(1);
  }

  const qualified = [];

  for (const biz of businesses) {
    const leadId = makeLeadId(biz.businessName, Date.now().toString());

    logLead({
      leadId, stage: "discovery", status: "pass",
      message: `${biz.businessName} | Reviews: ${biz.reviewCount} | Website: ${biz.signals.noWebsite ? "MISSING" : "present"} | Booking: ${biz.signals.noOnlineBooking ? "MISSING" : "present"} | Phone complaints: ${biz.signals.phoneComplaints.length}`,
    });

    if (!opts.dryRun) {
      upsertLead(leadId, {
        ...biz,
        placeId: `manual-${leadId}`,
        stage: "discovery",
        stage1Score: 75, // Default score for manual entries
        stage1Signals: biz.signals,
      });
    }

    qualified.push({ leadId, ...biz });
  }

  // Save results
  const outputFile = path.join(config.leadsDir, "stage1-discovered.json");
  if (!opts.dryRun) {
    fs.writeFileSync(outputFile, JSON.stringify(qualified, null, 2));
  }

  logPipeline("discovery", `Complete: ${qualified.length} leads discovered`);

  return { qualified, dropped: [] };
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
discover(opts)
  .then((result) => {
    console.log(`\n✅ Stage 1 (Manual) complete: ${result.qualified.length} leads discovered`);
  })
  .catch((err) => {
    console.error("\n❌ Stage 1 failed:", err.message);
    process.exit(1);
  });
