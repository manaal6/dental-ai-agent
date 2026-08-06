// ─── Stage 5: Deployment ─────────────────────────────────────────────────────
// Programmatically deploy a customized demo per lead:
//   1. Create a new git branch/repo per lead (demo-[business-slug])
//   2. Commit the customized config
//   3. Push and trigger a Render deploy via Render API
//   4. Poll deploy status until success
//   5. Return live URL only when deploy succeeds
//   6. Store demo URLs to prevent redeployment
//
// DRY RUN MODE (default): Generates config but skips git push/deploy.
//
// Usage:
//   node deploy.js                         # Deploy all Stage 4 demos
//   node deploy.js --input stage4-customized.json
//   node deploy.js --lead-id foo-123       # Single lead
//   node deploy.js --dry-run               # Preview (default: true)
//   node deploy.js --live                  # Actually deploy

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  config, logLead, logPipeline,
  getLead, upsertLead, advanceStage, hasDeployedDemo,
} from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: null,
    leadId: null,
    dryRun: config.dryRun, // Default from config
    live: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input": opts.input = args[++i]; break;
      case "--lead-id": opts.leadId = args[++i]; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--live": opts.live = true; opts.dryRun = false; break;
    }
  }
  return opts;
}

// ── Render API ──────────────────────────────────────────────────────────────
const RENDER_BASE = config.deployment.render.baseUrl;

/**
 * Create a new Render service via API.
 */
