// ─── Stage 1: Lead Discovery ────────────────────────────────────────────────
// Search for local service businesses using Google Places API or SerpAPI,
// filter for signals of weak phone/booking infrastructure.
//
// Usage:
//   node discover.js                          # Run with defaults (dental, Austin TX)
//   node discover.js --vertical "HVAC" --city "Dallas" --state "TX"
//   node discover.js --dry-run                # Preview without saving
//   node discover.js --limit 10               # Max leads to output

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
    vertical: config.discovery.vertical,
    city: config.discovery.city,
    state: config.discovery.state,
    country: config.discovery.country,
    dryRun: false,
    limit: 20,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--vertical": opts.vertical = args[++i]; break;
      case "--city": opts.city = args[++i]; break;
      case "--state": opts.state = args[++i]; break;
      case "--country": opts.country = args[++i]; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--limit": opts.limit = parseInt(args[++i], 10); break;
    }
  }
  return opts;
}

// ── Google Places API ───────────────────────────────────────────────────────
async function searchPlacesGoogle(query, location, radius, apiKey) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${query} in ${location}`);
  url.searchParams.set("radius", radius);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API status: ${data.status} — ${data.error_message || "unknown"}`);
  }

  return data.results || [];
}

async function getPlaceDetailsGoogle(placeId, apiKey) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", [
    "name", "formatted_address", "formatted_phone_number",
    "website", "rating", "user_ratings_total",
    "reviews", "opening_hours", "business_status",
    "url", "types",
  ].join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Place Details ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (data.status !== "OK") {
    throw new Error(`Place Details status: ${data.status}`);
  }

  return data.result;
}

