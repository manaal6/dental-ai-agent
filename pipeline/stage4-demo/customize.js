// ─── Stage 4: Demo Customization ─────────────────────────────────────────────
// Take the existing product template (clinic.json) and auto-generate a
// business-specific instance per lead.
//
// Auto-fills only structured fields — does NOT auto-write the full voice script.
// Uses vertical-specific templates (dental, HVAC, etc.) and parameter-substitutes.
//
// Usage:
//   node customize.js                         # Customize all Stage 3 leads
//   node customize.js --input stage3-scored.json
//   node customize.js --lead-id foo-123       # Single lead
//   node customize.js --dry-run               # Preview without saving

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  config, logLead, logPipeline,
  getLead, getLeads, upsertLead, advanceStage,
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

// ── Vertical-Specific Templates ─────────────────────────────────────────────
const VERTICAL_TEMPLATES = {
  dental: {
    greeting: "Hello! Thank you for calling {businessName}. How can I help you today?",
    services: [
      "check-ups", "cleaning", "whitening", "fillings",
      "Invisalign", "root canal", "crowns", "bridges",
      "wisdom tooth extractions", "implants", "periodontal treatment",
    ],
    callFlow: [
      "STEP 1 — Greeting: Warm welcome, identify as {businessName} receptionist",
      "STEP 2 — Understand: Ask what treatment or concern they have",
      "STEP 3 — Follow-up: One question to narrow down the service needed",
      "STEP 4 — Collect Name: Ask for their name naturally",
      "STEP 5 — Collect Phone: Ask for phone number for appointment confirmation",
      "STEP 6 — Confirm: Read back name, phone, and treatment needed",
      "STEP 7 — Close: Thank them, say team will confirm the appointment",
    ],
    systemPrompt: `You are the AI Reception Agent for {businessName} in {location}.
Speak warmly, professionally, and naturally — like a real, friendly front-desk receptionist on the phone.

CLINIC FACTS:
- Phone: {phone}
- Hours: {hours}
- Services: {services}
- Website: {website}

Follow this call flow STRICTLY:
{callFlow}

STRICT RULES:
- Maximum 2 sentences per reply. Never longer.
- Never output JSON, bullet points, or markdown.
- Never break character.
- Plain spoken language only.
- If asked something off-topic, gently steer back to booking or their needs.`,
  },

  hvac: {
    greeting: "Hello! Thank you for calling {businessName}. How can I help you with your heating or cooling today?",
    services: [
      "AC repair", "furnace repair", "AC installation", "furnace installation",
      "duct cleaning", "thermostat installation", "emergency repair",
      "maintenance plans", "indoor air quality", "heat pump services",
    ],
    callFlow: [
      "STEP 1 — Greeting: Warm welcome, identify as {businessName} receptionist",
      "STEP 2 — Understand: Ask if this is for emergency service, repair, or installation",
      "STEP 3 — Follow-up: One question about their system or issue",
      "STEP 4 — Collect Name: Ask for their name",
      "STEP 5 — Collect Phone: Ask for phone number to schedule",
      "STEP 6 — Confirm: Read back name, phone, and service needed",
      "STEP 7 — Close: Thank them, say someone will call to confirm scheduling",
    ],
    systemPrompt: `You are the AI Reception Agent for {businessName} in {location}.
Speak warmly, professionally, and naturally — like a real, friendly front-desk person on the phone.

COMPANY FACTS:
- Phone: {phone}
- Hours: {hours}
- Services: {services}
- Website: {website}

Follow this call flow STRICTLY:
{callFlow}

STRICT RULES:
- Maximum 2 sentences per reply.
- Never output JSON, bullet points, or markdown.
- Never break character.
- Plain spoken language only.
- If asked about pricing, offer to have the team provide an estimate.`,
  },

  "med spa": {
    greeting: "Hello! Thank you for calling {businessName}. How can I help you today?",
    services: [
      "Botox", "dermal fillers", "laser hair removal", "chemical peels",
      "microdermabrasion", "facials", "body contouring", "skin tightening",
      "PRP therapy", "IV therapy", "weight management",
    ],
    callFlow: [
      "STEP 1 — Greeting: Warm, welcoming tone — identify as {businessName}",
      "STEP 2 — Understand: Ask what treatment or concern they're interested in",
      "STEP 3 — Follow-up: One question to understand their goals",
      "STEP 4 — Collect Name: Ask for their name",
      "STEP 5 — Collect Phone: Ask for phone number to schedule consultation",
      "STEP 6 — Confirm: Read back name, phone, and treatment interest",
      "STEP 7 — Close: Thank them, say the team will reach out to confirm",
    ],
    systemPrompt: `You are the AI Reception Agent for {businessName} in {location}.
Speak warmly, professionally, and naturally — like a real, friendly front-desk person on the phone.

CLINIC FACTS:
- Phone: {phone}
- Hours: {hours}
- Services: {services}
- Website: {website}

Follow this call flow STRICTLY:
{callFlow}

STRICT RULES:
- Maximum 2 sentences per reply.
- Never output JSON, bullet points, or markdown.
- Never break character.
- Plain spoken language only.
- Never quote exact prices — offer to have the team confirm.`,
  },

  salon: {
    greeting: "Hello! Thank you for calling {businessName}. How can I help you today?",
    services: [
      "haircut", "hair coloring", "highlights", "blowout",
      "manicure", "pedicure", "gel nails", "facial",
      "waxing", "bridal styling", "blow dry bar",
    ],
    callFlow: [
      "STEP 1 — Greeting: Warm welcome, identify as {businessName} receptionist",
      "STEP 2 — Understand: Ask what service they're looking for",
      "STEP 3 — Follow-up: One question about style or timing preference",
      "STEP 4 — Collect Name: Ask for their name",
      "STEP 5 — Collect Phone: Ask for phone number to confirm appointment",
      "STEP 6 — Confirm: Read back name, phone, and service",
      "STEP 7 — Close: Thank them, say someone will confirm the appointment",
    ],
    systemPrompt: `You are the AI Reception Agent for {businessName} in {location}.
Speak warmly, professionally, and naturally — like a real, friendly front-desk person on the phone.

SALON FACTS:
- Phone: {phone}
- Hours: {hours}
- Services: {services}
- Website: {website}

Follow this call flow STRICTLY:
{callFlow}

STRICT RULES:
- Maximum 2 sentences per reply.
- Never output JSON, bullet points, or markdown.
- Never break character.
- Plain spoken language only.`,
  },
};

