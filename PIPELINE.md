# AI Receptionist — Lead Pipeline

Multi-stage agent pipeline for automated lead discovery, enrichment, and outreach.

## Architecture

```
Stage 1: Discovery    → Google Places API → Find businesses with weak phone/booking
Stage 2: Enrichment   → Hunter.io API     → Verify owner/decision-maker contact
Stage 3: Scoring      → Custom logic      → Rank by conversion likelihood
Stage 4: Demo         → Template engine   → Auto-generate business-specific instance
Stage 5: Deploy       → Render API        → Push to live URL
Stage 6: Outreach     → LLM-generated     → Personalized cold email/DM
Stage 7: Output       → CSV/Dashboard     → Clean lead table
```

## Quick Start

### 1. Get API Keys (100% Free Options)

**Stage 1 (Discovery) — TWO FREE OPTIONS:**

**Option A: Google Places API (Recommended)**
- Go to: https://console.cloud.google.com
- Create a project (or use existing)
- Enable "Places API (New)" at: https://console.cloud.google.com/apis/library/places-backend.googleapis.com
- Create credentials: https://console.cloud.google.com/apis/credentials
- **Free:** $200/month credit (enough for ~20,000 searches)
- **Needs:** Credit card on file (won't charge unless you exceed $200)

**Option B: SerpAPI (No credit card needed)**
- Go to: https://serpapi.com
- Sign up for free tier
- **Free:** 100 searches/month, no credit card
- Good for testing before committing to Google

**Stage 2 (Enrichment) — THREE FREE OPTIONS:**

**Option A: Snov.io (Recommended — 50 free credits)**
- Go to: https://snov.io
- Sign up (no credit card needed)
- **Free:** 50 credits/month for domain search + email verification
- Install Chrome extension for bonus credits

**Option B: Apollo.io (50 free credits)**
- Go to: https://apollo.io
- Sign up (no credit card needed)
- **Free:** 50 credits/month, includes email + phone

**Option C: Manual (100% Free, No API)**
- Search business website contact page
- Check LinkedIn for owner/decision-maker
- Use WHOIS lookup for domain registration contact
- Check state business registry (free public records)

**Stage 5 (Deployment) — FREE OPTIONS:**

**Option A: Vercel (Recommended)**
- Go to: https://vercel.com
- Sign up with GitHub
- **Free:** Unlimited deploys, custom domains, no cold starts

**Option B: Netlify**
- Go to: https://netlify.com
- Sign up with GitHub
- **Free:** 100GB bandwidth/month, 300 build minutes

**Option C: Render (current setup)**
- Go to: https://render.com
- **Free:** 750 hours/month, but cold starts (15-30s spin-up)

**Stage 6 (LLM) — Already Free:**
- Groq: You already have a key ✅

### 2. Configure .env

```bash
# Add to your .env file:
GOOGLE_PLACES_API_KEY=your_places_key_here        # or leave empty for SerpAPI
SERP_API_KEY=your_serpapi_key_here                 # if using SerpAPI instead
SNOV_CLIENT_ID=your_snov_client_id                 # if using Snov.io
SNOV_CLIENT_SECRET=your_snov_client_secret         # if using Snov.io
APOLLO_API_KEY=your_apollo_key                     # if using Apollo.io
VERCEL_TOKEN=your_vercel_token                     # if using Vercel
```

### 3. Run the Pipeline

```bash
# Run Stages 1-2 (default — discover + enrich)
node pipeline.js

# Run only Stage 1 (discovery)
node pipeline.js --stage 1

# Run only Stage 2 (enrichment)
node pipeline.js --stage 2

# Custom target
node pipeline.js --vertical HVAC --city Dallas --state TX

# Dry run (no saves)
node pipeline.js --dry-run

# View today's summary
node pipeline.js --summary

# Run ALL stages (1-7)
node pipeline.js --all

# Run all stages with Vercel deployment
node pipeline.js --all --deploy-vercel
```

## Stage Details

### Stage 1: Lead Discovery

Searches Google Places API for businesses matching your vertical + location.

**Filters for:**
- Review count ≥ 20 (proof of real call volume)
- Missing website OR no online booking widget
- Review complaints about phone/reachability
- Low review-response rate

**Output:** `data/leads/stage1-discovered.json`

### Stage 2: Enrichment (Critical Bottleneck)

Resolves actual decision-maker contacts using Hunter.io.

**Priority order:**
1. Hunter.io domain search + email verification
2. State business registry (future enhancement)
3. Manual review queue (if no verified contact)

**Hard rules:**
- Never fabricate email patterns without verification
- Only pass leads with confidence ≥ 80%
- Leads without verified contact → manual review queue

**Output:**
- `data/leads/stage2-verified.json` (ready for Stage 3)
- `data/leads/stage2-manual-review.json` (needs human follow-up)

### Stage 3: Qualification Scoring

Scores leads 0-100 based on weighted factors:
- Review volume (call volume proxy)
- Absence of online booking
- Phone/reachability complaints in reviews
- Business size (single-location preferred)
- Industry vertical weight
- Email confidence from enrichment

**Hard gate:** Only leads with `CONTACT_VERIFIED=true` AND score >= 70 pass.

**Output:** `data/leads/stage3-scored.json`

### Stage 4: Demo Customization

Takes the existing product template (clinic.json) and auto-generates a per-lead config:
- Business name, location, phone, hours
- Vertical-specific greeting script
- Services list from Google Places
- Auto-fills structured fields only (no auto-written voice scripts)

**Templates available:** dental, HVAC, med spa, salon

**Output:** `data/configs/{leadId}.json`

### Stage 5: Deployment

Programmatically deploys a customized demo per lead:
1. Creates a git branch (`demo-[business-slug]`)
2. Commits the customized config
3. Triggers a Render deploy via API
4. Polls deploy status until success
5. Returns live URL only when deploy succeeds

**Prevents redeployment:** Checks if demo already exists before deploying.

**Output:** `data/leads/stage5-deployed.json` with live demo URLs

### Stage 6: Outreach Generation

Generates a personalized cold email using Groq LLM:
- References specific business name
- References one specific pain signal from Stage 1
- Includes live demo link
- Under 100 words, ready to paste into sending tool

**Not auto-sent:** All outreach marked `needs_review` for your approval.

**Output:** `data/leads/stage6-outreach.json`

### Stage 7: Output Export

Exports a clean CSV/dashboard row per lead:
- Business name, owner name, verified contact
- Qualification score, demo URL, outreach message
- Status tracking (needs_review / ready_to_send / sent)

**Output:** CSV + JSON + dashboard summary

## Folder Structure

```
pipeline/
├── shared/
│   ├── config.js          # All thresholds & settings
│   ├── logger.js          # Pipeline logging (JSONL)
│   ├── db.js              # Lead database (JSON)
│   ├── rate-limiter.js    # API rate limiting
│   └── index.js           # Barrel exports
├── stage1-discovery/
│   └── discover.js        # Google Places search + filtering
├── stage2-enrichment/
│   └── enrich.js          # Hunter.io contact resolution
├── stage3-qualification/
│   └── score.js           # Weighted scoring model
├── stage4-demo/
│   └── customize.js       # Template parameter substitution
├── stage5-deploy/
│   └── deploy.js          # Git + Render API deployment
├── stage6-outreach/
│   └── generate.js        # LLM-powered cold email
└── stage7-output/
    └── export.js          # CSV/JSON/dashboard export

data/
├── leads/                 # Lead data per stage
├── configs/               # Demo configs (Stage 4)
└── logs/                  # Pipeline logs (JSONL)
```

## Individual Stage Scripts

Run any stage independently:

```bash
# Stage 1: Discovery
node pipeline/stage1-discovery/discover.js --vertical "dental clinic" --city Austin --state TX

# Stage 2: Enrichment
node pipeline/stage2-enrichment/enrich.js

# Stage 3: Scoring
node pipeline/stage3-qualification/score.js --threshold 80

# Stage 4: Demo Customization
node pipeline/stage4-demo/customize.js

# Stage 5: Deployment (dry-run by default)
node pipeline/stage5-deploy/deploy.js --live

# Stage 6: Outreach Generation
node pipeline/stage6-outreach/generate.js

# Stage 7: Export
node pipeline/stage7-output/export.js --format csv
```

## Logging

Every lead's pipeline status and failure reason is logged at each stage.

```bash
# View today's logs
cat data/logs/pipeline-$(date +%Y-%m-%d).jsonl | jq .

# View specific lead's journey
cat data/logs/pipeline-*.jsonl | jq 'select(.leadId == "tooth-dental-care-abc123")'
```

## Dry Run Mode

Stages 4-5 support dry-run mode (default: enabled). This generates config but skips git push/deploy.

```bash
# Force live mode (use with caution)
DRY_RUN=false node pipeline.js --all
```

## Rate Limits

All API calls respect provider limits:
- Google Places: 100ms between calls
- Hunter.io: 2s between calls (free tier: 25/month)
- Render: 1s between calls
