// Redeploy ALL demos with updated CSS (bypasses hasDeployedDemo check)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./pipeline/shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERCEL_BASE = "https://api.vercel.com";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

// Get all lead configs
const configsDir = path.join(config.root, "data", "configs");
const allFiles = fs.readdirSync(configsDir).filter(f => f.endsWith("-full.json"));
const leadIds = allFiles.map(f => f.replace("-full.json", ""));

console.log(`\n🚀 Redeploying ${leadIds.length} demos with updated CSS...\n`);

async function deployToVercel(leadId, demoData) {
  const slug = leadId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const projectName = `demo-${slug}`;

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

  // clinic.json
  files["clinic.json"] = JSON.stringify(demoData.demoConfig, null, 2);

  // package.json
  const pkgPath = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    files["package.json"] = fs.readFileSync(pkgPath, "utf8");
  }

  // call.html — inject clinic data
  const callPath = path.join(repoRoot, "call.html");
  if (fs.existsSync(callPath)) {
    let callHtml = fs.readFileSync(callPath, "utf8");
    const clinicJson = JSON.stringify(demoData.demoConfig);
    callHtml = callHtml.replace(/let CLINIC\s*=\s*\{[^}]*\};/, `let CLINIC = ${clinicJson};`);
    // Set WS_SERVER to the Render deployment URL for WebSocket connections
    const renderUrl = demoData.renderUrl || "";
    callHtml = callHtml.replace(/let WS_SERVER\s*=\s*"[^"]*";/, `let WS_SERVER = "${renderUrl}";`);
    callHtml = callHtml.replace(/fetch\('\/api\/clinic'\)\.then[\s\S]*?\.catch\(\(\) => \{\}\);/, `// Clinic data embedded`);
    files["call.html"] = callHtml;
  }

  // index.html — inject clinic data
  const indexPath = path.join(repoRoot, "index.html");
  if (fs.existsSync(indexPath)) {
    let indexHtml = fs.readFileSync(indexPath, "utf8");
    const clinicJson = JSON.stringify(demoData.demoConfig);
    indexHtml = indexHtml.replace(/window\.CLINIC\s*=\s*\{[^}]*\};/, `window.CLINIC = ${clinicJson};`);
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

  // dashboard.js
  const dashboardJsPath = path.join(repoRoot, "dashboard.js");
  if (fs.existsSync(dashboardJsPath)) {
    files["dashboard.js"] = fs.readFileSync(dashboardJsPath, "utf8");
  }

  // dashboard.css (UPDATED — includes the panel-header padding fix)
  const dashboardCssPath = path.join(repoRoot, "dashboard.css");
  if (fs.existsSync(dashboardCssPath)) {
    files["dashboard.css"] = fs.readFileSync(dashboardCssPath, "utf8");
  }

  // Build Vercel files array
  const vercelFiles = Object.entries(files).map(([file, data]) => ({
    file,
    data: Buffer.from(data).toString("base64"),
    encoding: "base64",
  }));

  // Deploy
  const res = await fetch(`${VERCEL_BASE}/v13/deployments`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VERCEL_TOKEN}`,
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
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Vercel API error: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  let success = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    const fullDataFile = path.join(configsDir, `${leadId}-full.json`);
    const demoData = JSON.parse(fs.readFileSync(fullDataFile, "utf8"));

    console.log(`🚀 Deploying: ${demoData.demoConfig?.name || leadId}`);

    try {
      const result = await deployToVercel(leadId, demoData);
      const url = `https://${result.url}`;
      console.log(`   ✅ ${url}`);
      success++;
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
      failed++;
    }

    // 3s delay between deploys
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`✅ Deployed: ${success}  ❌ Failed: ${failed}`);
  console.log(`═══════════════════════════════════════\n`);
}

main().catch(console.error);