// ── Demo Customization Logic ────────────────────────────────────────────────

/**
 * Build a customized clinic.json for a lead.
 */
function buildDemoConfig(lead) {
  const vertical = lead.vertical || "dental";
  const template = VERTICAL_TEMPLATES[vertical] || VERTICAL_TEMPLATES.dental;

  const businessName = lead.businessName || "Unknown Business";
  const location = `${lead.city || ""}, ${lead.state || ""}`.trim() || "your area";
  const phone = lead.phone || "your phone number";
  const website = lead.website || "your website";
  const hours = Array.isArray(lead.hours) && lead.hours.length > 0
    ? lead.hours.join("; ")
    : "Mon-Fri 9am-5pm";

  // Use services from Google Places if available, otherwise use template defaults
  const services = lead.services
    ? (Array.isArray(lead.services) ? lead.services.join(", ") : lead.services)
    : template.services.join(", ");

  // Substitute parameters into templates
  const substitutions = {
    "{businessName}": businessName,
    "{location}": location,
    "{phone}": phone,
    "{website}": website,
    "{hours}": hours,
    "{services}": services,
  };

  function substitute(text) {
    let result = text;
    for (const [key, value] of Object.entries(substitutions)) {
      result = result.replaceAll(key, value);
    }
    return result;
  }

  // Build the demo config
  const demoConfig = {
    name: businessName,
    location: location,
    website: website,
    phone: phone,
    hours: hours,
    services: services,
    practices: `${businessName} in ${location}`,
    offer: "Call us today for a consultation!",
    rating: `Rated ${lead.rating || "N/A"} stars from ${lead.reviewCount || "N/A"} Google reviews.`,
    avatarLetter: businessName.charAt(0).toUpperCase(),
    // Pipeline metadata
    _pipeline: {
      leadId: lead.id || lead.leadId,
      vertical: vertical,
      createdAt: new Date().toISOString(),
      qualificationScore: lead.qualificationScore || 0,
      verifiedEmail: lead.verifiedEmail || null,
      stage1Signals: lead.stage1Signals || lead.signals || {},
    },
  };

  // Build the voice agent system prompt
  const systemPrompt = substitute(template.systemPrompt);

  // Build the call flow
  const callFlow = template.callFlow.map(substitute);

  return {
    demoConfig,
    systemPrompt,
    callFlow,
    vertical,
    templateName: vertical,
  };
}

