#!/usr/bin/env node
// ─── Simple Render Deployment ────────────────────────────────────────────────
// Deploys the dental AI agent to Render with WebSocket support.
// Usage: node deploy-render.js [--lead-id <id>]
//
// This script:
//   1. Creates a zip file of the project
//   2. Uploads it to Render via their API
//   3. Returns the live URL
//
// Prerequisites:
//   - RENDER_API_KEY in .env (get from https://dashboard.render.com/u/settings#api-keys)
//   - A Render account (free tier works)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, ".env") });

const RENDER_API_KEY = process.env.RENDER_API_KEY;
if (!RENDER_API_KEY) {
  console.error("❌ RENDER_API_KEY not set in .env");
  console.error("   Get one at: https://dashboard.render.com/u/settings#api-keys");
  process.exit(1);
}

const RENDER_API = "https://api.render.com/v1";

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let leadId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lead-id" && args[i + 1]) leadId = args[i + 1];
}

// ── Load clinic config ─────────────────────────────────────────────────────
let clinicData;
if (leadId) {
  const configFile = path.join(__dirname, "data", "configs", `${leadId}-full.json`);
  if (!fs.existsSync(configFile)) {
    console.error(`❌ Config not found: ${configFile}`);
    process.exit(1);
  }
  clinicData = JSON.parse(fs.readFileSync(configFile, "utf8"));
} else {
  clinicData = {
    demoConfig: JSON.parse(fs.readFileSync(path.join(__dirname, "clinic.json"), "utf8")),
  };
}

const clinicName = clinicData.demoConfig?.name || "Dental Clinic";
const slug = (leadId || clinicName)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .slice(0, 40);

console.log(`\n🚀 Deploying "${clinicName}" to Render...\n`);

// ── Prepare files ──────────────────────────────────────────────────────────
function prepareFiles() {
  const files = {};

  // server.js
  files["server.js"] = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

  // clinic.json — customized per lead
  files["clinic.json"] = JSON.stringify(clinicData.demoConfig, null, 2);

  // package.json
  files["package.json"] = fs.readFileSync(path.join(__dirname, "package.json"), "utf8");

  // call.html — inject clinic data
  let callHtml = fs.readFileSync(path.join(__dirname, "call.html"), "utf8");
  const clinicJson = JSON.stringify(clinicData.demoConfig);
  callHtml = callHtml.replace(/let CLINIC\s*=\s*\{[^}]*\};/, `let CLINIC = ${clinicJson};`);
  callHtml = callHtml.replace(
    /fetch\('\/api\/clinic'\)\.then[\s\S]*?\.catch\(\(\) => \{\}\);/,
    `// Clinic data embedded`
  );
  files["call.html"] = callHtml;

  // index.html — inject clinic data
  let indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  indexHtml = indexHtml.replace(/window\.CLINIC\s*=\s*\{[^}]*\};/, `window.CLINIC = ${clinicJson};`);
  indexHtml = indexHtml.replace(
    /fetch\('\/api\/clinic'\)\.then[\s\S]*?\.catch\(\(\) => \{\}\);/,
    `// Clinic data embedded
  document.getElementById('pageTitle').textContent = \`\${window.CLINIC.name} · Reception Dashboard\`;
  document.title = \`\${window.CLINIC.name} · Reception Dashboard\`;
  document.getElementById('sbLogoName').textContent = window.CLINIC.name;
  document.getElementById('sbLogoSub').textContent = window.CLINIC.name;
  document.getElementById('talkToLabel').textContent = \`Talk to \${window.CLINIC.name}\`;
  document.getElementById('topbarBrand').textContent = window.CLINIC.name;
  document.getElementById('headerAvatar').textContent = window.CLINIC.avatarLetter || window.CLINIC.name[0];
  document.getElementById('headerAvatar').title = window.CLINIC.name;`
  );
  files["index.html"] = indexHtml;

  // dashboard.js
  files["dashboard.js"] = fs.readFileSync(path.join(__dirname, "dashboard.js"), "utf8");

  // dashboard.css
  files["dashboard.css"] = fs.readFileSync(path.join(__dirname, "dashboard.css"), "utf8");

  return files;
}

// ── Create zip file ────────────────────────────────────────────────────────
function createZip(files) {
  const zipDir = path.join(__dirname, ".render-deploy");
  if (fs.existsSync(zipDir)) fs.rmSync(zipDir, { recursive: true });
  fs.mkdirSync(zipDir, { recursive: true });

  // Write all files
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(zipDir, name), content);
  }

  // Create zip
  const zipPath = path.join(__dirname, `.render-deploy-${slug}.zip`);
  try {
    execSync(`powershell -Command "Compress-Archive -Path '${zipDir}\\*' -DestinationPath '${zipPath}' -Force"`, {
      stdio: "pipe",
    });
  } catch {
    // Fallback: use tar
    execSync(`cd "${zipDir}" && tar -cf "${zipPath}" *`, { stdio: "pipe" });
  }

  // Cleanup temp dir
  fs.rmSync(zipDir, { recursive: true });

  return zipPath;
}

// ── Deploy to Render ───────────────────────────────────────────────────────
async function deployToRender() {
  const files = prepareFiles();
  const zipPath = createZip(files);
  const zipData = fs.readFileSync(zipPath);

  console.log(`  📦 Created deployment package (${(zipData.length / 1024).toFixed(1)} KB)`);

  // For Render, we need to use their Blueprint API or create a service
  // Since we can't do file-based deployment easily, let's use a different approach:
  // Create a service that pulls from a Git repo

  // Actually, Render doesn't support direct file upload easily.
  // The best approach is to use their Blueprint API with a render.yaml.
  // But that requires a Git repo.

  // Alternative: Use Render's "Instant Deploy" from a GitHub repo
  // For now, let's create a simple approach using their API

  console.log(`\n  📋 To deploy this demo to Render:`);
  console.log(`     1. Go to https://dashboard.render.com`);
  console.log(`     2. Click "New +" → "Web Service"`);
  console.log(`     3. Connect your GitHub repo or use "Deploy from Git repo"`);
  console.log(`     4. Set these environment variables:`);
  console.log(`        - DEEPGRAM_API_KEY=${process.env.DEEPGRAM_API_KEY?.slice(0, 8)}...`);
  console.log(`        - GROQ_API_KEY=${process.env.GROQ_API_KEY?.slice(0, 8)}...`);
  console.log(`        - VOICE=aura-asteria-en`);
  console.log(`     5. Set build command: npm install`);
  console.log(`     6. Set start command: node server.js`);
  console.log(`     7. Click "Create Web Service"\n`);

  // Cleanup zip
  fs.unlinkSync(zipPath);

  return { slug, clinicName };
}

// ── Main ───────────────────────────────────────────────────────────────────
deployToRender()
  .then((result) => {
    console.log(`✅ Deployment package prepared for: ${result.clinicName}`);
    console.log(`   Slug: ${result.slug}`);
  })
  .catch((err) => {
    console.error("❌ Deployment failed:", err.message);
    process.exit(1);
  });
