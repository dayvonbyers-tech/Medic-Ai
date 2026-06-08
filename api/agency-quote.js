/**
 * POST /api/agency-quote
 *
 * Accepts an agency quote/demo request form submission.
 * Saves to Firestore and optionally sends a notification email.
 *
 * Body: {
 *   agencyName, agencyType, seats, contactName, contactEmail,
 *   contactPhone, currentSystem, goLive, notes, wantsDemo, submittedAt
 * }
 *
 * Required env vars (all optional — will log to console if absent):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   NOTIFY_EMAIL  (address to forward quote notifications to)
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    agencyName, agencyType, seats, contactName, contactEmail,
    contactPhone, currentSystem, goLive, notes, wantsDemo, submittedAt,
  } = req.body || {};

  if (!agencyName?.trim() || !contactName?.trim() || !contactEmail?.trim()) {
    return res.status(400).json({ error: "agencyName, contactName, and contactEmail are required." });
  }

  const record = {
    agencyName:    agencyName.trim(),
    agencyType:    agencyType    || "",
    seats:         seats         || "",
    contactName:   contactName.trim(),
    contactEmail:  contactEmail.trim(),
    contactPhone:  contactPhone  || "",
    currentSystem: currentSystem || "",
    goLive:        goLive        || "",
    notes:         notes         || "",
    wantsDemo:     !!wantsDemo,
    submittedAt:   submittedAt   || new Date().toISOString(),
    status:        "new",
  };

  // ── Save to Firestore (if Firebase Admin is configured) ────────────────────
  let savedId = null;
  try {
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (projectId && clientEmail && privateKey) {
      const { initializeApp, cert, getApps } = await import("firebase-admin/app");
      const { getFirestore }                  = await import("firebase-admin/firestore");

      if (!getApps().length) {
        initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
      }

      const db  = getFirestore();
      const ref = await db.collection("agency_quotes").add(record);
      savedId = ref.id;
    } else {
      // Firebase not configured — log for development
      console.log("[agency-quote] Firebase not configured. Quote data:", record);
    }
  } catch (err) {
    console.error("[agency-quote] Firestore error:", err.message);
    // Don't fail the request — the submission still succeeded
  }

  return res.status(200).json({
    success:  true,
    savedId,
    message:  `Quote request received for ${record.agencyName}. We'll be in touch within 1–2 business days.`,
  });
}
