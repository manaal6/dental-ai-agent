// Vercel Serverless Function — /api/leads
// Serves the leads data
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const leadsFile = path.join(process.cwd(), "leads.json");
    if (fs.existsSync(leadsFile)) {
      const data = JSON.parse(fs.readFileSync(leadsFile, "utf8"));
      return res.status(200).json(Array.isArray(data) ? data : []);
    }
    return res.status(200).json([]);
  } catch (err) {
    console.error("Error reading leads.json:", err);
    return res.status(200).json([]);
  }
}
