# 🆓 Free Pipeline Setup Guide

**Everything here is 100% free. No credit card required for any service.**

## Step 1: SerpAPI (Discovery — 100 free searches/month)

1. Go to **https://serpapi.com**
2. Click **Sign Up** (use email or Google)
3. Verify your email
4. Go to **Dashboard → API Key**
5. Copy your API key

**Free tier:** 100 searches/month, no credit card needed.

---

## Step 2: Snov.io (Enrichment — 50 free credits/month)

1. Go to **https://snov.io**
2. Click **Sign Up** (use email or Google)
3. Verify your email
4. Go to **Settings → API** (left sidebar)
5. Copy your **Client ID** and **Client Secret**

**Free tier:** 50 credits/month, no credit card needed.

**Bonus:** Install the Snov.io Chrome extension for 50 extra credits!

---

## Step 3: Vercel (Deployment — unlimited free deploys)

1. Go to **https://vercel.com**
2. Click **Sign Up** with GitHub
3. Verify your email
4. Go to **Settings → Tokens** (or visit https://vercel.com/account/tokens)
5. Click **Create Token**
6. Copy the token

**Free tier:** Unlimited deploys, no credit card needed.

---

## Step 4: Update .env File

Open your `.env` file and replace the placeholder values:

```bash
# Stage 1: Discovery
DISCOVERY_PROVIDER=serpapi
SERP_API_KEY=paste_your_serpapi_key_here

# Stage 2: Enrichment
ENRICHMENT_PROVIDER=snovio
SNOV_CLIENT_ID=paste_your_snov_client_id_here
SNOV_CLIENT_SECRET=paste_your_snov_client_secret_here

# Stage 5: Deployment
DEPLOY_PROVIDER=vercel
VERCEL_TOKEN=paste_your_vercel_token_here
```

---

## Step 5: Test the Pipeline

### Option A: With API Keys (Recommended)
```bash
# Test Stage 1 (Discovery) — should find dental clinics
node pipeline.js --stage 1

# Test Stage 2 (Enrichment) — should find owner emails
node pipeline.js --stage 2

# Test everything (dry run — no deploys)
node pipeline.js --all --dry-run
```

### Option B: Zero API Keys (Manual Mode)
```bash
# Stage 1: Use built-in sample data (no API needed)
node pipeline/stage1-discovery/discover-manual.js --sample

# Stage 2: Flag all for manual review (no API needed)
node pipeline/stage2-enrichment/enrich.js --provider manual

# Or run full pipeline with manual modes
DISCOVERY_PROVIDER=manual ENRICHMENT_PROVIDER=manual node pipeline.js --all
```

---

## API Limits Cheat Sheet

| Service | Free Limit | Resets | Good For |
|---------|-----------|--------|----------|
| SerpAPI | 100 searches/month | Monthly | ~100 businesses |
| Snov.io | 50 credits/month | Monthly | ~50 email verifications |
| Vercel | Unlimited | Never | As many demos as you want |
| Groq | Free tier | Always | Unlimited LLM calls |

---

## Troubleshooting

**"SNOV_CLIENT_ID not set"**
- Make sure you copied the Client ID (not Client Secret)
- Check for extra spaces or quotes in .env

**"SerpAPI rate limit exceeded"**
- You've used all 100 searches this month
- Wait for monthly reset or upgrade ($50/month)

**"Vercel deployment failed"**
- Make sure your GitHub repo is connected to Vercel
- Check that package.json has correct "start" script

---

## Upgrade Path (When Ready to Scale)

| Service | Paid Plan | Cost | What You Get |
|---------|----------|------|--------------|
| SerpAPI | Starter | $50/mo | 5,000 searches/month |
| Snov.io | Starter | $30/mo | 1,000 credits/month |
| Vercel | Pro | $20/mo | Team features, analytics |

**Total to scale:** ~$80/month for 50x more capacity.