/**
 * Save demo config to disk.
 */
function saveDemoConfig(leadId, demoData, dryRun) {
  if (dryRun) return;

  const configDir = config.configsDir;
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Save clinic.json for this lead
  const configFile = path.join(configDir, `${leadId}.json`);
  fs.writeFileSync(configFile, JSON.stringify(demoData.demoConfig, null, 2));

  // Save the full demo data (includes system prompt, call flow)
  const fullDataFile = path.join(configDir, `${leadId}-full.json`);
  fs.writeFileSync(fullDataFile, JSON.stringify(demoData, null, 2));

  logLead({
    leadId, stage: "demo", status: "info",
    message: `Config saved: ${configFile}`,
  });
}

// ── Main Customization Flow ─────────────────────────────────────────────────
async function customize(opts) {
  logPipeline("demo", "Starting demo customization");

  // Load leads from Stage 3 output
  let leads;
  if (opts.input) {
    const inputPath = path.join(config.leadsDir, opts.input);
    const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    leads = data.qualified || data;
  } else if (opts.leadId) {
    const lead = getLead(opts.leadId);
    if (!lead) {
      console.error(`❌ Lead ${opts.leadId} not found`);
      process.exit(1);
    }
    leads = [lead];
  } else {
    const inputFile = path.join(config.leadsDir, "stage3-scored.json");
    if (!fs.existsSync(inputFile)) {
      console.error("❌ No Stage 3 output found. Run Stage 3 first.");
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    leads = data.qualified || [];
  }

  if (leads.length === 0) {
    console.error("❌ No qualified leads to customize.");
    process.exit(1);
  }

  logPipeline("demo", `Customizing demos for ${leads.length} leads`);

  const results = {
    customized: [],
    errors: [],
  };

  for (const lead of leads) {
    const leadId = lead.id || lead.leadId || lead.placeId;

    try {
      logLead({
        leadId, stage: "demo", status: "info",
        message: `Generating demo for: ${lead.businessName || lead.name}`,
      });

      const demoData = buildDemoConfig(lead);
      saveDemoConfig(leadId, demoData, opts.dryRun);

      if (!opts.dryRun) {
        upsertLead(leadId, {
          demoGenerated: true,
          demoVertical: demoData.vertical,
          stage: "demo",
        });
        advanceStage(leadId, "demo", `Demo config generated (${demoData.vertical})`);
      }

      logLead({
        leadId, stage: "demo", status: "pass",
        message: `✅ Demo generated: ${demoData.vertical} template | ${Object.keys(demoData.demoConfig).length} fields configured`,
      });

      results.customized.push({
        leadId,
        businessName: lead.businessName || lead.name,
        vertical: demoData.vertical,
        configFile: `${leadId}.json`,
      });

    } catch (err) {
      logLead({
        leadId, stage: "demo", status: "error",
        message: `Customization failed: ${err.message}`,
      });
      results.errors.push({ leadId, error: err.message });
    }
  }

  // Summary
  logPipeline("demo", `Complete: ${results.customized.length} customized, ${results.errors.length} errors`);

  // Save results
  const outputFile = path.join(config.leadsDir, "stage4-customized.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  return results;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
customize(opts)
  .then((result) => {
    console.log(`\n✅ Stage 4 complete:`);
    console.log(`   ✅ Customized: ${result.customized.length}`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.customized.length > 0) {
      console.log("\n   Customized demos:");
      for (const demo of result.customized) {
        console.log(`     - ${demo.businessName} (${demo.vertical}) → ${demo.configFile}`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 4 failed:", err.message);
    process.exit(1);
  });
