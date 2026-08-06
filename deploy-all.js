import { execSync } from "child_process";

const leads = [
  "emergency-dentist-of-austin-dhSsCHHk",
  "austin-city-dental-4pGMKusA",
  "austin-dental-works-s0RVjV3Y",
  "mydental-at-tech-ridge-oVqGeGa0",
];

for (const leadId of leads) {
  console.log(`\n🚀 Deploying: ${leadId}`);
  try {
    execSync(`node pipeline/stage5-deploy/deploy.js --live --lead-id ${leadId}`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch (e) {
    console.error(`❌ Failed: ${leadId}`);
  }
  // Wait 3s between deploys
  await new Promise(r => setTimeout(r, 3000));
}

console.log("\n✅ All deployments complete!");