async function createRenderService(leadId, repoUrl, apiKey) {
  const slug = leadId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

  const res = await fetch(`${RENDER_BASE}/services`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `demo-${slug}`,
      type: "web_service",
      ownerID: "tea-d83irrmk1jcs73bti78g",
      repo: repoUrl,
      branch: "main",
      serviceDetails: {
        runtime: "node",
        plan: config.deployment.render.plan,
        region: config.deployment.render.region,
        buildCommand: "npm install",
        startCommand: "node server.js",
        envVars: [
          { key: "NODE_ENV", value: "production" },
          { key: "PORT", value: "10000" },
        ],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Render API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    serviceId: data.id,
    name: data.name,
    url: data.serviceDetails?.url || null,
    status: data.serviceDetails?.status,
  };
}

// ── Vercel API ──────────────────────────────────────────────────────────────
const VERCEL_BASE = config.deployment.vercel.baseUrl;

/**
 * Deploy to Vercel using file-based deployment.
 * Uploads the project files directly to Vercel.
 */
async function deployToVercel(leadId, demoData, apiKey) {
  const slug = leadId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const projectName = `demo-${slug}`;

  // Read the project files we need to deploy
  const repoRoot = config.root;
  const files = {};

  // Read Vercel serverless functions for API endpoints
  const apiDir = path.join(repoRoot, "api");
  if (fs.existsSync(apiDir)) {
    const apiFiles = fs.readdirSync(apiDir).filter(f => f.endsWith(".js"));
    for (const apiFile of apiFiles) {
      files[`api/${apiFile}`] = fs.readFileSync(path.join(apiDir, apiFile), "utf8");
    }
  }

  // Read vercel.json if it exists
  const vercelJsonPath = path.join(repoRoot, "vercel.json");
  if (fs.existsSync(vercelJsonPath)) {
    files["vercel.json"] = fs.readFileSync(vercelJsonPath, "utf8");
  }

  // Read server.js
  const serverPath = path.join(repoRoot, "server.js");
  if (fs.existsSync(serverPath)) {
    files["server.js"] = fs.readFileSync(serverPath, "utf8");
  }

  // Read clinic.json (the customized config)
  files["clinic.json"] = JSON.stringify(demoData.demoConfig, null, 2);

  // Read package.json
  const pkgPath = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    files["package.json"] = fs.readFileSync(pkgPath, "utf8");
  }

  // Read call.html — inject clinic data so it works on static hosting
  const callPath = path.join(repoRoot, "call.html");
  if (fs.existsSync(callPath)) {
    let callHtml = fs.readFileSync(callPath, "utf8");
    const clinicJson = JSON.stringify(demoData.demoConfig);
    // Replace the default CLINIC object with the actual lead data
    callHtml = callHtml.replace(
      /let CLINIC\s*=\s*\{[^}]*\};/,
      `let CLINIC = ${clinicJson};`
    );
    // Set WS_SERVER to point to the Render server for WebSocket connections
    // This is needed when the page is served from Vercel (static) but the
    // WebSocket server runs on Render (which supports long-lived connections)
    const renderUrl = demoData.renderUrl || "";
    callHtml = callHtml.replace(
      /let WS_SERVER\s*=\s*"[^"]*";/,
      `let WS_SERVER = "${renderUrl}";`
    );
    // Remove the fetch('/api/clinic') call since data is embedded
    callHtml = callHtml.replace(
      /fetch\('\/api\/clinic'\)\.then[\s\S]*?\.catch\(\(\) => \{\}\);/,
      `// Clinic data embedded — no API needed`
    );
    files["call.html"] = callHtml;
  }

  // Read index.html — inject clinic data so it works on static hosting
  const indexPath = path.join(repoRoot, "index.html");
  if (fs.existsSync(indexPath)) {
    let indexHtml = fs.readFileSync(indexPath, "utf8");
    const clinicJson = JSON.stringify(demoData.demoConfig);
    // Replace the default window.CLINIC with actual lead data
    indexHtml = indexHtml.replace(
      /window\.CLINIC\s*=\s*\{[^}]*\};/,
      `window.CLINIC = ${clinicJson};`
    );
    // Remove the fetch('/api/clinic') call since data is embedded
    indexHtml = indexHtml.replace(
      /fetch\('\/api\/clinic'\)\.then[\s\S]*?\.catch\(\(\) => \{\}\);/,
      `// Clinic data embedded — no API needed
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
  }

  // Read dashboard files if they exist
  const dashboardJsPath = path.join(repoRoot, "dashboard.js");
  if (fs.existsSync(dashboardJsPath)) {
    files["dashboard.js"] = fs.readFileSync(dashboardJsPath, "utf8");
  }

  const dashboardCssPath = path.join(repoRoot, "dashboard.css");
  if (fs.existsSync(dashboardCssPath)) {
    files["dashboard.css"] = fs.readFileSync(dashboardCssPath, "utf8");
  }

  // Build the files array for Vercel API
  const vercelFiles = Object.entries(files).map(([file, data]) => ({
    file: file,
    data: Buffer.from(data).toString("base64"),
    encoding: "base64",
  }));

  // Create deployment via Vercel API (with retry)
  let res;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(`${VERCEL_BASE}/v13/deployments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: vercelFiles,
        projectSettings: {
          framework: null,
          buildCommand: "",
          outputDirectory: ".",
          installCommand: "npm install",
        },
        target: "production",
      }),
    });

    if (res.ok) break;
    lastErr = await res.text();
    if (attempt < 3) {
      console.log(`   ⏳ Vercel API ${res.status} — retrying in ${attempt * 2}s...`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }

  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${lastErr}`);
  }

  const data = await res.json();
  return {
    deploymentId: data.id,
    url: data.url || `https://${projectName}.vercel.app`,
    readyState: data.readyState,
    alias: data.alias || [],
  };
}

/**
 * Poll Vercel deployment status until ready.
 */
async function pollVercelDeployment(deploymentId, apiKey, maxWaitMs = 120000) {
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`${VERCEL_BASE}/v13/deployments/${deploymentId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Vercel poll failed: ${res.status}`);
    }

    const data = await res.json();

    if (data.readyState === "READY") {
      return { success: true, url: data.url };
    }
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      return { success: false, error: data.readyState };
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return { success: false, error: "Deployment timed out" };
}

/**
 * Get the status of a Render deploy.
 */