// ── SerpAPI (FREE: 100 searches/month, no credit card) ─────────────────────
async function searchPlacesSerpAPI(query, location, apiKey) {
  const url = new URL(config.serpapi.baseUrl);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", `${query} in ${location}`);
  url.searchParams.set("type", "search");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // SerpAPI returns results in a different format
  const results = (data.local_results || data.organic_results || []).map(r => ({
    place_id: r.place_id || `serpapi-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name: r.title,
    formatted_address: r.address,
    formatted_phone_number: r.phone || "",
    website: r.website || "",
    rating: r.rating || 0,
    user_ratings_total: r.reviews || 0,
    url: r.place_id_search || r.link || "",
    opening_hours: r.hours ? { weekday_text: [r.hours] } : null,
    // SerpAPI includes some data we need
    _serpData: {
      type: r.type || "",
      service_options: r.service_options || {},
      reviews: r.reviews || [],
    },
  }));

  return results;
}

// ── Filter: Weak Phone/Booking Signals ──────────────────────────────────────
function analyzeLead(place, details) {
  const signals = {
    noWebsite: !place.website,
    outdatedWebsite: false,
    noOnlineBooking: false,
    phoneComplaints: [],
    reviewCount: place.user_ratings_total || 0,
    rating: place.rating || 0,
    hasPhone: !!place.formatted_phone_number,
    singleLocation: true, // Default assumption; multi-loc detected below
  };

  // Check website for scheduling widget / chatbot
  if (place.website) {
    const domain = new URL(place.website).hostname;
    // Common scheduling widget domains
    const schedulingDomains = [
      "zocdoc.com", "healthgrades.com", "appointlet.com",
      "calendly.com", "simplepractice.com", "dentistry.com",
      "patientpop.com", "weave.com", "nexhealth.com",
      "linehealth.co", "birdeye.com",
    ];
    const chatbotDomains = [
      "intercom.com", "drift.com", "tawk.to",
      "freshchat.com", "zendesk.com", "tidio.co",
    ];

    // Check if website URL contains scheduling keywords
    const hasSchedulingKeyword =
      /book|schedule|appointment|online\s*booking/i.test(place.website);

    // Heuristic: if no scheduling domain in URL and no scheduling keyword, flag it
    if (!hasSchedulingKeyword) {
      signals.noOnlineBooking = true;
    }
  }

  // Analyze reviews for phone/reachability complaints
  if (details?.reviews?.length) {
    const complaintPatterns = [
      /hard\s+to\s+reach/i,
      /no\s+one\s+answered/i,
      /phone\s*tag/i,
      /voicemail/i,
      /never\s+(?:answer|call\s*back|return)/i,
      /couldn.t\s+(?:get\s+(?:a\s+)?(?:hold|through)|reach)/i,
      /difficult\s+to\s+(?:reach|contact)/i,
      /wait\s+(?:days?|weeks?)\s+(?:for\s+)?(?:a\s+)?call\s*back/i,
      /no\s+(?:response|reply)/i,
    ];

    for (const review of details.reviews) {
      const text = review.text || "";
      for (const pattern of complaintPatterns) {
        if (pattern.test(text)) {
          signals.phoneComplaints.push({
            author: review.author_name,
            text: text.slice(0, 200),
            pattern: pattern.source,
          });
          break; // One complaint per review is enough
        }
      }
    }
  }

  // Score the lead based on signals
  let score = 0;
  if (signals.noWebsite) score += 20;
  if (signals.noOnlineBooking) score += 25;
  if (signals.phoneComplaints.length > 0) score += 20;
  if (signals.reviewCount >= 20 && signals.reviewCount < 200) score += 15; // Sweet spot
  if (signals.reviewCount >= 200) score += 10; // Big enough to have staff
  if (!signals.hasPhone) score += 10; // No listed phone = harder to reach
  if (signals.rating < 4.0) score += 10; // Lower rating may indicate service issues

  return { signals, score };
}

// ── Main Discovery Flow ─────────────────────────────────────────────────────
async function discover(opts) {
  const provider = config.discoveryProvider;
  const location = `${opts.city}, ${opts.state}, ${opts.country}`;
  const query = `${opts.vertical} ${opts.city} ${opts.state}`;

  logPipeline("discovery", `Starting lead discovery: "${query}" (provider: ${provider})`);

  let places;

  if (provider === "serpapi") {
    const apiKey = config.env.SERP_API_KEY;
    if (!apiKey || apiKey === "your_serpapi_key_here") {
      console.error("❌ SERP_API_KEY not set in .env");
      console.error("   Get FREE 100 searches/month at: https://serpapi.com");
      console.error("   No credit card required");
      process.exit(1);
    }
    logPipeline("discovery", `Searching SerpAPI for "${query}"...`);
    places = await searchPlacesSerpAPI(query, location, apiKey);
  } else {
    // Default to Google Places
    const apiKey = config.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey || apiKey === "your_google_places_api_key_here") {
      console.error("❌ GOOGLE_PLACES_API_KEY not set in .env");
      console.error("   Get one at: https://console.cloud.google.com/apis/credentials");
      console.error("   Enable: Places API (New)");
      process.exit(1);
    }
    logPipeline("discovery", `Searching Google Places for "${query}"...`);
    places = await searchPlacesGoogle(query, location, config.discovery.searchRadius, apiKey);
  }

  logPipeline("discovery", `Found ${places.length} raw results`);

  const qualified = [];
  const dropped = [];
  const seenPlaceIds = new Set();
  const seenPhones = new Set();
  const seenDomains = new Set();
  const seenNames = new Set();

  for (const place of places) {
    if (qualified.length >= opts.limit) break;

    const leadId = makeLeadId(place.name, place.place_id);

    // ── Duplicate Detection ────────────────────────────────────────────────
    // Check place ID
    if (place.place_id && seenPlaceIds.has(place.place_id)) {
      logLead({ leadId, stage: "discovery", status: "skip", message: `Duplicate place_id: ${place.place_id}` });
      continue;
    }
    // Check phone number
    const phone = (place.formatted_phone_number || "").replace(/\D/g, "");
    if (phone && phone.length >= 7 && seenPhones.has(phone)) {
      logLead({ leadId, stage: "discovery", status: "skip", message: `Duplicate phone: ${place.formatted_phone_number}` });
      continue;
    }
    // Check website domain
    if (place.website) {
      try {
        const domain = new URL(place.website).hostname.replace(/^www\./, "");
        if (seenDomains.has(domain)) {
          logLead({ leadId, stage: "discovery", status: "skip", message: `Duplicate domain: ${domain}` });
          continue;
        }
      } catch { /* invalid URL, skip domain check */ }
    }
    // Check business name (normalized)
    const normalizedName = (place.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedName && seenNames.has(normalizedName)) {
      logLead({ leadId, stage: "discovery", status: "skip", message: `Duplicate name: ${place.name}` });
      continue;
    }

    logLead({ leadId, stage: "discovery", status: "info", message: `Processing: ${place.name}` });

    try {
      // Get detailed info (reviews, website, hours)
      // For SerpAPI, data is already in the place object
      // For Google Places, we need to fetch details separately
      let details = place;
      if (provider !== "serpapi") {
        details = await getPlaceDetailsGoogle(place.place_id, config.env.GOOGLE_PLACES_API_KEY);
      }
      const { signals, score } = analyzeLead(place, details);

      // Apply filters
      if (signals.reviewCount < config.discovery.minReviewCount) {
        logLead({
          leadId, stage: "discovery", status: "skip",
          message: `Only ${signals.reviewCount} reviews (min: ${config.discovery.minReviewCount})`,
        });
        dropped.push({ name: place.name, reason: "insufficient_reviews", reviews: signals.reviewCount });
        continue;
      }

      // Build lead record
      const lead = {
        businessName: place.name,
        placeId: place.place_id,
        address: place.formatted_address,
        phone: place.formatted_phone_number || "",
        website: place.website || "",
        rating: place.rating,
        reviewCount: signals.reviewCount,
        vertical: opts.vertical.toLowerCase(),
        city: opts.city,
        state: opts.state,
        signals,
        discoveryScore: score,
        googleUrl: place.url,
        hours: details?.opening_hours?.weekday_text || [],
      };

      if (!opts.dryRun) {
        upsertLead(leadId, {
          ...lead,
          stage: "discovery",
          stage1Score: score,
          stage1Signals: signals,
        });
      }

      logLead({
        leadId, stage: "discovery", status: "pass",
        message: `Score ${score}/100 | Reviews: ${signals.reviewCount} | Website: ${signals.noWebsite ? "MISSING" : "present"} | Booking: ${signals.noOnlineBooking ? "MISSING" : "present"} | Phone complaints: ${signals.phoneComplaints.length}`,
      });

      // Track seen values for duplicate detection
      if (place.place_id) seenPlaceIds.add(place.place_id);
      if (phone && phone.length >= 7) seenPhones.add(phone);
      if (place.website) {
        try {
          const domain = new URL(place.website).hostname.replace(/^www\./, "");
          seenDomains.add(domain);
        } catch { /* skip */ }
      }
      if (normalizedName) seenNames.add(normalizedName);

      qualified.push({ leadId, ...lead });

    } catch (err) {
      logLead({
        leadId, stage: "discovery", status: "error",
        message: `Details fetch failed: ${err.message}`,
      });
      dropped.push({ name: place.name, reason: "api_error", error: err.message });
    }

    // Rate limit: 200ms between Place Details calls
    await new Promise((r) => setTimeout(r, 200));
  }

  // Summary
  logPipeline("discovery", `Complete: ${qualified.length} qualified, ${dropped.length} dropped`);

  // Save results to file
  const outputFile = path.join(config.leadsDir, "stage1-discovered.json");
  fs.writeFileSync(outputFile, JSON.stringify(qualified, null, 2));
  logPipeline("discovery", `Results saved to ${outputFile}`);

  return { qualified, dropped };
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
discover(opts)
  .then((result) => {
    console.log(`\n✅ Stage 1 complete: ${result.qualified.length} leads discovered`);
    if (result.dropped.length) {
      console.log(`   ${result.dropped.length} leads dropped:`);
      for (const d of result.dropped) {
        console.log(`     - ${d.name}: ${d.reason}`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 1 failed:", err.message);
    process.exit(1);
  });
