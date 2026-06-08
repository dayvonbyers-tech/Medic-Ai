export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { patient, adminLog, vitalsEntries, wkg, wlb, mode, interview } = req.body || {};

  const fmtT = ts => new Date(ts).toTimeString().slice(0, 5);

  // Flatten med log chronologically
  const medEvents = [];
  if (adminLog) {
    Object.entries(adminLog).forEach(([drugName, data]) => {
      (data.times || []).forEach((ts, i) => {
        medEvents.push({ drug: drugName, ts, doseNum: i + 1, total: data.times.length });
      });
    });
    medEvents.sort((a, b) => a.ts - b.ts);
  }

  const medsText = medEvents.length === 0
    ? 'No medications administered.'
    : medEvents.map(e => `  ${fmtT(e.ts)} — ${e.drug} (dose ${e.doseNum} of ${e.total})`).join('\n');

  const vitalsText = !vitalsEntries || vitalsEntries.length === 0
    ? 'No vitals recorded.'
    : vitalsEntries.map(v => {
        const parts = [];
        if (v.sbp && v.dbp) parts.push(`BP ${v.sbp}/${v.dbp}`);
        else if (v.sbp) parts.push(`SBP ${v.sbp}`);
        if (v.hr) parts.push(`HR ${v.hr}`);
        if (v.rr) parts.push(`RR ${v.rr}`);
        if (v.spo2) parts.push(`SpO2 ${v.spo2}%`);
        if (v.etco2) parts.push(`EtCO2 ${v.etco2}`);
        if (v.bgl) parts.push(`BGL ${v.bgl}`);
        if (v.temp) parts.push(`Temp ${v.temp}°F`);
        if (v.pain) parts.push(`Pain ${v.pain}/10`);
        if (v.gcsTotal) parts.push(`GCS ${v.gcsTotal}`);
        if (v.skin) parts.push(v.skin);
        const label = v.autoCapture && v.drugName ? ` [Pre-${v.drugName}]` : '';
        const note = v.notes ? ` | Note: ${v.notes}` : '';
        return `  ${fmtT(v.ts)} — ${parts.join(' · ')}${label}${note}`;
      }).join('\n');

  const p = patient || {};
  const iv = interview || {};
  const patientType = mode === 'peds' ? 'PEDIATRIC' : 'ADULT';
  const weightStr = wkg > 0 ? `${wkg} kg (${wlb} lbs)` : 'Not recorded';

  const prompt = `You are an expert EMS documentation specialist writing a Patient Care Report (PCR) narrative for submission into a state ePCR system.

NARRATIVE RULES — follow these exactly:
- Write in past tense, professional EMS language
- The narrative tells the STORY of the call: scene, presentation, clinical reasoning, and disposition
- Do NOT restate vitals, medication names/doses/times, or interventions — those are captured in structured chart fields. Reference them briefly only when clinically relevant to the story (e.g., "following medication administration, patient reported improved pain")
- DO use the provider's interview answers as the primary narrative content — this is what they observed and assessed
- Do NOT invent any detail not provided
- Be concise — no padding, no repetition
- Structure: Dispatch/Scene → Patient Presentation → Pertinent Findings → Clinical Impression → Treatment Summary (brief reference only) → Patient Response → Disposition

CHART DATA (already captured in structured fields — reference briefly, do not restate):
Patient Type: ${patientType}
Age: ${p.age || 'Unknown'} | Sex: ${p.sex || 'Unknown'} | Weight: ${weightStr}
Allergies: ${p.allergies || 'NKDA'} | Home Meds: ${p.meds || 'None reported'}
PMH/SAMPLE: ${p.pmh || 'Not documented'}
Chief Complaint: ${p.cc || p.hpi || 'Not specified'}
Vitals trend: ${vitalsEntries && vitalsEntries.length > 0 ? `${vitalsEntries.length} sets recorded` : 'None recorded'}
Medications: ${medEvents.length > 0 ? medEvents.map(e => e.drug).join(', ') : 'None administered'}
Interventions: ${p.interventions || 'None documented'}
Response to treatment: ${p.response || 'Not documented'}

PROVIDER INTERVIEW — use this as the primary narrative content:
Call Type: ${iv.callType || 'Not specified'}
Scene / Mechanism: ${iv.scene || 'Not documented'}
General Impression on Arrival: ${iv.impression || 'Not documented'}
Pertinent Exam Findings (positives and negatives): ${iv.findings || 'Not documented'}
Clinical Impression / Working Diagnosis: ${iv.clinicalImpression || 'Not documented'}
Receiving Facility: ${iv.facility || 'Not specified'}
Receiving Provider: ${iv.receivingProvider || 'Not specified'}
Transport Mode: ${iv.transportMode || 'Not specified'}
Patient Condition at Transfer: ${iv.conditionAtTransfer || 'Not documented'}

Write the PCR narrative now. Flowing prose, no bullet points, no headers. One or two paragraphs maximum.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Claude API error: ${errText}` });
    }

    const data = await response.json();
    const narrative = data.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ narrative });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
}