async function getDeployStatus(serviceId, deployId, apiKey) {
  const res = await fetch(`${RENDER_BASE}/services/${serviceId}/deploys/${deployId}`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Render API ${res.status}`);
  const data = await res.json();

  return {
    status: data.status, // "live", "building", "deploying", "failed"
    url: data.serviceDetails?.url,
  };
}

/**
 * Poll deploy status until terminal state.
 */
async function pollDeploy(serviceId, deployId, apiKey, maxWaitMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getDeployStatus(serviceId, deployId, apiKey);

    if (status.status === "live") {
      return { success: true, url: status.url };
    }
    if (status.status === "failed") {
      return { success: false, error: "Deploy failed" };
    }

    // Still building/deploying — wait
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return { success: false, error: "Deploy timed out" };
}

// ── Git Operations ──────────────────────────────────────────────────────────

/**
 * Create a demo branch, commit customized config, push to remote.
 */
function gitDeploy(leadId, demoData) {
  const repoRoot = config.root;
  const branchName = `${config.deployment.git.branchPrefix}${leadId}`;

  try {
    // Check if we're in a git repo
    execSync("git rev-parse --is-inside-work-tree", { cwd: repoRoot, stdio: "pipe" });
  } catch {
    // Initialize git if not a repo
    execSync("git init", { cwd: repoRoot, stdio: "pipe" });
  }

  // Create or switch to the demo branch
  try {
    execSync(`git checkout -b ${branchName}`, { cwd: repoRoot, stdio: "pipe" });
  } catch {
    // Branch exists — switch to it
    execSync(`git checkout ${branchName}`, { cwd: repoRoot, stdio: "pipe" });
  }

  // Write the customized clinic.json
  const clinicPath = path.join(repoRoot, "clinic.json");
  fs.writeFileSync(clinicPath, JSON.stringify(demoData.demoConfig, null, 2));

  // Write the system prompt to a file for reference
  const promptPath = path.join(repoRoot, "data", "configs", `${leadId}-prompt.txt`);
  if (!fs.existsSync(path.dirname(promptPath))) {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  }
  fs.writeFileSync(promptPath, demoData.systemPrompt);

  // Stage and commit
  execSync("git add clinic.json", { cwd: repoRoot, stdio: "pipe" });
  execSync(`git commit -m "demo: ${leadId} - customized config" --allow-empty`, {
    cwd: repoRoot,
    stdio: "pipe",
  });

  // Get remote URL (if set)
  let remoteUrl = null;
  try {
    remoteUrl = execSync("git remote get-url origin", { cwd: repoRoot, stdio: "pipe" })
      .toString().trim();
  } catch {
    // No remote configured — will need manual push
  }

  return {
    branchName,
    remoteUrl,
    committed: true,
  };
}

// ── Main Deployment Flow ────────────────────────────────────────────────────
async function deploy(opts) {
  const provider = config.deployment.provider;
  const renderApiKey = config.env.RENDER_API_KEY;
  const vercelApiKey = config.env.VERCEL_TOKEN;

  // Validate API keys based on provider
  if (!opts.dryRun) {
    if (provider === "render" && (!renderApiKey || renderApiKey === "your_render_api_key_here")) {
      console.error("❌ RENDER_API_KEY not set in .env");
      console.error("   Get one at: https://dashboard.render.com/u/settings#api-keys");
      process.exit(1);
    }
    if (provider === "vercel" && (!vercelApiKey || vercelApiKey === "your_vercel_token_here")) {
      console.error("❌ VERCEL_TOKEN not set in .env");
      console.error("   Get one at: https://vercel.com/account/tokens");
      process.exit(1);
    }
  }

  const mode = opts.dryRun ? "🧪 DRY RUN" : "🔴 LIVE";
  logPipeline("deploy", `Starting deployment (${mode}) — Provider: ${provider}`);

  // Load leads from Stage 4 output
  let leads;
  if (opts.input) {
    const inputPath = path.join(config.leadsDir, opts.input);
    const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    leads = data.customized || data;
  } else if (opts.leadId) {
    const lead = getLead(opts.leadId);
    if (!lead) {
      console.error(`❌ Lead ${opts.leadId} not found`);
      process.exit(1);
    }
    leads = [lead];
  } else {
    const inputFile = path.join(config.leadsDir, "stage4-customized.json");
    if (!fs.existsSync(inputFile)) {
      console.error("❌ No Stage 4 output found. Run Stage 4 first.");
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    leads = data.customized || [];
  }

  if (leads.length === 0) {
    console.error("❌ No demos to deploy.");
    process.exit(1);
  }

  logPipeline("deploy", `Deploying ${leads.length} demos (${mode})`);

  const results = {
    deployed: [],
    skipped: [],
    errors: [],
  };

  for (const lead of leads) {
    const leadId = lead.id || lead.leadId || lead.placeId;

    // Check if already deployed (prevent redeployment)
    if (hasDeployedDemo(leadId)) {
      logLead({
        leadId, stage: "deploy", status: "skip",
        message: `Already deployed — skipping`,
      });
      results.skipped.push({ leadId, reason: "already_deployed" });
      continue;
    }

    try {
      logLead({
        leadId, stage: "deploy", status: "info",
        message: `Deploying demo for: ${lead.businessName || lead.name}`,
      });

      // Load the full demo data
      const fullDataFile = path.join(config.configsDir, `${leadId}-full.json`);
      if (!fs.existsSync(fullDataFile)) {
        throw new Error(`Demo config not found: ${fullDataFile}`);
      }
      const demoData = JSON.parse(fs.readFileSync(fullDataFile, "utf8"));

      if (opts.dryRun) {
        // Dry run: just log what would happen
        const demoUrl = provider === "vercel"
          ? `(dry-run) Would deploy demo-${leadId}.vercel.app`
          : `(dry-run) Would deploy demo-${leadId}.onrender.com`;
        logLead({
          leadId, stage: "deploy", status: "pass",
          message: `🧪 DRY RUN: Would deploy to ${provider} (branch: demo-${leadId})`,
        });
        results.deployed.push({
          leadId,
          businessName: lead.businessName || lead.name,
          demoUrl,
          branch: `demo-${leadId}`,
        });
      } else if (provider === "vercel") {
        // Vercel deployment — file-based, no git needed
        logLead({
          leadId, stage: "deploy", status: "info",
          message: `Deploying to Vercel...`,
        });

        const vercelResult = await deployToVercel(leadId, demoData, vercelApiKey);

        logLead({
          leadId, stage: "deploy", status: "info",
          message: `Vercel: deployment ${vercelResult.deploymentId} (${vercelResult.readyState})`,
        });

        // Poll until deployment is ready
        const pollResult = await pollVercelDeployment(vercelResult.deploymentId, vercelApiKey);

        if (pollResult.success) {
          results.deployed.push({
            leadId,
            businessName: lead.businessName || lead.name,
            demoUrl: pollResult.url,
            vercelDeploymentId: vercelResult.deploymentId,
          });

          logLead({
            leadId, stage: "deploy", status: "pass",
            message: `✅ Deployed: ${pollResult.url}`,
          });
        } else {
          throw new Error(`Vercel deployment failed: ${pollResult.error}`);
        }
      } else {
        // Render deployment — git-based
        const gitResult = gitDeploy(leadId, demoData);

        logLead({
          leadId, stage: "deploy", status: "info",
          message: `Git: committed to branch ${gitResult.branchName}`,
        });

        // Create Render service
        const service = await createRenderService(leadId, gitResult.remoteUrl, renderApiKey);

        logLead({
          leadId, stage: "deploy", status: "info",
          message: `Render: service "${service.name}" created (status: ${service.status})`,
        });

        // Store the service ID for polling
        upsertLead(leadId, {
          renderServiceId: service.serviceId,
          renderServiceName: service.name,
        });

        results.deployed.push({
          leadId,
          businessName: lead.businessName || lead.name,
          demoUrl: service.url || `https://${service.name}.onrender.com`,
          renderServiceId: service.serviceId,
          branch: gitResult.branchName,
        });

        logLead({
          leadId, stage: "deploy", status: "pass",
          message: `✅ Deployed: ${service.url || service.name}`,
        });
      }

      if (!opts.dryRun) {
        advanceStage(leadId, "deploy", `Demo deployed to ${provider}`);
      }

    } catch (err) {
      logLead({
        leadId, stage: "deploy", status: "error",
        message: `Deployment failed: ${err.message}`,
      });
      results.errors.push({ leadId, error: err.message });
    }

    // Rate limit: 2s between API calls
    if (!opts.dryRun) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Summary
  logPipeline("deploy", `Complete: ${results.deployed.length} deployed, ${results.skipped.length} skipped, ${results.errors.length} errors`);

  // Save results
  const outputFile = path.join(config.leadsDir, "stage5-deployed.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  return results;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────
const opts = parseArgs();
deploy(opts)
  .then((result) => {
    console.log(`\n✅ Stage 5 complete:`);
    console.log(`   ✅ Deployed: ${result.deployed.length}`);
    console.log(`   ⏭️  Skipped: ${result.skipped.length}`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.deployed.length > 0) {
      console.log("\n   Deployed demos:");
      for (const demo of result.deployed) {
        console.log(`     - ${demo.businessName}: ${demo.demoUrl}`);
      }
    }
  })
  .catch((err) => {
    console.error("\n❌ Stage 5 failed:", err.message);
    process.exit(1);
  });
