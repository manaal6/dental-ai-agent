// Vercel Serverless Function — /api/clinic
// Serves the clinic configuration data
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
    // Try to read clinic.json from the project root
    const clinicPath = path.join(process.cwd(), "clinic.json");
    if (fs.existsSync(clinicPath)) {
      const clinic = JSON.parse(fs.readFileSync(clinicPath, "utf8"));
      return res.status(200).json(clinic);
    }

    // Fallback: return default clinic data
    return res.status(200).json({
      name: "Dental Clinic",
      location: "Austin, TX",
      phone: "(555) 000-0000",
      hours: "Mon-Fri 9am-5pm",
      services: "general dentistry",
      website: "",
      practices: "a dental clinic",
      offer: "Call us today!",
      rating: "Rated 5 stars",
      avatarLetter: "D",
    });
  } catch (err) {
    console.error("Error reading clinic.json:", err);
    return res.status(500).json({ error: "Failed to load clinic data" });
  }
}
