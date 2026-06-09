import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { saveArrestReport, loadArrestReports, saveCallRecord, isFirebaseConfigured } from "./firebase.js";

/* �������������������������������������������������������
   AUDIO + NOTIFICATION UTILITIES
������������������������������������������������������� */
let _audioCtx = null;
// iOS requires AudioContext to be created AND resumed inside a user gesture.
// We unlock it on the first tap anywhere, then keep it alive.
function _unlockAudio() {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
  } catch(_) {}
}
if (typeof window !== 'undefined') {
  const unlock = () => { _unlockAudio(); document.removeEventListener('touchstart', unlock, true); document.removeEventListener('click', unlock, true); };
  document.addEventListener('touchstart', unlock, true);
  document.addEventListener('click', unlock, true);
}
function getAudioCtx() {
  _unlockAudio();
  return _audioCtx;
}
function playTone(freq, dur, vol = 0.35, type = 'sine', delay = 0) {
  try {
    const ctx = getAudioCtx();
    if (!ctx || ctx.state !== 'running') return; // iOS: bail if not unlocked yet
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur / 1000);
    osc.start(t); osc.stop(t + dur / 1000 + 0.05);
  } catch(_) {}
}
const SOUNDS = {
  cprCycle:    () => { playTone(880,120,0.5,'square'); playTone(880,120,0.5,'square',0.18); playTone(1100,220,0.55,'square',0.38); },
  epiDue:      () => { playTone(740,150,0.45,'sawtooth'); playTone(740,150,0.45,'sawtooth',0.22); playTone(880,300,0.5,'sine',0.46); },
  drugDue:     () => { playTone(660,180,0.35,'sine'); playTone(660,180,0.35,'sine',0.28); },
  wipeWarning: () => { playTone(520,200,0.4); playTone(440,200,0.4,'sine',0.28); playTone(360,400,0.4,'sine',0.56); },
  callStart:   () => { playTone(440,120,0.25); playTone(550,200,0.28,'sine',0.18); },
  callClose:   () => { playTone(550,150,0.3); playTone(440,300,0.25,'sine',0.22); },
};
function swNotify(title, body, tag, delay = 0, requireInteraction = false) {
  if (typeof window === 'undefined' || Notification.permission !== 'granted') return;
  const msg = { type: delay > 0 ? 'SCHEDULE' : 'NOTIFY', title, body, tag, delay, requireInteraction };
  navigator.serviceWorker?.controller?.postMessage(msg);
  if (!navigator.serviceWorker?.controller && delay === 0) {
    try { new Notification(title, { body, tag, icon: '/favicon.svg' }); } catch(_) {}
  }
}
function swCancel(tag) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CANCEL', tag });
}

/* �������������������������������������������������������
   CHECK BUILDING BLOCKS
������������������������������������������������������� */
const CHK = {
  sbp:  { id:"sbp",  label:"Blood Pressure (SBP / DBP)", type:"value", unit:"mmHg", placeholder:"SBP" },
  hr:   { id:"hr",   label:"Heart Rate",   type:"value", unit:"bpm",  placeholder:"e.g. 76"  },
  rr:   { id:"rr",   label:"Resp Rate",    type:"value", unit:"/min", placeholder:"e.g. 16"  },
  spo2: { id:"spo2", label:"SpO₂",         type:"value", unit:"%",    placeholder:"e.g. 98"  },
  bgl:  { id:"bgl",  label:"Blood Glucose",type:"value", unit:"mg/dL",placeholder:"e.g. 48"  },
  pde5:    { id:"pde5",   label:"PDE-5 inhibitor use (Viagra/Cialis/Levitra) in last 48h?",     type:"yesno" },
  rvi:     { id:"rvi",    label:"Suspected right ventricular infarction (inferior STEMI)?",      type:"yesno" },
  arrest:  { id:"arrest", label:"Confirmed cardiac arrest (pulseless)?",                         type:"yesno" },
  cpr:     { id:"cpr",    label:"CPR actively in progress?",                                     type:"yesno" },
  svt:     { id:"svt",    label:"Narrow-complex SVT confirmed on monitor?",                      type:"yesno" },
  ivprox:  { id:"ivprox", label:"IV site is antecubital or above (proximal)?",                   type:"yesno" },
  avblock: { id:"avblock",label:"Known 2nd/3rd degree AV block?",                                type:"yesno" },
  typeii:  { id:"typeii", label:"Rhythm consistent with Type II or high-degree AV block?",       type:"yesno" },
  sympt:   { id:"sympt",  label:"Bradycardia is SYMPTOMATIC (hypotension, AMS, syncope)?",       type:"yesno" },
  anaph:   { id:"anaph",  label:"Anaphylaxis confirmed (urticaria/angioedema + hypotension OR airway compromise)?", type:"yesno" },
  opioid:  { id:"opioid", label:"Suspected opioid toxidrome (miosis, respiratory depression, unresponsive)?", type:"yesno" },
  psychhx: { id:"psychhx",label:"History of schizophrenia or active psychosis?",                 type:"yesno" },
  parkinsons:{ id:"park", label:"Known Parkinson's disease?",                                    type:"yesno" },
  qtprolong: { id:"qt",   label:"Known QT prolongation or on QT-prolonging medications?",        type:"yesno" },
  placenta:  { id:"plac", label:"Placenta has been delivered?",                                  type:"yesno" },
  injurytime:{ id:"injtm",label:"Time since injury (hours)",                                     type:"value", unit:"hrs", placeholder:"e.g. 1.5" },
  hemorrhage:{ id:"hemrg",label:"Active significant hemorrhage confirmed?",                       type:"yesno" },
  burntime:  { id:"burntm",label:"Time since burn (hours)",                                      type:"value", unit:"hrs", placeholder:"e.g. 6"   },
  digoxin:   { id:"digox",label:"Patient is on digoxin (Lanoxin)?",                              type:"yesno" },
  dtr:       { id:"dtr",  label:"Deep tendon reflexes (DTRs) still present?",                   type:"yesno" },
  hyperkal:  { id:"hkrsk",label:"Risk factors for hyperkalemia? (crush, renal failure, burns >24h)", type:"yesno" },
  metalk:    { id:"metalk",label:"Known or suspected metabolic alkalosis?",                       type:"yesno" },
  hypergly:  { id:"hypgl",    label:"Confirmed hyperglycemia (BGL >200 mg/dL)?",                  type:"yesno" },
  lungsounds:  { id:"lngsnd",  label:"Wheezing or diminished lung sounds present on auscultation?",    type:"yesno" },
  aspirinallergy:{ id:"aspalrg", label:"Known allergy to aspirin or NSAIDs?",                           type:"yesno" },
  aspirinprior:  { id:"aspprior",label:"Number of aspirin tablets (81 mg) taken prior to our arrival",  type:"value", unit:"tablets", placeholder:"0 if none" },
  pulse:         { id:"pulse",   label:"Pulse present?",                                                type:"yesno" },
};
const mk = (id, ov={}) => ({ ...CHK[id], ...ov });
const EMPTY_OBJ = {};

const bzdChecks=(sbpMsg,rrBlock,rrWarn="RR <12 — monitor airway",spo2Msg="SpO₂ <94% — pre-oxygenate")=>[
  mk("sbp", {required:true,warnIf:v=>+v<90,warnMsg:sbpMsg}),
  mk("rr",  {required:true,blockIf:v=>+v<8,warnIf:v=>+v<12,blockMsg:rrBlock,warnMsg:rrWarn}),
  mk("spo2",{required:true,warnIf:v=>+v<94,warnMsg:spo2Msg}),
];

/* ─────────────────────────────────────────────────────
   INITIAL PRE-CHECKS  (full — vitals + yes/no)
   Asked only on Dose 1
   Rule: every vital in RE_CHECKS must also appear here
───────────────────────────────────────────────────── */
const INIT_CHECKS = {
  "Aspirin": [
    mk("aspirinallergy",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Aspirin/NSAID allergy — CONTRAINDICATED" }),
    mk("aspirinprior",  { required:true,
      blockIf: v=>+v>=4,
      warnIf:  v=>+v>=1&&+v<4,
      blockMsg:"4 tablets already taken — full 324 mg dose on board. Do not repeat.",
      warnMsg: v=>`${v} tablet${+v>1?"s":""} taken prior — give only ${4-+v} more tablet${4-+v>1?"s":""} to reach 324 mg total`
    }),
  ],
  "Nitroglycerin": [
    mk("sbp",  { required:true, blockIf:v=>+v<100, warnIf:v=>+v<110, blockMsg:"SBP <100 — CONTRAINDICATED", warnMsg:"SBP borderline low — caution" }),
    mk("hr",   { required:true, warnIf:v=>+v<50||+v>100, warnMsg:"HR outside 50–100 — reassess" }),
    mk("pde5", { required:true, blockIf:v=>v==="Yes", blockMsg:"PDE-5 inhibitor use — CONTRAINDICATED (severe hypotension risk)" }),
    mk("rvi",  { required:true, blockIf:v=>v==="Yes", blockMsg:"Suspected RVI — CONTRAINDICATED (preload-dependent)" }),
  ],
  "Epinephrine 1:10,000": [
    mk("pulse",  { required:true, blockIf:v=>v==="Yes", blockMsg:"Pulse present — patient is NOT in arrest. Do NOT give Epi 1:10,000." }),
    mk("arrest", { required:true, blockIf:v=>v==="No",  blockMsg:"Patient must be pulseless — confirm cardiac arrest" }),
    mk("cpr",    { required:true, warnIf:v=>v==="No",   warnMsg:"Ensure CPR is in progress" }),
    // HR not asked on initial — patient is pulseless; re-dose check uses HR to detect ROSC
  ],
  "Adenosine": [
    mk("svt",    { required:true, blockIf:v=>v==="No",  blockMsg:"Confirm narrow-complex SVT on monitor before Adenosine" }),
    mk("ivprox", { required:true, blockIf:v=>v==="No",  blockMsg:"Must use antecubital or above for rapid flush" }),
    mk("avblock",{ required:true, blockIf:v=>v==="Yes", blockMsg:"AV block — Adenosine CONTRAINDICATED" }),
    mk("sbp",    { required:true, warnIf:v=>+v<90, warnMsg:"SBP <90 — Adenosine causes transient asystole/hypotension. Caution." }),
    mk("hr",     { required:true, warnIf:v=>+v<100, warnMsg:"HR <100 — confirm this is a true SVT rate before giving" }),
  ],
  "Atropine": [
    mk("sympt", { required:true, blockIf:v=>v==="No",  blockMsg:"Symptomatic bradycardia only — confirm symptoms" }),
    mk("typeii",{ required:true, warnIf:v=>v==="Yes",  warnMsg:"Type II / high-degree AV block — Atropine may worsen. Consider pacing." }),
    mk("hr",    { required:true, warnIf:v=>+v>60, warnMsg:"HR >60 — reassess indication for Atropine" }),
    mk("sbp",   { required:true, warnIf:v=>+v<90, warnMsg:"SBP <90 — assess hemodynamic status, consider pacing if no improvement" }),
  ],
  "Midazolam (Versed)": bzdChecks("SBP <90 — may worsen hypotension. Consider ketamine.","RR <8 — significant respiratory depression. HOLD.","RR <12 — monitor airway closely","SpO₂ <94% — pre-oxygenate first"),
  "Diazepam (Valium)":  bzdChecks("SBP <90 — may worsen hypotension","RR <8 — hold Diazepam"),
  "Lorazepam (Ativan)": bzdChecks("SBP <90 — may worsen hypotension","RR <8 — hold Lorazepam"),
  "Morphine Sulfate": [
    mk("sbp",  { required:true, blockIf:v=>+v<90, warnIf:v=>+v<100, blockMsg:"SBP <90 — CONTRAINDICATED in hypotension", warnMsg:"SBP <100 — caution, consider Fentanyl" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14,  blockMsg:"RR <10 — respiratory depression. Hold.", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate" }),
  ],
  "Morphine": [
    mk("sbp",  { required:true, blockIf:v=>+v<90, warnIf:v=>+v<100, blockMsg:"SBP <90 — CONTRAINDICATED", warnMsg:"SBP <100 — caution" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14,  blockMsg:"RR <10 — hold Morphine", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate" }),
  ],
  "Fentanyl": [
    mk("sbp",  { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — consider Ketamine for unstable patients" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14, blockMsg:"RR <10 — respiratory depression. Hold Fentanyl.", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate" }),
  ],
  "Naloxone (Narcan)": [
    mk("opioid",{ required:true, warnIf:v=>v==="No", warnMsg:"Opioid toxidrome not clearly confirmed — consider other causes of AMS" }),
    mk("rr",    { required:true, warnIf:v=>+v>12,    warnMsg:"RR >12 — titrate to respirations only, reassess need" }),
    mk("spo2",  { required:true, warnIf:v=>+v<94,    warnMsg:"SpO₂ <94% — ensure airway positioning and BVM ready" }),
  ],
  "Ketamine": [
    mk("psychhx",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Active psychosis / schizophrenia — Ketamine may cause severe emergence reactions." }),
  ],
  "Haloperidol (Haldol)": [
    mk("sbp",       { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — Haloperidol may cause orthostatic hypotension" }),
    mk("hr",        { required:true, warnIf:v=>+v>100, warnMsg:"HR >100 — tachycardia present, assess QT risk before giving" }),
    mk("parkinsons",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Parkinson's disease — Haloperidol CONTRAINDICATED" }),
    mk("qtprolong", { required:true, warnIf:v=>v==="Yes",  warnMsg:"QT prolongation risk — monitor for Torsades de Pointes" }),
  ],
  "Magnesium Sulfate": [
    mk("rr",  { required:true, blockIf:v=>+v<12, blockMsg:"RR <12 — Magnesium respiratory depression risk. HOLD." }),
    mk("sbp", { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — magnesium may worsen hypotension. Slow infusion." }),
    mk("dtr", { required:true, warnIf:v=>v==="No", warnMsg:"DTRs absent — early sign of magnesium toxicity." }),
  ],
  "Oxytocin (Pitocin)": [
    mk("placenta",{ required:true, blockIf:v=>v==="No", blockMsg:"Placenta NOT yet delivered — CONTRAINDICATED" }),
  ],
  "Tranexamic Acid (TXA)": [
    mk("injurytime",{ required:true, blockIf:v=>+v>3, warnIf:v=>+v>2.5, blockMsg:"Injury >3 hours — TXA CONTRAINDICATED", warnMsg:"Approaching 3-hour window — give immediately" }),
    mk("hemorrhage",{ required:true, blockIf:v=>v==="No", blockMsg:"Active hemorrhage must be confirmed" }),
  ],
  "Succinylcholine": [
    mk("burntime",{ required:true, blockIf:v=>+v>24, blockMsg:"Burn >24 hours — CONTRAINDICATED (life-threatening hyperkalemia). Use Rocuronium." }),
    mk("hyperkal",{ required:true, warnIf:v=>v==="Yes", warnMsg:"Hyperkalemia risk factors — consider Rocuronium" }),
  ],
  "Calcium Chloride 10%": [
    mk("digoxin",{ required:true, warnIf:v=>v==="Yes", warnMsg:"Digoxin use — risk of digitalis toxicity. Use Calcium Gluconate with extreme caution." }),
  ],
  "Sodium Bicarbonate": [
    mk("metalk",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Metabolic alkalosis — CONTRAINDICATED" }),
  ],
  "Dopamine": [
    mk("sbp",{ required:true, warnIf:v=>+v>90,  warnMsg:"SBP >90 — reassess indication for Dopamine" }),
    mk("hr", { required:true, warnIf:v=>+v>120, warnMsg:"HR >120 — tachycardia present, consider dose reduction" }),
  ],
  "Albuterol": [
    mk("lungsounds",{ required:true, blockIf:v=>v==="No", blockMsg:"No wheezing or diminished lung sounds — bronchospasm not confirmed. Reassess indication." }),
    mk("hr",        { required:true, warnIf:v=>+v>120, warnMsg:"HR >120 — tachyarrhythmia risk, reassess before giving" }),
    mk("spo2",      { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — confirm bronchospasm as cause; give with O₂" }),
  ],
  "Atropine (Organophosphate)": [
    mk("rr",   { required:true, warnIf:v=>+v<10, warnMsg:"RR <10 — severe respiratory compromise, prioritize airway management alongside Atropine" }),
    mk("hr",   { required:true, warnIf:v=>+v>100, warnMsg:"HR >100 — atropine toxicity possible. Secretion drying is the endpoint, not HR." }),
  ],
  "Oral Glucose (Glutose)": [
    mk("bgl",{ required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — not indicated", warnMsg:"BGL borderline — confirm clinical hypoglycemia" }),
  ],
  "Oral Glucose": [
    mk("bgl",{ required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — not indicated", warnMsg:"BGL borderline — confirm clinical hypoglycemia" }),
  ],
  "Dextrose 50% (D50)": [
    mk("bgl",     { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — D50 not indicated", warnMsg:"BGL borderline — confirm clinical hypoglycemia" }),
    mk("hypergly",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Confirmed hyperglycemia — CONTRAINDICATED" }),
  ],
  "Dextrose 25% (D25)": [
    mk("bgl",     { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — D25 not indicated", warnMsg:"BGL borderline — confirm" }),
    mk("hypergly",{ required:true, blockIf:v=>v==="Yes", blockMsg:"Confirmed hyperglycemia — CONTRAINDICATED" }),
  ],
  "Epinephrine 1:1,000": [
    mk("sbp",  { required:true, warnIf:v=>+v<80, warnMsg:"SBP <80 — severe hemodynamic compromise, IV Epi may be needed instead of IM" }),
    mk("hr",   { required:true, warnIf:v=>+v>130, warnMsg:"HR >130 — tachycardia present; still give Epi if anaphylaxis confirmed" }),
    mk("anaph",{ required:true, warnIf:v=>v==="No", warnMsg:"Anaphylaxis not clearly confirmed — reassess before giving" }),
  ],
  "Amiodarone": [
    mk("arrest",{ required:true, warnIf:v=>v==="No", warnMsg:"Confirm shockable rhythm before Amiodarone" }),
  ],
  "Lidocaine": [
    mk("arrest",{ required:true, warnIf:v=>v==="No", warnMsg:"Confirm VF/pVT on monitor before Lidocaine" }),
  ],
};

/* ─────────────────────────────────────────────────────
   REASSESSMENT CHECKS  (vitals only — per drug)
   Asked before every subsequent dose after Dose 1.
   Rule: only numeric vitals — no yes/no questions.
   Contextual screening is done once on Dose 1 only.
───────────────────────────────────────────────────── */
const RE_CHECKS = {
  "Nitroglycerin": [
    mk("sbp", { required:true, blockIf:v=>+v<100, warnIf:v=>+v<110, blockMsg:"SBP <100 — hold re-dose", warnMsg:"SBP still borderline — reassess carefully" }),
    mk("hr",  { required:true, warnIf:v=>+v<50||+v>100, warnMsg:"HR outside 50–100 — reassess before re-dosing" }),
  ],
  "Epinephrine 1:10,000": [
    mk("hr",  { required:true, warnIf:v=>+v>0, warnMsg:"Pulse detected — patient may have ROSC. Stop and reassess rhythm." }),
  ],
  "Adenosine": [
    mk("hr",  { required:true, warnIf:v=>+v<150, warnMsg:"HR <150 — SVT may have converted. Confirm rhythm on monitor before re-dosing." }),
    mk("sbp", { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — Adenosine causes transient asystole. Caution with re-dose." }),
  ],
  "Atropine": [
    mk("hr",  { required:true, blockIf:v=>+v>60, warnIf:v=>+v>50, blockMsg:"HR >60 — bradycardia resolved, re-dose not indicated", warnMsg:"HR improving — reassess need for additional Atropine" }),
    mk("sbp", { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — assess hemodynamic status before re-dosing" }),
  ],
  "Midazolam (Versed)": bzdChecks("SBP <90 — re-dose may worsen hypotension","RR <8 — hold re-dose, respiratory depression present","RR <12 — monitor airway closely","SpO₂ <94% — pre-oxygenate before re-dosing"),
  "Diazepam (Valium)":  bzdChecks("SBP <90 — may worsen hypotension","RR <8 — hold re-dose","RR <12 — monitor closely"),
  "Lorazepam (Ativan)": bzdChecks("SBP <90 — may worsen hypotension","RR <8 — hold re-dose","RR <12 — monitor closely"),
  "Morphine Sulfate": [
    mk("sbp",  { required:true, blockIf:v=>+v<90, warnIf:v=>+v<100, blockMsg:"SBP <90 — hold re-dose, hypotension present", warnMsg:"SBP <100 — caution" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14,  blockMsg:"RR <10 — hold re-dose, respiratory depression", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate before re-dosing" }),
  ],
  "Morphine": [
    mk("sbp",  { required:true, blockIf:v=>+v<90, warnIf:v=>+v<100, blockMsg:"SBP <90 — hold re-dose", warnMsg:"SBP <100 — caution" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14,  blockMsg:"RR <10 — hold re-dose", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate" }),
  ],
  "Fentanyl": [
    mk("sbp",  { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — consider Ketamine instead" }),
    mk("rr",   { required:true, blockIf:v=>+v<10, warnIf:v=>+v<14, blockMsg:"RR <10 — hold re-dose, respiratory depression", warnMsg:"RR <14 — monitor airway" }),
    mk("spo2", { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — pre-oxygenate before re-dosing" }),
  ],
  "Naloxone (Narcan)": [
    mk("rr",   { required:true, blockIf:v=>+v>=12, blockMsg:"RR ≥12 — re-dose not needed. Titrate to respirations only." }),
    mk("spo2", { required:true, warnIf:v=>+v<94,   warnMsg:"SpO₂ still low — ensure airway position and BVM ready" }),
  ],
  "Epinephrine 1:1,000": [
    mk("sbp",  { required:true, warnIf:v=>+v>100, warnMsg:"SBP now >100 — reassess if re-dose is still needed" }),
    mk("hr",   { required:true, warnIf:v=>+v>130, warnMsg:"HR >130 — tachycardia present, but re-dose if anaphylaxis persists" }),
  ],
  "Magnesium Sulfate": [
    mk("rr",   { required:true, blockIf:v=>+v<12, blockMsg:"RR <12 — hold re-dose, respiratory depression risk" }),
    mk("sbp",  { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — slow infusion and reassess" }),
  ],
  "Haloperidol (Haldol)": [
    mk("sbp",  { required:true, warnIf:v=>+v<90,  warnMsg:"SBP <90 — Haloperidol may worsen orthostatic hypotension" }),
    mk("hr",   { required:true, warnIf:v=>+v>100, warnMsg:"HR >100 — increasing QT prolongation risk with repeated dosing" }),
  ],
  "Albuterol": [
    mk("lungsounds",{ required:true, blockIf:v=>v==="No", blockMsg:"Lung sounds clear — bronchospasm resolved. Re-dose not indicated." }),
    mk("hr",        { required:true, warnIf:v=>+v>120, warnMsg:"HR >120 — tachycardia worsening, reassess re-dose" }),
    mk("spo2",      { required:true, warnIf:v=>+v<94,  warnMsg:"SpO₂ <94% — reassess response to nebulizer treatment" }),
  ],
  "Dopamine": [
    mk("sbp",  { required:true, warnIf:v=>+v>90,  warnMsg:"SBP >90 — reassess need to continue Dopamine" }),
    mk("hr",   { required:true, warnIf:v=>+v>120, warnMsg:"HR >120 — consider reducing dose rate" }),
  ],
  "Dextrose 50% (D50)": [
    mk("bgl",  { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — re-dose not indicated", warnMsg:"BGL borderline — confirm clinical hypoglycemia" }),
  ],
  "Dextrose 25% (D25)": [
    mk("bgl",  { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — re-dose not indicated", warnMsg:"BGL borderline — confirm hypoglycemia" }),
  ],
  "Oral Glucose (Glutose)": [
    mk("bgl",  { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — re-dose not indicated", warnMsg:"BGL borderline" }),
  ],
  "Oral Glucose": [
    mk("bgl",  { required:true, blockIf:v=>+v>80, warnIf:v=>+v>60, blockMsg:"BGL >80 — re-dose not indicated", warnMsg:"BGL borderline" }),
  ],
  "Atropine (Organophosphate)": [
    mk("rr",   { required:true, warnIf:v=>+v>10, warnMsg:"RR improving — reassess secretion status before re-dosing" }),
    mk("hr",   { required:true, warnIf:v=>+v>100, warnMsg:"HR >100 — monitor for atropine toxicity (secretions are the endpoint)" }),
  ],
};

/* ��� DRUG DATABASE ��� */
const ADULT = {
  cardiac: [
    { name:"Aspirin", sub:"ACS / Chest Pain", dose:"324 mg PO (4 tablets, chewed)", route:"PO", conc:"81 mg/tablet", draw:"4 tablets — subtract any taken prior to arrival", notes:"Give early in suspected ACS. Must be chewed, not swallowed whole. Screen for allergy and prior dose before giving.", ci:["Aspirin/NSAID allergy","Active GI bleed","Hemorrhagic stroke"], scope:"EMT", redoseMins:null, maxDoses:1 },
    { name:"Nitroglycerin", sub:"ACS / Pulmonary Edema", dose:"0.4 mg SL q5min × 3", route:"SL", conc:"0.4 mg/tablet or spray", draw:"1 tablet or 1 spray SL", notes:"Hold if SBP <100, HR <50 or >100, suspected RVI, or PDE-5 use in past 24–48 h.", ci:["SBP <100","RVI","PDE-5 inhibitor <24–48h","HR <50"], scope:"EMT", redoseMins:5, maxDoses:3 },
    { name:"Epinephrine 1:10,000", sub:"Cardiac Arrest (all rhythms)", dose:"1 mg IV/IO q3–5 min", route:"IV/IO", conc:"0.1 mg/mL", draw:"10 mL", syringe:"10 mL syringe", notes:"Flush with 20 mL NS after each dose. Continue CPR without interruption. No established maximum dose per AHA/ACLS — continue every 3–5 min throughout arrest.", ci:[], scope:"AEMT", redoseMins:4, maxDoses:null },
    { name:"Amiodarone", sub:"VF / Pulseless VT", dose:"Dose 1: 300 mg IVP · Dose 2: 150 mg IVP", route:"IV/IO", conc:"50 mg/mL", draw:"Dose 1: 6 mL (300 mg) · Dose 2: 3 mL (150 mg)", notes:"Stable VT: 150 mg IV over 10 min. Avoid in iodine allergy. Do NOT mix with other drugs.", maxDoseNote:"Max 450 mg total (2 doses)", doseSteps:[{label:"Dose 1",dose:"300 mg IVP",draw:"6 mL",mg:300},{label:"Dose 2",dose:"150 mg IVP",draw:"3 mL",mg:150}], ci:["Iodine allergy (relative)","Cardiogenic shock"], scope:"Medic", redoseMins:2, maxDoses:2 },
    { name:"Adenosine", sub:"SVT", dose:"6 mg rapid IVP; repeat 12 mg ×2", route:"IV (proximal site)", conc:"3 mg/mL", draw:"2 mL (6 mg) · 4 mL (12 mg)", syringe:"5 mL", notes:"PUSH FAST — flush 20 mL NS immediately. 2nd & 3rd doses = 12 mg each.", ci:["2nd/3rd degree AV block","Sick sinus syndrome","Asthma (relative)"], scope:"Medic", redoseMins:2, maxDoses:3 },
    { name:"Atropine", sub:"Symptomatic Bradycardia", dose:"0.5 mg IV q3–5 min (max 3 mg)", route:"IV/IO", conc:"0.1 mg/mL", draw:"5 mL per dose", syringe:"10 mL", notes:"Min 0.5 mg to avoid paradoxical bradycardia. Max 3 mg total (6 doses).", ci:["Glaucoma (relative)","Infranodal block – Type II"], scope:"AEMT", redoseMins:4, maxDoses:6 },
    { name:"Dopamine", sub:"Cardiogenic Shock / Hypotension", dose:"2–20 mcg/kg/min IV infusion", route:"IV infusion", conc:"1,600 mcg/mL (400 mg/250 mL)", draw:"Titrate via IV pump", notes:"2–5 mcg/kg/min = renal. 5–10 = inotropic. 10–20 = vasopressor.", ci:["Pheochromocytoma"], scope:"Medic", redoseMins:null, maxDoses:null },
    { name:"Lidocaine", sub:"VF/pVT (alternative to amiodarone)", dose:"1–1.5 mg/kg IV/IO", route:"IV/IO", conc:"20 mg/mL (2%)", draw:"Varies by weight", notes:"Maintenance after ROSC: 1–4 mg/min infusion.", ci:["High-degree AV block","Lidocaine allergy"], scope:"Medic", wt:true, mpk:1.5, cmpml:20, redoseMins:null, maxDoses:1 },
    { name:"Magnesium Sulfate", sub:"Torsades de Pointes", dose:"1–2 g IV over 5–20 min", route:"IV", conc:"500 mg/mL (dilute in 100 mL NS)", draw:"2–4 mL in 100 mL NS", notes:"Antidote for toxicity: Calcium Gluconate 1 g IV.", ci:["Renal failure (relative)","Heart block"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Sodium Bicarbonate", sub:"Prolonged Arrest / TCA OD / Hyperkalemia", dose:"1 mEq/kg IV", route:"IV/IO", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"Do NOT mix with calcium or epinephrine. Flush line before and after.", ci:["Metabolic alkalosis","Hypokalemia"], scope:"Medic", wt:true, mpk:1, cmpml:1, unit:"mEq", redoseMins:null, maxDoses:null },
  ],
  respiratory: [
    { name:"Albuterol", sub:"Bronchospasm / Asthma / COPD", dose:"2.5 mg nebulized (may repeat)", route:"Nebulizer", conc:"0.83 mg/mL (2.5 mg/3 mL unit)", draw:"1 unit dose (3 mL)", notes:"May give continuous neb in severe asthma. Can mix with ipratropium.", ci:["Tachyarrhythmia (relative)"], scope:"EMT", redoseMins:20, maxDoses:null },
    { name:"Ipratropium (Atrovent)", sub:"COPD Exacerbation / Bronchospasm", dose:"0.5 mg nebulized (once)", route:"Nebulizer", conc:"0.02% (0.5 mg/2.5 mL)", draw:"1 unit dose — mix with albuterol", notes:"Give ONCE with albuterol. Do not repeat alone.", ci:["Peanut/soy allergy (relative)"], scope:"AEMT", redoseMins:null, maxDoses:1 },
    { name:"Epinephrine 1:1,000", sub:"Severe Bronchospasm / Anaphylaxis", dose:"0.3–0.5 mg IM (lateral thigh)", route:"IM", conc:"1 mg/mL", draw:"0.3–0.5 mL", syringe:"1 mL", notes:"IM lateral thigh preferred. May repeat in 5–15 min.", ci:["None absolute in anaphylaxis"], scope:"AEMT", redoseMins:10, maxDoses:3 },
    { name:"Methylprednisolone", sub:"Severe Asthma / COPD / Anaphylaxis", dose:"125 mg IV/IM", route:"IV/IM", conc:"125 mg/2 mL", draw:"2 mL", notes:"Delayed onset ~1–2 hr. Helps prevent biphasic reaction.", ci:["Active systemic fungal infection"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Nitroglycerin", sub:"Flash Pulmonary Edema / HTN Urgency", dose:"0.4 mg SL q5min", route:"SL", conc:"0.4 mg/tablet or spray", draw:"1 spray or tablet SL", notes:"Key adjunct for flash pulmonary edema with hypertension.", ci:["SBP <100","PDE-5 inhibitors <24–48h"], scope:"EMT", redoseMins:5, maxDoses:3 },
  ],
  neurological: [
    { name:"Midazolam (Versed)", sub:"Active Seizure / Sedation / Agitation", dose:"2–5 mg IV · 5–10 mg IM/IN", route:"IV/IM/IN", conc:"5 mg/mL", draw:"0.5–1 mL IV · 1–2 mL IM/IN", syringe:"3 mL; MAD for IN", notes:"IN: max 1 mL per nostril. Titrate to effect. Monitor airway.", ci:["Significant respiratory depression","Hypotension (relative)"], scope:"Medic", redoseMins:10, maxDoses:2 },
    { name:"Diazepam (Valium)", sub:"Active Seizure", dose:"5–10 mg IV · 5–10 mg IM/PR", route:"IV/IM/PR", conc:"5 mg/mL", draw:"1–2 mL IV", notes:"Give IV slowly — causes pain/phlebitis if fast.", ci:["Acute narrow-angle glaucoma","Severe respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:2 },
    { name:"Lorazepam (Ativan)", sub:"Active Seizure / Status Epilepticus", dose:"2–4 mg IV/IM", route:"IV/IM", conc:"2 mg/mL", draw:"1–2 mL", notes:"Onset 2–5 min IV. Preferred for status epilepticus.", ci:["Acute narrow-angle glaucoma","Severe respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:2 },
    { name:"Dextrose 50% (D50)", sub:"Hypoglycemia with AMS", dose:"25 g IV (50 mL)", route:"IV", conc:"500 mg/mL (50%)", draw:"50 mL prefilled syringe", notes:"Confirm BGL <60 mg/dL. Vesicant — large-bore IV. Recheck BGL in 5 min.", ci:["Confirmed hyperglycemia"], scope:"AEMT", redoseMins:5, maxDoses:2 },
    { name:"Naloxone (Narcan)", sub:"Opioid Overdose", dose:"0.4–2 mg IV/IM/IN (titrate)", route:"IV/IM/IN", conc:"0.4 mg/mL or 1 mg/mL", draw:"1–5 mL (0.4 mg/mL) · 2 mL IN", notes:"Titrate to adequate respirations ONLY. Re-dose PRN.", ci:[], scope:"EMT", redoseMins:3, maxDoses:null },
    { name:"Thiamine (B1)", sub:"Suspected Wernicke's / Alcoholism / AMS", dose:"100 mg IV/IM", route:"IV/IM", conc:"100 mg/mL", draw:"1 mL", notes:"Give BEFORE dextrose in known or suspected alcoholics.", ci:[], scope:"Medic", redoseMins:null, maxDoses:1 },
  ],
  metabolic: [
    { name:"Dextrose 50% (D50)", sub:"Severe Hypoglycemia (IV access)", dose:"25 g IV (50 mL)", route:"IV", conc:"500 mg/mL (50%)", draw:"50 mL prefilled syringe", notes:"Vesicant — large-bore IV. Recheck BGL in 5 min.", ci:["Hyperglycemia"], scope:"AEMT", redoseMins:5, maxDoses:2 },
    { name:"Glucagon", sub:"Hypoglycemia (No IV) / Beta-Blocker OD", dose:"1 mg IM · 3–10 mg IV (OD)", route:"IM / IV", conc:"1 mg/mL (reconstituted)", draw:"1 mL IM", notes:"Reconstitute per kit. Onset 5–20 min IM. May cause vomiting.", ci:["Pheochromocytoma","Insulinoma"], scope:"AEMT", redoseMins:null, maxDoses:1 },
    { name:"Oral Glucose (Glutose)", sub:"Conscious Hypoglycemia", dose:"15–20 g PO", route:"PO", conc:"15 g/tube", draw:"1 tube (15 g)", notes:"Patient MUST be conscious with intact gag reflex. Recheck BGL in 15 min.", ci:["Unconscious","Impaired swallow"], scope:"EMT", redoseMins:15, maxDoses:2 },
    { name:"Normal Saline (0.9% NaCl)", sub:"Volume Replacement / DKA / Heat Emergency", dose:"250–1,000 mL IV bolus (titrate)", route:"IV/IO", conc:"0.9% NaCl", draw:"250–1,000 mL bag", notes:"Caution in pulmonary edema or CHF.", ci:["Cardiogenic pulmonary edema (large volumes)"], scope:"AEMT", redoseMins:null, maxDoses:null },
    { name:"Sodium Bicarbonate", sub:"Metabolic Acidosis / DKA / Hyperkalemia", dose:"1 mEq/kg IV", route:"IV", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"DKA: use only if pH <7.0 and hemodynamically unstable. Alkalinizes serum. Do NOT mix with calcium or epinephrine. Flush line before and after.", ci:["Metabolic alkalosis","Hypernatremia"], scope:"Medic", wt:true, mpk:1, cmpml:1, unit:"mEq", redoseMins:null, maxDoses:null },
    { name:"Calcium Chloride 10%", sub:"Hyperkalemia — Cardiac Membrane Stabilization", dose:"1 g (10 mL) IV slow push over 3–5 min", route:"IV", conc:"100 mg/mL (10%)", draw:"10 mL prefilled syringe", notes:"Stabilizes cardiac membrane — does NOT lower potassium. Combine with bicarb and albuterol for full hyperkalemia treatment. Do NOT mix with bicarb in same line.", ci:["Ventricular fibrillation","Digitalis toxicity","Hypercalcemia"], scope:"Medic", redoseMins:null, maxDoses:null },
    { name:"Thiamine (B1)", sub:"Pre-Glucose Administration / Wernicke's Prevention", dose:"100 mg IV/IM", route:"IV/IM", conc:"100 mg/mL", draw:"1 mL", notes:"Give BEFORE dextrose in known or suspected alcoholism or malnourished patients. Prevents Wernicke's encephalopathy.", ci:[], scope:"Medic", redoseMins:null, maxDoses:1 },
  ],
  anaphylaxis: [
    { name:"Epinephrine 1:1,000", sub:"Anaphylaxis — FIRST LINE", dose:"0.3–0.5 mg IM (lateral thigh)", route:"IM", conc:"1 mg/mL", draw:"0.3–0.5 mL", notes:"FIRST-LINE. Lateral mid-thigh preferred. Repeat every 5–15 min.", ci:["None absolute in anaphylaxis"], scope:"EMT", redoseMins:10, maxDoses:3 },
    { name:"Diphenhydramine (Benadryl)", sub:"Allergic Reaction (adjunct to epi)", dose:"25–50 mg IV/IM", route:"IV/IM", conc:"50 mg/mL", draw:"0.5–1 mL", notes:"ADJUNCT only — never first-line. Slow IV push.", ci:["Narrow-angle glaucoma","Prostatic hypertrophy (relative)"], scope:"AEMT", redoseMins:null, maxDoses:1 },
    { name:"Methylprednisolone", sub:"Anaphylaxis — biphasic prevention", dose:"125 mg IV/IM", route:"IV/IM", conc:"125 mg/2 mL", draw:"2 mL", notes:"Secondary agent. Delayed onset. Prevents biphasic reaction.", ci:[], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Albuterol", sub:"Bronchospasm in Anaphylaxis", dose:"2.5 mg nebulized", route:"Nebulizer", conc:"0.83 mg/mL", draw:"1 unit dose in neb cup", notes:"Give after epinephrine for persistent bronchospasm.", ci:[], scope:"EMT", redoseMins:20, maxDoses:null },
  ],
  pain: [
    { name:"Fentanyl", sub:"Moderate–Severe Pain", dose:"1–2 mcg/kg IV/IM/IN", route:"IV/IM/IN", conc:"50 mcg/mL", draw:"Varies by weight", syringe:"3 mL; MAD for IN", notes:"IN: 2 mcg/kg, max 1 mL per nostril. Monitor resp depression.", ci:["Significant respiratory depression","Hemodynamic instability (relative)"], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Morphine Sulfate", sub:"Moderate–Severe Pain / ACS", dose:"2–4 mg IV q5–15 min (titrate)", route:"IV/IM", conc:"2 mg/mL", draw:"1–2 mL", notes:"Slow IVP. Caution in hypotension and respiratory depression.", ci:["Hypotension","Severe respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:null },
    { name:"Ketorolac (Toradol)", sub:"Moderate Pain — non-narcotic", dose:"15–30 mg IV · 30 mg IM", route:"IV/IM", conc:"30 mg/mL", draw:"0.5–1 mL IV · 1 mL IM", notes:"Slow IV push over 15 sec. Avoid in elderly, renal failure, GI bleed.", ci:["Active GI bleeding","Renal failure","NSAID allergy","Age >65 (reduce dose)"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Acetaminophen IV (Ofirmev)", sub:"Moderate Pain / Fever", dose:"1,000 mg IV over 15 min (≥50 kg) · 15 mg/kg <50 kg (max 750 mg)", route:"IV infusion", conc:"10 mg/mL", draw:"100 mL bag over 15 min", notes:"Max 4 g/day.", ci:["Hepatic failure","Acetaminophen allergy"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Ketamine", sub:"Pain / Excited Delirium / RSI", dose:"Pain: 0.1–0.3 mg/kg IV · Behavioral: 4–6 mg/kg IM · RSI: 1–2 mg/kg IV", route:"IV/IM", conc:"10 mg/mL or 50 mg/mL", draw:"Varies by weight and indication", notes:"Sub-dissociative (0.3 mg/kg IV) for pain. Full dissociative for RSI.", ci:["History of schizophrenia","Age <3 months"], scope:"Medic", wt:true, mpk:0.3, cmpml:10, redoseMins:null, maxDoses:null },
    { name:"Midazolam (Versed)", sub:"Procedural Sedation / Agitation", dose:"1–2.5 mg IV · 5 mg IM/IN", route:"IV/IM/IN", conc:"5 mg/mL", draw:"0.5–1 mL IV · 1 mL IM", notes:"Titrate slowly IV. Reversal: Flumazenil 0.2 mg IV.", ci:["Significant respiratory depression","Hypotension (relative)"], scope:"Medic", redoseMins:10, maxDoses:2 },
    { name:"Haloperidol (Haldol)", sub:"Acute Agitation / Behavioral Emergency", dose:"5 mg IM (may repeat; max 20 mg total)", route:"IM", conc:"5 mg/mL", draw:"1 mL", notes:"Monitor QT prolongation. Avoid in Parkinson's. Onset 20–40 min IM.", ci:["Parkinson's disease","Known QT prolongation","CNS depression"], scope:"Medic", redoseMins:30, maxDoses:4 },
  ],
  toxicology: [
    { name:"Naloxone (Narcan)", sub:"Opioid Overdose", dose:"0.4–2 mg IV/IM/IN (titrate)", route:"IV/IM/IN", conc:"0.4 mg/mL or 1 mg/mL", draw:"1–5 mL (0.4 mg/mL) · 2 mL IN", notes:"Titrate to adequate respirations only. Monitor for re-narcotization.", ci:[], scope:"EMT", redoseMins:3, maxDoses:null },
    { name:"Atropine (Organophosphate)", sub:"Organophosphate / Nerve Agent Poisoning", dose:"2–4 mg IV/IM q5–10 min until secretions dry", route:"IV/IM", conc:"0.1 mg/mL", draw:"20–40 mL per dose", notes:"ENDPOINT = DRYING OF SECRETIONS — not HR.", ci:[], scope:"Medic", redoseMins:7, maxDoses:null },
    { name:"Sodium Bicarbonate", sub:"TCA OD / Salicylate Toxicity / Hyperkalemia", dose:"1 mEq/kg IV bolus", route:"IV", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"TCA OD: give until QRS narrows. Do NOT mix with calcium or epi.", ci:["Metabolic alkalosis","Hypernatremia"], scope:"Medic", wt:true, mpk:1, cmpml:1, unit:"mEq", redoseMins:null, maxDoses:null },
    { name:"Glucagon", sub:"Beta-Blocker / CCB Overdose", dose:"3–10 mg IV · 1 mg IM", route:"IV/IM", conc:"1 mg/mL (reconstituted)", draw:"3–10 mL IV", notes:"Reconstitute per kit. Monitor for vomiting.", ci:["Pheochromocytoma","Insulinoma"], scope:"AEMT", redoseMins:null, maxDoses:null },
    { name:"Activated Charcoal", sub:"Certain Toxic Ingestions (within 1 hr)", dose:"1 g/kg PO (max 50–100 g)", route:"PO", conc:"25 g/120 mL or 50 g/240 mL", draw:"50 g standard adult dose", notes:"NOT for caustics, hydrocarbons, or AMS.", ci:["AMS","Caustic ingestion","Hydrocarbon ingestion","Unprotected airway"], scope:"Medic", redoseMins:null, maxDoses:1 },
  ],
  obgyn: [
    { name:"Magnesium Sulfate", sub:"Eclampsia / Severe Pre-Eclampsia", dose:"4–6 g IV over 15–20 min (loading)", route:"IV infusion", conc:"500 mg/mL — dilute 4 g in 100 mL NS", draw:"8 mL (4 g) in 100 mL NS", notes:"Monitor: DTRs, RR >12/min, UO >25 mL/hr. Antidote: Calcium Gluconate 1 g IV.", ci:["Renal failure (relative)","Myasthenia gravis","Heart block"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Oxytocin (Pitocin)", sub:"Postpartum Hemorrhage", dose:"10–40 units in 1 L NS at 500 mL/hr", route:"IV infusion", conc:"10 units/mL", draw:"1–4 mL in 1 L NS bag", notes:"ONLY after placental delivery. NEVER undiluted IVP.", ci:["Before placental delivery","Undiluted IV push"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Epinephrine 1:1,000", sub:"Anaphylaxis in Pregnancy", dose:"0.3–0.5 mg IM (lateral thigh)", route:"IM", conc:"1 mg/mL", draw:"0.3–0.5 mL", notes:"Do NOT withhold due to fetal concerns — maternal survival is priority.", ci:[], scope:"AEMT", redoseMins:10, maxDoses:3 },
  ],
  trauma: [
    { name:"Tranexamic Acid (TXA)", sub:"Hemorrhagic Shock — within 3 hrs of injury", dose:"1 g IV over 10 min", route:"IV infusion", conc:"100 mg/mL", draw:"10 mL in 100 mL NS over 10 min", notes:"CRITICAL: Give within 3 hours of injury only.", ci:["Injury >3 hrs prior","Active thromboembolic disease","Subarachnoid hemorrhage"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Normal Saline / LR", sub:"Hemorrhagic Shock — Permissive Hypotension", dose:"250–500 mL IV bolus; titrate to SBP 80–90", route:"IV/IO wide-bore", conc:"0.9% NaCl or LR", draw:"250–500 mL bolus; reassess after each", notes:"PERMISSIVE HYPOTENSION target: SBP 80–90. LR preferred.", ci:["TBI with suspected ICP elevation"], scope:"AEMT", redoseMins:null, maxDoses:null },
    { name:"Ketamine", sub:"Trauma Pain / RSI Induction", dose:"Pain: 0.1–0.3 mg/kg IV · RSI: 1–2 mg/kg IV · IM: 4 mg/kg", route:"IV/IM", conc:"10 mg/mL or 50 mg/mL", draw:"Varies by weight", notes:"Drug of choice for hemodynamically unstable trauma.", ci:["Suspected aortic dissection (relative)"], scope:"Medic", wt:true, mpk:0.3, cmpml:10, redoseMins:null, maxDoses:null },
    { name:"Fentanyl", sub:"Trauma Pain (hemodynamically stable)", dose:"1–2 mcg/kg IV/IM/IN", route:"IV/IM/IN", conc:"50 mcg/mL", draw:"Varies by weight", notes:"Use Ketamine first if hemodynamically unstable.", ci:["Significant respiratory depression","Hypotension"], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Calcium Chloride 10%", sub:"Crush Syndrome / Hyperkalemia / Massive Transfusion", dose:"1 g (10 mL) IV slow push over 3–5 min", route:"IV", conc:"100 mg/mL (10%)", draw:"10 mL prefilled syringe", notes:"For crush syndrome: give before releasing entrapment >4 hrs. Do NOT mix with bicarb.", ci:["Ventricular fibrillation","Digitalis toxicity","Hypercalcemia"], scope:"Medic", redoseMins:null, maxDoses:null },
    { name:"Sodium Bicarbonate", sub:"Crush Syndrome — Rhabdomyolysis Alkalinization", dose:"1 mEq/kg IV bolus; then infusion", route:"IV/IO", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"Alkalinizes urine to prevent myoglobin precipitation. Give after calcium.", ci:["Metabolic alkalosis"], scope:"Medic", wt:true, mpk:1, cmpml:1, unit:"mEq", redoseMins:null, maxDoses:null },
    { name:"Epinephrine 1:10,000", sub:"Traumatic Cardiac Arrest", dose:"1 mg IV/IO q3–5 min", route:"IV/IO", conc:"0.1 mg/mL", draw:"10 mL", notes:"Address reversible causes first (4 H's and 4 T's).", ci:[], scope:"AEMT", redoseMins:4, maxDoses:null },
    { name:"Midazolam (Versed)", sub:"RSI Pre-medication / Combative Trauma", dose:"2–5 mg IV · 5–10 mg IM", route:"IV/IM", conc:"5 mg/mL", draw:"0.5–1 mL IV · 1–2 mL IM", notes:"Caution in hypotensive trauma. Prefer ketamine for unstable patients.", ci:["Hemodynamic instability (relative)","Significant respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:2 },
  ],
  burns: [
    { name:"Normal Saline / LR (Parkland)", sub:"Burn Fluid Resuscitation — Parkland Formula", dose:"4 mL × kg × % TBSA in 24 hrs · First half in first 8 hrs from burn", route:"IV large-bore (2 sites)", conc:"0.9% NaCl or LR (preferred)", draw:"Calculate: 4 × wt(kg) × % TBSA = total mL / 24 h", notes:"Clock starts at TIME OF BURN. Target UO 0.5–1 mL/kg/hr.", ci:["<15% TBSA (oral hydration may suffice)"], scope:"AEMT", redoseMins:null, maxDoses:null },
    { name:"Morphine Sulfate", sub:"Burn Pain Management", dose:"2–4 mg IV slow push q5–15 min", route:"IV", conc:"2 mg/mL", draw:"1–2 mL per dose", notes:"IV strongly preferred — IM/SQ unreliable in burns.", ci:["Hypotension","Significant respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:null },
    { name:"Fentanyl", sub:"Burn Pain — IV or Intranasal", dose:"1–2 mcg/kg IV/IN", route:"IV/IN", conc:"50 mcg/mL", draw:"Varies by weight", notes:"Preferred for initial burn analgesia. Faster onset than morphine.", ci:["Significant respiratory depression","Hemodynamic instability (relative)"], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Ketamine", sub:"Burn Pain / Dressing Change / Procedural Sedation", dose:"Sub-dissoc: 0.1–0.3 mg/kg IV · Procedural: 1–2 mg/kg IV · IM: 4 mg/kg", route:"IV/IM", conc:"10 mg/mL or 50 mg/mL", draw:"Varies by weight and indication", notes:"Excellent for burn dressing changes. Maintains hemodynamics.", ci:["History of schizophrenia"], scope:"Medic", wt:true, mpk:0.3, cmpml:10, redoseMins:null, maxDoses:null },
    { name:"Albuterol", sub:"Inhalation Injury — Bronchospasm", dose:"2.5 mg nebulized (may repeat)", route:"Nebulizer", conc:"0.83 mg/mL (2.5 mg/3 mL unit)", draw:"1 unit dose (3 mL) in neb cup", notes:"Give early for wheezing, stridor, or hoarseness.", ci:["Tachyarrhythmia (relative)"], scope:"EMT", redoseMins:20, maxDoses:null },
    { name:"Epi 1:1,000 (Neb)", sub:"Severe Inhalation Injury / Airway Edema", dose:"5 mg (5 mL of 1 mg/mL) nebulized", route:"Nebulizer", conc:"1 mg/mL", draw:"5 mL in neb cup", notes:"Temporizing measure for impending upper airway edema. Early definitive airway is priority.", ci:["Tachyarrhythmia"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Midazolam (Versed)", sub:"Burn Sedation / RSI Pre-medication", dose:"2–5 mg IV · 5 mg IM", route:"IV/IM", conc:"5 mg/mL", draw:"0.5–1 mL IV · 1 mL IM", notes:"Pair with ketamine for better hemodynamic stability.", ci:["Hemodynamic instability (relative)","Significant respiratory depression"], scope:"Medic", redoseMins:10, maxDoses:2 },
  ],
};

const PEDS = {
  cardiac: [
    { name:"Epinephrine 1:10,000", sub:"Cardiac Arrest", dose:"0.01 mg/kg IV/IO q3–5 min", route:"IV/IO", conc:"0.1 mg/mL", draw:"0.1 mL/kg (max 10 mL)", notes:"Max 1 mg per dose. Flush 3–5 mL NS after each dose. No established maximum dose per AHA/ACLS — continue every 3–5 min throughout arrest.", ci:[], scope:"AEMT", wt:true, mpk:0.01, cmpml:0.1, maxd:1, redoseMins:4, maxDoses:null },
    { name:"Adenosine", sub:"SVT", dose:"0.1 mg/kg rapid IVP (max 6 mg)", route:"Rapid IV proximal + flush", conc:"3 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"Push FAST + flush 10–20 mL NS. 2nd dose: 0.2 mg/kg (max 12 mg).", ci:["2nd/3rd degree AV block","Asthma (relative)"], scope:"Medic", wt:true, mpk:0.1, cmpml:3, maxd:6, redoseMins:2, maxDoses:3 },
    { name:"Amiodarone", sub:"VF / pVT (refractory)", dose:"5 mg/kg IV/IO (max 300 mg per dose)", route:"IV/IO", conc:"50 mg/mL", draw:"Varies by weight (max 6 mL per dose)", notes:"Max 300 mg per dose. Dilute in D5W. Both doses are equal weight-based amounts. Stable arrhythmia: give over 20–60 min.", maxDoseNote:"Max 300 mg/dose · Max 2 doses (600 mg total)", ci:[], scope:"Medic", wt:true, mpk:5, cmpml:50, maxd:300, redoseMins:2, maxDoses:2 },
    { name:"Atropine", sub:"Symptomatic Bradycardia", dose:"0.02 mg/kg IV/IO", route:"IV/IO", conc:"0.1 mg/mL", draw:"Varies by weight", notes:"Min 0.1 mg; max 0.5 mg (child), 1 mg (adolescent).", ci:[], scope:"AEMT", wt:true, mpk:0.02, cmpml:0.1, maxd:0.5, mind:0.1, redoseMins:4, maxDoses:2 },
  ],
  airway: [
    { name:"Succinylcholine", sub:"RSI Paralytic", dose:"1–2 mg/kg IV/IO", route:"IV/IO", conc:"20 mg/mL", draw:"Varies by weight (max 7.5 mL)", notes:"Onset 45–60 sec. Pre-treat with atropine. Contraindicated in hyperkalemia.", ci:["Hyperkalemia","Burns >24 h","Crush injury >24 h","Known myopathy"], scope:"Medic", wt:true, mpk:1.5, cmpml:20, maxd:150, redoseMins:null, maxDoses:1 },
    { name:"Rocuronium", sub:"RSI Paralytic (if succinylcholine CI)", dose:"1–1.2 mg/kg IV", route:"IV/IO", conc:"10 mg/mL", draw:"Varies by weight (max 10 mL)", notes:"Onset 60–90 sec. Reversal: Sugammadex 16 mg/kg.", ci:["Allergy"], scope:"Medic", wt:true, mpk:1.2, cmpml:10, maxd:100, redoseMins:null, maxDoses:1 },
    { name:"Ketamine", sub:"RSI Induction / Procedural Sedation", dose:"1–2 mg/kg IV · 4–6 mg/kg IM", route:"IV/IM", conc:"10 mg/mL", draw:"Varies by weight", notes:"Preserves airway reflexes and hemodynamics.", ci:["Age <3 months (relative)","Schizophrenia"], scope:"Medic", wt:true, mpk:2, cmpml:10, maxd:200, redoseMins:null, maxDoses:null },
    { name:"Midazolam (Versed)", sub:"RSI Pre-medication / Sedation", dose:"0.1–0.3 mg/kg IV/IM/IN", route:"IV/IM/IN", conc:"5 mg/mL", draw:"Varies by weight (max 1 mL)", notes:"IN: use MAD device, max 0.5 mL per nostril.", ci:[], scope:"Medic", wt:true, mpk:0.1, cmpml:5, maxd:5, redoseMins:10, maxDoses:2 },
    { name:"Atropine (RSI pre-tx)", sub:"RSI Pre-medication — under 1 yr", dose:"0.02 mg/kg IV (3 min before intubation)", route:"IV", conc:"0.1 mg/mL", draw:"Varies by weight", notes:"Prevents vagal bradycardia from laryngoscopy. Min 0.1 mg.", ci:[], scope:"Medic", wt:true, mpk:0.02, cmpml:0.1, maxd:0.5, mind:0.1, redoseMins:null, maxDoses:1 },
  ],
  respiratory: [
    { name:"Albuterol", sub:"Bronchospasm / Asthma — Pediatric", dose:"≥20 kg: 2.5 mg neb · <20 kg: 1.25 mg neb", route:"Nebulizer", conc:"0.83 mg/mL (2.5 mg/3 mL unit)", draw:"Unit dose — see weight", notes:"Repeat q20 min. Continuous neb in severe asthma. Mix with ipratropium in same neb cup.", ci:["Tachyarrhythmia (relative)"], scope:"EMT", redoseMins:20, maxDoses:null },
    { name:"Ipratropium (Atrovent)", sub:"Bronchospasm — Pediatric Adjunct", dose:"<20 kg: 0.25 mg neb · ≥20 kg: 0.5 mg neb (once)", route:"Nebulizer", conc:"0.02% (0.5 mg/2.5 mL)", draw:"Unit dose — mix with albuterol", notes:"Give ONCE with albuterol. Not effective as sole bronchodilator.", ci:["Peanut/soy allergy (relative)"], scope:"AEMT", redoseMins:null, maxDoses:1 },
    { name:"Epinephrine 1:1,000 (Nebulized)", sub:"Croup (Laryngotracheobronchitis)", dose:"5 mL of 1:1,000 undiluted via neb", route:"Nebulizer", conc:"1 mg/mL (1:1,000)", draw:"5 mL undiluted in neb cup", notes:"For moderate-severe croup with stridor at rest. Watch for rebound — observe 2+ hrs. Use racemic epi if protocol permits.", ci:[], scope:"Medic", redoseMins:20, maxDoses:2 },
    { name:"Epinephrine 1:1,000", sub:"Severe Bronchospasm / Near-Fatal Asthma", dose:"0.01 mg/kg IM (max 0.5 mg)", route:"IM (lateral thigh)", conc:"1 mg/mL", draw:"0.01 mL/kg (max 0.5 mL)", notes:"Reserve for life-threatening bronchospasm refractory to nebulized treatment. Monitor HR and rhythm.", ci:[], scope:"AEMT", wt:true, mpk:0.01, cmpml:1, maxd:0.5, redoseMins:15, maxDoses:2 },
    { name:"Methylprednisolone", sub:"Severe Asthma / Reactive Airway Disease", dose:"1–2 mg/kg IV/IM (max 125 mg)", route:"IV/IM", conc:"125 mg/2 mL", draw:"Varies by weight (max 2 mL)", notes:"Start early — onset ~1–2 hr. Single-dose EMS intervention.", ci:["Active systemic fungal infection"], scope:"Medic", wt:true, mpk:1, cmpml:62.5, maxd:125, redoseMins:null, maxDoses:1 },
    { name:"Magnesium Sulfate", sub:"Severe Refractory Bronchospasm", dose:"25–75 mg/kg IV over 20 min (max 2 g)", route:"IV infusion — dilute in 100 mL NS", conc:"500 mg/mL (diluted in 100 mL NS)", draw:"Varies by weight (max 4 mL = 2 g) in 100 mL NS", notes:"Reserve for life-threatening asthma unresponsive to bronchodilators. Monitor RR, BP, deep tendon reflexes. Antidote: Calcium Gluconate.", ci:["Renal failure","Hypotension","Heart block"], scope:"Medic", wt:true, mpk:50, cmpml:500, maxd:2000, redoseMins:null, maxDoses:1 },
    { name:"Dexamethasone", sub:"Croup — Corticosteroid", dose:"0.6 mg/kg IM/IV/PO (max 16 mg)", route:"IM/IV/PO", conc:"4 mg/mL (injection)", draw:"Varies by weight (max 4 mL)", notes:"For moderate-severe croup. Single dose. May give orally if tolerated.", ci:["Active systemic infection (relative)"], scope:"Medic", wt:true, mpk:0.6, cmpml:4, maxd:16, redoseMins:null, maxDoses:1 },
  ],
  seizure: [
    { name:"Midazolam (Versed)", sub:"Active Seizure — 1st Line", dose:"0.2 mg/kg IM/IN · 0.1 mg/kg IV", route:"IM/IN/IV", conc:"5 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"IM/IN preferred if no IV access. IN: MAD, max 0.5 mL per nostril.", ci:[], scope:"Medic", wt:true, mpk:0.2, cmpml:5, maxd:10, redoseMins:10, maxDoses:2 },
    { name:"Diazepam (Valium)", sub:"Active Seizure", dose:"0.2–0.5 mg/kg IV · 0.5 mg/kg PR", route:"IV/PR", conc:"5 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"PR when no IV access. Max 10 mg. Monitor airway.", ci:[], scope:"Medic", wt:true, mpk:0.3, cmpml:5, maxd:10, redoseMins:10, maxDoses:2 },
    { name:"Lorazepam (Ativan)", sub:"Status Epilepticus", dose:"0.05–0.1 mg/kg IV", route:"IV", conc:"2 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"Preferred IV benzo for status epilepticus. Onset 2–5 min IV.", ci:[], scope:"Medic", wt:true, mpk:0.1, cmpml:2, maxd:4, redoseMins:10, maxDoses:2 },
  ],
  anaphylaxis: [
    { name:"Epinephrine 1:1,000", sub:"Anaphylaxis — FIRST LINE", dose:"0.01 mg/kg IM (max 0.5 mg)", route:"IM (lateral thigh)", conc:"1 mg/mL", draw:"Varies by weight (max 0.5 mL)", notes:"EpiPen Jr (<25 kg) or EpiPen (≥25 kg). Repeat every 5–15 min PRN.", ci:[], scope:"EMT", wt:true, mpk:0.01, cmpml:1, maxd:0.5, redoseMins:10, maxDoses:3 },
    { name:"Diphenhydramine", sub:"Allergic Reaction — adjunct only", dose:"1 mg/kg IV/IM (max 50 mg)", route:"IV/IM", conc:"50 mg/mL", draw:"Varies by weight (max 1 mL)", notes:"ADJUNCT — not first-line. Give slowly IV.", ci:[], scope:"AEMT", wt:true, mpk:1, cmpml:50, maxd:50, redoseMins:null, maxDoses:1 },
    { name:"Albuterol", sub:"Bronchospasm in Anaphylaxis", dose:"≥20 kg: 2.5 mg neb · <20 kg: 1.25 mg neb", route:"Nebulizer", conc:"0.83 mg/mL", draw:"Unit dose — see weight", notes:"Adjunct for wheezing. Give after epinephrine.", ci:[], scope:"EMT", redoseMins:20, maxDoses:null },
  ],
  pain: [
    { name:"Fentanyl", sub:"Moderate–Severe Pain", dose:"1–2 mcg/kg IV/IM/IN", route:"IV/IM/IN", conc:"50 mcg/mL", draw:"Varies by weight", notes:"IN: 2 mcg/kg, max 0.5 mL per nostril with MAD.", ci:[], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, maxd:0.1, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Ketamine", sub:"Moderate–Severe Pain / Sedation", dose:"0.5–1 mg/kg IV · 2–3 mg/kg IM", route:"IV/IM", conc:"10 mg/mL", draw:"Varies by weight", notes:"Sub-dissociative (0.5 mg/kg IV) for pain.", ci:["Age <3 months"], scope:"Medic", wt:true, mpk:0.5, cmpml:10, maxd:100, redoseMins:null, maxDoses:null },
    { name:"Morphine", sub:"Moderate–Severe Pain", dose:"0.1 mg/kg IV/IM", route:"IV/IM", conc:"2 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"Titrate carefully. Monitor for respiratory depression.", ci:[], scope:"Medic", wt:true, mpk:0.1, cmpml:2, maxd:4, redoseMins:10, maxDoses:null },
    { name:"Acetaminophen IV (Ofirmev)", sub:"Moderate Pain / Fever", dose:"15 mg/kg IV over 15 min (max 750 mg if <50 kg)", route:"IV infusion over 15 min", conc:"10 mg/mL", draw:"Varies by weight (max 75 mL)", notes:"Max 750 mg if <50 kg. Max 4 g/day.", ci:["Hepatic failure"], scope:"Medic", wt:true, mpk:15, cmpml:10, maxd:750, redoseMins:null, maxDoses:1 },
  ],
  toxicology: [
    { name:"Naloxone (Narcan)", sub:"Opioid Overdose — Pediatric", dose:"0.01 mg/kg IV/IM/IN (titrate) · 0.1 mg/kg for full reversal (max 2 mg)", route:"IV/IM/IN", conc:"0.4 mg/mL or 1 mg/mL (IN)", draw:"0.025 mL/kg IV/IM · 0.1 mL/kg per nostril IN using 1 mg/mL", notes:"Titrate to adequate respirations — not full reversal in opioid-dependent patients. IN via MAD. Re-dose q3–5 min PRN.", ci:[], scope:"EMT", wt:true, mpk:0.01, cmpml:0.4, maxd:2, redoseMins:3, maxDoses:null },
    { name:"Activated Charcoal", sub:"Toxic Ingestion — within 1 hr of ingestion", dose:"1 g/kg PO (max 50 g)", route:"PO", conc:"25 g/120 mL or 50 g/240 mL", draw:"1 g/kg — see weight (max 50 g)", notes:"ONLY if conscious with intact airway/gag reflex and within 1 hr of ingestion. NOT for caustics, hydrocarbons, or AMS.", ci:["AMS or impaired airway","Caustic ingestion","Hydrocarbon ingestion","Ingestion >1 hr ago"], scope:"Medic", redoseMins:null, maxDoses:1 },
    { name:"Atropine (Organophosphate)", sub:"Organophosphate / Nerve Agent Poisoning", dose:"0.05 mg/kg IV/IM; double dose q5 min until secretions dry", route:"IV/IM", conc:"0.1 mg/mL", draw:"0.5 mL/kg initial dose — titrate", notes:"ENDPOINT = DRYING OF SECRETIONS, not HR. Min 0.1 mg per dose. May require massive cumulative doses.", ci:[], scope:"Medic", redoseMins:7, maxDoses:null },
    { name:"Sodium Bicarbonate", sub:"TCA Overdose / Salicylate Toxicity", dose:"1 mEq/kg IV bolus", route:"IV/IO", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"TCA OD: give until QRS narrows to <100 ms. Do NOT mix with calcium or epinephrine. Flush line before/after.", ci:["Metabolic alkalosis","Hypernatremia"], scope:"Medic", wt:true, mpk:1, cmpml:1, unit:"mEq", redoseMins:null, maxDoses:null },
  ],
  glucose: [
    { name:"Dextrose 25% (D25)", sub:"Hypoglycemia — preferred in peds", dose:"0.5–1 g/kg IV (2–4 mL/kg of D25)", route:"IV", conc:"250 mg/mL (25%)", draw:"2–4 mL/kg", notes:"Make D25 by diluting D50 1:1 with NS. Recheck BGL in 5 min.", ci:[], scope:"AEMT", wt:true, mpk:500, cmpml:250, maxd:25000, redoseMins:5, maxDoses:2 },
    { name:"Dextrose 10% (D10)", sub:"Hypoglycemia — Neonates / Infants", dose:"2 mL/kg IV", route:"IV", conc:"100 mg/mL (10%)", draw:"2 mL/kg", notes:"Preferred for neonates. Recheck BGL in 5 min.", ci:[], scope:"Medic", redoseMins:5, maxDoses:null },
    { name:"Glucagon", sub:"Hypoglycemia — No IV Access", dose:"<20 kg: 0.5 mg IM · ≥20 kg: 1 mg IM", route:"IM", conc:"1 mg/mL", draw:"0.5 mL (<20 kg) · 1 mL (≥20 kg)", notes:"Reconstitute per kit. Onset 5–15 min. May cause vomiting.", ci:[], scope:"AEMT", redoseMins:null, maxDoses:1 },
    { name:"Oral Glucose", sub:"Conscious Hypoglycemia (age ≥2, intact gag)", dose:"15 g PO", route:"PO", conc:"15 g/tube", draw:"1 tube (15 g)", notes:"Must be conscious with intact gag reflex. Recheck BGL in 15 min.", ci:["AMS","Impaired swallow"], scope:"EMT", redoseMins:15, maxDoses:2 },
  ],
  trauma: [
    { name:"Tranexamic Acid (TXA)", sub:"Pediatric Hemorrhagic Shock / Major Trauma", dose:"15 mg/kg IV over 10 min (max 1 g)", route:"IV infusion", conc:"100 mg/mL", draw:"Varies by weight in 100 mL NS (max 10 mL)", notes:"Must give within 3 hours of injury. Max 1 g.", ci:["Injury >3 hrs prior","Active thromboembolic disease"], scope:"Medic", wt:true, mpk:15, cmpml:100, maxd:1000, redoseMins:null, maxDoses:1 },
    { name:"Normal Saline (Trauma Resus)", sub:"Hemorrhagic Shock — Peds Fluid Resuscitation", dose:"20 mL/kg IV/IO bolus; reassess; repeat PRN", route:"IV/IO", conc:"0.9% NaCl or LR", draw:"20 mL/kg per bolus", notes:"LR preferred. 20 mL/kg boluses; reassess after each.", ci:[], scope:"AEMT", wt:true, mpk:20, cmpml:1, redoseMins:null, maxDoses:null },
    { name:"Ketamine", sub:"Trauma Pain / RSI", dose:"Pain: 0.5 mg/kg IV · RSI: 1–2 mg/kg IV · IM: 4 mg/kg", route:"IV/IM", conc:"10 mg/mL", draw:"Varies by weight", notes:"Drug of choice for hemodynamically unstable peds trauma.", ci:[], scope:"Medic", wt:true, mpk:0.5, cmpml:10, maxd:100, redoseMins:null, maxDoses:null },
    { name:"Fentanyl", sub:"Trauma Pain (stable peds patient)", dose:"1–2 mcg/kg IV/IM/IN", route:"IV/IM/IN", conc:"50 mcg/mL", draw:"Varies by weight", notes:"Use ketamine first if hemodynamically unstable.", ci:["Hypotension","Significant respiratory depression"], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, maxd:0.1, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Calcium Chloride 10%", sub:"Crush Syndrome / Hyperkalemia / Massive Transfusion", dose:"20 mg/kg IV slow push (max 1 g)", route:"IV", conc:"100 mg/mL (10%)", draw:"Varies by weight (max 10 mL)", notes:"Give slowly over 3–5 min. Do NOT mix with bicarb.", ci:["VF","Digitalis toxicity","Hypercalcemia"], scope:"Medic", wt:true, mpk:20, cmpml:100, maxd:1000, redoseMins:null, maxDoses:null },
    { name:"Sodium Bicarbonate", sub:"Crush Syndrome — Rhabdomyolysis", dose:"1 mEq/kg IV", route:"IV/IO", conc:"1 mEq/mL (8.4%)", draw:"1 mL/kg", notes:"Alkalinizes urine to protect kidneys from myoglobin.", ci:["Metabolic alkalosis"], scope:"Medic", wt:true, mpk:1, cmpml:1, maxd:50, unit:"mEq", redoseMins:null, maxDoses:null },
  ],
  burns: [
    { name:"Normal Saline / LR (Modified Parkland)", sub:"Pediatric Burn Fluid Resuscitation", dose:"3 mL × kg × % TBSA in first 24 hrs · First half in first 8 hrs", route:"IV large-bore", conc:"0.9% NaCl or LR (preferred)", draw:"Calculate: 3 × wt(kg) × % TBSA = total mL / 24 hrs", notes:"Add D5W maintenance fluids (<20 kg). Target UO 1 mL/kg/hr.", ci:["<10% TBSA (may use oral hydration)"], scope:"AEMT", redoseMins:null, maxDoses:null },
    { name:"Fentanyl", sub:"Burn Pain — Peds", dose:"1–2 mcg/kg IV/IN", route:"IV/IN", conc:"50 mcg/mL", draw:"Varies by weight", notes:"IN route useful in peds burn patients. Avoid IM — unreliable absorption.", ci:["Respiratory depression","Hemodynamic instability (relative)"], scope:"Medic", wt:true, mpk:0.001, cmpml:0.05, maxd:0.1, unit:"mcg", dmult:1000, redoseMins:10, maxDoses:null },
    { name:"Ketamine", sub:"Burn Pain / Dressing Changes / Sedation", dose:"Sub-dissoc: 0.5 mg/kg IV · Procedural: 1–2 mg/kg IV · IM: 4 mg/kg", route:"IV/IM", conc:"10 mg/mL", draw:"Varies by weight", notes:"Excellent for burn care. Maintains hemodynamics.", ci:["Age <3 months (relative)"], scope:"Medic", wt:true, mpk:0.5, cmpml:10, maxd:100, redoseMins:null, maxDoses:null },
    { name:"Morphine", sub:"Burn Pain — IV preferred", dose:"0.1 mg/kg IV (max 4 mg)", route:"IV", conc:"2 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"IV route strongly preferred — IM/SQ unreliable in burn patients.", ci:["Hypotension","Significant respiratory depression"], scope:"Medic", wt:true, mpk:0.1, cmpml:2, maxd:4, redoseMins:10, maxDoses:null },
    { name:"Albuterol", sub:"Inhalation Injury — Pediatric Bronchospasm", dose:"≥20 kg: 2.5 mg neb · <20 kg: 1.25 mg neb", route:"Nebulizer", conc:"0.83 mg/mL", draw:"Unit dose — see weight", notes:"Give early for wheezing, stridor, or respiratory distress.", ci:[], scope:"EMT", redoseMins:20, maxDoses:null },
    { name:"Succinylcholine", sub:"RSI — AVOID in Burns >24 Hours Old", dose:"1–2 mg/kg IV/IO (ONLY within 24 hrs of burn)", route:"IV/IO", conc:"20 mg/mL", draw:"Varies by weight (max 7.5 mL)", notes:"CRITICAL: AVOID after 24 hours — life-threatening HYPERKALEMIA. Use Rocuronium.", ci:["Burns >24 hours old","Hyperkalemia","Known myopathy"], scope:"Medic", wt:true, mpk:1.5, cmpml:20, maxd:150, redoseMins:null, maxDoses:1 },
  ],
};

/* ��� CONFIG ��� */
const A_SYS=[{k:"cardiac",l:"Cardiac",c:"#f87171",lc:"#dc2626",e:"♥"},{k:"respiratory",l:"Respiratory",c:"#60a5fa",lc:"#1d4ed8",e:"🌬"},{k:"neurological",l:"Neuro",c:"#c084fc",lc:"#7e22ce",e:"⚡"},{k:"metabolic",l:"Metabolic",c:"#facc15",lc:"#a16207",e:"⚗"},{k:"anaphylaxis",l:"Anaphylaxis",c:"#fb923c",lc:"#c2410c",e:"⚠"},{k:"pain",l:"Pain/Sedation",c:"#4ade80",lc:"#15803d",e:"💊"},{k:"toxicology",l:"Tox",c:"#94a3b8",lc:"#475569",e:"☠"},{k:"obgyn",l:"OB/GYN",c:"#f472b6",lc:"#be185d",e:"♀"},{k:"trauma",l:"Trauma",c:"#f97316",lc:"#b45309",e:"🩹"},{k:"burns",l:"Burns",c:"#fb7185",lc:"#be123c",e:"🔥"}];
const P_SYS=[{k:"cardiac",l:"Cardiac",c:"#f87171",lc:"#dc2626",e:"♥"},{k:"respiratory",l:"Respiratory",c:"#38bdf8",lc:"#0369a1",e:"💨"},{k:"airway",l:"Airway/RSI",c:"#60a5fa",lc:"#1d4ed8",e:"🌬"},{k:"seizure",l:"Seizures",c:"#c084fc",lc:"#7e22ce",e:"⚡"},{k:"anaphylaxis",l:"Anaphylaxis",c:"#fb923c",lc:"#c2410c",e:"⚠"},{k:"pain",l:"Pain/Sedation",c:"#4ade80",lc:"#15803d",e:"💊"},{k:"toxicology",l:"Toxicology",c:"#94a3b8",lc:"#475569",e:"☠"},{k:"glucose",l:"Glucose",c:"#facc15",lc:"#a16207",e:"🩸"},{k:"trauma",l:"Trauma",c:"#f97316",lc:"#b45309",e:"🩹"},{k:"burns",l:"Burns",c:"#fb7185",lc:"#be123c",e:"🔥"}];
const SS={EMT:{bg:"#14532d",fg:"#86efac",lbl:"EMT+",lbg:"#b7e4c7",lfg:"#064e3b",bd:"#166534",lbd:"#15803d"},AEMT:{bg:"#1e3a8a",fg:"#93c5fd",lbl:"AEMT+",lbg:"#b8cff2",lfg:"#172554",bd:"#1e40af",lbd:"#1d4ed8"},Medic:{bg:"#7c2d12",fg:"#fdba74",lbl:"Paramedic",lbg:"#f3c097",lfg:"#7c2d12",bd:"#9a3412",lbd:"#c2410c"}};
const LIGHT_TABS={cardiac:{bg:"#f4b9b9",fg:"#7f1d1d",bd:"#dc2626"},respiratory:{bg:"#adc8ee",fg:"#172554",bd:"#1d4ed8"},neurological:{bg:"#d8b4ed",fg:"#581c87",bd:"#7e22ce"},metabolic:{bg:"#e9c46a",fg:"#713f12",bd:"#a16207"},anaphylaxis:{bg:"#f0b27a",fg:"#7c2d12",bd:"#c2410c"},airway:{bg:"#adc8ee",fg:"#172554",bd:"#1d4ed8"},seizure:{bg:"#d8b4ed",fg:"#581c87",bd:"#7e22ce"},glucose:{bg:"#e9c46a",fg:"#713f12",bd:"#a16207"},toxicology:{bg:"#cbd5e1",fg:"#1e293b",bd:"#475569"}};

// Mode-specific lookup maps — keeps adult and peds separate so jumps land in the right bank
const DRUG_LOC_ADULT = new Map();
const DRUG_LOC_PEDS  = new Map();
Object.entries(ADULT).forEach(([sys,drugs])=>drugs.forEach(d=>DRUG_LOC_ADULT.set(d.name,{mode:"adult",sys})));
Object.entries(PEDS).forEach(([sys,drugs])=>drugs.forEach(d=>DRUG_LOC_PEDS.set(d.name,{mode:"peds",sys})));
// Combined fallback for contexts that don't know the mode (e.g. med log)
const DRUG_LOCATION_MAP = new Map([...DRUG_LOC_ADULT,...DRUG_LOC_PEDS]);

function calcDose(d,wt){if(!d.wt||!d.mpk||!wt||wt<=0)return null;let mg=d.mpk*wt;if(d.maxd!=null&&mg>d.maxd)mg=d.maxd;if(d.mind!=null&&mg<d.mind)mg=d.mind;const display=parseFloat(((d.dmult||1)*mg).toFixed(2));const mL=d.cmpml?parseFloat((mg/d.cmpml).toFixed(2)):null;return{display,unit:d.unit||"mg",mL};}

function getMaxDoseDisplay(drug) {
  // Explicit override already set (e.g. Epi 1:10,000, Amiodarone, peds Amiodarone)
  if (drug.maxDoseNote) return { text: drug.maxDoseNote, color:"#93c5fd" };
  // No dose limit
  if (drug.maxDoses === null) return { text:"No field limit — continue per protocol", color:"var(--c-text4)" };
  // Single dose only
  if (drug.maxDoses === 1) return { text:"Single dose only", color:"#f97316" };
  // Weight-based multi-dose — show per-dose cap × doses
  if (drug.wt && drug.maxd != null) {
    const mult = drug.dmult || 1;
    const unit = drug.unit || "mg";
    const perDose = parseFloat((drug.maxd * mult).toFixed(2));
    return { text:`${perDose} ${unit} per dose · Max ${drug.maxDoses} doses`, color:"#f97316" };
  }
  // Fixed multi-dose — just show max doses
  return { text:`Max ${drug.maxDoses} doses`, color:"#f97316" };
}

function getSyringeSize(mL) {
  if (mL === null || mL === undefined) return null;
  if (mL <= 1)  return "1 mL syringe";
  if (mL <= 3)  return "3 mL syringe";
  if (mL <= 5)  return "5 mL syringe";
  if (mL <= 10) return "10 mL syringe";
  if (mL <= 20) return "20 mL syringe";
  if (mL <= 60) return "60 mL syringe";
  return "IV bag";
}

/* ─── Per-drug warn threshold (secs before expiry) ─── */
const WARN_AT = {
  "Nitroglycerin":              60,  // BP recheck needed
  "Epinephrine 1:10,000":       45,  // Arrest — confirm no ROSC, draw up
  "Adenosine":                  30,  // Rapid sequence, rhythm on monitor
  "Atropine":                   60,  // HR check before re-dose
  "Midazolam (Versed)":         90,  // Airway reassessment takes time
  "Diazepam (Valium)":          90,  // Same
  "Lorazepam (Ativan)":         90,  // Same
  "Naloxone (Narcan)":          45,  // Watch for re-narcotization
  "Dextrose 50% (D50)":         60,  // BGL recheck needed
  "Dextrose 25% (D25)":         60,  // Same
  "Fentanyl":                   90,  // RR + SpO₂ recheck
  "Morphine Sulfate":           90,  // Same
  "Morphine":                   90,  // Same
  "Albuterol":                 120,  // Full lung sound reassessment
  "Epinephrine 1:1,000":        90,  // Anaphylaxis response check
  "Haloperidol (Haldol)":      180,  // QT + BP reassessment takes time
  "Oral Glucose (Glutose)":     90,  // BGL recheck
  "Oral Glucose":               90,  // Same
  "Atropine (Organophosphate)": 60,  // Secretion assessment
};

/* ─── Alarm sounds via Web Audio API ─── */
function playAlarm(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    if (type === "warn") {
      // Two medium beeps — "heads up"
      beep(880, 0,    0.12);
      beep(880, 0.18, 0.12);
    } else {
      // Three urgent beeps — "due now"
      beep(1100, 0,    0.12);
      beep(1100, 0.18, 0.12);
      beep(1100, 0.36, 0.18);
    }
  } catch(e) { /* silently fail if AudioContext not available */ }
}
const fmt=s=>{if(s<=0)return"NOW";const m=Math.floor(s/60),sc=s%60;return m>0?`${m}:${String(sc).padStart(2,"0")}`:`0:${String(sc).padStart(2,"0")}`;};
const fmtE=s=>{const m=Math.floor(s/60),sc=s%60;return m>0?`${m}m ${sc}s ago`:`${sc}s ago`;};
const fmtTime=(ts,hour12=true)=>new Date(ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12});

function evalChecks(checks,vals={}){
  return checks.map(c=>{
    const v=vals[c.id]??"";
    const filled=v!==""&&v!=null;
    const isBlock=filled&&c.blockIf?.(v);
    const isWarn=filled&&!isBlock&&c.warnIf?.(v);
    const isOk=filled&&!isBlock&&!isWarn;
    return{...c,v,filled,isBlock,isWarn,isOk};
  });
}

/* ── Check Form ── */
function CheckForm({checks,vals,onUpdate,label,accentColor="#60a5fa",subtitle,isDarkMode=true}){
  const results=evalChecks(checks,vals);
  return(
    <div>
      {label&&(
        <div style={{background:isDarkMode?"#0f1622":"#f0f4ff",border:`1px solid ${accentColor}33`,borderRadius:6,padding:"7px 10px",marginBottom:8,display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:14}}>🔄</span>
          <div>
            <div style={{color:accentColor,fontSize:12,fontWeight:700}}>{label}</div>
            {subtitle&&<div style={{color:isDarkMode?"#5a4020":"#7a5010",fontSize:11,marginTop:1}}>{subtitle}</div>}
          </div>
        </div>
      )}
      {results.map(r=>{
        let rowBg="var(--c-surface)",bCol="var(--c-border)";
        if(r.isBlock){rowBg=isDarkMode?"#2a0808":"#fff0f0";bCol=isDarkMode?"#7f1d1d":"#fca5a5";}
        else if(r.isWarn){rowBg=isDarkMode?"#1f1408":"#fffbeb";bCol=isDarkMode?"#92400e":"#fbbf24";}
        else if(r.isOk){rowBg=isDarkMode?"#071a0e":"#f0fdf4";bCol=isDarkMode?"#14532d":"#86efac";}
        return(
          <div key={r.id} style={{background:rowBg,border:`1px solid ${bCol}`,borderRadius:7,padding:"9px 11px",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
              <div style={{width:17,height:17,borderRadius:"50%",flexShrink:0,marginTop:1,background:r.isBlock?"#ef4444":r.isWarn?"#f59e0b":r.isOk?"#22c55e":"var(--c-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#fff"}}>
                {r.isBlock?"✕":r.isWarn?"!":r.isOk?"✓":""}
              </div>
              <div style={{flex:1}}>
                <div style={{color:"var(--c-text3)",fontSize:12,lineHeight:1.4}}>{r.label}</div>
                {(r.isBlock||r.isWarn)&&<div style={{marginTop:3,fontSize:11,fontWeight:600,color:r.isBlock?(isDarkMode?"#fca5a5":"#b91c1c"):(isDarkMode?"#fcd34d":"#92400e"),lineHeight:1.4}}>{r.isBlock?`⛔ ${r.blockMsg}`:`⚠ ${typeof r.warnMsg==="function"?r.warnMsg(r.v):r.warnMsg}`}</div>}
              </div>
            </div>
            {r.type==="value"&&r.id==="sbp"&&(
              <div style={{display:"flex",alignItems:"center",gap:6,paddingLeft:25,marginTop:6,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <input type="number" value={r.v} onChange={e=>onUpdate(r.id,e.target.value)} onClick={e=>e.stopPropagation()} placeholder="SBP" style={{width:62,padding:"5px 7px",background:"var(--c-input)",border:`1px solid ${r.isBlock?(isDarkMode?"#7f1d1d":"#fca5a5"):r.isWarn?(isDarkMode?"#92400e":"#fbbf24"):"var(--c-border)"}`,borderRadius:5,color:"var(--c-text)",fontSize:13,fontFamily:"'IBM Plex Mono',monospace",textAlign:"right",outline:"none"}}/>
                </div>
                <span style={{color:"var(--c-text4)",fontSize:12,fontWeight:700}}>/</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <input type="number" value={vals.dbp||""} onChange={e=>onUpdate("dbp",e.target.value)} onClick={e=>e.stopPropagation()} placeholder="DBP" style={{width:62,padding:"5px 7px",background:"var(--c-input)",border:"1px solid var(--c-border)",borderRadius:5,color:"var(--c-text)",fontSize:13,fontFamily:"'IBM Plex Mono',monospace",textAlign:"right",outline:"none"}}/>
                </div>
                <span style={{color:"var(--c-text4)",fontSize:11}}>mmHg</span>
              </div>
            )}
            {r.type==="value"&&r.id!=="sbp"&&(
              <div style={{display:"flex",alignItems:"center",gap:6,paddingLeft:25,marginTop:6}}>
                <input type="number" value={r.v} onChange={e=>onUpdate(r.id,e.target.value)} onClick={e=>e.stopPropagation()} placeholder={r.placeholder||""} style={{width:80,padding:"5px 8px",background:"var(--c-input)",border:`1px solid ${r.isBlock?(isDarkMode?"#7f1d1d":"#fca5a5"):r.isWarn?(isDarkMode?"#92400e":"#fbbf24"):"var(--c-border)"}`,borderRadius:5,color:"var(--c-text)",fontSize:13,fontFamily:"'IBM Plex Mono',monospace",textAlign:"right",outline:"none"}}/>
                {r.unit&&<span style={{color:"var(--c-text4)",fontSize:11}}>{r.unit}</span>}
              </div>
            )}
            {r.type==="yesno"&&(
              <div style={{display:"flex",gap:6,paddingLeft:25,marginTop:6}}>
                {["Yes","No"].map(opt=>(
                  <button key={opt} onClick={e=>{e.stopPropagation();onUpdate(r.id,opt);}} style={{padding:"5px 16px",borderRadius:5,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,background:r.v===opt?(opt==="No"?(isDarkMode?"#166534":"#b7e4c7"):(isDarkMode?"#9a1f0f":"#e5b2b2")):(isDarkMode?"#1e2f4a":"#e0e5eb"),color:r.v===opt?(opt==="No"?(isDarkMode?"#86efac":"#064e3b"):(isDarkMode?"#fca5a5":"#7f1d1d")):(isDarkMode?"#7090b8":"#26364c"),border:r.v===opt?`1px solid ${opt==="No"?(isDarkMode?"#22c55e40":"#15803d"):(isDarkMode?"#ef444440":"#b91c1c")}`:`1px solid ${isDarkMode?"#2a3f60":"#8fa0b6"}`,transition:"all 0.1s"}}>{opt}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ��� DRUG CARD ��� */
const DrugCard=React.memo(function DrugCard({drug,wt,color,tick,adminLog,onGive,onReset,initVals,onInitUpdate,reVals,onReUpdate,onClearRe,highlighted,isDarkMode=true,scopeFilter="all"}){
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState("info");
  const alarmRef=useRef({warn:false,due:false,lastDoseCount:0});
  const cardRef=useRef(null);

  // Auto-open and scroll when highlighted from active drugs bar
  useEffect(()=>{
    if(highlighted){
      setOpen(true);
      setTab("admin");
      const t=setTimeout(()=>{
        cardRef.current?.scrollIntoView({behavior:"smooth",block:"center"});
      },100);
      return()=>clearTimeout(t);
    }
  },[highlighted]);
  const calc=calcDose(drug,wt);
  const s=SS[drug.scope]||SS.EMT;
  const initChecks=INIT_CHECKS[drug.name]||[];
  const reChecks=RE_CHECKS[drug.name]||[];
  const hasInitChecks=initChecks.length>0;
  const hasReChecks=reChecks.length>0;
  const log=adminLog[drug.name];
  const doseCount=log?.times?.length||0;
  const lastAt=doseCount>0?log.times[doseCount-1]:null;
  const hasActivity=doseCount>0;
  const maxReached=drug.maxDoses!=null&&doseCount>=drug.maxDoses;
  const isMultiDose=!maxReached&&drug.maxDoses!==1;
  const now=Date.now();
  const elapsedSecs=lastAt?Math.floor((now-lastAt)/1000):null;
  const redoseSecs=drug.redoseMins?drug.redoseMins*60:null;
  const remainSecs=(redoseSecs&&elapsedSecs!=null)?Math.max(0,redoseSecs-elapsedSecs):null;
  const isDue=remainSecs===0;
  const warnAt=WARN_AT[drug.name]||60;
  const isWarning=hasActivity&&!isDue&&!maxReached&&remainSecs!=null&&remainSecs<=warnAt;

  useEffect(()=>{
    if(alarmRef.current.lastDoseCount!==doseCount){
      alarmRef.current={warn:false,due:false,lastDoseCount:doseCount};
    }
    if(isWarning&&!alarmRef.current.warn){
      alarmRef.current.warn=true;
      playAlarm("warn");
    }
    if(isDue&&hasActivity&&!maxReached&&!alarmRef.current.due){
      alarmRef.current.due=true;
      playAlarm("due");
    }
  },[doseCount,isWarning,isDue,hasActivity,maxReached]);

  /* initial check eval */
  const iR=evalChecks(initChecks,initVals);
  const iBlocked=iR.some(r=>r.isBlock);
  const iAllFill=iR.every(r=>r.filled);
  const iWarn=iR.some(r=>r.isWarn);
  const iOk=!hasInitChecks||(iAllFill&&!iBlocked);
  const iMissing=iR.filter(r=>!r.filled).length;

  /* reassessment check eval — vitals only */
  const needsRe=hasActivity&&isDue&&!maxReached&&hasReChecks&&isMultiDose;
  const rR=evalChecks(reChecks,reVals);
  const rBlocked=rR.some(r=>r.isBlock);
  const rAllFill=rR.every(r=>r.filled);
  const rWarn=rR.some(r=>r.isWarn);
  const rOk=rAllFill&&!rBlocked;
  const rMissing=rR.filter(r=>!r.filled).length;

  const timerReady=!hasActivity||remainSecs===null||isDue;
  const checkGate=!hasActivity?iOk:(needsRe?rOk:true);
  const canGive=!maxReached&&timerReady&&checkGate&&(hasActivity?!rBlocked:!iBlocked);

  let timerCol=isDarkMode?"#4ade80":"#15803d";
  if(maxReached)timerCol=isDarkMode?"#ef4444":"#b91c1c";
  else if(iBlocked||(needsRe&&rBlocked))timerCol=isDarkMode?"#ef4444":"#b91c1c";
  else if(isDue&&hasActivity)timerCol=isDarkMode?"#f97316":"#c2410c";
  else if(isWarning)timerCol=isDarkMode?"#facc15":"#854d0e";

  const hdrBorder=hasActivity?timerCol:(iBlocked?"#ef4444":color);

  /* badge helpers */
  const preCheckBadge=hasInitChecks?(iBlocked?"⛔":iAllFill?"✓":`${iMissing}`):null;
  const preCheckBadgeCol=iBlocked?"#ef4444":iAllFill?"#22c55e":"#60a5fa";
  const adminBadge=needsRe?(rOk?"✓ clear":rBlocked?"⛔":`${rMissing} vitals`):hasActivity?`×${doseCount}`:null;
  const adminBadgeCol=needsRe?(rBlocked?"#ef4444":rOk?"#22c55e":"#f97316"):timerCol;

  return(
    <div ref={cardRef} style={{background:open?"var(--c-surface-open)":"var(--c-surface)",borderLeft:`3px solid ${highlighted?color:hdrBorder}`,border:`1px solid ${highlighted?color+"99":open?color+"44":hasActivity||iBlocked?hdrBorder+"33":"var(--c-border)"}`,borderRadius:8,marginBottom:7,cursor:"pointer",userSelect:"none",transition:"border-color 0.3s"}}>

      {/* COLLAPSED HEADER */}
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",padding:"11px 12px",gap:8}}>
        <div style={{flex:1,minWidth:0,textAlign:"left"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:700,color:"var(--c-text)"}}>{drug.name}</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",background:isDarkMode?s.bg:s.lbg,color:isDarkMode?s.fg:s.lfg,border:`1px solid ${isDarkMode?s.bd:s.lbd}`,borderRadius:3,padding:"2px 5px"}}>{s.lbl}</span>
            {hasInitChecks&&!open&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",background:iBlocked?"#e5b2b2":iAllFill?"#b7e4c7":"#d8b4ed",color:iBlocked?"#7f1d1d":iAllFill?"#064e3b":"#581c87",border:`1px solid ${iBlocked?"#b91c1c":iAllFill?"#15803d":"#7e22ce"}`,borderRadius:3,padding:"2px 5px"}}>{iBlocked?"⛔ blocked":iAllFill?"✓ checked":`⚕ ${iMissing} checks`}</span>}
            {needsRe&&!open&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",background:isDarkMode?"#1a1000":"#fff7ed",color:isDarkMode?"#f97316":"#c2410c",border:`1px solid ${isDarkMode?"#f9731655":"#fb923c"}`,borderRadius:3,padding:"2px 5px"}}>📋 REASSESS</span>}
          </div>
          <div style={{color:isDarkMode?"var(--c-text-sub)":"#1e3a58",fontSize:11,marginTop:3,lineHeight:1.3}}>{drug.sub}</div>
        </div>
        {calc&&wt>0&&<div style={{background:"var(--c-deep)",border:`1px solid ${color}30`,borderRadius:6,padding:"5px 8px",textAlign:"center",flexShrink:0,minWidth:52}}><div style={{fontFamily:"'IBM Plex Mono',monospace",color,fontSize:14,fontWeight:700,lineHeight:1}}>{calc.display}</div><div style={{color:"var(--c-text-sub)",fontSize:8,textTransform:"uppercase",marginTop:1}}>{calc.unit}</div>{calc.mL!=null&&<div style={{color:"var(--c-text3)",fontSize:9,marginTop:1}}>{calc.mL} mL</div>}{calc.mL!=null&&<div style={{color:"var(--c-text4)",fontSize:8,marginTop:1}}>({getSyringeSize(calc.mL)})</div>}</div>}
        {hasActivity&&<div style={{background:timerCol+"18",border:`1px solid ${timerCol}55`,borderRadius:6,padding:"4px 7px",textAlign:"center",flexShrink:0}}>{maxReached?<div style={{color:"#ef4444",fontSize:9,fontWeight:700,textTransform:"uppercase"}}>MAX</div>:needsRe?<div style={{color:"#f97316",fontSize:9,fontWeight:700}}>📋</div>:remainSecs!=null?<><div style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:12,fontWeight:700,lineHeight:1}}>{fmt(remainSecs)}</div><div style={{color:timerCol,fontSize:8,marginTop:1,fontWeight:600}}>{isDue?"DUE NOW":isWarning?"PREP":"next"}</div></>:elapsedSecs!=null?<><div style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:12,fontWeight:700,lineHeight:1}}>{Math.floor(elapsedSecs/60)}:{String(elapsedSecs%60).padStart(2,"0")}</div><div style={{color:timerCol,fontSize:8,marginTop:1,fontWeight:600}}>ago</div></>:<div style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:9,fontWeight:700}}>×{doseCount}</div>}</div>}
        <span style={{color:"#2a3450",fontSize:12,flexShrink:0,display:"inline-block",transition:"transform 0.2s",transform:open?"rotate(180deg)":"none"}}>▼</span>
      </div>

      {/* EXPANDED */}
      {open&&(
        <div style={{borderTop:"1px solid #141e32"}}>
          {/* Tab bar */}
          <div style={{display:"flex",borderBottom:"1px solid #141e32"}}>
            {[
              {k:"info",l:"Drug Info",e:"📋",badge:null},
              {k:"precheck",l:"Pre-Check",e:"⚕",badge:preCheckBadge,bc:preCheckBadgeCol},
              {k:"admin",l:"Administer",e:"💉",badge:adminBadge,bc:adminBadgeCol},
            ].map(t=>(
              <button key={t.k} onClick={e=>{e.stopPropagation();setTab(t.k);}} style={{flex:1,padding:"9px 4px",border:"none",cursor:"pointer",background:tab===t.k?"var(--c-surface)":"transparent",borderBottom:tab===t.k?`2px solid ${color}`:"2px solid transparent",color:tab===t.k?color:"var(--c-text4)",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:3,transition:"all 0.12s"}}>
                <span>{t.e}</span><span>{t.l}</span>
                {t.badge&&<span style={{background:t.bc+"30",color:t.bc,border:`1px solid ${t.bc}60`,borderRadius:10,padding:"0px 5px",fontSize:9,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{t.badge}</span>}
              </button>
            ))}
          </div>

          <div style={{padding:"12px 12px"}}>

            {/* INFO */}
            {tab==="info"&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"9px 14px",fontSize:12,marginBottom:10}}>
                  {[["Dose",drug.dose],["Route",drug.route],["Concentration",drug.conc],["Draw Up",drug.draw],drug.syringe&&drug.syringe!=="N/A"?["Syringe",drug.syringe]:null].filter(Boolean).map(([l,v])=>(
                    <div key={l}><div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{l}</div><div style={{color:"var(--c-text2)",lineHeight:1.45}}>{v}</div></div>
                  ))}
                  {/* Max Dose — always shown, full width */}
                  {(()=>{const md=getMaxDoseDisplay(drug); return(
                    <div style={{gridColumn:"1/-1",background:"var(--c-deep2)",border:`1px solid ${md.color}33`,borderRadius:6,padding:"6px 10px"}}>
                      <div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Max Dose</div>
                      <div style={{fontFamily:"'IBM Plex Mono',monospace",color:md.color,fontSize:12,fontWeight:700}}>{md.text}</div>
                    </div>
                  );})()}
                  {calc&&wt>0&&calc.mL!=null&&<div style={{gridColumn:"1/-1"}}><div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>⟹ Calculated Draw</div><div style={{fontFamily:"'IBM Plex Mono',monospace",color,fontWeight:700,fontSize:14}}>{calc.mL} mL = {calc.display} {calc.unit} <span style={{color:"var(--c-text4)",fontSize:11,fontWeight:400}}>({getSyringeSize(calc.mL)})</span></div></div>}
                </div>

                {/* Dose steps table (e.g. Amiodarone) */}
                {drug.doseSteps&&(
                  <div style={{marginBottom:10}}>
                    <div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Dose Schedule</div>
                    {drug.doseSteps.map((step,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:i===0?"#0d1f12":"#0f1a28",border:`1px solid ${i===0?"#14532d":"#1e3a8a"}`,borderRadius:6,padding:"7px 10px",marginBottom:5}}>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,color:i===0?"#4ade80":"#93c5fd",minWidth:44}}>{step.label}</span>
                        <span style={{color:"var(--c-text)",fontSize:12,fontWeight:600,flex:1}}>{step.dose}</span>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",color:"#6b7a9a",fontSize:11}}>{step.draw}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Max dose note */}
                {(drug.maxDoseNote)&&(
                  <div style={{background:"#0f1a2e",border:"1px solid #1e3a6a",borderRadius:6,padding:"6px 10px",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12}}>⚠</span>
                    <div style={{color:"#93c5fd",fontSize:11,fontWeight:600}}>{drug.maxDoseNote}</div>
                  </div>
                )}

                {drug.notes&&<div style={{marginBottom:10}}><div style={{color:isDarkMode?"var(--c-text5)":"#111827",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3,fontWeight:700}}>Notes</div><div style={{background:isDarkMode?"transparent":"#111827",border:isDarkMode?"none":"2px solid #020617",borderRadius:6,padding:isDarkMode?0:"8px 10px",color:isDarkMode?"var(--c-text2)":"#ffffff",fontSize:isDarkMode?12:12.5,lineHeight:1.6,fontWeight:isDarkMode?400:700}}>{drug.notes}</div></div>}
                {drug.ci?.length>0&&<div><div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>⚠ Contraindications</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{drug.ci.map((c,i)=><span key={i} style={{background:isDarkMode?"#3b0000":"#e5b2b2",color:isDarkMode?"#fca5a5":"#7f1d1d",border:`1px solid ${isDarkMode?"#5a1010":"#b91c1c"}`,borderRadius:4,padding:"2px 7px",fontSize:11}}>{c}</span>)}</div></div>}
              </>
            )}

            {/* PRE-CHECK (initial — full questions) */}
            {tab==="precheck"&&(
              hasInitChecks
                ?<CheckForm checks={initChecks} vals={initVals} onUpdate={(id,v)=>onInitUpdate(drug.name,id,v)} color={color} isDarkMode={isDarkMode}/>
                :<div style={{padding:"14px 0",textAlign:"center",color:"#2a3a55",fontSize:12}}>No pre-administration requirements for this drug.</div>
            )}

            {/* ADMINISTER */}
            {tab==="admin"&&(
              <div>

                {/* Gate: first dose, checks incomplete */}
                {!hasActivity&&hasInitChecks&&!iOk&&(
                  <div style={{background:"#0d1728",border:"1px solid #1e3a8a55",borderRadius:7,padding:"10px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>⚕</span>
                    <div style={{flex:1}}>
                      <div style={{color:"#60a5fa",fontSize:12,fontWeight:600}}>Pre-check required before first dose</div>
                      <div style={{color:"#3a4f70",fontSize:11,marginTop:2}}>{iBlocked?"A contraindication is blocking administration":`${iMissing} check${iMissing>1?"s":""} incomplete`}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();setTab("precheck");}} style={{padding:"5px 10px",background:"#1e3a8a",border:"1px solid #2a4f9a",borderRadius:5,color:"#93c5fd",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>Go →</button>
                  </div>
                )}

                {/* Timer still counting */}
                {hasActivity&&!isDue&&!maxReached&&(
                  <div style={{background:"var(--c-nav)",border:`1px solid ${isWarning?"#facc1555":"var(--c-border)"}`,borderRadius:7,padding:"10px 12px",marginBottom:10}}>
                    {isWarning&&(
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8,background:"#1a1600",border:"1px solid #facc1555",borderRadius:5,padding:"6px 10px"}}>
                        <span style={{fontSize:14}}>⚠️</span>
                        <div>
                          <div style={{color:"#facc15",fontSize:12,fontWeight:700}}>Re-dose approaching in {fmt(remainSecs)}</div>
                          <div style={{color:"#7a6010",fontSize:11,marginTop:1}}>
                            {hasReChecks?"Begin vital reassessment now":"Prepare draw-up for next dose"}
                          </div>
                        </div>
                      </div>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{color:"#4a5a7a",fontSize:12}}>Last dose: <span style={{color:"var(--c-text-sub)"}}>{fmtE(elapsedSecs)}</span></span>
                      {remainSecs!=null&&<span style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:13,fontWeight:700}}>Next: {fmt(remainSecs)}</span>}
                    </div>
                    {drug.maxDoses&&<div style={{display:"flex",gap:5,marginTop:8}}>{Array.from({length:drug.maxDoses}).map((_,i)=><div key={i} style={{width:10,height:10,borderRadius:"50%",background:i<doseCount?(maxReached&&i===doseCount-1?"#ef4444":color):"#1a2540",border:`1px solid ${i<doseCount?color:"#253040"}`,transition:"all 0.2s"}}/>)}</div>}
                  </div>
                )}

                {/* ── VITALS-ONLY REASSESSMENT ── */}
                {needsRe&&(
                  <div style={{marginBottom:12}}>
                    <CheckForm
                      checks={reChecks}
                      vals={reVals}
                      onUpdate={(id,v)=>onReUpdate(drug.name,id,v)}
                      label={`Dose ${doseCount+1} Vital Reassessment`}
                      subtitle={`${drug.redoseMins} min interval elapsed — re-enter current vitals`}
                      accentColor="#f97316"
                      isDarkMode={isDarkMode}
                    />

                    {rAllFill&&(
                      rBlocked
                        ?<div style={{background:"#2a0808",border:"1px solid #7f1d1d",borderRadius:6,padding:"8px 12px",marginTop:8,display:"flex",alignItems:"flex-start",gap:6}}>
                           <span>⛔</span>
                           <div><div style={{color:"#fca5a5",fontSize:12,fontWeight:700}}>Re-administration blocked</div>{rR.filter(r=>r.isBlock).map((r,i)=><div key={i} style={{color:"#9b1c1c",fontSize:11,marginTop:2}}>• {r.blockMsg}</div>)}</div>
                         </div>
                        :rWarn
                          ?<div style={{background:"#1a1000",border:"1px solid #f59e0b44",borderRadius:6,padding:"8px 12px",marginTop:8}}>
                             <div style={{color:"#fcd34d",fontSize:11,fontWeight:600}}>⚠ Warnings — review before re-administering</div>
                             {rR.filter(r=>r.isWarn).map((r,i)=><div key={i} style={{color:"#a07030",fontSize:11,marginTop:2}}>• {r.warnMsg}</div>)}
                           </div>
                          :<div style={{background:"#071a0e",border:"1px solid #14532d",borderRadius:6,padding:"7px 12px",marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                             <span>✓</span>
                             <span style={{color:"#4ade80",fontSize:12,fontWeight:600}}>Vitals cleared — ready for dose {doseCount+1}</span>
                           </div>
                    )}
                  </div>
                )}

                {/* Max dose */}
                {maxReached&&<div style={{background:"#2a0808",border:"1px solid #7f1d1d",borderRadius:7,padding:"10px 12px",marginBottom:10,textAlign:"center"}}><div style={{color:"#f87171",fontSize:13,fontWeight:700}}>MAX DOSE REACHED</div><div style={{color:"#6b1414",fontSize:11,marginTop:3}}>{drug.maxDoses} dose{drug.maxDoses>1?"s":""} administered</div></div>}

                {/* First dose pass/warn */}
                {!hasActivity&&iOk&&iWarn&&<div style={{background:"#1a1000",border:"1px solid #f59e0b44",borderRadius:6,padding:"8px 12px",marginBottom:10}}><div style={{color:"#fcd34d",fontSize:11,fontWeight:600}}>⚠ Warnings — review before giving</div>{iR.filter(r=>r.isWarn).map((r,i)=><div key={i} style={{color:"#a07030",fontSize:11,marginTop:2}}>• {r.warnMsg}</div>)}</div>}
                {!hasActivity&&iOk&&!iWarn&&hasInitChecks&&<div style={{background:"#071a0e",border:"1px solid #14532d",borderRadius:6,padding:"7px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✓</span><span style={{color:"#4ade80",fontSize:12,fontWeight:600}}>All checks cleared — ready to administer</span></div>}

                {/* Dose progress dots */}
                {hasActivity&&drug.maxDoses&&<div style={{display:"flex",gap:5,marginBottom:10}}>{Array.from({length:drug.maxDoses}).map((_,i)=><div key={i} style={{width:10,height:10,borderRadius:"50%",background:i<doseCount?(maxReached&&i===doseCount-1?"#ef4444":color):"#1a2540",border:`1px solid ${i<doseCount?color:"#253040"}`,transition:"all 0.2s"}}/>)}</div>}

                {/* Upcoming dose step (e.g. Amiodarone Dose 1 vs Dose 2) */}
                {drug.doseSteps&&!maxReached&&(()=>{
                  const step=drug.doseSteps[doseCount];
                  if(!step) return null;
                  return(
                    <div style={{background:"#0d1a28",border:`1px solid ${color}44`,borderRadius:7,padding:"9px 12px",marginBottom:10}}>
                      <div style={{color:"#253040",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Next — {step.label}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",color,fontSize:15,fontWeight:700}}>{step.dose}</div>
                          <div style={{color:"#6b7a9a",fontSize:11,marginTop:2}}>Draw up: <span style={{color:"var(--c-text3)",fontWeight:600}}>{step.draw}</span></div>
                        </div>
                        {drug.maxDoseNote&&<div style={{textAlign:"right"}}><div style={{color:"#3a4f70",fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em"}}>Max Total</div><div style={{color:"#f97316",fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{drug.maxDoseNote.replace("Max ","")}</div></div>}
                      </div>
                    </div>
                  );
                })()}

                {/* MAIN BUTTON */}
                <div style={{display:"flex",gap:7}}>
                  <button
                    onClick={e=>{e.stopPropagation();if(canGive){onGive(drug.name);if(needsRe)onClearRe(drug.name);}}}
                    disabled={!canGive}
                    style={{
                      flex:1,padding:"10px 0",borderRadius:7,border:"none",
                      cursor:canGive?"pointer":"not-allowed",
                      fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:"0.05em",
                      background:maxReached?"#1a2030":iBlocked?"#2a0808":!iOk?"#0d1728":needsRe&&rBlocked?"#2a0808":needsRe&&!rAllFill?"#1a1200":needsRe&&rOk?"#7a3500":hasActivity&&remainSecs!=null&&!isDue?"var(--c-nav)":hasActivity?"#7a3500":"#0f3a1f",
                      color:maxReached?"#2a3a55":iBlocked?"#6b1414":!iOk?"#1e3a8a":needsRe&&rBlocked?"#6b1414":needsRe&&!rAllFill?"#7a5020":needsRe&&rOk?"#fff":hasActivity&&remainSecs!=null&&!isDue?"#2a3a55":hasActivity?"#fff":"#4ade80",
                      border:"1px solid "+(maxReached?"#1a2030":iBlocked?"#7f1d1d":!iOk?"#1e3a8a":needsRe&&(rBlocked||!rAllFill)?(rBlocked?"#7f1d1d":"#92400e"):hasActivity&&remainSecs!=null&&!isDue?"var(--c-border)":hasActivity?"#f9731660":"#1a5c2a"),
                      opacity:canGive?1:0.65,transition:"all 0.15s",
                    }}
                  >
                    {maxReached?"MAX DOSE REACHED":iBlocked?"⛔ BLOCKED — SEE PRE-CHECK TAB":!iOk?`⚕ COMPLETE PRE-CHECK (${iMissing} left)`:needsRe&&rBlocked?"⛔ BLOCKED — CONTRAINDICATION IN VITALS":needsRe&&!rAllFill?`📋 ENTER VITALS FIRST (${rMissing} left)`:needsRe&&rWarn?`⟹ RE-ADMINISTER DOSE ${doseCount+1} (warnings)`:needsRe&&rOk?`⟹ RE-ADMINISTER — DOSE ${doseCount+1}`:hasActivity&&remainSecs!=null&&!isDue?`TIMER ACTIVE — ${fmt(remainSecs)}`:hasActivity?"⟹ RE-ADMINISTER":`✓ MARK AS GIVEN — DOSE 1`}
                  </button>
                  {hasActivity&&<button onClick={e=>{e.stopPropagation();onReset(drug.name);onClearRe(drug.name);}} style={{padding:"10px 12px",borderRadius:7,border:"1px solid #1a2540",background:"transparent",color:"#3a4f70",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>↺</button>}
                </div>

                {drug.redoseMins&&!maxReached&&<div style={{color:"var(--c-text4)",fontSize:10,marginTop:7,textAlign:"center"}}>Re-dose interval: {drug.redoseMins} min{drug.maxDoses?` · Max ${drug.maxDoses} doses`:" · No dose limit"}</div>}
                {!drug.redoseMins&&drug.maxDoses===1&&<div style={{color:"var(--c-text4)",fontSize:10,marginTop:7,textAlign:"center"}}>Single dose only</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/* �������������������������������������������������������
   VITALS LOG
������������������������������������������������������� */
const EMPTY_VITALS = {
  sbp:'', dbp:'', hr:'', rr:'', spo2:'',
  gcs_e:'', gcs_v:'', gcs_m:'',
  bgl:'', pain:'', temp:'', etco2:'',
  skin:'', pupils_l_sz:'', pupils_l_rx:'', pupils_r_sz:'', pupils_r_rx:'',
  notes:''
};

const GCS_E = [{v:'',l:'—'},{v:1,l:'1 – None'},{v:2,l:'2 – To pain'},{v:3,l:'3 – To voice'},{v:4,l:'4 – Spontaneous'}];
const GCS_V = [{v:'',l:'—'},{v:1,l:'1 – None'},{v:2,l:'2 – Sounds'},{v:3,l:'3 – Words'},{v:4,l:'4 – Confused'},{v:5,l:'5 – Oriented'}];
const GCS_M = [{v:'',l:'—'},{v:1,l:'1 – None'},{v:2,l:'2 – Extension'},{v:3,l:'3 – Flexion'},{v:4,l:'4 – Withdrawal'},{v:5,l:'5 – Localizes'},{v:6,l:'6 – Obeys'}];
const SKIN_OPTS = ['','Warm/Dry','Pale','Diaphoretic','Flushed','Cyanotic','Mottled','Cool/Clammy'];
const PUPIL_RX  = ['','Reactive','Sluggish','Non-reactive','Fixed/Dilated'];
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function parseVitalsSpeech(text) {
  const t = text.toLowerCase().replace(/\band\b/g,' ');
  const r = {};
  const bp = t.match(/(?:bp|blood\s*pressure)?[\s:]*(1\d{2}|[6-9]\d)\s*(?:over|\/)\s*(\d{2,3})/);
  if (bp) { r.sbp = bp[1]; r.dbp = bp[2]; }
  const hr = t.match(/(?:heart\s*rate|hr|pulse)[:\s]*(\d{2,3})/);
  if (hr) r.hr = hr[1];
  const rr = t.match(/(?:resp(?:iratory)?(?:\s*rate)?|respirations?|rr)[:\s]*(\d{1,2})/);
  if (rr) r.rr = rr[1];
  const sp = t.match(/(?:spo2?|o2\s*sat(?:uration)?|oxygen|sat(?:uration)?)[:\s]*(\d{2,3})/);
  if (sp) r.spo2 = sp[1];
  const bg = t.match(/(?:blood\s*(?:glucose|sugar)|bgl?|glucose|sugar)[:\s]*(\d{2,3})/);
  if (bg) r.bgl = bg[1];
  const pn = t.match(/(?:pain(?:\s*(?:scale|level|score))?)[:\s]*(\d{1,2})/);
  if (pn) r.pain = pn[1];
  const tmp = t.match(/(?:temp(?:erature)?)[:\s]*(\d{2,3}(?:\.\d)?)/);
  if (tmp) r.temp = tmp[1];
  const et = t.match(/(?:etco2?|end[\s-]*tidal(?:\s*co2?)?|capno)[:\s]*(\d{2,3})/);
  if (et) r.etco2 = et[1];
  const gcs = t.match(/(?:gcs|glasgow)[:\s]*(\d{1,2})/);
  if (gcs) r._gcstotal = gcs[1];
  return r;
}

function getTrend(cur, prev) {
  if (!cur || !prev || cur==='' || prev==='') return null;
  const c=+cur, p=+prev;
  if (isNaN(c)||isNaN(p)) return null;
  if (c>p) return '↑';
  if (c<p) return '↓';
  return '→';
}
function trendColor(field, dir) {
  const goodUp  = ['spo2'];
  const badUp   = ['sbp','dbp','hr','rr','temp','etco2'];
  if (!dir||dir==='→') return 'var(--c-text4)';
  if (dir==='↑') return goodUp.includes(field)?'#4ade80':badUp.includes(field)?'#f87171':'#facc15';
  return goodUp.includes(field)?'#f87171':badUp.includes(field)?'#4ade80':'#facc15';
}

function PupilDiagram({ sz, rx, label }) {
  const size   = parseInt(sz) || 0;
  const SR2    = 20, IR = 14; // sclera radius, iris radius
  const pupilR = size > 0 ? Math.max(2, Math.round((size / 9) * IR)) : 0;
  const rxCol  = { Reactive:'var(--c-text)', Sluggish:'#f59e0b', 'Non-reactive':'#7c1d1d', 'Fixed/Dilated':'#ef4444' }[rx] || '#1a2540';
  const hasLight = rx === 'Reactive' && pupilR > 3;
  return (
    <div style={{ textAlign:'center', minWidth:52 }}>
      <svg width={SR2*2+4} height={SR2*2+4} viewBox={`0 0 ${SR2*2+4} ${SR2*2+4}`}>
        {/* Sclera */}
        <circle cx={SR2+2} cy={SR2+2} r={SR2} fill="#c8d8f0" stroke="var(--c-text4)" strokeWidth={0.5}/>
        {/* Iris */}
        <circle cx={SR2+2} cy={SR2+2} r={IR} fill="#2a3f5c"/>
        {/* Limbal ring */}
        <circle cx={SR2+2} cy={SR2+2} r={IR} fill="none" stroke="#1a2a40" strokeWidth={1}/>
        {/* Pupil */}
        {pupilR > 0 && <circle cx={SR2+2} cy={SR2+2} r={pupilR} fill={rxCol}/>}
        {/* Light reflex */}
        {hasLight && <circle cx={SR2+2-pupilR*0.35} cy={SR2+2-pupilR*0.35} r={Math.max(1, pupilR*0.22)} fill="rgba(255,255,255,0.55)"/>}
        {/* No data state */}
        {size === 0 && <text x={SR2+2} y={SR2+6} textAnchor="middle" fill="#3a4f70" fontSize={9}>?</text>}
      </svg>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", color:'#93c5fd', fontSize:10, fontWeight:700, marginTop:2 }}>{label}</div>
      {size > 0 && <div style={{ color:'#c0cfe8', fontSize:10, fontFamily:"'IBM Plex Mono',monospace", marginTop:1 }}>{size} mm</div>}
      {rx && <div style={{ color:rxCol, fontSize:9, marginTop:1, lineHeight:1.2 }}>{rx}</div>}
    </div>
  );
}

function VitalsLog({ initChecks, reChecks, onClearCall, entries, setEntries }) {
  const [isAdding, setIsAdding]       = useState(false);
  const [form, setForm]               = useState({...EMPTY_VITALS});
  const [listening, setListening]     = useState(false);
  const [listenField, setListenField] = useState(null);
  const [transcript, setTranscript]   = useState('');
  const [parseResult, setParseResult] = useState({});
  const recRef = useRef(null);

  const gcsTotal = (form.gcs_e&&form.gcs_v&&form.gcs_m) ? +form.gcs_e + +form.gcs_v + +form.gcs_m : null;
  const gcsColor = gcsTotal ? (gcsTotal>=14?'#4ade80':gcsTotal>=9?'#facc15':gcsTotal>=3?'#f87171':'#ef4444') : 'var(--c-text4)';

  // Gather most recent vitals across all drug pre-checks and reassessments
  const gatherFromChecks = useCallback(()=>{
    const v = {};
    const FIELDS = ['sbp','dbp','hr','rr','spo2','bgl'];
    Object.values(initChecks||{}).forEach(dv=>{ FIELDS.forEach(k=>{ if(dv[k]&&dv[k]!=='') v[k]=dv[k]; }); });
    Object.values(reChecks||{}).forEach(dv=>{  FIELDS.forEach(k=>{ if(dv[k]&&dv[k]!=='') v[k]=dv[k]; }); });
    return v;
  },[initChecks, reChecks]);

  // Open form pre-filled from drug pre-check vitals
  const openAddVitals = () => {
    const prefill = gatherFromChecks();
    setForm({...EMPTY_VITALS, ...prefill});
    setIsAdding(true);
  };

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const saveEntry = () => {
    if(!form.sbp&&!form.hr&&!form.rr&&!form.spo2) return;
    setEntries(p=>[...p,{...form, gcsTotal, ts:Date.now()}]);
    setForm({...EMPTY_VITALS});
    setIsAdding(false);
    setTranscript('');
    setParseResult({});
  };

  const startListen = (field=null) => {
    if(!SR) return;
    if(recRef.current) recRef.current.abort();
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recRef.current = rec;
    setListenField(field);
    setListening(true);
    setTranscript('');
    rec.onresult = e => {
      const t = Array.from(e.results).map(r=>r[0].transcript).join(' ');
      setTranscript(t);
      if(e.results[e.results.length-1].isFinal){
        if(field){ set(field, t.trim().replace(/[^0-9.]/g,'')); }
        else {
          const parsed = parseVitalsSpeech(t);
          setParseResult(parsed);
          setForm(f=>({...f,...Object.fromEntries(Object.entries(parsed).filter(([k])=>k!=='_gcstotal'))}));
        }
        setListening(false);
      }
    };
    rec.onerror = ()=>setListening(false);
    rec.onend   = ()=>setListening(false);
    rec.start();
  };
  const stopListen = () => { recRef.current?.stop(); setListening(false); };

  const MicBtn = ({field=null, small=false})=>(
    SR ? <button onClick={e=>{e.stopPropagation(); listening&&listenField===field?stopListen():startListen(field);}} style={{background:listening&&listenField===field?'#7c2d12':'var(--c-surface)',border:`1px solid ${listening&&listenField===field?'#ef4444':'var(--c-border)'}`,borderRadius:5,padding:small?'3px 6px':'5px 8px',cursor:'pointer',color:listening&&listenField===field?'#fca5a5':'var(--c-text4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      {listening&&listenField===field
        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
      }
    </button> : null
  );

  const numField = (key, label, ph, unit, max=999) => (
    <div style={{marginBottom:8}}>
      <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:3}}>{label}</div>
      <div style={{display:'flex',alignItems:'center',gap:5}}>
        <input type="number" value={form[key]} onChange={e=>set(key,e.target.value)} placeholder={ph} min={0} max={max}
          style={{flex:1,padding:'6px 8px',background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:6,color:'var(--c-text)',fontSize:13,fontFamily:"'IBM Plex Mono',monospace",outline:'none'}}/>
        {unit&&<span style={{color:'var(--c-text4)',fontSize:11,minWidth:28}}>{unit}</span>}
        <MicBtn field={key} small/>
      </div>
    </div>
  );

  const prevEntry = entries.length>0 ? entries[entries.length-1] : null;

  const VitalBadge = ({label,val,field,unit='',prev})=>{
    const dir = prev ? getTrend(val, prev[field]) : null;
    return val ? (
      <div style={{background:'var(--c-surface)',border:'1px solid var(--c-border)',borderRadius:6,padding:'5px 8px',minWidth:52,textAlign:'center'}}>
        <div style={{color:'var(--c-text5)',fontSize:8,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:1}}>{label}</div>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",color:'var(--c-text)',fontSize:13,fontWeight:700}}>{val}{unit}</div>
        {dir&&<div style={{color:trendColor(field,dir),fontSize:10,marginTop:1,fontWeight:700}}>{dir}</div>}
      </div>
    ) : null;
  };


  return (
    <div style={{paddingBottom:20}}>
      {/* Header row */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:700,color:'var(--c-text)'}}>Vitals Log</div>
          <div style={{color:'var(--c-text4)',fontSize:10,marginTop:1}}>{entries.length} entr{entries.length===1?'y':'ies'} this call</div>
        </div>
        <div style={{display:'flex',gap:6}}>
          {entries.length>0&&<button onClick={()=>{setEntries([]);setForm({...EMPTY_VITALS});setIsAdding(false);onClearCall&&onClearCall();}} style={{padding:'5px 10px',background:'transparent',border:'1px solid #7a5a30',color:'#c08040',borderRadius:5,cursor:'pointer',fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>Clear Call</button>}
          {!isAdding&&<button onClick={openAddVitals} style={{padding:'6px 12px',background:'#0f3a1f',border:'1px solid #1a5c2a',color:'#4ade80',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>+ Add Vitals</button>}
        </div>
      </div>

      {/* Add vitals form */}
      {isAdding&&(
        <div style={{background:'var(--c-surface)',border:'1px solid #1e3a8a55',borderRadius:8,padding:'12px',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",color:'#93c5fd',fontSize:11,fontWeight:700}}>NEW VITALS ENTRY</span>
            {SR&&(
              <button onClick={()=>listening&&!listenField?stopListen():startListen(null)} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 10px',background:listening&&!listenField?'#7c2d12':'#0d1f3a',border:`1px solid ${listening&&!listenField?'#ef4444':'#1e3a8a'}`,borderRadius:6,cursor:'pointer',color:listening&&!listenField?'#fca5a5':'#93c5fd',fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>
                {listening&&!listenField
                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                }
                <span>{listening&&!listenField?'Stop':'Dictate All'}</span>
              </button>
            )}
          </div>

          {/* Transcript feedback */}
          {transcript&&(
            <div style={{background:'#080c18',border:'1px solid #1e3a8a33',borderRadius:6,padding:'7px 10px',marginBottom:10,fontSize:11,color:'#8a9dc0',fontStyle:'italic'}}>
              "{transcript}"
              {Object.keys(parseResult).filter(k=>k!=='_gcstotal').length>0&&<div style={{color:'#4ade80',fontSize:10,marginTop:3,fontStyle:'normal'}}>✓ Parsed: {Object.entries(parseResult).filter(([k])=>k!=='_gcstotal').map(([k,v])=>`${k}: ${v}`).join(' · ')}</div>}
            </div>
          )}

          {/* BP */}
          <div style={{marginBottom:8}}>
            <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:3}}>Blood Pressure</div>
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <input type="number" value={form.sbp} onChange={e=>set('sbp',e.target.value)} placeholder="Sys" min={0} max={300} style={{flex:1,padding:'6px 8px',background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:6,color:'var(--c-text)',fontSize:13,fontFamily:"'IBM Plex Mono',monospace",outline:'none'}}/>
              <span style={{color:'var(--c-text4)'}}>/ </span>
              <input type="number" value={form.dbp} onChange={e=>set('dbp',e.target.value)} placeholder="Dia" min={0} max={200} style={{flex:1,padding:'6px 8px',background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:6,color:'var(--c-text)',fontSize:13,fontFamily:"'IBM Plex Mono',monospace",outline:'none'}}/>
              <span style={{color:'var(--c-text4)',fontSize:11}}>mmHg</span>
              <MicBtn field="sbp" small/>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 10px'}}>
            {numField('hr','Heart Rate','bpm','bpm',300)}
            {numField('rr','Resp Rate','/min','/min',60)}
            {numField('spo2','SpO₂','%','%',100)}
            {numField('etco2','EtCO₂','mmHg','mmHg',100)}
            {numField('temp','Temperature','°F','°F',110)}
            {numField('bgl','Blood Glucose','mg/dL','mg/dL',999)}
          </div>

          {/* Pain scale */}
          <div style={{marginBottom:10}}>
            <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:5}}>Pain Scale (0–10)</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {[0,1,2,3,4,5,6,7,8,9,10].map(n=>(
                <button key={n} onClick={()=>set('pain',String(n))} style={{width:30,height:30,borderRadius:5,border:'none',cursor:'pointer',fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:700,background:form.pain===String(n)?(n<=3?'#14532d':n<=6?'#854f0b':'#7c2d12'):'var(--c-input)',color:form.pain===String(n)?'var(--c-text)':'var(--c-text4)',border:`1px solid ${form.pain===String(n)?'transparent':'var(--c-border)'}`}}>{n}</button>
              ))}
            </div>
          </div>

          {/* GCS */}
          <div style={{background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:7,padding:'9px 10px',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:7}}>
              <span style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em'}}>GCS — Glasgow Coma Scale</span>
              {gcsTotal&&<span style={{fontFamily:"'IBM Plex Mono',monospace",color:gcsColor,fontSize:14,fontWeight:700}}>Total: {gcsTotal}/15</span>}
            </div>
            {[['gcs_e','Eyes (E)',GCS_E],['gcs_v','Verbal (V)',GCS_V],['gcs_m','Motor (M)',GCS_M]].map(([k,lbl,opts])=>(
              <div key={k} style={{marginBottom:6}}>
                <div style={{color:'var(--c-text4)',fontSize:10,marginBottom:3}}>{lbl}</div>
                <select value={form[k]} onChange={e=>set(k,e.target.value)} style={{width:'100%',padding:'5px 7px',background:'var(--c-surface)',border:'1px solid var(--c-border)',borderRadius:5,color:form[k]?'var(--c-text)':'var(--c-text4)',fontSize:12,outline:'none'}}>
                  {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Pupils */}
          <div style={{background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:7,padding:'9px 10px',marginBottom:10}}>
            <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>Pupils</div>
            {/* Live visual diagrams */}
            <div style={{display:'flex',justifyContent:'center',gap:24,marginBottom:12,padding:'8px 0',background:'#080c18',borderRadius:6,border:'1px solid #141e32'}}>
              <PupilDiagram sz={form.pupils_l_sz} rx={form.pupils_l_rx} label="LEFT"/>
              {/* PERRL indicator */}
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4}}>
                <div style={{width:1,height:20,background:'var(--c-border)'}}/>
                {form.pupils_l_sz&&form.pupils_r_sz&&form.pupils_l_sz===form.pupils_r_sz&&form.pupils_l_rx==='Reactive'&&form.pupils_r_rx==='Reactive'
                  ?<div style={{background:'#14532d',border:'1px solid #22543d',borderRadius:4,padding:'2px 6px',color:'#86efac',fontSize:8,fontWeight:700,textAlign:'center',fontFamily:"'IBM Plex Mono',monospace"}}>PERRL</div>
                  :<div style={{color:'#2a3450',fontSize:8,textAlign:'center',fontFamily:"'IBM Plex Mono',monospace"}}>vs</div>
                }
                <div style={{width:1,height:20,background:'var(--c-border)'}}/>
              </div>
              <PupilDiagram sz={form.pupils_r_sz} rx={form.pupils_r_rx} label="RIGHT"/>
            </div>
            {/* Input fields */}
            {[['L','LEFT','pupils_l_sz','pupils_l_rx'],['R','RIGHT','pupils_r_sz','pupils_r_rx']].map(([side,full,szk,rxk])=>(
              <div key={side} style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}>
                <span style={{color:'var(--c-text4)',fontSize:11,minWidth:28,fontFamily:"'IBM Plex Mono',monospace"}}>{full}</span>
                <input type="number" value={form[szk]} onChange={e=>set(szk,e.target.value)} placeholder="mm" min={1} max={9} style={{width:48,padding:'5px 6px',background:'var(--c-surface)',border:'1px solid var(--c-border)',borderRadius:5,color:'var(--c-text)',fontSize:12,fontFamily:"'IBM Plex Mono',monospace",textAlign:'center',outline:'none'}}/>
                <span style={{color:'var(--c-text4)',fontSize:10}}>mm</span>
                <select value={form[rxk]} onChange={e=>set(rxk,e.target.value)} style={{flex:1,padding:'5px 6px',background:'var(--c-surface)',border:'1px solid var(--c-border)',borderRadius:5,color:form[rxk]?'var(--c-text)':'var(--c-text4)',fontSize:11,outline:'none'}}>
                  {PUPIL_RX.map(o=><option key={o} value={o}>{o||'Reaction…'}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Skin */}
          <div style={{marginBottom:10}}>
            <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>Skin</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {SKIN_OPTS.filter(Boolean).map(o=>(
                <button key={o} onClick={()=>set('skin',form.skin===o?'':o)} style={{padding:'4px 9px',borderRadius:16,border:'none',cursor:'pointer',fontSize:11,background:form.skin===o?'#1e3a8a':'var(--c-input)',color:form.skin===o?'#93c5fd':'var(--c-text4)',border:`1px solid ${form.skin===o?'#2a4f9a':'var(--c-border)'}`}}>{o}</button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div style={{marginBottom:12}}>
            <div style={{color:'var(--c-text5)',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>Notes</div>
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Clinical notes…" rows={2} style={{width:'100%',padding:'7px 9px',background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:6,color:'#c0cfe8',fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:'none',resize:'none'}}/>
          </div>

          <div style={{display:'flex',gap:7}}>
            <button onClick={saveEntry} disabled={!form.sbp&&!form.hr&&!form.rr&&!form.spo2} style={{flex:1,padding:'10px',background:'#0f3a1f',border:'1px solid #1a5c2a',borderRadius:7,color:'#4ade80',cursor:'pointer',fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,opacity:(!form.sbp&&!form.hr&&!form.rr&&!form.spo2)?0.4:1}}>✓ SAVE ENTRY</button>
            <button onClick={()=>{setIsAdding(false);setForm({...EMPTY_VITALS});setTranscript('');setParseResult({});}} style={{padding:'10px 14px',background:'transparent',border:'1px solid var(--c-border)',borderRadius:7,color:'var(--c-text4)',cursor:'pointer',fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>✕</button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {entries.length===0&&!isAdding&&(
        <div style={{textAlign:'center',padding:'40px 20px',color:'var(--c-text4)'}}>
          <div style={{fontSize:28,marginBottom:8}}>📋</div>
          <div style={{fontSize:13,fontFamily:"'IBM Plex Mono',monospace"}}>No vitals recorded yet</div>
          <div style={{fontSize:11,marginTop:4,color:'#3a4f70'}}>Tap Add Vitals — pre-check values will auto-fill the form</div>
        </div>
      )}

      {/* Timeline */}
      {entries.map((e,i)=>{
        const prev = i>0?entries[i-1]:null;
        const gc = e.gcsTotal?(e.gcsTotal>=14?'#4ade80':e.gcsTotal>=9?'#facc15':'#f87171'):'var(--c-text4)';
        return(
          <div key={i} style={{background:'var(--c-surface)',border:`1px solid ${e.autoCapture?'#f9731640':'var(--c-border)'}`,borderRadius:8,padding:'11px 12px',marginBottom:8,position:'relative'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:e.autoCapture?'#f97316':'#60a5fa',flexShrink:0}}/>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",color:e.autoCapture?'#fb923c':'#93c5fd',fontSize:10,fontWeight:700}}>
                  {e.autoCapture?'AUTO-CAPTURE':`ENTRY ${i+1}`}
                </span>
                <span style={{color:'var(--c-text4)',fontSize:10}}>{fmtTime(e.ts)}</span>
                {e.autoCapture&&e.drugName&&(
                  <span style={{background:'#1a1000',border:'1px solid #f9731640',borderRadius:4,padding:'1px 6px',color:'#f97316',fontSize:9,fontFamily:"'IBM Plex Mono',monospace"}}>{e.drugName}</span>
                )}
              </div>
              <button onClick={()=>setEntries(p=>p.filter((_,j)=>j!==i))} style={{background:'transparent',border:'none',color:'#3a4f70',cursor:'pointer',fontSize:12,padding:'0 4px'}}>✕</button>
            </div>

            {/* Vitals grid */}
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:e.notes?8:0}}>
              {e.sbp&&<VitalBadge label="SBP" val={e.sbp} field="sbp" prev={prev}/>}
              {e.dbp&&<VitalBadge label="DBP" val={e.dbp} field="dbp" prev={prev}/>}
              {e.hr &&<VitalBadge label="HR"  val={e.hr}  field="hr"  prev={prev}/>}
              {e.rr &&<VitalBadge label="RR"  val={e.rr}  field="rr"  prev={prev}/>}
              {e.spo2&&<VitalBadge label="SpO₂" val={e.spo2} field="spo2" prev={prev} unit="%"/>}
              {e.etco2&&<VitalBadge label="EtCO₂" val={e.etco2} field="etco2" prev={prev}/>}
              {e.temp&&<VitalBadge label="Temp" val={e.temp} field="temp" prev={prev} unit="°F"/>}
              {e.bgl&&<VitalBadge label="BGL" val={e.bgl} field="bgl" prev={prev}/>}
              {e.pain!==''&&e.pain!==undefined&&<div style={{background:'var(--c-surface)',border:'1px solid var(--c-border)',borderRadius:6,padding:'5px 8px',minWidth:52,textAlign:'center'}}><div style={{color:'var(--c-text5)',fontSize:8,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:1}}>Pain</div><div style={{fontFamily:"'IBM Plex Mono',monospace",color:'var(--c-text)',fontSize:13,fontWeight:700}}>{e.pain}/10</div></div>}
              {e.gcsTotal&&<div style={{background:'var(--c-surface)',border:`1px solid ${gc}44`,borderRadius:6,padding:'5px 8px',textAlign:'center'}}><div style={{color:'var(--c-text5)',fontSize:8,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:1}}>GCS</div><div style={{fontFamily:"'IBM Plex Mono',monospace",color:gc,fontSize:13,fontWeight:700}}>{e.gcsTotal}/15</div>{prev?.gcsTotal&&<div style={{color:trendColor('gcs',getTrend(e.gcsTotal,prev.gcsTotal)),fontSize:10,fontWeight:700}}>{getTrend(e.gcsTotal,prev.gcsTotal)}</div>}</div>}
            </div>

            {/* Secondary row */}
            {(e.skin||e.pupils_l_sz||e.pupils_r_sz)&&(
              <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,marginTop:5,marginBottom:e.notes?8:0}}>
                {e.skin&&<span style={{background:'var(--c-input)',border:'1px solid var(--c-border)',borderRadius:4,padding:'2px 8px',color:'#a0b4d0',fontSize:11}}>{e.skin}</span>}
                {(e.pupils_l_sz||e.pupils_r_sz)&&(
                  <div style={{display:'flex',alignItems:'center',gap:10,background:'#080c18',border:'1px solid #141e32',borderRadius:6,padding:'6px 12px'}}>
                    <PupilDiagram sz={e.pupils_l_sz} rx={e.pupils_l_rx} label="L"/>
                    {e.pupils_l_sz&&e.pupils_r_sz&&e.pupils_l_sz===e.pupils_r_sz&&e.pupils_l_rx==='Reactive'&&e.pupils_r_rx==='Reactive'
                      ?<div style={{background:'#14532d',border:'1px solid #22543d',borderRadius:4,padding:'2px 6px',color:'#86efac',fontSize:8,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>PERRL</div>
                      :<div style={{color:'#2a3450',fontSize:10}}>·</div>
                    }
                    <PupilDiagram sz={e.pupils_r_sz} rx={e.pupils_r_rx} label="R"/>
                  </div>
                )}
              </div>
            )}

            {e.notes&&<div style={{color:'var(--c-text5)',fontSize:11,borderTop:'1px solid #141e32',paddingTop:6,marginTop:4}}>{e.notes}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* �������������������������������������������������������
   ARREST TRACKER — AHA/ACLS 2020 Adult Cardiac Arrest Algorithm
   Tracks pulse checks, shocks, meds, airway, H's and T's
������������������������������������������������������� */

const H_T_LIST = [
  { k:"hypoxia",      l:"Hypoxia",                     grp:"H" },
  { k:"hypovolemia",  l:"Hypovolemia",                 grp:"H" },
  { k:"hydrogen",     l:"Hydrogen ion (acidosis)",     grp:"H" },
  { k:"hypothermia",  l:"Hypothermia",                 grp:"H" },
  { k:"hypokalemia",  l:"Hypo/Hyperkalemia",           grp:"H" },
  { k:"hypoglycemia", l:"Hypoglycemia",                grp:"H" },
  { k:"tension",      l:"Tension pneumothorax",        grp:"T" },
  { k:"tamponade",    l:"Cardiac tamponade",           grp:"T" },
  { k:"toxins",       l:"Toxins / OD",                 grp:"T" },
  { k:"thrombosis_p", l:"Thrombosis — pulmonary (PE)", grp:"T" },
  { k:"thrombosis_c", l:"Thrombosis — coronary (MI)",  grp:"T" },
  { k:"trauma",       l:"Trauma",                      grp:"T" },
];

const IV_SITES = [
  "Left AC", "Right AC",
  "Left Forearm", "Right Forearm",
  "Left Hand", "Right Hand",
  "Left EJ", "Right EJ",
  "Other"
];
const IO_SITES = [
  "Left Proximal Tibia", "Right Proximal Tibia",
  "Left Humeral Head", "Right Humeral Head",
  "Left Distal Tibia", "Right Distal Tibia",
  "Left Distal Femur", "Right Distal Femur",
];
const IV_GAUGES = [14, 16, 18, 20, 22, 24];
const IO_GAUGES = [15, 25, 45]; // EZ-IO common needle lengths in mm

/* ── Arrest drug menu: categorized by phase ──
   Each entry: key, name, category (arrest/peri/post), dose,
   weight-based calc (optional), event type for logging,
   drug name for cross-logging to Med Log */
const ARREST_DRUG_MENU = {
  arrest: [
    {
      k: "epi", name: "Epinephrine 1:10,000", sub: "Cardiac arrest (all rhythms)",
      dose: "1 mg IV/IO q3–5 min", volume: "10 mL",
      eventType: "epi", medLogName: "Epinephrine 1:10,000",
      notes: "Flush 20 mL NS after. Continue CPR.",
    },
    {
      k: "amio", name: "Amiodarone", sub: "VF / pVT refractory after 2nd shock",
      dose: "300 mg IVP → 150 mg IVP", volume: "6 mL / 3 mL",
      eventType: "amio", medLogName: "Amiodarone",
      notes: "Max 2 doses (450 mg total). VF/pVT only.",
      adaptiveDose: (count) => count === 0 ? "300 mg IVP" : "150 mg IVP",
      maxDoses: 2,
    },
    {
      k: "lido", name: "Lidocaine", sub: "VF / pVT alternative to amio",
      dose: "1–1.5 mg/kg IV/IO", volume: "wt-based",
      eventType: "lido", medLogName: "Lidocaine",
      notes: "Maintenance 1–4 mg/min infusion after ROSC.",
      wt: true, mpk: 1.5, cmpml: 20,
    },
    {
      k: "bicarb", name: "Sodium Bicarbonate", sub: "Prolonged arrest · TCA OD · hyperK",
      dose: "1 mEq/kg IV/IO", volume: "1 mL/kg",
      eventType: "bicarb", medLogName: "Sodium Bicarbonate",
      notes: "Do NOT mix with calcium or epi — flush line.",
      wt: true, mpk: 1, cmpml: 1, unit: "mEq",
      maxDoses: 1,
    },
    {
      k: "calcium", name: "Calcium Chloride 10%", sub: "HyperK · Ca-channel blocker OD · crush",
      dose: "1 g (10 mL) slow IV", volume: "10 mL",
      eventType: "calcium", medLogName: "Calcium Chloride 10%",
      notes: "Slow push over 3–5 min. Do NOT mix with bicarb.",
    },
    {
      k: "mag", name: "Magnesium Sulfate", sub: "Torsades de pointes",
      dose: "1–2 g IV over 5–20 min", volume: "2–4 mL in 100 mL NS",
      eventType: "mag", medLogName: "Magnesium Sulfate",
      notes: "For torsades or suspected hypomagnesemia.",
    },
    {
      k: "d50", name: "Dextrose 50%", sub: "Hypoglycemia with AMS",
      dose: "25 g IV (50 mL)", volume: "50 mL prefilled",
      eventType: "d50", medLogName: "Dextrose 50% (D50)",
      notes: "Confirm BGL <60. Vesicant — large-bore IV.",
    },
    {
      k: "narcan", name: "Naloxone", sub: "Suspected opioid arrest",
      dose: "0.4–2 mg IV/IM/IN", volume: "1–5 mL",
      eventType: "narcan", medLogName: "Naloxone (Narcan)",
      notes: "Titrate to respirations. Short half-life — re-dose PRN.",
    },
    {
      k: "ns_bolus", name: "NS Bolus", sub: "Hypovolemia · PEA with narrow QRS",
      dose: "250–1000 mL IV/IO", volume: "IV bag",
      eventType: "ns_bolus", medLogName: "Normal Saline (0.9% NaCl)",
      notes: "Address hypovolemia — one of the H's.",
    },
  ],
  peri: [
    {
      k: "atropine", name: "Atropine", sub: "Symptomatic bradycardia (pre-arrest)",
      dose: "1 mg IV q3–5 min (max 3 mg)", volume: "10 mL",
      eventType: "atropine", medLogName: "Atropine",
      notes: "ACLS 2020: dose increased to 1 mg (was 0.5 mg).",
    },
    {
      k: "adenosine", name: "Adenosine", sub: "SVT pre-arrest",
      dose: "6 mg rapid IVP → 12 mg × 2", volume: "2 mL / 4 mL",
      eventType: "adenosine", medLogName: "Adenosine",
      notes: "Rapid push + 20 mL NS flush. Antecubital or above.",
    },
  ],
  postROSC: [
    {
      k: "dopamine", name: "Dopamine Drip", sub: "Post-ROSC hypotension",
      dose: "2–20 mcg/kg/min IV infusion", volume: "IV pump",
      eventType: "dopamine", medLogName: "Dopamine",
      notes: "Titrate to MAP ≥65. Start 5 mcg/kg/min; titrate by 2–5 q3–5min.",
    },
    {
      k: "ns_postrosc", name: "NS Bolus (post-ROSC)", sub: "Post-ROSC hypotension",
      dose: "250–500 mL IV bolus", volume: "IV bag",
      eventType: "ns_bolus", medLogName: "Normal Saline (0.9% NaCl)",
      notes: "Target SBP ≥90 / MAP ≥65. Reassess after bolus.",
    },
    {
      k: "versed_post", name: "Midazolam", sub: "Post-ROSC sedation (if intubated)",
      dose: "2–5 mg IV", volume: "0.5–1 mL",
      eventType: "versed", medLogName: "Midazolam (Versed)",
      notes: "Titrate to effect. Monitor BP — may worsen hypotension.",
    },
    {
      k: "fentanyl_post", name: "Fentanyl", sub: "Post-ROSC analgesia",
      dose: "1 mcg/kg IV", volume: "wt-based",
      eventType: "fentanyl", medLogName: "Fentanyl",
      notes: "Titrate. Monitor for hypotension and resp depression.",
      wt: true, mpk: 0.001, cmpml: 0.05, unit: "mcg", dmult: 1000,
    },
    {
      k: "amio_post", name: "Amiodarone Drip (post-ROSC)", sub: "Recurrent VF/VT",
      dose: "1 mg/min × 6 hr, then 0.5 mg/min", volume: "IV pump",
      eventType: "amio", medLogName: "Amiodarone",
      notes: "Continue per ROSC protocol if VF/VT was the arrest rhythm.",
    },
  ],
};

// Weight-based dose calc for arrest menu (reuses the same logic)
function calcArrestDose(drug, wt) {
  if (!drug.wt || !drug.mpk || !wt || wt <= 0) return null;
  let mg = drug.mpk * wt;
  let capped = false;
  // Per-dose maximum (PALS)
  if (drug.maxd != null && mg > drug.maxd) {
    mg = drug.maxd;
    capped = true;
  }
  // Per-dose minimum (e.g., Atropine min 0.1 mg)
  if (drug.mind != null && mg < drug.mind) {
    mg = drug.mind;
  }
  const unit = drug.unit || "mg";
  const dmult = drug.dmult || 1;
  const display = +(mg * dmult).toFixed(2);
  const mL = drug.cmpml ? +(mg / drug.cmpml).toFixed(2) : null;
  return { display, unit, mL, capped, mg };
}

/* �������������������������������������������������������
   PEDS ARREST DRUG MENU — PALS 2020
   All doses weight-based with explicit max caps.
   maxCumulative enforces hard stop across multiple doses.
������������������������������������������������������� */
const PEDS_ARREST_DRUG_MENU = {
  arrest: [
    {
      k: "epi", name: "Epinephrine 1:10,000", sub: "Cardiac arrest — all rhythms",
      dose: "0.01 mg/kg IV/IO q3–5 min",
      eventType: "epi", medLogName: "Epinephrine 1:10,000",
      notes: "0.1 mL/kg of 1:10,000. Max 1 mg per dose. Flush 5 mL NS after. Do NOT give 1:1,000 concentration IV/IO.",
      wt: true, mpk: 0.01, cmpml: 0.1, maxd: 1, unit: "mg",
    },
    {
      k: "amio", name: "Amiodarone", sub: "VF / pVT refractory",
      dose: "5 mg/kg IV/IO bolus",
      eventType: "amio", medLogName: "Amiodarone",
      notes: "For pulseless VT/VF only. May repeat ×2. Max cumulative 15 mg/kg (or 300 mg total, whichever less). Give as bolus in arrest.",
      wt: true, mpk: 5, cmpml: 50, maxd: 300, unit: "mg",
      maxCumulative: (wt) => Math.min(15 * wt, 300), // 15 mg/kg or 300mg
      maxDoses: 3,
    },
    {
      k: "lido", name: "Lidocaine", sub: "VF / pVT — alternative to amio",
      dose: "1 mg/kg IV/IO",
      eventType: "lido", medLogName: "Lidocaine",
      notes: "Alternative to amiodarone. May repeat q5–10 min. Post-ROSC infusion: 20–50 mcg/kg/min.",
      wt: true, mpk: 1, cmpml: 20, maxd: 100, unit: "mg",
      maxDoses: 3,
    },
    {
      k: "bicarb", name: "Sodium Bicarbonate", sub: "Prolonged arrest · hyperK · TCA OD",
      dose: "1 mEq/kg IV/IO (0.5 mEq/kg <1 mo)",
      eventType: "bicarb", medLogName: "Sodium Bicarbonate",
      notes: "Use 4.2% (0.5 mEq/mL) in neonates/infants; 8.4% (1 mEq/mL) in children. Do NOT mix with calcium or epi. Flush line.",
      wt: true, mpk: 1, cmpml: 1, unit: "mEq",
    },
    {
      k: "calcium", name: "Calcium Chloride 10%", sub: "HyperK · CCB OD · hypocalcemia",
      dose: "20 mg/kg IV/IO slow",
      eventType: "calcium", medLogName: "Calcium Chloride 10%",
      notes: "Give SLOWLY over 3–5 min. Max 2 g per dose. Central line preferred — vesicant. Do NOT mix with bicarb.",
      wt: true, mpk: 20, cmpml: 100, maxd: 2000, unit: "mg",
      maxDoses: 1,
    },
    {
      k: "mag", name: "Magnesium Sulfate", sub: "Torsades de pointes",
      dose: "25–50 mg/kg IV/IO",
      eventType: "mag", medLogName: "Magnesium Sulfate",
      notes: "For torsades. Max 2 g per dose. Give over 10–20 min in stable patient; bolus OK in arrest.",
      wt: true, mpk: 50, cmpml: 500, maxd: 2000, unit: "mg",
      maxDoses: 1,
    },
    {
      k: "d10", name: "Dextrose 10% (D10W)", sub: "Hypoglycemia — infants/small children",
      dose: "5 mL/kg IV/IO",
      eventType: "d50", medLogName: "Dextrose 10%",
      notes: "PREFERRED in infants (<1yr) and neonates. 5 mL/kg of D10W = 0.5 g/kg. Recheck BGL in 5 min. DO NOT USE D50 in infants.",
      wt: true, mpk: 0.5, cmpml: 0.1, unit: "g",
      volumeOverride: (wt) => `${(5 * wt).toFixed(1)} mL`,
      maxDoses: 2,
    },
    {
      k: "d25", name: "Dextrose 25% (D25)", sub: "Hypoglycemia — older children",
      dose: "2 mL/kg IV/IO",
      eventType: "d50", medLogName: "Dextrose 25%",
      notes: "For children >1yr. 2 mL/kg of D25 = 0.5 g/kg. Dilute D50 1:1 with NS to make D25. Recheck BGL in 5 min.",
      wt: true, mpk: 0.5, cmpml: 0.25, unit: "g",
      volumeOverride: (wt) => `${(2 * wt).toFixed(1)} mL`,
      maxDoses: 2,
    },
    {
      k: "narcan", name: "Naloxone", sub: "Suspected opioid arrest",
      dose: "0.1 mg/kg IV/IO/IM/IN",
      eventType: "narcan", medLogName: "Naloxone (Narcan)",
      notes: "Max 2 mg per dose. Short half-life — re-dose q2–3 min PRN. Titrate to respirations.",
      wt: true, mpk: 0.1, cmpml: 1, maxd: 2, unit: "mg",
      maxDoses: 3,
    },
    {
      k: "ns_bolus", name: "NS Bolus", sub: "Hypovolemia · sepsis · PEA",
      dose: "20 mL/kg IV/IO over 5–10 min",
      eventType: "ns_bolus", medLogName: "Normal Saline (0.9% NaCl)",
      notes: "Reassess after each bolus. May repeat ×3 (total 60 mL/kg). In cardiogenic shock give 5–10 mL/kg carefully.",
      wt: true, mpk: 20, unit: "mL",
      volumeOverride: (wt) => `${(20 * wt).toFixed(0)} mL`,
      maxDoses: 3,
    },
  ],
  peri: [
    {
      k: "atropine", name: "Atropine", sub: "Symptomatic bradycardia · vagal",
      dose: "0.02 mg/kg IV/IO (min 0.1 mg)",
      eventType: "atropine", medLogName: "Atropine",
      notes: "Minimum 0.1 mg (below this causes paradoxical brady). Max single dose 0.5 mg. Max TOTAL 1 mg. May repeat ×1 only.",
      wt: true, mpk: 0.02, cmpml: 0.1, maxd: 0.5, mind: 0.1, unit: "mg",
      maxCumulative: () => 1,
      maxDoses: 2,
    },
    {
      k: "adenosine", name: "Adenosine", sub: "SVT",
      dose: "0.1 mg/kg rapid IVP (1st) · 0.2 mg/kg (2nd)",
      eventType: "adenosine", medLogName: "Adenosine",
      notes: "1st dose max 6 mg. 2nd dose max 12 mg. RAPID push + immediate 5–10 mL NS flush. Antecubital or above.",
      wt: true, mpk: 0.1, cmpml: 3, maxd: 6, unit: "mg",
      adaptiveDose: (count, wt) => {
        if (count === 0) return `${Math.min(0.1 * wt, 6).toFixed(2)} mg (0.1 mg/kg, max 6 mg)`;
        return `${Math.min(0.2 * wt, 12).toFixed(2)} mg (0.2 mg/kg, max 12 mg)`;
      },
      maxDoses: 3,
    },
  ],
  postROSC: [
    {
      k: "epi_drip", name: "Epinephrine Infusion", sub: "Post-ROSC hypotension",
      dose: "0.1–1 mcg/kg/min IV infusion",
      eventType: "dopamine", medLogName: "Epinephrine",
      notes: "Preferred over dopamine in peds per PALS. Start 0.1 mcg/kg/min, titrate to MAP per age.",
    },
    {
      k: "dopamine", name: "Dopamine Drip", sub: "Post-ROSC (alternative to epi drip)",
      dose: "2–20 mcg/kg/min IV infusion",
      eventType: "dopamine", medLogName: "Dopamine",
      notes: "Titrate to adequate perfusion. Start 5 mcg/kg/min; titrate by 2–5 q5min.",
    },
    {
      k: "ns_postrosc", name: "NS Bolus (post-ROSC)", sub: "Post-ROSC hypotension",
      dose: "10–20 mL/kg IV over 10 min",
      eventType: "ns_bolus", medLogName: "Normal Saline (0.9% NaCl)",
      notes: "Smaller boluses post-ROSC than in arrest. Reassess after each. Avoid fluid overload.",
      wt: true, mpk: 10, unit: "mL",
      maxDoses: 2,
      volumeOverride: (wt) => `${(10 * wt).toFixed(0)}–${(20 * wt).toFixed(0)} mL`,
    },
    {
      k: "versed_post", name: "Midazolam", sub: "Post-ROSC sedation (if intubated)",
      dose: "0.05–0.1 mg/kg IV",
      eventType: "versed", medLogName: "Midazolam (Versed)",
      notes: "Max 2 mg per dose. Monitor BP — may worsen post-ROSC hypotension.",
      wt: true, mpk: 0.1, cmpml: 5, maxd: 2, unit: "mg",
      maxDoses: 1,
    },
    {
      k: "fentanyl_post", name: "Fentanyl", sub: "Post-ROSC analgesia",
      dose: "1 mcg/kg IV slow",
      eventType: "fentanyl", medLogName: "Fentanyl",
      notes: "Max 50 mcg per dose. Monitor for hypotension and resp depression. Give over 1–2 min.",
      wt: true, mpk: 0.001, cmpml: 0.05, maxd: 0.05, unit: "mcg", dmult: 1000,
      maxDoses: 1,
    },
  ],
};

/* Peds defibrillation energy per PALS 2020:
   1st shock: 2 J/kg · 2nd shock: 4 J/kg · Subsequent: 4–10 J/kg (max 10 J/kg or adult 360J)
*/
function pedsShockJoules(shockCount, wt) {
  if (!wt || wt <= 0) return null;
  let jpk;
  if (shockCount === 0) jpk = 2;
  else if (shockCount === 1) jpk = 4;
  else jpk = 10; // max
  const j = Math.min(jpk * wt, 360); // cap at adult max
  return {
    joules: Math.round(j),
    perKg: jpk,
    capped: jpk * wt > 360
  };
}

/* Cumulative dose tracking — sum up actual dose given per event type.
   Returns { cumulative, maxCumulative, percentOfMax, doseCount, maxReached }
*/
function getCumulative(drug, events, wt) {
  const defaultMaxDoses = {
    bicarb: 1,
    calcium: 1,
    mag: 1,
    d10: 2,
    d25: 2,
    narcan: 3,
    ns_bolus: 3,
    ns_postrosc: 2,
    versed_post: 1,
    fentanyl_post: 1,
  };
  const drugEvents = events.filter(e => e.type === drug.eventType);
  const doseCount = drugEvents.length;
  let cumulative = 0;
  // Each event's detail may have a mg value; if not, use calc'd dose
  if (drug.wt && drug.mpk && wt > 0) {
    const calc = calcArrestDose(drug, wt);
    if (calc) cumulative = calc.mg * doseCount;
  }
  const maxCumulative = drug.maxCumulative ? drug.maxCumulative(wt) : null;
  const maxDoses = drug.maxDoses ?? defaultMaxDoses[drug.k] ?? null;
  const maxReached = (maxCumulative && cumulative >= maxCumulative) ||
                     (maxDoses && doseCount >= maxDoses);
  return { cumulative, maxCumulative, doseCount, maxDoses, maxReached };
}

const ARREST_EVENT_COLORS = {
  start:         { bg:"#14532d", fg:"#86efac", icon:"▶", label:"Arrest Started" },
  rhythm_vf:     { bg:"#7c2d12", fg:"#fdba74", icon:"⚡", label:"Rhythm: VF/pVT" },
  rhythm_pea:    { bg:"#1e3a8a", fg:"#93c5fd", icon:"⊘", label:"Rhythm: PEA" },
  rhythm_asys:   { bg:"#1a2540", fg:"var(--c-text4)", icon:"━", label:"Rhythm: Asystole" },
  shock:         { bg:"#7f1d1d", fg:"#fca5a5", icon:"⚡", label:"Shock" },
  epi:           { bg:"#7c2d12", fg:"#fdba74", icon:"💉", label:"Epinephrine" },
  amio:          { bg:"#1e3a8a", fg:"#93c5fd", icon:"💉", label:"Amiodarone" },
  lido:          { bg:"#1e3a8a", fg:"#93c5fd", icon:"💉", label:"Lidocaine" },
  bicarb:        { bg:"#0d1f3a", fg:"#93c5fd", icon:"💉", label:"Sodium Bicarb" },
  calcium:       { bg:"#0d1f3a", fg:"#93c5fd", icon:"💉", label:"Calcium Chloride" },
  mag:           { bg:"#0d1f3a", fg:"#93c5fd", icon:"💉", label:"Magnesium Sulfate" },
  d50:           { bg:"#1a1408", fg:"#facc15", icon:"💉", label:"Dextrose 50%" },
  narcan:        { bg:"#1a0e28", fg:"#c084fc", icon:"💉", label:"Naloxone" },
  ns_bolus:      { bg:"#0a1a28", fg:"#60a5fa", icon:"💧", label:"NS Bolus" },
  atropine:      { bg:"#7c2d12", fg:"#fdba74", icon:"💉", label:"Atropine" },
  adenosine:     { bg:"#7c2d12", fg:"#fdba74", icon:"💉", label:"Adenosine" },
  dopamine:      { bg:"#1a0e28", fg:"#c084fc", icon:"💉", label:"Dopamine Drip" },
  versed:        { bg:"#1a0e28", fg:"#c084fc", icon:"💉", label:"Midazolam" },
  fentanyl:      { bg:"#1a0e28", fg:"#c084fc", icon:"💉", label:"Fentanyl" },
  airway:        { bg:"#0a2318", fg:"#4ade80", icon:"🫁", label:"Airway" },
  access_iv:     { bg:"#0a1a28", fg:"#60a5fa", icon:"💧", label:"IV Access" },
  access_io:     { bg:"#1a0a28", fg:"#c084fc", icon:"🦴", label:"IO Access" },
  access_fail:   { bg:"#2a0808", fg:"#fca5a5", icon:"✕", label:"Access Attempt Failed" },
  cpr_resume:    { bg:"#0d1f3a", fg:"#60a5fa", icon:"↻", label:"CPR Resumed" },
  cause:         { bg:"#1a0e28", fg:"#c084fc", icon:"✓", label:"Cause Addressed" },
  rosc:          { bg:"#14532d", fg:"#4ade80", icon:"♥", label:"ROSC" },
  terminate:     { bg:"#1a2540", fg:"#94a3b8", icon:"✕", label:"Terminated" },
  note:          { bg:"var(--c-surface)", fg:"var(--c-text4)", icon:"•", label:"Note" },
};

/* ── Audio alarms (reuses pattern from drug card) ── */
function arrestBeep(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.28, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    if (type === "warn") {
      beep(880, 0, 0.14); beep(880, 0.2, 0.14);
    } else if (type === "due") {
      beep(1100, 0, 0.14); beep(1100, 0.2, 0.14); beep(1100, 0.4, 0.2);
    } else if (type === "cycle") {
      // 2-min CPR cycle end — 4 short beeps
      beep(1320, 0, 0.1); beep(1320, 0.14, 0.1);
      beep(1320, 0.28, 0.1); beep(1320, 0.42, 0.16);
    }
  } catch(e){}
}

const fmtArrestTime = s => {
  if (s == null || s < 0) return "—:—";
  const m = Math.floor(s/60), sc = s%60;
  return `${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`;
};
const fmtClock = ts => {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toTimeString().slice(0,8);
};

function ArrestTracker({ arrestState, setArrestState, tick, onLogMed, wkg, setWkg, setWlb, mode, isDarkMode=true, patient={} }) {
  const alarmRef = useRef({ epiWarn: false, epiDue: false, cycleEnd: false, lastCycleStart: null });
  const [showHT, setShowHT] = useState(false);
  const [showRhythmMenu, setShowRhythmMenu] = useState(false);
  const [showShockMenu, setShowShockMenu] = useState(false);
  const [showAirwayMenu, setShowAirwayMenu] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [now, setNow] = useState(0);
  const [cloudSaveStatus, setCloudSaveStatus] = useState(null); // null | "saving" | "saved" | "error"

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { startTs, endTs, endReason, rhythm, cycleStartTs, lastEpiTs, events, airway, hts, access, patientType } = arrestState;
  const active = !!startTs && !endTs;

  // Determine which drug menu to use based on patient type
  const isPeds = patientType === "infant" || patientType === "child";
  const DRUG_MENU = isPeds ? PEDS_ARREST_DRUG_MENU : ARREST_DRUG_MENU;

  // Age-adjusted CPR ratio
  const cprRatio = !isPeds ? "30:2 (adult)" : "15:2 two-rescuer · 30:2 solo";
  const cprDepth = patientType === "infant" ? "1.5 in (4 cm)"
                 : patientType === "child" ? "2 in (5 cm)"
                 : "2–2.4 in (5–6 cm)";

  // Timers
  const totalSecs = startTs ? Math.floor(((endTs || now) - startTs) / 1000) : 0;
  const cycleSecs = cycleStartTs ? Math.floor((now - cycleStartTs) / 1000) : 0;
  const cycleRemain = Math.max(0, 120 - cycleSecs); // 2 min cycles
  const cycleEnded = active && cycleStartTs && cycleRemain === 0;
  const epiSecs = lastEpiTs ? Math.floor((now - lastEpiTs) / 1000) : null;
  const epiWarn = active && epiSecs != null && epiSecs >= 180 && epiSecs < 300;
  const epiDue = active && epiSecs != null && epiSecs >= 300;
  const epiWindowOpen = active && epiSecs != null && epiSecs >= 180;

  // Dose counters — single pass
  const _counts={epi:0,shock:0,amio:0,lido:0};
  events.forEach(e=>{if(e.type in _counts)_counts[e.type]++;});
  const{epi:epiCount,shock:shockCount,amio:amioCount,lido:lidoCount}=_counts;

  // Amiodarone/Lidocaine become relevant after 2nd shock in VF/pVT
  const showAntiarrhythmic = rhythm === "VF/pVT" && shockCount >= 2;

  useEffect(()=>{
    if (!active) return;
    if (epiWarn && !alarmRef.current.epiWarn) {
      alarmRef.current.epiWarn = true;
      arrestBeep("warn");
    }
    if (epiDue && !alarmRef.current.epiDue) {
      alarmRef.current.epiDue = true;
      arrestBeep("due");
    }
    if (cycleEnded && alarmRef.current.lastCycleStart === cycleStartTs && !alarmRef.current.cycleEnd) {
      alarmRef.current.cycleEnd = true;
      arrestBeep("cycle");
    }
    if (alarmRef.current.lastCycleStart !== cycleStartTs) {
      alarmRef.current.lastCycleStart = cycleStartTs;
      alarmRef.current.cycleEnd = false;
    }
  },[active,epiWarn,epiDue,cycleEnded,cycleStartTs]);

  // Helpers
  const addEvent = useCallback((type, detail = "", extra = {}) => {
    const ts = Date.now();
    const ev = { id: ts + Math.random(), ts, type, detail, ...extra };
    setArrestState(s => ({ ...s, events: [ev, ...s.events] }));
    return ev;
  }, []);

  const startArrest = (type = "adult") => {
    const ts = Date.now();
    setArrestState({
      startTs: ts, endTs: null, endReason: null,
      rhythm: null, cycleStartTs: ts, lastEpiTs: null,
      events: [{
        id: ts, ts, type: "start",
        detail: `${type === "adult" ? "Adult" : type === "infant" ? "Infant (<1yr)" : "Child (1–8yr)"} arrest · CPR begun${type !== "adult" ? " · PALS protocol" : " · ACLS protocol"}`
      }],
      airway: null, hts: {}, access: [],
      patientType: type
    });
    alarmRef.current = { epiWarn: false, epiDue: false, cycleEnd: false, lastCycleStart: ts };
  };

  const recordRhythm = (r) => {
    const type = r === "VF/pVT" ? "rhythm_vf" : r === "PEA" ? "rhythm_pea" : "rhythm_asys";
    setArrestState(s => ({
      ...s,
      rhythm: r === "Asystole" ? "PEA/Asystole" : r === "PEA" ? "PEA/Asystole" : "VF/pVT",
      cycleStartTs: Date.now(),  // new cycle starts
      events: [{ id: Date.now()+Math.random(), ts: Date.now(), type, detail: `Rhythm check: ${r}` }, ...s.events]
    }));
    alarmRef.current = { ...alarmRef.current, cycleEnd: false, lastCycleStart: Date.now() };
    setShowRhythmMenu(false);
  };

  const recordShock = (joules) => {
    addEvent("shock", `${joules}J biphasic`, { joules });
    // New 2-min cycle after shock
    setArrestState(s => ({ ...s, cycleStartTs: Date.now() }));
    alarmRef.current = { ...alarmRef.current, cycleEnd: false, lastCycleStart: Date.now() };
    setShowShockMenu(false);
  };

  const recordMed = (medType) => {
    // Peds: block if no weight (safety hard-stop)
    if (isPeds && wkg === 0) return;

    if (medType === "epi") {
      const ts = Date.now();
      let detail = "1 mg IV/IO";
      if (isPeds && wkg > 0) {
        const mg = Math.min(0.01 * wkg, 1);
        const mL = Math.min(0.1 * wkg, 10);
        detail = `${mg.toFixed(2)} mg (${mL.toFixed(1)} mL of 1:10,000) IV/IO`;
      }
      addEvent("epi", detail);
      setArrestState(s => ({ ...s, lastEpiTs: ts }));
      alarmRef.current = { ...alarmRef.current, epiWarn: false, epiDue: false };
      if (onLogMed) onLogMed("Epinephrine 1:10,000");
    } else if (medType === "amio") {
      // Peds amio: 5 mg/kg, max cumulative 15 mg/kg (or 300 mg)
      if (isPeds) {
        if (wkg === 0) return;
        // Hard block if max cumulative reached
        const prevAmioCount = events.filter(e => e.type === "amio").length;
        const perDose = Math.min(5 * wkg, 300);
        const maxCum = Math.min(15 * wkg, 300);
        if (prevAmioCount * perDose >= maxCum || prevAmioCount >= 3) return;
        addEvent("amio", `${perDose.toFixed(0)} mg (5 mg/kg) IVP`);
      } else {
        // Adult: hard block at 2 doses
        if (amioCount >= 2) return;
        const doseLabel = amioCount === 0 ? "300 mg IVP" : "150 mg IVP";
        addEvent("amio", doseLabel);
      }
      if (onLogMed) onLogMed("Amiodarone");
    } else if (medType === "lido") {
      if (isPeds && wkg === 0) return;
      if (isPeds) {
        const prevLidoCount = events.filter(e => e.type === "lido").length;
        if (prevLidoCount >= 3) return;
        const mg = Math.min(1 * wkg, 100);
        addEvent("lido", `${mg.toFixed(0)} mg (1 mg/kg) IV/IO`);
      } else {
        addEvent("lido", "1–1.5 mg/kg IV/IO");
      }
      if (onLogMed) onLogMed("Lidocaine");
    }
  };

  const recordAirway = (a) => {
    addEvent("airway", `${a} placed`);
    setArrestState(s => ({ ...s, airway: a }));
    setShowAirwayMenu(false);
  };

  // ── IV/IO access handlers ──
  const [showAccessMenu, setShowAccessMenu] = useState(false);
  const recordAccess = useCallback(({ type, site, gauge, who, success }) => {
    const ts = Date.now();
    const entry = {
      id: ts + Math.random(),
      ts,
      type, site, gauge, who, success
    };
    setArrestState(s => ({ ...s, access: [entry, ...s.access] }));
    const label = success
      ? `${gauge}g ${type} · ${site}${who ? ` · ${who}` : ""}`
      : `FAILED · ${type} attempt · ${site}${who ? ` · ${who}` : ""}`;
    addEvent(
      success ? (type === "IV" ? "access_iv" : "access_io") : "access_fail",
      label,
      { accessId: entry.id }
    );
    setShowAccessMenu(false);
  }, []);
  const successfulAccess = access.filter(a => a.success);

  // ── Unified arrest drug menu handler ──
  const [showDrugMenu, setShowDrugMenu] = useState(false);
  const [drugPhase, setDrugPhase] = useState("arrest"); // "arrest" | "peri" | "postROSC"
  const [expandedDrug, setExpandedDrug] = useState(null);

  const recordMenuDrug = (drug) => {
    if (drug.wt && wkg === 0) return;

    const cumInfo = getCumulative(drug, events, wkg);
    if (cumInfo.maxReached) return;

    // Special handling for drugs already wired via recordMed (keep counters working)
    if (drug.k === "epi") { recordMed("epi"); return; }
    if (drug.k === "amio") { recordMed("amio"); return; }
    if (drug.k === "lido") { recordMed("lido"); return; }

    // Calculate adaptive dose for repeat-dose drugs
    let detail = drug.dose;
    if (drug.adaptiveDose) {
      const count = events.filter(e => e.type === drug.eventType).length;
      detail = drug.adaptiveDose(count, wkg);
    } else if (drug.wt && wkg > 0) {
      const calc = calcArrestDose(drug, wkg);
      if (calc) {
        detail = `${calc.display} ${calc.unit}${calc.mL ? ` (${calc.mL} mL)` : ""}`;
      }
    }

    addEvent(drug.eventType, detail);
    if (onLogMed) onLogMed(drug.medLogName);
  };

  const toggleHT = (k) => {
    setArrestState(s => {
      const addressed = !s.hts[k];
      const newHts = { ...s.hts, [k]: addressed };
      let newEvents = s.events;
      if (addressed) {
        const item = H_T_LIST.find(x => x.k === k);
        newEvents = [{ id: Date.now()+Math.random(), ts: Date.now(), type:"cause", detail: `${item.l} addressed` }, ...s.events];
      }
      return { ...s, hts: newHts, events: newEvents };
    });
  };

  const endArrest = (reason) => {
    const ts = Date.now();
    const type = reason === "ROSC" ? "rosc" : "terminate";
    setArrestState(s => {
      const finalEvents = [{ id: ts, ts, type, detail: reason === "ROSC" ? "Return of spontaneous circulation" : "Resuscitation terminated" }, ...s.events];
      const counts = { epi:0, shock:0 };
      finalEvents.forEach(e => { if (e.type in counts) counts[e.type]++; });

      if (isFirebaseConfigured()) {
        setCloudSaveStatus("saving");
        saveArrestReport({
          patientType: s.patientType,
          outcome: reason,
          startTs: s.startTs,
          endTs: ts,
          totalSeconds: Math.floor((ts - s.startTs) / 1000),
          events: finalEvents,
          airway: s.airway,
          shockCount: counts.shock,
          epiCount: counts.epi,
          access: s.access,
          weightKg: wkg || 0,
          run: patient.run || "",
          unit: patient.unit || "",
          provider: patient.provider || "",
          patientAge: patient.age || "",
          patientSex: patient.sex || "",
        }).then(() => setCloudSaveStatus("saved"))
          .catch(() => setCloudSaveStatus("error"));
      }

      return { ...s, endTs: ts, endReason: reason, events: finalEvents };
    });
    setConfirmEnd(false);
  };

  const resetArrest = () => {
    setArrestState({
      startTs:null, endTs:null, endReason:null,
      rhythm:null, cycleStartTs:null, lastEpiTs:null,
      events:[], airway:null, hts:{}, access:[], patientType:null
    });
    alarmRef.current = { epiWarn: false, epiDue: false, cycleEnd: false, lastCycleStart: null };
    setConfirmReset(false);
  };

  const deleteEvent = (id) => {
    setArrestState(s => ({ ...s, events: s.events.filter(e => e.id !== id) }));
  };

  const ac = (d, l) => isDarkMode ? d : l;
  const subTxt = ac("#8aa0c2", "#64748b");

  /* ── RENDER: Pre-start state ── */
  if (!startTs) {
    return (
      <div style={{ paddingBottom: 20 }}>
        <div style={{ textAlign: "center", padding: "28px 16px 16px" }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>❤</div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:15, fontWeight:700, color:"var(--c-text)", marginBottom:4 }}>
            Cardiac Arrest Tracker
          </div>
          <div style={{ color:"var(--c-text4)", fontSize:11.5, lineHeight:1.5, marginBottom:16, maxWidth:340, margin:"0 auto 16px" }}>
            Select patient type to begin · ACLS for adults · PALS for pediatrics
          </div>

          {/* Patient-type chooser */}
          <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:10 }}>
            <button
              onClick={() => startArrest("adult")}
              style={{
                width:"100%", padding:"16px 14px", borderRadius:10,
                background:"#7f1d1d", border:"2px solid #ef4444", color:"#fff", cursor:"pointer",
                fontFamily:"'IBM Plex Mono',monospace", fontSize:14, fontWeight:700,
                letterSpacing:"0.05em", textTransform:"uppercase",
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
                boxShadow:"0 0 16px rgba(239,68,68,0.25)"
              }}
            >
              <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:22 }}>🧑</span>
                <span style={{ textAlign:"left" }}>
                  <div>Adult Arrest</div>
                  <div style={{ fontSize:9, opacity:0.8, fontWeight:500, textTransform:"none", letterSpacing:"0.02em", marginTop:2 }}>ACLS protocol · ≥8 years or adult size</div>
                </span>
              </span>
              <span style={{ fontSize:18 }}>▶</span>
            </button>

            <button
              onClick={() => startArrest("child")}
              style={{
                width:"100%", padding:"14px 14px", borderRadius:10,
                background:"#1a0a28", border:"2px solid #a855f7", color:"#e9d5ff", cursor:"pointer",
                fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700,
                letterSpacing:"0.04em", textTransform:"uppercase",
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:10
              }}
            >
              <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>🧒</span>
                <span style={{ textAlign:"left" }}>
                  <div>Child Arrest · 1–8 yr</div>
                  <div style={{ fontSize:9, opacity:0.8, fontWeight:500, textTransform:"none", letterSpacing:"0.02em", marginTop:2 }}>PALS protocol · weight-based dosing</div>
                </span>
              </span>
              <span style={{ fontSize:18 }}>▶</span>
            </button>

            <button
              onClick={() => startArrest("infant")}
              style={{
                width:"100%", padding:"14px 14px", borderRadius:10,
                background:"#0a1a28", border:"2px solid #60a5fa", color:"#bfdbfe", cursor:"pointer",
                fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700,
                letterSpacing:"0.04em", textTransform:"uppercase",
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:10
              }}
            >
              <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>👶</span>
                <span style={{ textAlign:"left" }}>
                  <div>Infant Arrest · &lt;1 yr</div>
                  <div style={{ fontSize:9, opacity:0.8, fontWeight:500, textTransform:"none", letterSpacing:"0.02em", marginTop:2 }}>PALS protocol · D10, peds pads, 15:2 ratio</div>
                </span>
              </span>
              <span style={{ fontSize:18 }}>▶</span>
            </button>
          </div>

          <div style={{ marginTop:8, color:"#4a5a7a", fontSize:10, lineHeight:1.5 }}>
            Tap when patient is confirmed pulseless · CPR initiated<br/>
            {wkg === 0 && <span style={{color:"#f59e0b"}}>⚠ No weight entered — weight-based drugs will be disabled</span>}
          </div>
        </div>

        {/* Quick reference card — ADULT */}
        <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border-sub)", borderRadius:8, padding:"12px 13px", marginTop:6 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"var(--c-text4)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>
            ACLS Adult — Quick Reference
          </div>
          <div style={{ fontSize:11.5, color:"var(--c-text3)", lineHeight:1.7 }}>
            <div style={{ marginBottom:10 }}>
              <span style={{ color:"#fca5a5", fontWeight:700 }}>▸ VF / pVT (Shockable):</span><br/>
              Shock 200/300/360J → 2 min CPR → Rhythm check → Shock → Epi 1 mg q3–5min → 2 min CPR → Shock → <span style={{color:"#93c5fd"}}>Amiodarone 300 mg</span> (or Lido 1–1.5 mg/kg)
            </div>
            <div style={{ marginBottom:10 }}>
              <span style={{ color:"#93c5fd", fontWeight:700 }}>▸ PEA / Asystole:</span><br/>
              CPR → Epi 1 mg q3–5min ASAP → 2 min CPR → Rhythm check → repeat
            </div>
            <div>
              <span style={{ color:"#c084fc", fontWeight:700 }}>▸ 4 H's & 4 T's:</span><br/>
              Hypoxia · Hypovolemia · H⁺ · Hypo/Hyperkalemia · Hypothermia · Hypoglycemia · Tension pneumo · Tamponade · Toxins · Thrombosis (PE/MI) · Trauma
            </div>
          </div>
        </div>

        {/* Quick reference card — PEDS (PALS) */}
        <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border-sub)", borderLeft:"3px solid #a855f7", borderRadius:8, padding:"12px 13px", marginTop:6 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#a855f7", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>
            PALS Pediatric — Quick Reference
          </div>
          <div style={{ fontSize:11.5, color:"var(--c-text3)", lineHeight:1.7 }}>
            <div style={{ marginBottom:8 }}>
              <span style={{ color:"#fca5a5", fontWeight:700 }}>▸ VF / pVT:</span> Shock <b>2 J/kg</b> → CPR → <b>4 J/kg</b> → Epi 0.01 mg/kg q3–5min → CPR → Shock 4–10 J/kg → <span style={{color:"#93c5fd"}}>Amio 5 mg/kg</span> or Lido 1 mg/kg
            </div>
            <div style={{ marginBottom:8 }}>
              <span style={{ color:"#93c5fd", fontWeight:700 }}>▸ PEA/Asystole:</span> CPR → <b>Epi 0.01 mg/kg</b> ASAP → CPR (2 min) → recheck → repeat · Max epi 1 mg/dose
            </div>
            <div style={{ marginBottom:8 }}>
              <span style={{ color:"#fdba74", fontWeight:700 }}>▸ CPR mechanics:</span>
              <br/>Infant: depth 1.5" (4 cm) · 15:2 two-rescuer · Rate 100–120
              <br/>Child: depth 2" (5 cm) · 15:2 two-rescuer · Rate 100–120
              <br/><span style={{ color:"#86efac", fontWeight:600 }}>Adv airway (ETT/SGA) → continuous compressions · 1 breath q2–3 sec (20–30/min) · no pause</span>
            </div>
            <div>
              <span style={{ color:"#c084fc", fontWeight:700 }}>▸ 6 H's & 5 T's:</span>
              <br/>Same as adult, but consider <b>congenital heart</b>, <b>abuse</b>, <b>sudden infant death</b>, and <b>hyperthermia</b> (malignant)
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── RENDER: Post-end summary ── */
  if (endTs) {
    return (
      <div style={{ paddingBottom:20 }}>
        <div style={{
          background: endReason === "ROSC" ? ac("#071a0e","#dcfce7") : ac("#1a1208","#fef3c7"),
          border: `2px solid ${endReason === "ROSC" ? ac("#14532d","#16a34a") : ac("#5a4020","#d97706")}`,
          borderRadius:10, padding:"16px 14px", marginBottom:10, textAlign:"center"
        }}>
          <div style={{ fontSize:36, marginBottom:6 }}>{endReason === "ROSC" ? "♥" : "✕"}</div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:15, fontWeight:700, color: endReason === "ROSC" ? "#4ade80" : "#c08040", marginBottom:4 }}>
            {endReason === "ROSC" ? "ROSC Achieved" : "Resuscitation Terminated"}
          </div>
          <div style={{ color: subTxt, fontSize:11 }}>
            Total arrest time: <span style={{ color: ac("#e2e8f0","#1e293b"), fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{fmtArrestTime(totalSecs)}</span>
          </div>
        </div>

        {/* Cloud save status */}
        {isFirebaseConfigured() && (
          <div style={{
            display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
            background: cloudSaveStatus === "saved" ? "#071a0e" : cloudSaveStatus === "error" ? "#1a0808" : "#0a0f1c",
            border: `1px solid ${cloudSaveStatus === "saved" ? "#14532d" : cloudSaveStatus === "error" ? "#7f1d1d" : "#1a2338"}`,
            borderRadius:7, marginBottom:8
          }}>
            <span style={{ fontSize:14 }}>
              {cloudSaveStatus === "saving" ? "⏳" : cloudSaveStatus === "saved" ? "☁️" : cloudSaveStatus === "error" ? "⚠️" : "☁️"}
            </span>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:700,
                color: cloudSaveStatus === "saved" ? "#4ade80" : cloudSaveStatus === "error" ? "#fca5a5" : "#6b82a8" }}>
                {cloudSaveStatus === "saving" ? "Saving to cloud…" :
                 cloudSaveStatus === "saved"  ? "Saved to cloud — accessible on Toughbook / tablet" :
                 cloudSaveStatus === "error"  ? "Cloud save failed — check connection" :
                 "Cloud sync ready"}
              </div>
              {cloudSaveStatus === "saved" && (
                <div style={{ fontSize:9, color:"#4a6a5a", marginTop:1 }}>
                  Open this app on your Toughbook to view under Saved Calls
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stat summary */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:10 }}>
          <SumStat label="Shocks" value={shockCount} color="#fca5a5" />
          <SumStat label="Epi Doses" value={epiCount} color="#fdba74" />
          <SumStat label="Access" value={access.filter(a => a.success).length} color="#93c5fd" />
          <SumStat label={airway ? "Airway" : "—"} value={airway || "—"} color="#86efac" />
        </div>

        <ArrestEventLog events={events} onDelete={deleteEvent} />

        {confirmReset ? (
          <div style={{ marginTop:10, background: ac("#1a0808","#fee2e2"), border:`1px solid ${ac("#7f1d1d","#dc2626")}`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ color: ac("#fca5a5","#b91c1c"), fontSize:12, fontWeight:700, marginBottom:4 }}>Reset arrest tracker?</div>
            <div style={{ color: ac("#9b1c1c","#991b1b"), fontSize:11, marginBottom:10, lineHeight:1.5 }}>This will clear all arrest events from this tab. The Med Log is NOT affected.</div>
            <div style={{ display:"flex", gap:7 }}>
              <button onClick={resetArrest} style={{ flex:1, padding:"9px 0", borderRadius:6, border:"1px solid #7f1d1d", background:"#7f1d1d", color:"#fef2f2", cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700 }}>Confirm Reset</button>
              <button onClick={()=>setConfirmReset(false)} style={{ flex:1, padding:"9px 0", borderRadius:6, border:`1px solid ${ac("#1a2540","#cbd5e1")}`, background:"transparent", color: subTxt, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", gap:7, marginTop:10 }}>
            <button onClick={()=>setConfirmReset(true)} style={{
              flex:1, padding:"11px 0", borderRadius:7, border:`1px solid ${ac("#1a2540","#cbd5e1")}`,
              background:"transparent", color: subTxt, cursor:"pointer",
              fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.05em"
            }}>↺ Reset & Start New</button>
          </div>
        )}
      </div>
    );
  }

  /* ── RENDER: Active arrest ── */
  const branchColor = rhythm === "VF/pVT" ? "#fca5a5" : rhythm ? "#93c5fd" : "var(--c-text4)";

  return (
    <div style={{ paddingBottom:20 }}>

      {/* PATIENT TYPE BANNER */}
      {isPeds && (
        <div style={{
          background: ac("#1a0a28","#ede9fe"), border:"1px solid #a855f7",
          borderRadius:7, padding:"7px 11px", marginBottom:8,
          display:"flex", alignItems:"center", gap:8
        }}>
          <span style={{ fontSize:16 }}>{patientType === "infant" ? "👶" : "🧒"}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color: ac("#c084fc","#7c3aed"), fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>
              {patientType === "infant" ? "Infant (<1 yr) · PALS" : "Child (1–8 yr) · PALS"}
            </div>
            <div style={{ fontSize:10, color: ac("#8aa0c2","#6d28d9"), marginTop:1 }}>
              CPR: {cprDepth} depth · {cprRatio}
              {wkg > 0 ? ` · ${wkg} kg` : " · ⚠ no weight"}
            </div>
            {isPeds && ["iGel", "King LT", "ET Tube"].includes(airway) && (
              <div style={{ fontSize:9.5, color:"#86efac", marginTop:2, fontWeight:700 }}>
                ✓ {airway} placed → continuous CPR · 1 breath q2–3 sec (20–30/min)
              </div>
            )}
          </div>
        </div>
      )}

      {isPeds && (
        <PedsWeightInput
          wkg={wkg}
          setWkg={setWkg}
          setWlb={setWlb}
          patientType={patientType}
        />
      )}

      {/* TOP: What to do next */}
      <NextActionCard
        epiWarn={epiWarn} epiDue={epiDue} epiWindowOpen={epiWindowOpen} epiSecs={epiSecs}
        cycleRemain={cycleRemain} cycleEnded={cycleEnded}
        rhythm={rhythm} shockCount={shockCount} epiCount={epiCount}
        showAntiarrhythmic={showAntiarrhythmic} amioCount={amioCount}
        isPeds={isPeds} wkg={wkg} patientType={patientType}
        onGiveEpi={() => recordMed("epi")}
        onShock={() => setShowShockMenu(true)}
        onRhythmCheck={() => setShowRhythmMenu(true)}
        isDarkMode={isDarkMode}
      />

      {/* MASTER TIMERS */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
        <TimerCard
          label="Total Arrest"
          value={fmtArrestTime(totalSecs)}
          color="var(--c-text)"
          bg="var(--c-surface)"
          labelColor={subTxt}
        />
        <TimerCard
          label={cycleEnded ? "Rhythm Check DUE" : "CPR Cycle"}
          value={cycleEnded ? "NOW" : fmtArrestTime(cycleRemain)}
          color={cycleEnded ? "#f87171" : cycleRemain < 30 ? "#facc15" : ac("#4ade80","#15803d")}
          bg={cycleEnded ? ac("#2a0808","#fee2e2") : ac("#0a1a18","#d1fae5")}
          pulse={cycleEnded}
          labelColor={subTxt}
        />
      </div>

      {/* Epi timer strip */}
      {epiCount > 0 && (
        <div style={{
          background: epiDue ? ac("#2a0808","#fee2e2") : epiWarn ? ac("#1a1408","#fef9c3") : ac("#0a1018","#f1f5f9"),
          border: `1px solid ${epiDue ? ac("#7f1d1d","#dc2626") : epiWarn ? ac("#92400e","#d97706") : ac("#1a2540","#cbd5e1")}`,
          borderRadius:7, padding:"7px 10px", marginBottom:8,
          display:"flex", alignItems:"center", gap:8
        }}>
          <span style={{ fontSize:14 }}>💉</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color: epiDue ? ac("#fca5a5","#b91c1c") : epiWarn ? ac("#fcd34d","#a16207") : subTxt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>
              Epi #{epiCount} · {fmtClock(lastEpiTs)}
            </div>
            <div style={{ fontSize:10.5, color: epiDue ? ac("#fca5a5","#b91c1c") : subTxt, marginTop:1 }}>
              {epiDue ? "⚠ Re-dose overdue" : epiWarn ? "⚠ Window open (3–5 min)" : `Elapsed: ${fmtArrestTime(epiSecs)}`}
            </div>
          </div>
          <div style={{
            fontFamily:"'IBM Plex Mono',monospace", fontSize:14, fontWeight:700,
            color: epiDue ? "#f87171" : epiWarn ? "#facc15" : "#4ade80"
          }}>
            {fmtArrestTime(epiSecs)}
          </div>
        </div>
      )}

      {/* Branch indicator */}
      {rhythm && (
        <div style={{
          background: rhythm === "VF/pVT" ? ac("#1a0808","#fee2e2") : ac("#0a1428","#dbeafe"),
          border:`1px solid ${branchColor}44`, borderLeft:`3px solid ${branchColor}`,
          borderRadius:6, padding:"6px 10px", marginBottom:8,
          display:"flex", alignItems:"center", gap:8
        }}>
          <span style={{ fontSize:12 }}>{rhythm === "VF/pVT" ? "⚡" : "⊘"}</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color: branchColor, letterSpacing:"0.05em" }}>
            {rhythm} ALGORITHM
          </span>
          {airway && (
            <span style={{ marginLeft:"auto", fontSize:9.5, color:"#86efac", fontFamily:"'IBM Plex Mono',monospace" }}>
              🫁 {airway}
            </span>
          )}
        </div>
      )}

      {/* ACTION GRID */}
      {/* Access summary strip (if any successful access) */}
      {successfulAccess.length > 0 && (
        <div style={{ background: ac("#0a1a28","#eff6ff"), border:`1px solid ${ac("#1e3a8a55","#bfdbfe")}`, borderRadius:7, padding:"6px 10px", marginBottom:6, display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#60a5fa", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", flexShrink:0 }}>
            💧 Access:
          </span>
          {successfulAccess.map(a => (
            <span key={a.id} style={{
              background: a.type === "IO" ? "#1a0a28" : "#0d1f3a",
              border: `1px solid ${a.type === "IO" ? "#4c1d7c" : "#1e3a8a"}`,
              color: a.type === "IO" ? "#c084fc" : "#93c5fd",
              borderRadius:4, padding:"2px 7px",
              fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:600
            }}>
              ✓ {a.gauge}g {a.type} · {a.site}{a.who ? ` · ${a.who}` : ""}
            </span>
          ))}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
        <ActionBtn
          icon="🔍" label="Rhythm Check"
          sub={rhythm ? `Last: ${rhythm}` : "Set algorithm branch"}
          onClick={() => setShowRhythmMenu(true)}
          bg={ac("#0d1f3a","#dbeafe")} bd={ac("#1e3a8a","#2563eb")} fg={ac("#93c5fd","#1d4ed8")} big
          subColor={subTxt}
        />
        <ActionBtn
          icon="⚡" label={`Shock${shockCount > 0 ? ` #${shockCount+1}` : ""}`}
          sub={
            isPeds
              ? (wkg > 0
                  ? (() => {
                      const pe = pedsShockJoules(shockCount, wkg);
                      return pe ? `${pe.joules} J (${pe.perKg} J/kg${pe.capped ? ", capped" : ""})` : "Weight required";
                    })()
                  : "⚠ Weight required")
              : (shockCount > 0 ? `${shockCount} delivered` : "200/300/360 J")
          }
          onClick={() => setShowShockMenu(true)}
          bg={ac("#2a0808","#fee2e2")} bd={ac("#7f1d1d","#dc2626")} fg={ac("#fca5a5","#b91c1c")} big
          disabled={(rhythm && rhythm !== "VF/pVT") || (isPeds && wkg === 0)}
          subColor={subTxt}
        />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:6 }}>
        <ActionBtn
          icon="💉" label={`Epi${epiCount > 0 ? ` #${epiCount+1}` : ""}`}
          sub={
            isPeds
              ? (wkg > 0
                  ? `${Math.min(0.01 * wkg, 1).toFixed(2)} mg (${Math.min(0.1 * wkg, 10).toFixed(1)} mL) IV/IO`
                  : "⚠ Weight required")
              : "1 mg IV/IO"
          }
          onClick={() => {
            if (isPeds && wkg === 0) return;
            recordMed("epi");
          }}
          bg={isPeds && wkg === 0 ? ac("#0a0e1a","#fef3c7") : epiDue ? ac("#7f1d1d","#fee2e2") : epiWarn ? ac("#7c2d12","#ffedd5") : ac("#1a1208","#fef3c7")}
          bd={isPeds && wkg === 0 ? ac("#1a1208","#d97706") : epiDue ? "#ef4444" : epiWarn ? "#f97316" : ac("#7c2d12","#d97706")}
          fg={isPeds && wkg === 0 ? ac("#fcd34d","#a16207") : epiDue ? ac("#fff","#b91c1c") : epiWarn ? ac("#fff","#c2410c") : ac("#fdba74","#92400e")}
          big
          flash={epiDue && !(isPeds && wkg === 0)}
          disabled={isPeds && wkg === 0}
          subColor={subTxt}
        />
        <ActionBtn
          icon="💧" label={successfulAccess.length > 0 ? `Access ×${successfulAccess.length}` : "Access"}
          sub={successfulAccess.length > 0 ? "Add / fail" : "IV or IO"}
          onClick={() => setShowAccessMenu(true)}
          bg={ac("#0a1a28","#eff6ff")} bd={ac("#1e3a8a","#3b82f6")} fg={ac("#93c5fd","#1d4ed8")} big
          subColor={subTxt}
        />
        <ActionBtn
          icon="🫁" label={airway ? "Airway ✓" : "Airway"}
          sub={airway || "OPA / iGel / ET"}
          onClick={() => setShowAirwayMenu(true)}
          bg={ac("#0a2318","#dcfce7")} bd={ac("#14532d","#16a34a")} fg={ac("#86efac","#15803d")} big
          subColor={subTxt}
        />
      </div>

      {/* ALL ARREST DRUGS — consolidated menu */}
      <div style={{ background:"var(--c-surface)", border:`1px solid ${isPeds ? "#4c1d7c55" : "var(--c-border-sub)"}`, borderLeft:`3px solid ${isPeds ? "#a855f7" : "#1e3a8a"}`, borderRadius:7, marginBottom:6 }}>
        <button
          onClick={() => setShowDrugMenu(v => !v)}
          style={{
            width:"100%", padding:"10px 12px", background:"transparent", border:"none",
            cursor:"pointer", display:"flex", alignItems:"center", gap:8
          }}
        >
          <span style={{ fontSize:14 }}>💊</span>
          <span style={{ flex:1, textAlign:"left", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color: isPeds ? "#c084fc" : "#93c5fd", letterSpacing:"0.05em" }}>
            {isPeds ? `All Peds Arrest Drugs · PALS 2020` : `All Arrest Drugs · AHA Protocols`}
          </span>
          <span style={{ fontSize:10, color:"var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
            {DRUG_MENU.arrest.length + DRUG_MENU.peri.length + DRUG_MENU.postROSC.length}
          </span>
          <span style={{ color:"#3a4f70", fontSize:11, transform: showDrugMenu ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>▼</span>
        </button>
        {showDrugMenu && (
          <div style={{ borderTop:"1px solid #141e32", padding:"10px" }}>
            {/* Weight warning */}
            {isPeds && wkg === 0 && (
              <div style={{ background: ac("#1a1208","#fef3c7"), border:`1px solid ${ac("#92400e","#d97706")}`, borderRadius:6, padding:"7px 9px", marginBottom:8 }}>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color: ac("#fcd34d","#a16207"), fontWeight:700, marginBottom:2 }}>
                  ⚠ NO WEIGHT ENTERED
                </div>
                <div style={{ color: subTxt, fontSize:10.5, lineHeight:1.4 }}>
                  Weight-based drugs are disabled. Scroll to top of app and enter weight in kg to enable dosing.
                </div>
              </div>
            )}

            {/* Phase tabs */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4, marginBottom:10, background:"var(--c-deep)", border:"1px solid var(--c-border-sub)", borderRadius:7, padding:3 }}>
              {[
                ["arrest",   "Arrest",     ac("#fca5a5","#b91c1c"), ac("#2a0808","#fee2e2")],
                ["peri",     "Peri-arrest",ac("#fdba74","#92400e"), ac("#1a1208","#fef3c7")],
                ["postROSC", "Post-ROSC",  ac("#4ade80","#15803d"), ac("#071a0e","#dcfce7")],
              ].map(([k, l, fg, bg]) => (
                <button
                  key={k}
                  onClick={() => setDrugPhase(k)}
                  style={{
                    padding:"7px 0", borderRadius:5, border:"none", cursor:"pointer",
                    fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:700, letterSpacing:"0.04em",
                    background: drugPhase === k ? bg : "transparent",
                    color: drugPhase === k ? fg : "var(--c-text4)"
                  }}
                >
                  {l} ({DRUG_MENU[k].length})
                </button>
              ))}
            </div>

            {/* Drug buttons for current phase */}
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {DRUG_MENU[drugPhase].map(drug => {
                const count = events.filter(e => e.type === drug.eventType).length;
                const expanded = expandedDrug === drug.k;
                const calc = drug.wt && wkg > 0 ? calcArrestDose(drug, wkg) : null;

                // Weight-gate: drug needs weight but we don't have it
                const needsWeight = drug.wt && wkg === 0;

                // Max-dose tracking
                const cumInfo = getCumulative(drug, events, wkg);
                const maxReached = cumInfo.maxReached;

                // Volume override (e.g., D10 5 mL/kg, NS 20 mL/kg)
                const volumeDisplay = drug.volumeOverride && wkg > 0
                  ? drug.volumeOverride(wkg)
                  : calc?.mL ? `${calc.mL} mL` : drug.volume;

                // Display dose with all peds logic
                let displayDose;
                if (needsWeight) {
                  displayDose = "⚠ Weight required";
                } else if (drug.adaptiveDose) {
                  displayDose = drug.adaptiveDose(count, wkg);
                } else if (calc) {
                  displayDose = `${calc.display} ${calc.unit}${calc.capped ? " (MAX)" : ""}${calc.mL ? ` · ${calc.mL} mL` : ""}`;
                } else if (drug.volumeOverride && wkg > 0) {
                  displayDose = `${drug.dose} → ${drug.volumeOverride(wkg)}`;
                } else {
                  displayDose = drug.dose;
                }

                const disabled = needsWeight || maxReached;
                const hasDarkCardBg = maxReached || count > 0 || needsWeight;

                return (
                  <div key={drug.k} style={{
                    background: maxReached ? ac("#0a0f18","#fee2e2")
                              : count > 0 ? ac("#0a1420","#dcfce7")
                              : needsWeight ? ac("#0a0e1a","#fef3c7")
                              : "var(--c-input)",
                    border: `1px solid ${maxReached ? ac("#5a1010","#dc2626")
                                         : count > 0 ? ac("#14532d","#16a34a")
                                         : needsWeight ? ac("#1a1208","#d97706")
                                         : "var(--c-border)"}`,
                    borderRadius: 7,
                    overflow: "hidden",
                    opacity: disabled ? 0.55 : 1
                  }}>
                    <div style={{ display:"flex", alignItems:"stretch" }}>
                      <button
                        onClick={() => !disabled && recordMenuDrug(drug)}
                        disabled={disabled}
                        style={{
                          flex: 1, padding:"8px 10px", border:"none",
                          cursor: disabled ? "not-allowed" : "pointer",
                          background:"transparent", textAlign:"left",
                          display:"flex", alignItems:"center", gap:8
                        }}
                      >
                        <span style={{ fontSize:14, flexShrink:0, filter: disabled ? "grayscale(1)" : "none" }}>💉</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11.5, fontWeight:700, color: hasDarkCardBg ? "#e2e8f0" : "var(--c-text)" }}>
                              {drug.name}
                            </span>
                            {count > 0 && !maxReached && (
                              <span style={{ background:"#0f5a3a", color:"#4ade80", border:"1px solid #14532d", borderRadius:3, padding:"1px 5px", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
                                ✓ ×{count}
                              </span>
                            )}
                            {maxReached && (
                              <span style={{ background:"#5a1010", color:"#fca5a5", border:"1px solid #7f1d1d", borderRadius:3, padding:"1px 5px", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, letterSpacing:"0.04em" }}>
                                🛑 MAX REACHED
                              </span>
                            )}
                            {needsWeight && !maxReached && (
                              <span style={{ background:"#1a1208", color:"#fcd34d", border:"1px solid #92400e", borderRadius:3, padding:"1px 5px", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
                                ⚠ WT
                              </span>
                            )}
                          </div>
                          <div style={{ color: hasDarkCardBg ? "#8aa0c2" : "var(--c-text-sub)", fontSize:10, marginTop:1, lineHeight:1.3 }}>
                            {drug.sub}
                          </div>
                          <div style={{ fontFamily:"'IBM Plex Mono',monospace", color: needsWeight ? "#fcd34d" : maxReached ? "#fca5a5" : "#60a5fa", fontSize:10.5, marginTop:2, fontWeight:600 }}>
                            {displayDose}
                          </div>
                          {/* Cumulative progress bar */}
                          {cumInfo.maxCumulative && count > 0 && wkg > 0 && (
                            <div style={{ marginTop:4, fontSize:9, color: hasDarkCardBg ? "#8aa0c2" : "var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
                              Cumulative: {cumInfo.cumulative.toFixed(2)} / {cumInfo.maxCumulative.toFixed(1)} {drug.unit || "mg"}
                              <div style={{ marginTop:2, height:3, background:"var(--c-border)", borderRadius:2, overflow:"hidden" }}>
                                <div style={{
                                  width: `${Math.min(100, (cumInfo.cumulative / cumInfo.maxCumulative) * 100)}%`,
                                  height:"100%",
                                  background: maxReached ? "#ef4444" : cumInfo.cumulative / cumInfo.maxCumulative > 0.75 ? "#f59e0b" : "#4ade80"
                                }} />
                              </div>
                            </div>
                          )}
                          {cumInfo.maxDoses && count > 0 && !cumInfo.maxCumulative && (
                            <div style={{ marginTop:3, fontSize:9, color: hasDarkCardBg ? "#8aa0c2" : "var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
                              Dose {count} of {cumInfo.maxDoses} max
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => setExpandedDrug(expanded ? null : drug.k)}
                        style={{
                          width:30, background:"transparent", border:"none", borderLeft:"1px solid var(--c-border)",
                          cursor:"pointer", color:"#4a5a7a", fontSize:11,
                          fontFamily:"'IBM Plex Mono',monospace",
                          transform: expanded ? "rotate(180deg)" : "none", transition:"transform 0.2s"
                        }}
                      >▼</button>
                    </div>
                    {expanded && (
                      <div style={{ borderTop:"1px solid var(--c-border)", padding:"8px 11px", background:"var(--c-deep)" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 10px", marginBottom:6 }}>
                          <div>
                            <div style={{ color:"#4a5a7a", fontSize:9, textTransform:"uppercase", letterSpacing:"0.06em" }}>Dose</div>
                            <div style={{ color:"var(--c-text2)", fontSize:11 }}>{drug.dose}</div>
                          </div>
                          <div>
                            <div style={{ color:"#4a5a7a", fontSize:9, textTransform:"uppercase", letterSpacing:"0.06em" }}>Volume</div>
                            <div style={{ color:"var(--c-text2)", fontSize:11 }}>{volumeDisplay}</div>
                          </div>
                        </div>
                        {drug.notes && (
                          <div style={{ background:isDarkMode?"var(--c-surface)":"#111827", border:isDarkMode?"1px solid var(--c-border)":"2px solid #020617", borderRadius:5, padding:"8px 10px" }}>
                            <div style={{ color:isDarkMode?"#fcd34d":"#ffffff", fontSize:11.5, lineHeight:1.55, fontWeight:800 }}>
                              ⓘ {drug.notes}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Antiarrhythmic (conditional) */}
      {showAntiarrhythmic && (
        <div style={{ background:"var(--c-nav)", border:"1px dashed #1e3a8a", borderRadius:7, padding:"8px 10px", marginBottom:6 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9.5, color:"#93c5fd", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
            ⓘ 2+ shocks delivered · Antiarrhythmic indicated
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <ActionBtn
              icon="💉" label={amioCount === 0 ? "Amiodarone" : amioCount === 1 ? "Amio #2" : amioCount === 2 ? "Amio #3" : `Amio ×${amioCount}`}
              sub={
                isPeds
                  ? (wkg > 0
                      ? `${Math.min(5 * wkg, 300).toFixed(0)} mg (5 mg/kg) IVP`
                      : "⚠ Weight required")
                  : (amioCount === 0 ? "300 mg IVP" : "150 mg IVP")
              }
              onClick={() => recordMed("amio")}
              bg={ac("#0d1f3a","#dbeafe")} bd={ac("#1e3a8a","#2563eb")} fg={ac("#93c5fd","#1d4ed8")}
              subColor={subTxt}
              disabled={
                (isPeds && wkg === 0) ||
                (isPeds && amioCount >= 3) ||
                (!isPeds && amioCount >= 2)
              }
            />
            <ActionBtn
              icon="💉" label={`Lidocaine${lidoCount > 0 ? ` ×${lidoCount}` : ""}`}
              sub={
                isPeds
                  ? (wkg > 0 ? `${(1 * wkg).toFixed(0)} mg (1 mg/kg) IV/IO` : "⚠ Weight required")
                  : (wkg > 0 ? `${(1.5 * wkg).toFixed(0)} mg (1.5 mg/kg)` : "1–1.5 mg/kg")
              }
              onClick={() => recordMed("lido")}
              bg={ac("#0d1f3a","#dbeafe")} bd={ac("#1e3a8a","#2563eb")} fg={ac("#93c5fd","#1d4ed8")}
              subColor={subTxt}
              disabled={isPeds && wkg === 0}
            />
          </div>
        </div>
      )}

      {/* H's and T's toggle */}
      <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border-sub)", borderRadius:7, marginBottom:6 }}>
        <button
          onClick={() => setShowHT(v => !v)}
          style={{
            width:"100%", padding:"10px 12px", background:"transparent", border:"none",
            cursor:"pointer", display:"flex", alignItems:"center", gap:8
          }}
        >
          <span style={{ fontSize:14 }}>🔍</span>
          <span style={{ flex:1, textAlign:"left", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color:"#c084fc", letterSpacing:"0.05em" }}>
            H's & T's — Reversible Causes
          </span>
          <span style={{ fontSize:10, color:"var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
            {Object.values(hts).filter(Boolean).length}/{H_T_LIST.length}
          </span>
          <span style={{ color:"#3a4f70", fontSize:11, transform: showHT ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>▼</span>
        </button>
        {showHT && (
          <div style={{ borderTop:"1px solid #141e32", padding:"10px 12px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
              {H_T_LIST.map(item => {
                const addressed = !!hts[item.k];
                return (
                  <button
                    key={item.k}
                    onClick={() => toggleHT(item.k)}
                    style={{
                      padding:"6px 8px", borderRadius:5, cursor:"pointer", textAlign:"left",
                      background: addressed ? "#071a0e" : "var(--c-input)",
                      border:`1px solid ${addressed ? "#14532d" : "var(--c-border)"}`,
                      color: addressed ? "#4ade80" : "var(--c-text-sub)",
                      fontSize:10.5, fontFamily:"'DM Sans',sans-serif",
                      display:"flex", alignItems:"center", gap:5
                    }}
                  >
                    <span style={{
                      width:12, height:12, borderRadius:3, flexShrink:0,
                      background: addressed ? "#22c55e" : "transparent",
                      border:`1px solid ${addressed ? "#22c55e" : "#3a4f70"}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:9, color:"#071a0e", fontWeight:900
                    }}>{addressed ? "✓" : ""}</span>
                    <span style={{ lineHeight:1.2 }}>{item.l}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* END ARREST */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
        <button
          onClick={() => endArrest("ROSC")}
          style={{
            padding:"10px 0", borderRadius:7, cursor:"pointer",
            background:"#0a2318", border:"1px solid #14532d", color:"#4ade80",
            fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.05em"
          }}
        >
          ♥ ROSC Achieved
        </button>
        <button
          onClick={() => setConfirmEnd(true)}
          style={{
            padding:"10px 0", borderRadius:7, cursor:"pointer",
            background:"transparent", border:`1px solid ${ac("#1a2540","#cbd5e1")}`, color: subTxt,
            fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.05em"
          }}
        >
          ✕ Terminate
        </button>
      </div>

      {/* EVENT LOG */}
      <ArrestEventLog events={events} onDelete={deleteEvent} />

      {/* MODALS */}
      {showRhythmMenu && (
        <ArrestModal title="Rhythm Check" onClose={() => setShowRhythmMenu(false)}>
          <ModalBtn
            icon="⚡" label="VF / pVT"
            sub="Shockable — deliver shock → CPR"
            color="#fca5a5" bg="#2a0808" bd="#7f1d1d"
            onClick={() => recordRhythm("VF/pVT")}
          />
          <ModalBtn
            icon="⊘" label="PEA"
            sub="Non-shockable — CPR + Epi"
            color="#93c5fd" bg="#0d1f3a" bd="#1e3a8a"
            onClick={() => recordRhythm("PEA")}
          />
          <ModalBtn
            icon="━" label="Asystole"
            sub="Non-shockable — CPR + Epi · confirm in 2 leads"
            color="#94a3b8" bg="#1a2540" bd="#3a4f70"
            onClick={() => recordRhythm("Asystole")}
          />
          <div style={{ borderTop:"1px solid #1a2540", marginTop:6, paddingTop:6 }}>
            <ModalBtn
              icon="♥" label="Organized Rhythm + Pulse"
              sub="ROSC — exit arrest"
              color="#4ade80" bg="#071a0e" bd="#14532d"
              onClick={() => { setShowRhythmMenu(false); endArrest("ROSC"); }}
            />
          </div>
        </ArrestModal>
      )}

      {showShockMenu && (
        <ArrestModal title={`Shock #${shockCount + 1}${isPeds ? " · Pediatric" : ""}`} onClose={() => setShowShockMenu(false)}>
          {isPeds ? (
            wkg > 0 ? (() => {
              const pe = pedsShockJoules(shockCount, wkg);
              const recommended = pe?.joules;
              // Build peds options: recommended + adjacent for flexibility
              const opts = [
                { j: Math.round(2 * wkg), label: "2 J/kg", note: shockCount === 0 ? "RECOMMENDED · 1st shock" : "1st-shock dose" },
                { j: Math.round(4 * wkg), label: "4 J/kg", note: shockCount === 1 ? "RECOMMENDED · 2nd shock" : shockCount >= 2 ? "Continue" : "2nd shock dose" },
                { j: Math.round(Math.min(10 * wkg, 360)), label: `${Math.min(10 * wkg, 360) === 360 ? "360 J (max)" : "10 J/kg"}`, note: shockCount >= 2 ? "RECOMMENDED · Subsequent" : "Max peds dose (≥3rd shock)" },
              ];
              return (
                <>
                  <div style={{ background:"#1a0a28", border:"1px solid #4c1d7c", borderRadius:6, padding:"8px 10px", marginBottom:8 }}>
                    <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#c084fc", fontWeight:700, marginBottom:3 }}>
                      PALS Defib Energy · Weight: {wkg} kg
                    </div>
                    <div style={{ color:"#e9d5ff", fontSize:11, lineHeight:1.5 }}>
                      Recommended: <b style={{ fontFamily:"'IBM Plex Mono',monospace" }}>{recommended} J</b> ({pe.perKg} J/kg){pe.capped && " · capped at 360J"}
                    </div>
                  </div>
                  {opts.map((o, i) => (
                    <ModalBtn
                      key={i}
                      icon="⚡" label={`${o.j} J · ${o.label}`}
                      sub={o.note}
                      color={o.note.includes("RECOMMENDED") ? "#fff" : "#fca5a5"}
                      bg={o.note.includes("RECOMMENDED") ? "#7f1d1d" : "#2a0808"}
                      bd={o.note.includes("RECOMMENDED") ? "#ef4444" : "#7f1d1d"}
                      onClick={() => recordShock(o.j)}
                    />
                  ))}
                </>
              );
            })() : (
              <div style={{ color:"#fcd34d", fontSize:12, textAlign:"center", padding:"20px 10px", background:"#1a1208", border:"1px solid #92400e", borderRadius:7 }}>
                ⚠ Weight required for peds defibrillation<br/>
                <span style={{ fontSize:10, color:"var(--c-text3)", marginTop:6, display:"block", lineHeight:1.5 }}>
                  Enter patient weight in kg at top of app.<br/>
                  PALS: 2 J/kg → 4 J/kg → 4–10 J/kg
                </span>
              </div>
            )
          ) : (
            <>
              <div style={{ color:"var(--c-text4)", fontSize:10.5, padding:"4px 0 10px", textAlign:"center" }}>
                Biphasic · Escalating energy recommended
              </div>
              {[200, 300, 360].map(j => (
                <ModalBtn
                  key={j}
                  icon="⚡" label={`${j} J`}
                  sub={j === 200 ? "Initial dose" : j === 300 ? "2nd shock" : "3rd+ shock (max)"}
                  color="#fca5a5" bg="#2a0808" bd="#7f1d1d"
                  onClick={() => recordShock(j)}
                />
              ))}
            </>
          )}
        </ArrestModal>
      )}

      {showAirwayMenu && (
        <ArrestModal title="Airway Placed" onClose={() => setShowAirwayMenu(false)}>
          {["OPA/NPA", "BVM", "iGel", "King LT", "ET Tube"].map(a => (
            <ModalBtn
              key={a}
              icon="━" label={a}
              sub=""
              color="#86efac" bg="#0a2318" bd="#14532d"
              onClick={() => recordAirway(a)}
            />
          ))}
        </ArrestModal>
      )}

      {showAccessMenu && (
        <AccessAttemptModal
          onClose={() => setShowAccessMenu(false)}
          onSubmit={recordAccess}
          existingAttempts={access}
        />
      )}

      {confirmEnd && (
        <ArrestModal title="Terminate Resuscitation?" onClose={() => setConfirmEnd(false)}>
          <div style={{ color:"var(--c-text-sub)", fontSize:11.5, padding:"6px 0 12px", lineHeight:1.6 }}>
            Confirm with medical control per local protocol. This ends the arrest timer but preserves the event log for ePCR.
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <button onClick={() => setConfirmEnd(false)} style={{
              padding:"10px 0", borderRadius:6, cursor:"pointer",
              background:"transparent", border:"1px solid #1a2540", color:"var(--c-text-sub)",
              fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700
            }}>Cancel</button>
            <button onClick={() => endArrest("Terminated")} style={{
              padding:"10px 0", borderRadius:6, cursor:"pointer",
              background:"#1a1208", border:"1px solid #5a4020", color:"#c08040",
              fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.05em"
            }}>Confirm</button>
          </div>
        </ArrestModal>
      )}
    </div>
  );
}

/* ── Next-action guidance card ── */
function PedsWeightInput({ wkg, setWkg, setWlb, patientType }) {
  const [lbsInput, setLbsInput] = useState("");
  const accentColor = patientType === "infant" ? "#60a5fa" : "#a855f7";
  const kgFromLbs = lbsInput ? +(parseFloat(lbsInput) / 2.2046).toFixed(1) : null;
  const canSetWeight = kgFromLbs && kgFromLbs > 0;

  const handleSetWeight = () => {
    if (!canSetWeight) return;
    setWkg(kgFromLbs);
    setWlb(parseFloat(lbsInput));
    setLbsInput("");
  };

  return (
    <div style={{ background:"var(--c-surface)", border:`1px solid ${accentColor}`, borderRadius:8, padding:"9px 10px", marginBottom:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:7 }}>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:accentColor, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>
          Patient Weight
        </div>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:wkg > 0 ? "#4ade80" : "#f59e0b", fontWeight:700 }}>
          {wkg > 0 ? `${wkg} kg active` : "Required for peds dosing"}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <input
          type="number"
          min="0"
          step="0.5"
          value={lbsInput}
          onChange={e => setLbsInput(e.target.value)}
          placeholder="Enter lbs"
          style={{
            flex:1, padding:"9px 10px",
            background:"var(--c-input)", border:`1px solid ${accentColor}`,
            borderRadius:7, color:"var(--c-text)",
            fontSize:16, fontFamily:"'IBM Plex Mono',monospace",
            textAlign:"right", outline:"none"
          }}
        />
        <span style={{ color:"var(--c-text4)", fontSize:12 }}>lbs</span>
        <button
          onClick={handleSetWeight}
          disabled={!canSetWeight}
          style={{
            padding:"9px 14px", borderRadius:7,
            border:`1px solid ${accentColor}`,
            background: canSetWeight ? (patientType === "infant" ? "#0a2040" : "#2a1040") : "var(--c-input)",
            color: canSetWeight ? accentColor : "var(--c-text4)",
            cursor: canSetWeight ? "pointer" : "default",
            fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700,
            whiteSpace:"nowrap", minWidth:72
          }}
        >
          {canSetWeight ? `${kgFromLbs} kg` : "— kg"}
        </button>
      </div>
    </div>
  );
}

function NextActionCard({ epiWarn, epiDue, epiWindowOpen, epiSecs, cycleRemain, cycleEnded, rhythm, shockCount, epiCount, showAntiarrhythmic, amioCount, isPeds, wkg, patientType, isDarkMode=true }) {
  const a = (d, l) => isDarkMode ? d : l;
  const labelTxt = a("#8aa0c2", "#64748b");
  let msg, sub, color, bg, bd, icon;

  if (!rhythm) {
    msg = "Set Rhythm";
    sub = "Tap rhythm check to select ACLS branch";
    color = a("#93c5fd","#1d4ed8"); bg = a("#0d1f3a","#dbeafe"); bd = a("#1e3a8a","#2563eb"); icon = "🔍";
  } else if (cycleEnded) {
    msg = "Rhythm Check NOW";
    sub = "2-min CPR cycle complete";
    color = "#f87171"; bg = a("#2a0808","#fee2e2"); bd = "#ef4444"; icon = "⚠";
  } else if (epiDue) {
    msg = "Epi Overdue";
    sub = isPeds && wkg > 0
      ? `${fmtArrestTime(epiSecs)} elapsed · give ${Math.min(0.01 * wkg, 1).toFixed(2)} mg IV/IO`
      : `${fmtArrestTime(epiSecs)} elapsed · give 1 mg IV/IO`;
    color = "#f87171"; bg = a("#2a0808","#fee2e2"); bd = "#ef4444"; icon = "💉";
  } else if (epiCount === 0 && rhythm === "PEA/Asystole") {
    msg = isPeds && wkg > 0
      ? `Give Epi ${Math.min(0.01 * wkg, 1).toFixed(2)} mg`
      : "Give Epi 1 mg IV/IO";
    sub = "PEA/Asystole — give epi ASAP";
    color = a("#fdba74","#92400e"); bg = a("#1a1208","#fef3c7"); bd = a("#f97316","#d97706"); icon = "💉";
  } else if (showAntiarrhythmic && amioCount === 0) {
    msg = "Antiarrhythmic Indicated";
    sub = isPeds && wkg > 0
      ? `Amiodarone ${Math.min(5 * wkg, 300).toFixed(0)} mg (5 mg/kg) IVP`
      : "Amiodarone 300 mg IVP after 2nd shock";
    color = a("#93c5fd","#1d4ed8"); bg = a("#0d1f3a","#dbeafe"); bd = a("#1e3a8a","#2563eb"); icon = "💉";
  } else if (epiWarn) {
    msg = "Epi Window Open";
    sub = `3–5 min interval · ${fmtArrestTime(epiSecs)} elapsed`;
    color = a("#fcd34d","#a16207"); bg = a("#1a1408","#fef9c3"); bd = a("#f59e0b","#d97706"); icon = "💉";
  } else if (rhythm === "VF/pVT" && shockCount === 0) {
    msg = "Deliver Shock";
    sub = isPeds && wkg > 0 ? `VF/pVT — shock 2 J/kg (${Math.round(2 * wkg)} J)` : "VF/pVT — shock 200J biphasic";
    color = a("#fca5a5","#b91c1c"); bg = a("#2a0808","#fee2e2"); bd = a("#7f1d1d","#dc2626"); icon = "⚡";
  } else {
    msg = "CPR in Progress";
    sub = `Next rhythm check in ${fmtArrestTime(cycleRemain)}`;
    color = a("#4ade80","#15803d"); bg = a("#071a0e","#dcfce7"); bd = a("#14532d","#16a34a"); icon = "↻";
  }

  return (
    <div style={{
      background: bg, border:`2px solid ${bd}`, borderRadius:10,
      padding:"12px 14px", marginBottom:8,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:24 }}>{icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:labelTxt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em" }}>
            Next Action
          </div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:15, color, fontWeight:700, marginTop:2, letterSpacing:"-0.01em" }}>
            {msg}
          </div>
          <div style={{ color:labelTxt, fontSize:11, marginTop:2 }}>
            {sub}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimerCard({ label, value, color, bg, pulse, labelColor }) {
  return (
    <div style={{
      background: bg, border:`1px solid ${color}30`, borderRadius:8,
      padding:"9px 11px", textAlign:"center",
      animation: pulse ? "flash 1s ease-in-out infinite" : "none"
    }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color: labelColor || "#8aa0c2", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>
        {label}
      </div>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, color, fontWeight:700, lineHeight:1, letterSpacing:"-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, sub, onClick, bg, bd, fg, big, disabled, flash, subColor }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg, border:`1px solid ${bd}`, borderRadius:8,
        padding: big ? "12px 11px" : "9px 10px",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign:"left", display:"flex", alignItems:"center", gap:9,
        opacity: disabled ? 0.4 : 1,
        transition:"all 0.12s",
        animation: flash ? "flash 1s ease-in-out infinite" : "none"
      }}
    >
      <span style={{ fontSize: big ? 20 : 16, flexShrink:0 }}>{icon}</span>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize: big ? 12.5 : 11.5, fontWeight:700, color: fg, letterSpacing:"0.01em" }}>
          {label}
        </div>
        <div style={{ color: subColor || "#8aa0c2", fontSize: 10, marginTop:1, lineHeight:1.2 }}>
          {sub}
        </div>
      </div>
    </button>
  );
}

function SumStat({ label, value, color }) {
  const isNumeric = typeof value === "number";
  const sz = isNumeric ? 18 : 11;
  return (
    <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:7, padding:"8px 6px", textAlign:"center", minHeight:44, display:"flex", flexDirection:"column", justifyContent:"center" }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"var(--c-text4)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>
        {label}
      </div>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize: sz, color, fontWeight:700, lineHeight:1.1, wordBreak:"break-word" }}>
        {value}
      </div>
    </div>
  );
}

function ArrestEventLog({ events, onDelete }) {
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  if (events.length === 0) return null;

  return (
    <div style={{ background:"var(--c-input)", border:"1px solid var(--c-border-sub)", borderRadius:8 }}>
      <div style={{ padding:"8px 11px", borderBottom:"1px solid var(--c-border-sub)", display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"var(--c-text4)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
          Arrest Event Log · {events.length}
        </span>
      </div>
      <div style={{ maxHeight:320, overflowY:"auto" }}>
        {events.map(e => {
          const def = ARREST_EVENT_COLORS[e.type] || ARREST_EVENT_COLORS.note;
          const isPending = pendingDeleteId === e.id;
          return (
            <div key={e.id} style={{
              display:"flex", alignItems:"center", gap:9,
              padding:"8px 11px", borderBottom:"1px solid #0e1525",
              background: isPending ? "#1a0808" : "transparent"
            }}>
              <div style={{
                width:26, height:26, borderRadius:6, background: def.bg, color: def.fg,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                fontSize:12, fontWeight:700
              }}>{def.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:7 }}>
                  <span style={{ fontFamily:"'IBM Plex Mono',monospace", color:"var(--c-text)", fontSize:11.5, fontWeight:700 }}>
                    {fmtClock(e.ts)}
                  </span>
                  <span style={{ color: def.fg, fontSize:11, fontWeight:600 }}>
                    {def.label}
                  </span>
                </div>
                {e.detail && (
                  <div style={{ color:"var(--c-text-sub)", fontSize:10.5, marginTop:1, lineHeight:1.3 }}>
                    {e.detail}
                  </div>
                )}
              </div>
              {isPending ? (
                <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                  <button onClick={()=>{ onDelete(e.id); setPendingDeleteId(null); }} style={{ background:"#7f1d1d", border:"1px solid #991b1b", color:"#fef2f2", borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>Remove</button>
                  <button onClick={()=>setPendingDeleteId(null)} style={{ background:"transparent", border:"1px solid var(--c-border)", color:"var(--c-text-sub)", borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>Keep</button>
                </div>
              ) : (
                <button
                  onClick={() => setPendingDeleteId(e.id)}
                  style={{
                    background:"transparent", border:"1px solid var(--c-border)", color:"#4a5a7a",
                    borderRadius:4, padding:"3px 6px", cursor:"pointer", fontSize:10,
                    fontFamily:"'IBM Plex Mono',monospace", flexShrink:0
                  }}
                >✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArrestModal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:100,
      background:"rgba(0,0,0,0.7)", backdropFilter:"blur(3px)",
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      padding:"12px"
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:"100%", maxWidth:456,
        background:"var(--c-surface)", border:"1px solid #1a2540", borderRadius:12,
        padding:"14px", maxHeight:"85vh", overflowY:"auto"
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color:"var(--c-text)", fontWeight:700, letterSpacing:"0.02em" }}>
            {title}
          </span>
          <button onClick={onClose} style={{
            background:"transparent", border:"1px solid #1a2540", color:"var(--c-text4)",
            borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:11,
            fontFamily:"'IBM Plex Mono',monospace"
          }}>✕</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalBtn({ icon, label, sub, onClick, color, bg, bd }) {
  return (
    <button onClick={onClick} style={{
      background: bg, border:`1px solid ${bd}`, borderRadius:7,
      padding:"10px 11px", cursor:"pointer", textAlign:"left",
      display:"flex", alignItems:"center", gap:10
    }}>
      <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color, fontWeight:700, letterSpacing:"0.02em" }}>
          {label}
        </div>
        {sub && (
          <div style={{ color:"var(--c-text-sub)", fontSize:10.5, marginTop:1, lineHeight:1.3 }}>
            {sub}
          </div>
        )}
      </div>
    </button>
  );
}

/* ── Access attempt modal — IV or IO, site, gauge, who, success/fail ── */
function AccessAttemptModal({ onClose, onSubmit, existingAttempts }) {
  const [type, setType] = useState("IV");
  const [site, setSite] = useState("");
  const [gauge, setGauge] = useState(null);
  const [who, setWho] = useState("");

  const sites = type === "IV" ? IV_SITES : IO_SITES;
  const gauges = type === "IV" ? IV_GAUGES : IO_GAUGES;
  const gaugeUnit = type === "IV" ? "g" : "mm";

  // Reset site/gauge when type changes
  const switchType = (t) => {
    setType(t);
    setSite("");
    setGauge(null);
  };

  const canSubmit = site && gauge != null;

  const handleSuccess = () => {
    if (!canSubmit) return;
    onSubmit({ type, site, gauge, who: who.trim(), success: true });
  };
  const handleFail = () => {
    if (!canSubmit) return;
    onSubmit({ type, site, gauge, who: who.trim(), success: false });
  };

  return (
    <ArrestModal title="Vascular Access" onClose={onClose}>
      {/* Type toggle */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10 }}>
        {[
          ["IV", "💧 IV", "#93c5fd", "#0d1f3a", "#1e3a8a"],
          ["IO", "🦴 IO", "#c084fc", "#1a0a28", "#4c1d7c"]
        ].map(([k, l, fg, bg, bd]) => (
          <button
            key={k}
            onClick={() => switchType(k)}
            style={{
              padding:"10px 0", borderRadius:6, border:"1px solid " + (type === k ? bd : "var(--c-border)"),
              background: type === k ? bg : "transparent",
              color: type === k ? fg : "var(--c-text4)", cursor:"pointer",
              fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700, letterSpacing:"0.05em"
            }}
          >{l}</button>
        ))}
      </div>

      {/* Site */}
      <div style={{ marginBottom:10 }}>
        <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5, fontFamily:"'IBM Plex Mono',monospace" }}>
          Site
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
          {sites.map(s => (
            <button
              key={s}
              onClick={() => setSite(s)}
              style={{
                padding:"5px 10px", borderRadius:4, cursor:"pointer",
                background: site === s ? (type === "IV" ? "#0d1f3a" : "#1a0a28") : "var(--c-input)",
                border: `1px solid ${site === s ? (type === "IV" ? "#1e3a8a" : "#4c1d7c") : "var(--c-border)"}`,
                color: site === s ? (type === "IV" ? "#93c5fd" : "#c084fc") : "var(--c-text-sub)",
                fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:600
              }}
            >{s}</button>
          ))}
        </div>
      </div>

      {/* Gauge */}
      <div style={{ marginBottom:10 }}>
        <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5, fontFamily:"'IBM Plex Mono',monospace" }}>
          {type === "IV" ? "Gauge" : "Needle Length"}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
          {gauges.map(g => (
            <button
              key={g}
              onClick={() => setGauge(g)}
              style={{
                padding:"6px 12px", borderRadius:4, cursor:"pointer",
                background: gauge === g ? (type === "IV" ? "#0d1f3a" : "#1a0a28") : "var(--c-input)",
                border: `1px solid ${gauge === g ? (type === "IV" ? "#1e3a8a" : "#4c1d7c") : "var(--c-border)"}`,
                color: gauge === g ? (type === "IV" ? "#93c5fd" : "#c084fc") : "var(--c-text-sub)",
                fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700
              }}
            >{g}{gaugeUnit}</button>
          ))}
        </div>
      </div>

      {/* Who */}
      <div style={{ marginBottom:10 }}>
        <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5, fontFamily:"'IBM Plex Mono',monospace" }}>
          Who (optional)
        </div>
        <input
          type="text"
          value={who}
          onChange={e => setWho(e.target.value)}
          placeholder="e.g. Ryan · Medic Smith"
          style={{
            width:"100%", padding:"7px 10px", background:"var(--c-input)", border:"1px solid var(--c-border)",
            borderRadius:5, color:"var(--c-text2)", fontSize:12, fontFamily:"'DM Sans',sans-serif", outline:"none"
          }}
        />
      </div>

      {/* Previous attempts */}
      {existingAttempts.length > 0 && (
        <div style={{ background:"var(--c-deep)", border:"1px solid var(--c-border)", borderRadius:6, padding:"7px 9px", marginBottom:10 }}>
          <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4, fontFamily:"'IBM Plex Mono',monospace" }}>
            Previous attempts ({existingAttempts.length})
          </div>
          {existingAttempts.map(a => (
            <div key={a.id} style={{ fontSize:10.5, color: a.success ? "#86efac" : "#fca5a5", fontFamily:"'IBM Plex Mono',monospace", marginBottom:2 }}>
              {a.success ? "✓" : "✕"} {a.gauge}{a.type === "IV" ? "g" : "mm"} {a.type} · {a.site}{a.who ? ` · ${a.who}` : ""}
            </div>
          ))}
        </div>
      )}

      {/* Submit buttons */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
        <button
          onClick={handleFail}
          disabled={!canSubmit}
          style={{
            padding:"11px 0", borderRadius:6, cursor: canSubmit ? "pointer" : "not-allowed",
            background: canSubmit ? "#2a0808" : "var(--c-surface)",
            border: `1px solid ${canSubmit ? "#7f1d1d" : "var(--c-border)"}`,
            color: canSubmit ? "#fca5a5" : "#3a4f70",
            fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.04em",
            opacity: canSubmit ? 1 : 0.5
          }}
        >✕ Failed</button>
        <button
          onClick={handleSuccess}
          disabled={!canSubmit}
          style={{
            padding:"11px 0", borderRadius:6, cursor: canSubmit ? "pointer" : "not-allowed",
            background: canSubmit ? "#071a0e" : "var(--c-surface)",
            border: `1px solid ${canSubmit ? "#14532d" : "var(--c-border)"}`,
            color: canSubmit ? "#4ade80" : "#3a4f70",
            fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.04em",
            opacity: canSubmit ? 1 : 0.5
          }}
        >✓ Success</button>
      </div>
      {!canSubmit && (
        <div style={{ textAlign:"center", color:"#4a5a7a", fontSize:9.5, marginTop:6, fontFamily:"'IBM Plex Mono',monospace" }}>
          Select site and {type === "IV" ? "gauge" : "needle length"} to continue
        </div>
      )}
    </ArrestModal>
  );
}

/* �������������������������������������������������������
   MED LOG — chronological timestamp view of all given drugs
������������������������������������������������������� */
function MedLog({ adminLog, findDrugLocation, onJump, onClearAll, onResetDrug, wkg }) {
  const [confirmClear, setConfirmClear] = useState(false);
  // Flatten { drugName: { times: [t1,t2] } } into individual dose events
  const events = [];
  Object.entries(adminLog).forEach(([drugName, data]) => {
    data.times.forEach((ts, i) => {
      events.push({ drug: drugName, ts, doseNum: i + 1, total: data.times.length });
    });
  });
  events.sort((a, b) => b.ts - a.ts); // newest first

  const fmtTimeLog = ts => fmtTime(ts, false);

  const copyLog = () => {
    const text = events.slice().reverse().map(e =>
      `${fmtTimeLog(e.ts)}  ${e.drug}  (dose ${e.doseNum}/${e.total})`
    ).join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(()=>{});
    }
  };

  if (events.length === 0) {
    return (
      <div style={{ padding:"60px 20px", textAlign:"center", color:"var(--c-text4)" }}>
        <div style={{ fontSize:32, marginBottom:10, opacity:0.4 }}>⏱</div>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", color:"var(--c-text-sub)", fontSize:13, fontWeight:700, marginBottom:6 }}>No medications given yet</div>
        <div style={{ fontSize:11, color:"#3a4f70", lineHeight:1.6 }}>
          Open a drug → complete pre-check →<br/>tap <span style={{ color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace" }}>✓ MARK AS GIVEN</span>
        </div>
      </div>
    );
  }

  // Group events by drug for summary row
  const byDrug = {};
  events.forEach(e => {
    if (!byDrug[e.drug]) byDrug[e.drug] = { count: 0, last: 0, first: Infinity };
    byDrug[e.drug].count++;
    byDrug[e.drug].last = Math.max(byDrug[e.drug].last, e.ts);
    byDrug[e.drug].first = Math.min(byDrug[e.drug].first, e.ts);
  });

  return (
    <div style={{ paddingBottom:20 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700, color:"var(--c-text)" }}>Medication Log</div>
          <div style={{ color:"var(--c-text4)", fontSize:10, marginTop:1 }}>
            {events.length} dose{events.length!==1?"s":""} · {Object.keys(byDrug).length} drug{Object.keys(byDrug).length!==1?"s":""}
          </div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={copyLog} style={{ padding:"5px 10px", background:"#0d1f3a", border:"1px solid #1e3a8a", color:"#93c5fd", borderRadius:5, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>📋 Copy</button>
          {confirmClear ? (
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <span style={{ color:"#c08040", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>Clear all?</span>
              <button onClick={()=>{ onClearAll(); setConfirmClear(false); }} style={{ padding:"4px 8px", background:"#7c2d12", border:"1px solid #9a3412", color:"#fed7aa", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>Yes</button>
              <button onClick={()=>setConfirmClear(false)} style={{ padding:"4px 8px", background:"transparent", border:"1px solid var(--c-border)", color:"var(--c-text-sub)", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>No</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmClear(true)} style={{ padding:"5px 10px", background:"transparent", border:"1px solid #7a5a30", color:"#c08040", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>Clear All</button>
          )}
        </div>
      </div>

      {/* Drug summary pills */}
      <div style={{ background:"var(--c-input)", border:"1px solid var(--c-border-sub)", borderRadius:8, padding:"8px 10px", marginBottom:10 }}>
        <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>Summary</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {Object.entries(byDrug).map(([drug, info]) => (
            <button
              key={drug}
              onClick={() => onJump(drug)}
              style={{
                background:"var(--c-surface)", border:"1px solid var(--c-border)",
                borderRadius:5, padding:"3px 8px", cursor:"pointer",
                display:"flex", alignItems:"center", gap:5
              }}
            >
              <span style={{ color:"var(--c-text)", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>{drug}</span>
              <span style={{ color:"#fb923c", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>×{info.count}</span>
              <span style={{ color:"#4a5a7a", fontSize:9 }}>↗</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chronological list */}
      <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>
        Timeline (newest first)
      </div>
      {events.map((e, idx) => {
        const loc = findDrugLocation(e.drug);
        return (
          <div
            key={`${e.drug}-${e.ts}`}
            onClick={() => onJump(e.drug)}
            style={{
              background:"var(--c-surface)", borderLeft:"3px solid #fb923c",
              border:"1px solid var(--c-border)", borderRadius:8,
              marginBottom:6, padding:"9px 11px",
              cursor:"pointer", display:"flex", alignItems:"center", gap:10,
              transition:"border-color 0.12s"
            }}
            onMouseEnter={ev => ev.currentTarget.style.borderColor = "#fb923c"}
            onMouseLeave={ev => ev.currentTarget.style.borderColor = "var(--c-border)"}
          >
            <div style={{ flexShrink:0, textAlign:"center", minWidth:64 }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", color:"var(--c-text)", fontSize:13, fontWeight:700, lineHeight:1, letterSpacing:"-0.02em" }}>
                {fmtTimeLog(e.ts)}
              </div>
              <div style={{ fontSize:8, color:"#3a4f70", marginTop:2, fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                {loc ? (loc.mode === "adult" ? "ADULT" : "PEDS") : "—"}
              </div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12.5, fontWeight:700, color:"var(--c-text)" }}>
                {e.drug}
              </div>
              <div style={{ color:"var(--c-text4)", fontSize:10.5, marginTop:2 }}>
                Dose {e.doseNum} of {e.total}
                {wkg > 0 ? ` · ${wkg} kg` : ""}
              </div>
            </div>
            <div style={{
              background:"#1a1208", border:"1px solid #f9731640",
              color:"#fb923c", borderRadius:5, padding:"3px 7px",
              fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
              flexShrink:0
            }}>
              #{e.doseNum}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* �������������������������������������������������������
   ePCR GENERATOR — patient demographics + auto-filled
   medication log + vitals trends → copyable narrative
������������������������������������������������������� */
const CC_DRUG_MAP = {
  "Chest Pain / ACS":               { sys:"cardiac",      color:"#3b82f6", drugs:["Aspirin","Nitroglycerin","Morphine Sulfate"],                            hint:"12-lead ASAP. Screen SBP, RVI, and PDE-5 before nitro. Give aspirin early." },
  "Cardiac Arrest":                  { sys:"cardiac",      color:"#3b82f6", drugs:["Epinephrine 1:10,000","Amiodarone","Sodium Bicarbonate"],                 hint:"CPR + defibrillation first. Identify 4 H's and 4 T's. Epi q3–5 min." },
  "Symptomatic Bradycardia":         { sys:"cardiac",      color:"#3b82f6", drugs:["Atropine","Dopamine","Epinephrine 1:10,000"],                             hint:"Confirm symptoms. TCP if Atropine fails. Min 0.5 mg Atropine dose." },
  "Palpitations / SVT":              { sys:"cardiac",      color:"#3b82f6", drugs:["Adenosine","Atropine"],                                                   hint:"Confirm narrow-complex SVT on monitor. Adenosine via proximal IV with rapid flush." },
  "Syncope":                         { sys:"cardiac",      color:"#3b82f6", drugs:["Normal Saline (0.9% NaCl)"],                                              hint:"12-lead. BGL check. Consider cardiac, neuro, and orthostatic etiologies." },
  "Shortness of Breath":             { sys:"respiratory",  color:"#22c55e", drugs:["Albuterol","Ipratropium (Atrovent)","Nitroglycerin"],                     hint:"Auscultate — wheeze vs crackles. CPAP for pulmonary edema. SpO₂ target 94–99%." },
  "Asthma / Bronchospasm":           { sys:"respiratory",  color:"#22c55e", drugs:["Albuterol","Ipratropium (Atrovent)","Epinephrine 1:1,000"],               hint:"Continuous nebs in severe asthma. Epi 1:1,000 IM if life-threatening." },
  "COPD Exacerbation":               { sys:"respiratory",  color:"#22c55e", drugs:["Albuterol","Ipratropium (Atrovent)","Methylprednisolone"],                hint:"Titrate O₂ — avoid hyperoxia in COPD. CPAP if tolerated and SpO₂ <90%." },
  "Altered Mental Status":           { sys:"neuro",        color:"#a855f7", drugs:["Naloxone (Narcan)","Dextrose 50% (D50)","Thiamine (B1)"],                hint:"BGL first. Thiamine BEFORE dextrose in alcoholics. Narcan if opioid suspected." },
  "Seizure":                         { sys:"neuro",        color:"#a855f7", drugs:["Midazolam (Versed)","Lorazepam (Ativan)","Diazepam (Valium)"],           hint:"Time the seizure. Protect airway. Benzos for active / status seizure." },
  "Stroke / CVA":                    { sys:"neuro",        color:"#a855f7", drugs:["Dextrose 50% (D50)"],                                                    hint:"Last known well time is critical. FAST scale. BGL to rule out hypoglycemia stroke mimic." },
  "Diabetic Emergency / Hypoglycemia":{ sys:"metabolic",   color:"#f97316", drugs:["Oral Glucose (Glutose)","Dextrose 50% (D50)","Glucagon"],                hint:"Confirm BGL <60. Oral glucose if conscious and intact gag reflex. D50 IV or Glucagon IM if AMS." },
  "Allergic Reaction / Anaphylaxis": { sys:"anaphylaxis",  color:"#ef4444", drugs:["Epinephrine 1:1,000","Diphenhydramine (Benadryl)","Methylprednisolone"], hint:"Epi 1:1,000 IM lateral thigh is FIRST LINE — do not delay. Benadryl is adjunct only." },
  "Opioid Overdose":                 { sys:"neuro",        color:"#e11d48", drugs:["Naloxone (Narcan)"],                                                     hint:"Titrate Narcan to adequate respirations only — avoid precipitating acute withdrawal." },
  "Overdose / Poisoning":            { sys:"metabolic",    color:"#e11d48", drugs:["Naloxone (Narcan)","Activated Charcoal","Sodium Bicarbonate"],            hint:"Identify substance. Charcoal within 1 hr if airway intact. Bicarb for TCA OD." },
  "Trauma / Injury":                 { sys:"trauma",       color:"#f59e0b", drugs:["Tranexamic Acid (TXA)","Ketamine","Fentanyl"],                           hint:"MARCH — Massive hemorrhage, Airway, Respiration, Circulation, Hypothermia." },
  "Burns":                           { sys:"burns",        color:"#f59e0b", drugs:["Normal Saline / LR","Fentanyl","Morphine"],                              hint:"TBSA estimation. Parkland formula for fluids. Aggressive pain management." },
  "Hemorrhage / Bleeding":           { sys:"trauma",       color:"#f59e0b", drugs:["Tranexamic Acid (TXA)","Normal Saline / LR","Calcium Chloride 10%"],     hint:"Tourniquet / wound packing first. Permissive hypotension SBP 80–90 unless TBI." },
  "Pain (General)":                  { sys:"assess",       color:"#fbbf24", drugs:["Fentanyl","Morphine Sulfate","Ketorolac (Toradol)","Ketamine"],          hint:"Assess 0–10 scale, location, radiation, quality. Screen vitals before opioids." },
  "Abdominal Pain":                  { sys:"assess",       color:"#fbbf24", drugs:["Fentanyl","Ketorolac (Toradol)","Morphine Sulfate"],                     hint:"Pain management does not mask surgical abdomen — treat it. Monitor for rigidity." },
  "OB Emergency":                    { sys:"assess",       color:"#ec4899", drugs:["Magnesium Sulfate","Oxytocin (Pitocin)","Epinephrine 1:1,000"],          hint:"Check for crowning. Mag for eclampsia. Pitocin only AFTER placental delivery." },
  "Behavioral / Psychiatric Emergency":{ sys:"neuro",      color:"#8b5cf6", drugs:["Midazolam (Versed)","Haloperidol (Haldol)","Ketamine"],                  hint:"Excited delirium: ketamine preferred. Monitor temp and rhabdo. Avoid prone restraint." },
  "Fever / Sepsis":                  { sys:"metabolic",    color:"#f97316", drugs:["Normal Saline (0.9% NaCl)","Acetaminophen IV (Ofirmev)"],                hint:"30 mL/kg IV fluid if hypotensive. Temp >38.5°C + hypotension → sepsis protocol." },
};
const CC_OPTIONS = Object.keys(CC_DRUG_MAP);

function AiDisclaimerModal({ isDarkMode, onAccept, onCancel }) {
  const [ack, setAck] = useState(false);
  const t  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su = isDarkMode ? "#0a0d1a" : "#ffffff";
  const bd = isDarkMode ? "#1a2338" : "#d1d5db";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:10000}}>
      <div style={{width:"100%",maxWidth:480,background:su,borderRadius:"18px 18px 0 0",padding:"24px 20px 36px",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -20px 60px rgba(0,0,0,.6)"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:18}}>
          <span style={{fontSize:28,lineHeight:1}}>⚠️</span>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#a855f7",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Before You Continue</div>
            <div style={{fontSize:18,fontWeight:800,color:t,lineHeight:1.2}}>AI Documentation Disclaimer</div>
            <div style={{fontSize:12,color:mu,marginTop:4,lineHeight:1.5}}>Read carefully — this applies every time you use AI narrative generation.</div>
          </div>
        </div>

        {/* Disclaimer body */}
        <div style={{background:isDarkMode?"#060a14":"#f8fafc",border:`1px solid ${isDarkMode?"#1a2338":"#e2e8f0"}`,borderRadius:10,padding:"14px 16px",marginBottom:16,display:"flex",flexDirection:"column",gap:14}}>

          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#a855f7",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>1. For Documentation Assistance Only</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.65,margin:0}}>
              The AI Narrative Generator is a <strong style={{color:t}}>documentation drafting tool only</strong>. It is not a clinical decision-making system and must never be used to guide patient care, drug selection, dosing, or treatment. All clinical decisions remain your professional responsibility.
            </p>
          </div>

          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#f59e0b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>2. You Are Responsible for Every Word</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.65,margin:0}}>
              All AI-generated text <strong style={{color:t}}>must be reviewed, verified, and corrected</strong> before submission. You are solely responsible for the accuracy, completeness, and clinical correctness of any PCR submitted under your name or certification number. Do not submit an AI narrative you have not read.
            </p>
          </div>

          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#ef4444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>3. AI Can and Does Make Mistakes</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.65,margin:0}}>
              Artificial intelligence can generate <strong style={{color:t}}>inaccurate, incomplete, or clinically inappropriate content</strong> — including details that were never documented. Treat the output as a rough draft, not a finished report.
            </p>
          </div>

          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#38bdf8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>4. Your Call Data Leaves This Device</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.65,margin:0}}>
              To generate the narrative, de-identified call data — including age, sex, chief complaint, vitals, medications administered, and clinical notes — is transmitted to <strong style={{color:t}}>Anthropic's Claude API</strong> over an encrypted connection. Patient names are never recorded or transmitted by R.O.M.A.N. You are responsible for confirming this use complies with <strong style={{color:t}}>your agency's policies and HIPAA requirements</strong>.
            </p>
          </div>

          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#4ade80",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>5. Your Agency Protocols Govern</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.65,margin:0}}>
              This tool does not replace your agency's PCR requirements, standing orders, or medical director standards. Ensure all submitted documentation meets those requirements regardless of how it was drafted.
            </p>
          </div>

          <div style={{background:isDarkMode?"#1a0a00":"#fff7ed",border:"1px solid #f59e0b44",borderRadius:7,padding:"10px 12px"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#f59e0b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>6. Limitation of Liability</div>
            <p style={{fontSize:12,color:isDarkMode?"#94a3b8":"#78350f",lineHeight:1.65,margin:0}}>
              The developers of R.O.M.A.N. accept <strong style={{color:isDarkMode?"#fbbf24":"#92400e"}}>no liability</strong> for errors in AI-generated narratives, inaccuracies in submitted documentation, or any clinical or legal consequences arising from use of this feature. Full professional and legal responsibility for all patient care reports rests with the submitting provider.
            </p>
          </div>
        </div>

        {/* Acknowledgment checkbox */}
        <label style={{display:"flex",alignItems:"flex-start",gap:11,cursor:"pointer",userSelect:"none",marginBottom:16}}>
          <div onClick={()=>setAck(v=>!v)}
            style={{width:22,height:22,borderRadius:6,flexShrink:0,marginTop:1,border:`2px solid ${ack?"#a855f7":isDarkMode?"#2a3a54":"#9a9286"}`,background:ack?(isDarkMode?"#4c1d95":"#7c3aed"):"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",cursor:"pointer"}}>
            {ack&&<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{fontSize:12,color:t,lineHeight:1.6}}>
            I have read and understood this disclaimer. I acknowledge that AI-generated narratives require my review before submission, that call data is transmitted to a third-party AI service, and that I am solely responsible for the accuracy of any PCR I submit.
          </span>
        </label>

        {/* Action buttons */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button onClick={onCancel}
            style={{height:48,borderRadius:10,border:`1px solid ${bd}`,background:"transparent",color:mu,fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14,cursor:"pointer"}}>
            Cancel
          </button>
          <button onClick={ack?onAccept:undefined} disabled={!ack}
            style={{height:48,borderRadius:10,border:"none",background:ack?"linear-gradient(135deg,#581c87,#7c3aed)":"#1a2338",color:ack?"#e9d5ff":(isDarkMode?"#374151":"#9ca3af"),fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:14,cursor:ack?"pointer":"not-allowed",transition:"all 0.18s"}}>
            ✓ I Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}

// Speech-to-text hook using Web Speech API
function useSpeechInput(onResult) {
  const [listening, setListening] = useState(false);
  const recRef = React.useRef(null);
  const supported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const start = () => {
    if(!supported || listening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      const text = e.results[0][0].transcript;
      onResult(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const stop = () => {
    recRef.current?.stop();
    setListening(false);
  };

  return { listening, start, stop, supported };
}

function MicBtn({ onResult, isDarkMode }) {
  const { listening, start, stop, supported } = useSpeechInput(onResult);
  if(!supported) return null;
  return (
    <button
      onMouseDown={start} onTouchStart={start}
      onMouseUp={stop} onTouchEnd={stop}
      onClick={e=>e.preventDefault()}
      title={listening ? "Listening… release to stop" : "Hold to speak"}
      style={{flexShrink:0,width:34,height:34,borderRadius:8,border:`1px solid ${listening?"#ef4444":"#334155"}`,background:listening?(isDarkMode?"#2a0808":"#fee2e2"):(isDarkMode?"#0d1f3a":"#f1f5f9"),color:listening?"#ef4444":"#64748b",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,transition:"all 0.1s"}}>
      {listening ? "🔴" : "🎙"}
    </button>
  );
}

// These are module-scope so React never remounts them on parent re-render
function NarrQ({ label, required, hint, mu, isDarkMode, children }) {
  return (
    <div style={{marginBottom:18}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
        {label}{required&&<span style={{color:"#ef4444",marginLeft:3}}>*</span>}
      </div>
      {hint&&<div style={{fontSize:11,color:isDarkMode?"#475569":"#9ca3af",marginBottom:6,lineHeight:1.4}}>{hint}</div>}
      {children}
    </div>
  );
}

function NarrToggle({ options, value, onChange, color="#38bdf8", mu, bd }) {
  return (
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {options.map(([v,l])=>(
        <button key={v} onClick={()=>onChange(v===value?"":v)}
          style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${value===v?color:bd}`,background:value===v?`${color}20`:"transparent",color:value===v?color:mu,fontWeight:value===v?700:500,fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.1s"}}>
          {l}
        </button>
      ))}
    </div>
  );
}

function NarrTextIn({ value, onChange, placeholder, area, rows=2, bd, inp, t, isDarkMode }) {
  const s = {flex:1,padding:"10px 12px",borderRadius:8,border:`1px solid ${bd}`,background:inp,color:t,fontSize:13,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",outline:"none",lineHeight:1.5,minWidth:0,width:"100%"};
  const append = txt => onChange((value ? value + " " : "") + txt);
  return (
    <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
      {area
        ? <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{...s,resize:"none"}}/>
        : <input type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>
      }
      <MicBtn onResult={append} isDarkMode={isDarkMode}/>
    </div>
  );
}

function NarrativeSectionLabel({ label, bd, isDarkMode }) {
  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,color:isDarkMode?"#3a4f70":"#9ca3af",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:12,borderBottom:`1px solid ${bd}`,paddingBottom:6,marginTop:4}}>
      {label}
    </div>
  );
}

function NarrativeInterviewModal({ isDarkMode, patient, onGenerate, onCancel }) {
  const BLANK = { callType:"", scene:"", impression:"", findings:"", clinicalImpression:"", facility:"", receivingProvider:"", transportMode:"", conditionAtTransfer:"" };
  const [ans, setAns] = useState(BLANK);
  const set = (k,v) => setAns(p=>({...p,[k]:v}));
  const canGenerate = ans.callType && ans.scene.trim() && ans.impression.trim() && ans.clinicalImpression.trim();
  const t  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su = isDarkMode ? "#0a0d1a" : "#ffffff";
  const bd = isDarkMode ? "#1a2338" : "#d1d5db";
  const inp= isDarkMode ? "#060a14" : "#f9fafb";

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:10001}}>
      <div style={{width:"100%",maxWidth:480,background:su,borderRadius:"18px 18px 0 0",padding:"22px 18px 36px",maxHeight:"94vh",overflowY:"auto",boxShadow:"0 -20px 60px rgba(0,0,0,.6)"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#a855f7",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>AI Narrative</div>
            <div style={{fontSize:19,fontWeight:800,color:t}}>Narrative Interview</div>
          </div>
          <button onClick={onCancel} style={{background:"transparent",border:"none",color:mu,fontSize:22,cursor:"pointer",padding:"2px 6px"}}>✕</button>
        </div>
        <div style={{fontSize:12,color:mu,marginBottom:20,lineHeight:1.5}}>
          Answer these questions. R.O.M.A.N. combines your answers with chart data — no need to re-enter vitals, meds, or interventions. Hold 🎙 to speak any answer.
        </div>

        <NarrativeSectionLabel label="Scene" bd={bd} isDarkMode={isDarkMode}/>

        <NarrQ label="Call Type" required mu={mu} isDarkMode={isDarkMode}>
          <NarrToggle options={[["medical","🩺 Medical"],["trauma","🚨 Trauma"]]} value={ans.callType} onChange={v=>set("callType",v)} color="#38bdf8" mu={mu} bd={bd}/>
        </NarrQ>

        <NarrQ label="Scene / Mechanism" required mu={mu} isDarkMode={isDarkMode} hint="Where was the patient? What happened?">
          <NarrTextIn value={ans.scene} onChange={v=>set("scene",v)} placeholder="e.g. found seated in living room / restrained driver, front-end MVC ~35 mph" area rows={2} bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrativeSectionLabel label="Patient Presentation" bd={bd} isDarkMode={isDarkMode}/>

        <NarrQ label="General Impression on Arrival" required mu={mu} isDarkMode={isDarkMode} hint="What did you see walking up?">
          <NarrTextIn value={ans.impression} onChange={v=>set("impression",v)} placeholder="e.g. alert, anxious male sitting upright in tripod, visibly labored breathing" area rows={2} bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrQ label="Pertinent Exam Findings" mu={mu} isDarkMode={isDarkMode} hint="Key positives AND negatives — don't re-list vitals, those are in the chart.">
          <NarrTextIn value={ans.findings} onChange={v=>set("findings",v)} placeholder="e.g. diminished breath sounds bilaterally, JVD present, trachea midline, skin pale and diaphoretic, no peripheral edema" area rows={3} bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrativeSectionLabel label="Clinical Impression" bd={bd} isDarkMode={isDarkMode}/>

        <NarrQ label="Working Impression / Clinical Impression" required mu={mu} isDarkMode={isDarkMode} hint="Your assessment of what's going on.">
          <NarrTextIn value={ans.clinicalImpression} onChange={v=>set("clinicalImpression",v)} placeholder="e.g. suspected inferior STEMI / acute severe asthma exacerbation / hypovolemic shock" bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrativeSectionLabel label="Disposition" bd={bd} isDarkMode={isDarkMode}/>

        <NarrQ label="Receiving Facility" mu={mu} isDarkMode={isDarkMode}>
          <NarrTextIn value={ans.facility} onChange={v=>set("facility",v)} placeholder="e.g. Grady Memorial Hospital" bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrQ label="Receiving Provider" mu={mu} isDarkMode={isDarkMode}>
          <NarrTextIn value={ans.receivingProvider} onChange={v=>set("receivingProvider",v)} placeholder="e.g. RN Smith, Dr. Jones" bd={bd} inp={inp} t={t} isDarkMode={isDarkMode}/>
        </NarrQ>

        <NarrQ label="Transport Mode" mu={mu} isDarkMode={isDarkMode}>
          <NarrToggle options={[["Ground ALS","🚑 Ground ALS"],["Ground BLS","Ground BLS"],["Air Medical","🚁 Air Medical"],["Refused","Refused Transport"],["Treat & Release","Treat & Release"]]} value={ans.transportMode} onChange={v=>set("transportMode",v)} color="#4ade80" mu={mu} bd={bd}/>
        </NarrQ>

        <NarrQ label="Condition at Transfer" mu={mu} isDarkMode={isDarkMode}>
          <NarrToggle options={[["Improved","✅ Improved"],["Stable","Stable"],["Unchanged","Unchanged"],["Deteriorated","⚠ Deteriorated"],["N/A","N/A"]]} value={ans.conditionAtTransfer} onChange={v=>set("conditionAtTransfer",v)} color="#fb923c" mu={mu} bd={bd}/>
        </NarrQ>

        {!canGenerate&&(
          <div style={{fontSize:11,color:isDarkMode?"#475569":"#9ca3af",marginBottom:12,fontFamily:"'IBM Plex Mono',monospace"}}>
            * Complete required fields to generate
          </div>
        )}

        <button onClick={canGenerate?()=>onGenerate(ans):undefined} disabled={!canGenerate}
          style={{width:"100%",height:52,borderRadius:12,border:"none",background:canGenerate?"linear-gradient(135deg,#581c87,#7c3aed)":"#1a2338",color:canGenerate?"#e9d5ff":(isDarkMode?"#374151":"#9ca3af"),fontWeight:800,fontSize:16,cursor:canGenerate?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.02em",transition:"all 0.18s",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <span style={{fontSize:18}}>✨</span> Generate Narrative
        </button>
      </div>
    </div>
  );
}

function NarrativeScreen({ patient, setPatient, adminLog, vitalsEntries, wkg, wlb, mode, isDarkMode=true, onClearCall }) {
  const [aiNarrative, setAiNarrative] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);
  const [showAiDisclaimer, setShowAiDisclaimer] = useState(false);
  const [showNarrativeInterview, setShowNarrativeInterview] = useState(false);
  const upd = (k, v) => setPatient(p => ({...p, [k]: v}));
  const t  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su = isDarkMode ? "#0d1120" : "#ffffff";
  const bd = isDarkMode ? "#1a2338" : "#d1d5db";

  const runAiGeneration = async (interview) => {
    setShowNarrativeInterview(false);
    setAiLoading(true);
    setAiError("");
    setAiNarrative("");
    try {
      const res = await fetch("/api/narrative", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ patient, adminLog, vitalsEntries, wkg, wlb, mode, interview }),
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      setAiNarrative(data.narrative);
    } catch(err) {
      setAiError("Could not generate narrative. Check your connection and try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const startNarrativeFlow = () => {
    const alreadyAcked = localStorage.getItem("roman_ai_ack") === "1";
    if(alreadyAcked) { setShowNarrativeInterview(true); }
    else { setShowAiDisclaimer(true); }
  };

  const handleAiDisclaimerAccept = () => {
    localStorage.setItem("roman_ai_ack","1");
    setShowAiDisclaimer(false);
    setShowNarrativeInterview(true);
  };

  const copyAiNarrative = async () => {
    try {
      await navigator.clipboard.writeText(aiNarrative);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1800);
    } catch(e) {}
  };

  const doseCount = Object.values(adminLog).reduce((s, l) => s + l.times.length, 0);

  return (
    <div style={{paddingBottom:40}}>
      {showAiDisclaimer&&<AiDisclaimerModal isDarkMode={isDarkMode} onAccept={handleAiDisclaimerAccept} onCancel={()=>setShowAiDisclaimer(false)}/>}
      {showNarrativeInterview&&<NarrativeInterviewModal isDarkMode={isDarkMode} patient={patient} onGenerate={answers=>runAiGeneration(answers)} onCancel={()=>setShowNarrativeInterview(false)}/>}

      {/* Header */}
      <div style={{marginBottom:16}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:700,color:t}}>✨ AI Narrative</div>
        <div style={{fontSize:10,color:mu,marginTop:2}}>
          {doseCount} med{doseCount!==1?"s":""} · {vitalsEntries.length} vital set{vitalsEntries.length!==1?"s":""} · generate → copy → paste into agency ePCR
        </div>
      </div>

      {/* Patient Context */}
      <div style={{background:su,border:`1px solid ${bd}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>Patient Context</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Age</div>
            <input type="text" value={patient.age||""} onChange={e=>upd("age",e.target.value)} placeholder="e.g. 45"
              style={{width:"100%",background:"var(--c-input)",border:`1px solid ${bd}`,borderRadius:6,color:t,fontSize:13,padding:"8px 10px",outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Sex</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
              {["Male","Female"].map(s=>(
                <button key={s} onClick={()=>upd("sex",s)}
                  style={{padding:"9px 0",borderRadius:6,border:`1.5px solid ${patient.sex===s?"#60a5fa":bd}`,
                    background:patient.sex===s?(isDarkMode?"#0c2340":"#dbeafe"):"transparent",
                    color:patient.sex===s?"#60a5fa":mu,
                    fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Chief Complaint</div>
          <select value={patient.cc||""} onChange={e=>upd("cc",e.target.value)}
            style={{width:"100%",background:"var(--c-input)",border:`1px solid ${bd}`,borderRadius:6,
              color:patient.cc?t:mu,fontSize:13,padding:"8px 10px",outline:"none",
              fontFamily:"'DM Sans',sans-serif",appearance:"none",cursor:"pointer"}}>
            <option value="">— Select chief complaint —</option>
            {CC_OPTIONS.map(cc=>(<option key={cc} value={cc}>{cc}</option>))}
          </select>
        </div>
      </div>

      {/* AI Narrative generator */}
      <div style={{background:su,border:`1px solid ${isDarkMode?"#3b1d6e":"#c4b5fd"}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <span style={{fontSize:14}}>✨</span>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#a855f7",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>AI Narrative</span>
          <span style={{marginLeft:"auto",fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:isDarkMode?"#3a2a5a":"#9ca3af"}}>Powered by Claude</span>
        </div>
        {!aiNarrative&&!aiLoading&&(
          <button onClick={startNarrativeFlow}
            style={{width:"100%",height:48,borderRadius:8,border:"1px solid #7c3aed",background:"linear-gradient(135deg,#581c87,#4c1d95)",color:"#e9d5ff",fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <span style={{fontSize:16}}>✨</span> Generate AI Narrative
          </button>
        )}
        {aiLoading&&(
          <div style={{textAlign:"center",padding:"20px 0",color:"#a855f7",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
            Generating narrative…
          </div>
        )}
        {aiError&&(
          <div style={{background:isDarkMode?"#2a0808":"#fff1f2",border:"1px solid #fecaca",borderRadius:6,padding:"8px 10px",color:isDarkMode?"#fca5a5":"#991b1b",fontSize:11,marginBottom:8,lineHeight:1.5}}>
            {aiError}
          </div>
        )}
        {aiNarrative&&!aiLoading&&(
          <>
            <textarea value={aiNarrative} onChange={e=>setAiNarrative(e.target.value)}
              style={{width:"100%",minHeight:220,background:isDarkMode?"#060310":"#f9fafb",border:"1px solid #7c3aed44",borderRadius:6,color:isDarkMode?"#d4b8f8":"#1e1b4b",fontSize:11.5,fontFamily:"'DM Sans',sans-serif",lineHeight:1.65,padding:"10px 12px",resize:"vertical",outline:"none",boxSizing:"border-box",marginBottom:8}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              <button onClick={copyAiNarrative}
                style={{height:48,borderRadius:8,border:"1px solid #7c3aed",background:aiCopied?"#4ade80":"linear-gradient(135deg,#7c3aed,#a855f7)",color:aiCopied?"#052e16":"#fff",fontWeight:800,fontSize:14,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s"}}>
                {aiCopied?"✓ Copied!":"Copy Narrative"}
              </button>
              <button onClick={startNarrativeFlow}
                style={{height:48,borderRadius:8,border:`1px solid ${bd}`,background:"transparent",color:mu,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                Regenerate
              </button>
            </div>
            {onClearCall&&(
              <button onClick={onClearCall}
                style={{width:"100%",height:44,borderRadius:8,border:"1px solid #14532d",background:isDarkMode?"#071a0e":"#dcfce7",color:"#4ade80",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em"}}>
                ✓ Done — Clear & Ready for Next Call
              </button>
            )}
          </>
        )}
      </div>

      {/* Medications given */}
      {doseCount>0&&(
        <div style={{background:su,border:`1px solid ${bd}`,borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Medications Given</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(adminLog).map(([name,data])=>(
              <div key={name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--c-input)",borderRadius:7,padding:"8px 10px"}}>
                <span style={{fontSize:12,fontWeight:600,color:t}}>{name}</span>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:mu}}>
                  ×{data.times.length} · {new Date(data.times[0]).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vitals summary */}
      {vitalsEntries.length>0&&(
        <div style={{background:su,border:`1px solid ${bd}`,borderRadius:10,padding:14}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>
            Vitals ({vitalsEntries.length} set{vitalsEntries.length!==1?"s":""})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {vitalsEntries.slice().reverse().map((v,i)=>(
              <div key={i} style={{background:"var(--c-input)",borderRadius:7,padding:"8px 10px"}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:mu,marginBottom:4}}>
                  {new Date(v.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}{v.drugName?` · after ${v.drugName}`:""}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"4px 12px"}}>
                  {[["BP",v.sbp&&v.dbp?`${v.sbp}/${v.dbp}`:v.sbp||""],["HR",v.hr||""],["RR",v.rr||""],["SpO2",v.spo2?`${v.spo2}%`:""],["GCS",v.gcsTotal||""],["BGL",v.bgl?`${v.bgl} mg/dL`:""]].filter(([,val])=>val).map(([lbl,val])=>(
                    <span key={lbl} style={{fontSize:11,color:t}}><span style={{fontSize:9,color:mu,fontFamily:"'IBM Plex Mono',monospace"}}>{lbl} </span>{val}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ��� MAIN APP ��� */
const BURN_DEPTHS = [
  { label:"Clear", color:"rgba(148,163,184,0.10)", border:"rgba(148,163,184,0.38)" },
  { label:"1st", color:"rgba(248,113,113,0.48)", border:"#f87171" },
  { label:"2nd", color:"rgba(220,38,38,0.70)", border:"#ef4444" },
  { label:"3rd", color:"rgba(127,29,29,0.88)", border:"#991b1b" },
];

const BURN_REGIONS = {
  adult: [
    { id:"front-head", side:"front", name:"Head/neck front", pct:4.5, shape:"ellipse", x:104, y:34, rx:20, ry:24 },
    { id:"front-torso", side:"front", name:"Anterior trunk", pct:18, shape:"rect", x:78, y:72, w:52, h:92, r:18 },
    { id:"front-left-arm", side:"front", name:"Left arm front", pct:4.5, shape:"rect", x:49, y:78, w:22, h:89, r:12 },
    { id:"front-right-arm", side:"front", name:"Right arm front", pct:4.5, shape:"rect", x:137, y:78, w:22, h:89, r:12 },
    { id:"front-left-leg", side:"front", name:"Left leg front", pct:9, shape:"rect", x:82, y:166, w:21, h:111, r:12 },
    { id:"front-right-leg", side:"front", name:"Right leg front", pct:9, shape:"rect", x:106, y:166, w:21, h:111, r:12 },
    { id:"perineum", side:"front", name:"Perineum", pct:1, shape:"ellipse", x:104, y:166, rx:11, ry:8 },
    { id:"back-head", side:"back", name:"Head/neck back", pct:4.5, shape:"ellipse", x:104, y:34, rx:20, ry:24 },
    { id:"back-torso", side:"back", name:"Posterior trunk", pct:18, shape:"rect", x:78, y:72, w:52, h:92, r:18 },
    { id:"back-left-arm", side:"back", name:"Left arm back", pct:4.5, shape:"rect", x:49, y:78, w:22, h:89, r:12 },
    { id:"back-right-arm", side:"back", name:"Right arm back", pct:4.5, shape:"rect", x:137, y:78, w:22, h:89, r:12 },
    { id:"back-left-leg", side:"back", name:"Left leg back", pct:9, shape:"rect", x:82, y:166, w:21, h:111, r:12 },
    { id:"back-right-leg", side:"back", name:"Right leg back", pct:9, shape:"rect", x:106, y:166, w:21, h:111, r:12 },
  ],
  peds: [
    { id:"front-head", side:"front", name:"Head/neck front", pct:9, shape:"ellipse", x:104, y:37, rx:25, ry:29 },
    { id:"front-torso", side:"front", name:"Anterior trunk", pct:18, shape:"rect", x:78, y:78, w:52, h:88, r:18 },
    { id:"front-left-arm", side:"front", name:"Left arm front", pct:4.5, shape:"rect", x:50, y:84, w:21, h:83, r:12 },
    { id:"front-right-arm", side:"front", name:"Right arm front", pct:4.5, shape:"rect", x:137, y:84, w:21, h:83, r:12 },
    { id:"front-left-leg", side:"front", name:"Left leg front", pct:6.75, shape:"rect", x:82, y:168, w:21, h:99, r:12 },
    { id:"front-right-leg", side:"front", name:"Right leg front", pct:6.75, shape:"rect", x:106, y:168, w:21, h:99, r:12 },
    { id:"perineum", side:"front", name:"Perineum", pct:1, shape:"ellipse", x:104, y:168, rx:11, ry:8 },
    { id:"back-head", side:"back", name:"Head/neck back", pct:9, shape:"ellipse", x:104, y:37, rx:25, ry:29 },
    { id:"back-torso", side:"back", name:"Posterior trunk", pct:18, shape:"rect", x:78, y:78, w:52, h:88, r:18 },
    { id:"back-left-arm", side:"back", name:"Left arm back", pct:4.5, shape:"rect", x:50, y:84, w:21, h:83, r:12 },
    { id:"back-right-arm", side:"back", name:"Right arm back", pct:4.5, shape:"rect", x:137, y:84, w:21, h:83, r:12 },
    { id:"back-left-leg", side:"back", name:"Left leg back", pct:6.75, shape:"rect", x:82, y:168, w:21, h:99, r:12 },
    { id:"back-right-leg", side:"back", name:"Right leg back", pct:6.75, shape:"rect", x:106, y:168, w:21, h:99, r:12 },
  ],
};

function BurnMapFigure({ side, patientType, burnMap, onToggle, isDarkMode }) {
  const regions = BURN_REGIONS[patientType].filter(r => r.side === side);
  const skin = isDarkMode ? "#223049" : "#f3d6bd";
  const line = isDarkMode ? "#475569" : "#9a6f55";
  const label = side === "front" ? "Anterior" : "Posterior";
  return (
    <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:8}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,letterSpacing:"0.08em",color:"var(--c-text4)",textTransform:"uppercase",textAlign:"center",marginBottom:5}}>{label}</div>
      <svg viewBox="0 0 208 292" role="img" aria-label={`${label} burn body map`} style={{width:"100%",display:"block",touchAction:"manipulation"}}>
        <rect x="0" y="0" width="208" height="292" rx="10" fill={isDarkMode?"#090e1c":"#f8efe6"} />
        {regions.map(region => {
          const depth = burnMap[region.id] || 0;
          const tone = BURN_DEPTHS[depth];
          const fill = depth ? tone.color : skin;
          const stroke = depth ? tone.border : line;
          const common = {
            key: region.id,
            fill,
            stroke,
            strokeWidth: depth ? 2.8 : 1.6,
            opacity: 0.98,
            style: { cursor:"pointer", transition:"fill 0.15s, stroke 0.15s, stroke-width 0.15s" },
            onClick: () => onToggle(region.id),
          };
          return region.shape === "ellipse"
            ? <ellipse {...common} cx={region.x} cy={region.y} rx={region.rx} ry={region.ry}><title>{`${region.name}: ${region.pct}% - ${tone.label}`}</title></ellipse>
            : <rect {...common} x={region.x} y={region.y} width={region.w} height={region.h} rx={region.r}><title>{`${region.name}: ${region.pct}% - ${tone.label}`}</title></rect>;
        })}
        <path d="M78 78 C66 92 60 112 58 139" fill="none" stroke={line} strokeWidth="1" opacity=".65"/>
        <path d="M130 78 C143 92 149 112 151 139" fill="none" stroke={line} strokeWidth="1" opacity=".65"/>
        <path d="M91 166 L88 275" fill="none" stroke={line} strokeWidth="1" opacity=".55"/>
        <path d="M117 166 L120 275" fill="none" stroke={line} strokeWidth="1" opacity=".55"/>
      </svg>
    </div>
  );
}

const BURN_PROTOCOL_QUESTIONS = [
  { id:"inhalation", label:"Airway / inhalation concern", detail:"Facial burns, soot, hoarseness, enclosed-space smoke, stridor, or respiratory distress." },
  { id:"chemical", label:"Chemical exposure", detail:"Brush dry powder first, remove contaminated clothing, then irrigate per protocol." },
  { id:"electrical", label:"Electrical / lightning injury", detail:"Consider hidden injury, dysrhythmia risk, entry/exit wounds, and trauma from fall." },
  { id:"criticalArea", label:"Face, hands, feet, genitalia, perineum, or major joint", detail:"These locations usually need burn-center consultation." },
  { id:"circumferential", label:"Circumferential chest or extremity burn", detail:"Watch ventilation, distal pulses, sensation, cap refill, and swelling." },
  { id:"trauma", label:"Associated trauma or blast injury", detail:"Treat life threats and choose trauma vs burn destination by highest immediate risk." },
  { id:"pain", label:"Poorly controlled pain", detail:"Analgesia and burn-center consultation may be needed." },
  { id:"comorbidity", label:"High-risk age, pregnancy, or serious comorbidity", detail:"Comorbidities can increase burn risk and affect destination decisions." },
];

const PROTOCOL_SYSTEMS = [
  { id:"assess",     label:"Assessments", color:"#22d3ee", lightColor:"#0e7490" },
  { id:"burns",      label:"Burns",       color:"#ef4444", lightColor:"#b91c1c" },
  { id:"cardiac",    label:"Cardiac",     color:"#f87171", lightColor:"#dc2626" },
  { id:"respiratory",label:"Respiratory", color:"#60a5fa", lightColor:"#1d4ed8" },
  { id:"neuro",      label:"Neuro",       color:"#c084fc", lightColor:"#6d28d9" },
  { id:"trauma",     label:"Trauma",      color:"#f97316", lightColor:"#c2410c" },
  { id:"metabolic",  label:"Metabolic",   color:"#facc15", lightColor:"#854d0e" },
  { id:"anaphylaxis",label:"Anaphylaxis", color:"#fb923c", lightColor:"#c2410c" },
];

const PROTOCOL_DEFINITIONS = [
  {
    id:"burns",
    system:"burns",
    title:"Burn Protocol",
    sub:"TBSA, depth, airway, transfer triggers",
    special:"burns",
    scope:"EMT",
    patientType:"both",
  },
  {
    id:"acs",
    system:"cardiac",
    title:"Chest Pain / ACS",
    sub:"12-lead, aspirin, nitro screen, transport",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["stemi","STEMI or concerning 12-lead changes?"],
      ["hypotension","SBP less than protocol threshold or signs of shock?"],
      ["pde5","PDE-5 inhibitor use in the last 24-48 hours?"],
      ["aspirinAllergy","Aspirin / NSAID allergy or active bleeding concern?"],
    ],
    steps:[
      "Primary survey, cardiac monitor, pulse oximetry, full vitals, pain scale.",
      "Obtain and transmit 12-lead ECG early; repeat if symptoms change.",
      "Give oxygen only for hypoxemia, respiratory distress, or shock per protocol.",
      "Consider aspirin if not allergic and no contraindication.",
      "Consider nitroglycerin only after BP, RVI, and PDE-5 screening.",
      "Establish IV access when indicated and transport to appropriate cardiac-capable facility.",
    ],
    meds:["Aspirin","Nitroglycerin","Fentanyl","Morphine Sulfate"],
    triggers:["stemi","hypotension"],
  },
  {
    id:"bradycardia",
    system:"cardiac",
    title:"Symptomatic Bradycardia (Adult)",
    sub:"HR <60 with symptoms · atropine · TCP · dopamine/epi infusion",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["sympt","Bradycardia SYMPTOMATIC — hypotension, AMS, syncope, chest pain, or acute HF?"],
      ["avblock","Monitor shows Type II or 3rd-degree (complete) AV block?"],
      ["atropineFail","No improvement after atropine?"],
      ["tcp","Transcutaneous pacing unit available?"],
    ],
    steps:[
      "Confirm HR <60 on monitor. KEY: Is the bradycardia CAUSING symptoms? Asymptomatic bradycardia (athletes, sleep) — do NOT treat.",
      "Symptomatic signs: hypotension, AMS, syncope, chest pain, acute heart failure, hemodynamic instability.",
      "Atropine 0.5 mg IV/IO — repeat q3–5 min to max 3 mg total. Do NOT give <0.5 mg (paradoxical worsening risk).",
      "Type II or 3rd-degree AV block: Atropine typically ineffective — prepare TCP immediately. Do not delay pacing for multiple atropine attempts.",
      "Transcutaneous Pacing (TCP): Set rate 60–80 bpm, increase output mA until electrical AND mechanical capture confirmed. Verify capture by pulse palpation. Sedate/analgize conscious patient per protocol.",
      "No TCP or TCP fails: Dopamine 5–20 mcg/kg/min IV infusion OR Epinephrine 2–10 mcg/min IV infusion as bridge (Medic scope).",
      "Identify reversible causes: Hypoxia, hypothermia, hyperkalemia (peaked T-waves, wide QRS), inferior STEMI (AV blocks), vagal tone, beta-blocker/Ca-channel blocker toxicity.",
      "12-lead ECG. Continuous cardiac monitoring. Transport to cardiac-capable facility.",
    ],
    meds:["Atropine","Dopamine","Epinephrine 1:10,000"],
    triggers:["sympt","avblock"],
  },
  {
    id:"tachycardia-svt",
    system:"cardiac",
    title:"Tachycardia / SVT (Adult)",
    sub:"Narrow-complex SVT · wide-complex VT · synchronized cardioversion",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["unstable","Hemodynamically UNSTABLE — hypotension, AMS, chest pain, acute HF, or syncope?"],
      ["narrowSvt","Narrow-complex, regular tachycardia HR 150–220 bpm consistent with SVT?"],
      ["afib","Irregular narrow-complex — atrial fibrillation or flutter?"],
      ["wideComplex","Wide-complex tachycardia (QRS ≥0.12 sec)?"],
    ],
    steps:[
      "Assess hemodynamic stability FIRST. UNSTABLE (hypotension, AMS, ischemia, shock) = synchronized cardioversion immediately — sedate if alert per protocol.",
      "NARROW-COMPLEX STABLE SVT: Vagal maneuvers first — modified Valsalva (Trendelenburg + bear-down 15 sec); carotid sinus massage (one side only, no bruit).",
      "Adenosine 6 mg RAPID IV push via proximal antecubital site + 20 mL NS rapid flush immediately after. If no conversion in 1–2 min: 12 mg repeat dose. Confirm narrow-complex SVT before administering.",
      "WIDE-COMPLEX STABLE: Treat as ventricular tachycardia (VT) until proven otherwise. Amiodarone 150 mg IV over 10 min (Medic scope). Do NOT give adenosine for wide irregular (pre-excitation AF).",
      "UNSTABLE with pulse: Synchronized cardioversion. Initial energy: AFib 100–200 J, AFL/SVT 50–100 J, VT with pulse 100 J (biphasic). Sedate conscious patient per protocol.",
      "Atrial fibrillation / flutter: Do NOT give adenosine. Prehospital rate-control pharmacology not typically indicated — monitor and transport.",
      "12-lead ECG. IV access. Continuous monitoring. Transport to cardiac-capable facility.",
    ],
    meds:["Adenosine","Amiodarone","Lidocaine"],
    triggers:["unstable","narrowSvt","wideComplex"],
  },
  {
    id:"heart-failure",
    system:"cardiac",
    title:"Acute Heart Failure / Pulmonary Edema",
    sub:"Upright position · CPAP · nitrates · avoid fluids",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["crackles","Bilateral crackles on auscultation with respiratory distress?"],
      ["sbpOk","SBP ≥100 mmHg (safe for nitrates)?"],
      ["pde5Use","PDE-5 inhibitor use (Viagra/Cialis/Levitra) in last 48 hours?"],
      ["hypotension","SBP <90 mmHg or cardiogenic shock signs?"],
    ],
    steps:[
      "POSITION: Sit upright, legs dependent — reduces preload, improves ventilation. DO NOT lay flat.",
      "High-flow oxygen; SpO₂ monitoring. Early CPAP 5–10 cm H₂O for awake patient with SBP ≥90 — reduces WOB, improves oxygenation, decreases preload and afterload.",
      "12-lead ECG: identify STEMI, bundle branch block, rate/rhythm trigger. Many AHF presentations are precipitated by ACS or dysrhythmia.",
      "Nitroglycerin 0.4 mg SL q3–5 min if SBP ≥100 AND no PDE-5 inhibitor use within 48 hrs — potent venodilator, rapidly reduces preload and afterload.",
      "CARDIOGENIC SHOCK (SBP <90, poor perfusion, crackles): Fluids are CONTRAINDICATED — worsen pulmonary edema. Dopamine 5–20 mcg/kg/min IV infusion for hemodynamic support (Medic scope) — use cautiously.",
      "Do NOT administer IV fluid challenge unless clearly volume-depleted AND no signs of pulmonary edema.",
      "Furosemide (Lasix) IV per local protocol (Medic scope) — venodilatory effect begins before diuresis. Avoid if volume-depleted.",
      "Priority transport to cardiac-capable facility. Maintain CPAP during transport. Pre-notify for advanced heart failure management.",
    ],
    meds:["Nitroglycerin","Furosemide (Lasix)","Dopamine","Aspirin"],
    triggers:["crackles","hypotension"],
  },
  {
    id:"resp-distress",
    system:"respiratory",
    title:"Respiratory Distress",
    sub:"Oxygen, bronchodilator, CPAP, airway escalation",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["severe","Severe distress, exhaustion, cyanosis, or altered mental status?"],
      ["wheezing","Wheezing or diminished bronchospastic lung sounds?"],
      ["pulmonaryEdema","Rales with suspected pulmonary edema / CHF?"],
      ["hypotension","Hypotension or poor perfusion?"],
    ],
    steps:[
      "Position of comfort, assess work of breathing, lung sounds, SpO2, EtCO2 if available.",
      "Apply oxygen and titrate to local protocol goals.",
      "Assist ventilations or prepare advanced airway if mental status or ventilation fails.",
      "Use bronchodilator pathway for wheezing/bronchospasm.",
      "Consider CPAP for appropriate awake patients with respiratory failure and adequate BP.",
      "Reassess breath sounds, SpO2, EtCO2, and fatigue after each intervention.",
    ],
    meds:["Albuterol","Ipratropium (Atrovent)","Epinephrine 1:1,000","Epi 1:1,000 (Neb)","Magnesium Sulfate"],
    triggers:["severe","hypotension"],
  },
  {
    id:"stroke",
    system:"neuro",
    title:"Suspected Stroke",
    sub:"Last known well, stroke scale, glucose, destination",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["positiveScale","Positive stroke scale or new focal neuro deficit?"],
      ["lvo","Large vessel occlusion screen positive?"],
      ["hypoglycemia","BGL low or unable to rule out glucose cause?"],
      ["timeWindow","Last known well within local stroke-alert window?"],
    ],
    steps:[
      "Primary survey and rapid neuro assessment; determine last known well time.",
      "Check blood glucose and correct hypoglycemia per protocol.",
      "Perform local stroke scale and LVO screen if used by system.",
      "Minimize scene time; notify receiving facility early with stroke alert criteria.",
      "Document deficits, anticoagulants, baseline status, and serial neuro checks.",
    ],
    meds:["Dextrose 50% (D50)","Dextrose 25% (D25)","Oral Glucose"],
    triggers:["positiveScale","lvo","timeWindow"],
  },
  {
    id:"peds-stroke",
    system:"neuro",
    title:"Pediatric Stroke",
    sub:"Rare but critical · focal deficit · BGL · last known well time",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["focalDeficit","Sudden focal neurological deficit — facial droop, arm drift, speech change, or one-sided weakness?"],
      ["lowBgl","BGL low or unable to rule out glucose as cause?"],
      ["seizure","Seizure at onset or after — possible Todd's paralysis mimic?"],
      ["alteredMS","Sudden severe headache, altered mental status, or sudden vision change?"],
    ],
    steps:[
      "Pediatric stroke is rare but occurs across all ages. THINK STROKE in any child with sudden focal neurological deficit — even with concurrent seizure (do not assume Todd's paralysis without ruling out stroke).",
      "Establish Last Known Well (LKW) time. Thrombectomy and thrombolytic time windows apply to children — accurate LKW is critical.",
      "BGL IMMEDIATELY — hypoglycemia is the most common stroke mimic in all ages. Treat if BGL below threshold: D25 2–4 mL/kg IV/IO (child) or D10 2 mL/kg IV/IO (neonate/infant).",
      "Pediatric stroke signs: Sudden unilateral weakness/paralysis, facial droop, speech difficulty, gaze deviation, ataxia, sudden severe headache. Infants: seizure, AMS, sudden irritability, poor feeding.",
      "DO NOT aggressively stimulate or handle roughly. Keep head midline, slightly elevated 30° — reduces ICP.",
      "SICKLE CELL DISEASE + FOCAL DEFICIT: Extremely high concern for stroke — priority transport to sickle cell-capable center. Exchange transfusion required.",
      "Other peds stroke causes: AVM/vascular malformation, congenital heart disease, arterial dissection (trauma, chiropractic), inherited coagulopathy.",
      "Priority transport to pediatric stroke center or children's hospital. Pre-notify with pediatric stroke alert. Minimize scene time.",
    ],
    meds:["Dextrose 25% (D25)","Dextrose 10% (D10)"],
    triggers:["focalDeficit","lowBgl","alteredMS"],
  },
  {
    id:"seizure",
    system:"neuro",
    title:"Seizure",
    sub:"Active seizure, glucose, airway, benzodiazepine",
    scope:"Medic",
    patientType:"both",
    questions:[
      ["active","Active seizure or recurrent seizures without recovery?"],
      ["airway","Airway compromise or hypoxia?"],
      ["pregnant","Pregnant / eclampsia concern?"],
      ["trauma","Trauma, overdose, or fever concern?"],
    ],
    steps:[
      "Protect from injury; do not restrain or place objects in mouth.",
      "Manage airway, suction as needed, oxygen/ventilation support per assessment.",
      "Check blood glucose and treat hypoglycemia.",
      "For active or recurrent seizure, give benzodiazepine per protocol.",
      "Consider eclampsia, overdose, head injury, fever, or infection as cause.",
      "Reassess respiratory status closely after sedating medications.",
    ],
    meds:["Midazolam (Versed)","Diazepam (Valium)","Lorazepam (Ativan)","Dextrose 50% (D50)","Magnesium Sulfate"],
    triggers:["active","airway","pregnant"],
  },
  {
    id:"ams",
    system:"neuro",
    title:"Altered Mental Status (Adult)",
    sub:"BGL first · AEIOU-TIPS · airway priority · naloxone",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["lowBgl","BGL below treatment threshold or unable to obtain?"],
      ["opioidSigns","Miosis, RR <12, or opioid/sedative toxidrome suspected?"],
      ["headTrauma","Head trauma, fall, or signs of head injury?"],
      ["fever","Fever, stiff neck, or signs of infection/meningitis?"],
      ["postictal","History of seizure disorder or recent seizure activity?"],
    ],
    steps:[
      "AIRWAY IS PRIORITY — AMS patients may not protect their airway. Position lateral if no trauma suspected; suction available; monitor breathing continuously.",
      "BGL FIRST — always. Hypoglycemia is the most immediately reversible cause of AMS. Treat if BGL below local threshold (typically <60–70 mg/dL).",
      "AEIOU-TIPS: Alcohol/Acidosis, Epilepsy/Electrolytes, Insulin, Opioids/Overdose, Uremia, Trauma/Toxins, Infection, Psychiatric, Stroke/Shock.",
      "Opioid toxidrome (miosis, RR <12, unresponsive): Naloxone 0.4–2 mg IV/IO/IM/IN. Titrate to adequate respirations — goal is breathing, not full awakening.",
      "Suspected Wernicke's encephalopathy (chronic alcohol use + AMS + nystagmus/ataxia): Thiamine 100 mg IV/IM BEFORE any dextrose.",
      "Sudden onset AMS + focal deficit: Stroke until proven otherwise — fast transport, minimize on-scene interventions.",
      "Fever + severe headache + stiff neck + AMS: Meningitis/encephalitis concern — minimize stimulation, priority transport, do not delay.",
      "Document serial GCS. Transport ALL AMS patients — even if improved. AMS that resolves may recur.",
    ],
    meds:["Naloxone (Narcan)","Dextrose 50% (D50)","Thiamine (B1)"],
    triggers:["lowBgl","opioidSigns","headTrauma"],
  },
  {
    id:"peds-ams",
    system:"neuro",
    title:"Pediatric Altered Mental Status",
    sub:"BGL · ingestion · infection · trauma · AVPU scale",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["lowBgl","BGL below treatment threshold or not yet checked?"],
      ["ingestion","Possible accidental ingestion or poisoning?"],
      ["fever","Fever present or recent febrile illness?"],
      ["headTrauma","Head trauma, fall, or suspected non-accidental trauma?"],
      ["opioidSigns","Respiratory depression, miosis, or opioid/sedative toxidrome?"],
    ],
    steps:[
      "AIRWAY FIRST — peds AMS patients lose airway protective reflexes rapidly. Position, suction, and support ventilation as needed.",
      "Use AVPU (Alert/Voice/Pain/Unresponsive) or Pediatric GCS for serial neurological assessment. Document and trend any changes.",
      "BGL FIRST — hypoglycemia is a common and rapidly reversible cause. D10 at 2 mL/kg IV/IO (neonate/infant); D25 at 2–4 mL/kg IV/IO (child).",
      "Accidental ingestion: A leading peds emergency. Common dangerous substances: button batteries, iron, laundry pods, grandparent medications (beta-blockers, Ca-channel blockers, opioids, digoxin). Identify substance and bring to hospital.",
      "Opioid/sedative toxidrome (slow breathing, pinpoint pupils, decreased tone): Naloxone 0.01 mg/kg IV/IO or 0.1 mg/kg IN (max 2 mg) — titrate to respiratory effort.",
      "Fever + AMS: Consider meningitis/encephalitis (stiff neck, photophobia, petechial rash), sepsis, febrile seizure with postictal state. Priority transport.",
      "HEAD TRAUMA and NON-ACCIDENTAL TRAUMA (NAT): Inconsistent history, atypical bruising, bilateral long-bone fractures in non-ambulatory children — mandatory reporter obligations apply.",
      "IV/IO access. Continuous monitoring. Priority transport to pediatric-capable facility.",
    ],
    meds:["Naloxone (Narcan)","Dextrose 25% (D25)","Dextrose 10% (D10)"],
    triggers:["lowBgl","ingestion","opioidSigns"],
  },
  {
    id:"trauma-shock",
    system:"trauma",
    title:"Trauma / Shock",
    sub:"MARCH, bleeding control, TXA screen, destination",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["majorBleed","Life-threatening external bleeding?"],
      ["shock","Signs of shock or poor perfusion?"],
      ["chestInjury","Chest injury or respiratory compromise?"],
      ["txaWindow","Major hemorrhage within TXA time window?"],
    ],
    steps:[
      "MARCH assessment: massive bleeding, airway, respirations, circulation, hypothermia/head injury.",
      "Control major hemorrhage with direct pressure, packing, tourniquet, or hemostatic dressing per protocol.",
      "Manage airway and breathing; seal open chest wounds and monitor for tension physiology.",
      "Establish vascular access when indicated; use permissive hypotension guidance per local protocol.",
      "Screen for TXA if significant hemorrhage and within protocol time window.",
      "Transport to appropriate trauma center with early notification.",
    ],
    meds:["Tranexamic Acid (TXA)","Fentanyl","Ketamine","Normal Saline (0.9% NaCl)","Normal Saline / LR"],
    triggers:["majorBleed","shock","chestInjury"],
  },
  {
    id:"peds-trauma",
    system:"trauma",
    title:"Pediatric Trauma",
    sub:"Age-specific vitals · IO access · weight-based fluids · NAT awareness",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["majorBleed","Life-threatening external hemorrhage?"],
      ["mechanism","High-energy mechanism — MVC, fall >10 ft/3× height, GSW, or assault?"],
      ["headInjury","Suspected head injury — AMS, LOC, scalp laceration, or persistent vomiting?"],
      ["weightKnown","Weight known? (required for weight-based fluid dosing)"],
      ["nat","Mechanism inconsistent with developmental stage, unusual bruising, or delayed presentation?"],
    ],
    steps:[
      "Primary survey — MARCH: Massive hemorrhage, Airway, Respirations, Circulation, Hypothermia/Head injury. Children compensate well, then CRASH suddenly — do not wait for hypotension to act.",
      "AGE-APPROPRIATE VITAL THRESHOLDS: Infant (<1 yr): HR 100–160, SBP ≥60. Toddler (1–3 yr): HR 90–150, SBP ≥70. Preschool (3–5): HR 80–140, SBP ≥75. School-age (6–12): HR 70–120, SBP ≥80. Teen (>12): HR 60–100, SBP ≥90.",
      "HEMORRHAGE CONTROL: Direct pressure, wound packing, tourniquet for extremity hemorrhage — same principles as adults. Children tolerate proportionally LESS blood loss.",
      "VASCULAR ACCESS: IO preferred when IV difficult under critical conditions. All IO sites valid in peds — tibial, humeral, sternal (>12 yr). Provides immediate access in all ages.",
      "FLUID RESUSCITATION: 20 mL/kg NS or LR IV/IO bolus. Reassess after each bolus. Permissive hypotension is NOT recommended in isolated pediatric TBI — maintain age-appropriate SBP to perfuse the brain.",
      "HEAD INJURY: Peds brain injury common due to large head:body ratio. Avoid hypotension AND hypoxia — both independently worsen TBI outcomes. GCS <13 = severe TBI. Prevent secondary injury.",
      "HYPOTHERMIA PREVENTION: Children lose heat rapidly — uncover only as needed, cover exposed areas, warm fluids if available, warm transport environment.",
      "NON-ACCIDENTAL TRAUMA (NAT): Inconsistent mechanism, delay in seeking care, patterned bruising, bilateral long-bone fractures in non-ambulatory child — mandatory reporter obligation. Transport all peds trauma.",
    ],
    meds:["Normal Saline (0.9% NaCl)","Normal Saline (Trauma Resus)","Tranexamic Acid (TXA)","Fentanyl","Ketamine","Morphine"],
    triggers:["majorBleed","headInjury","mechanism"],
  },
  {
    id:"hypoglycemia",
    system:"metabolic",
    title:"Hypoglycemia",
    sub:"BGL, mental status, oral vs IV/IO/IM therapy",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["lowBgl","BGL below local treatment threshold?"],
      ["canSwallow","Awake and able to swallow safely?"],
      ["noAccess","No IV/IO access available?"],
      ["persistent","Persistent symptoms after initial therapy?"],
    ],
    steps:[
      "Assess mental status, airway, and obtain blood glucose.",
      "If awake and safe to swallow, consider oral glucose per protocol.",
      "If unable to swallow, use IV/IO dextrose or glucagon per scope and protocol.",
      "Recheck BGL and mental status after treatment.",
      "Consider other causes if mental status does not improve after glucose correction.",
    ],
    meds:["Oral Glucose","Oral Glucose (Glutose)","Dextrose 50% (D50)","Dextrose 25% (D25)","Glucagon"],
    triggers:["lowBgl","persistent"],
  },
  {
    id:"anaphylaxis",
    system:"anaphylaxis",
    title:"Anaphylaxis",
    sub:"IM epi, airway, bronchodilator, shock support",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["airway","Airway swelling, voice change, stridor, or respiratory compromise?"],
      ["shock","Hypotension, syncope, or poor perfusion?"],
      ["wheezing","Wheezing or bronchospasm?"],
      ["repeat","Symptoms persist after initial epinephrine interval?"],
    ],
    steps:[
      "Remove trigger if possible; assess airway, breathing, circulation, skin, and GI symptoms.",
      "Give IM epinephrine promptly for anaphylaxis per protocol.",
      "Support oxygenation and ventilation; prepare airway escalation for swelling or fatigue.",
      "Treat bronchospasm with bronchodilator per protocol.",
      "Manage shock with positioning, IV access, and fluids per protocol.",
      "Reassess frequently and prepare repeat epinephrine if symptoms persist per local interval.",
    ],
    meds:["Epinephrine 1:1,000","Albuterol","Diphenhydramine (Benadryl)","Normal Saline (0.9% NaCl)"],
    triggers:["airway","shock","repeat"],
  },
  {
    id:"peds-resp",
    system:"respiratory",
    title:"Pediatric Respiratory Distress",
    sub:"Asthma, croup, bronchiolitis — weight-based treatment",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["croup","Barky cough, inspiratory stridor, or signs of croup?"],
      ["wheezing","Wheezing, prolonged expiration, or bronchospasm?"],
      ["severe","Severe distress, cyanosis, fatigue, or altered mental status?"],
      ["weight","Weight known? (required for weight-based dosing)"],
    ],
    steps:[
      "Position of comfort; assess WOB, stridor vs wheeze, SpO2, RR, accessory muscle use.",
      "Apply oxygen; titrate to SpO2 goal per protocol.",
      "Croup (barky cough, inspiratory stridor): Neb Epi 1:1,000 (5 mL undiluted) + Dexamethasone 0.6 mg/kg IM/IV max 16 mg.",
      "Asthma/bronchospasm (expiratory wheeze): Albuterol (≥20 kg: 2.5 mg · <20 kg: 1.25 mg) q20 min ± Ipratropium once.",
      "Severe/near-fatal bronchospasm: Epi 1:1,000 IM 0.01 mg/kg (max 0.5 mg) + Methylprednisolone 1–2 mg/kg IV/IM.",
      "Observe croup patients ≥2 hrs post-Neb Epi for rebound. Prepare airway for any rapid deterioration.",
    ],
    meds:["Albuterol","Ipratropium (Atrovent)","Epinephrine 1:1,000 (Nebulized)","Epinephrine 1:1,000","Methylprednisolone","Dexamethasone"],
    triggers:["severe","croup"],
  },
  {
    id:"peds-rsi",
    system:"respiratory",
    title:"Pediatric RSI / Advanced Airway",
    sub:"7-step RSI · weight-based paralytics · age-specific tube sizing",
    scope:"Medic",
    patientType:"peds",
    questions:[
      ["failedAirway","BVM inadequate or airway management failing?"],
      ["apneicRisk","High apnea risk — AMS, status seizure, or respiratory failure?"],
      ["weightKnown","Weight known? (required for weight-based dosing)"],
      ["contraSux","Contraindications to succinylcholine? (burns >24 hr, crush, hyperkalemia, denervation injury)"],
    ],
    steps:[
      "INDICATIONS: Failure to oxygenate/ventilate, inability to protect airway, anticipated deterioration. Weigh risk/benefit — BVM + OPA/NPA is a valid bridge in many cases.",
      "7-STEP RSI: 1) Preparation (equipment, suction, crash cart), 2) Preoxygenation, 3) Pretreatment, 4) Paralysis + sedation, 5) Protection/positioning, 6) Placement, 7) Post-intubation management.",
      "PREOXYGENATION: BVM 100% FiO₂ ×3 min if time allows. Apneic oxygenation via NC 6–8 L/min during laryngoscopy.",
      "PRETREATMENT: Atropine (RSI pre-tx) 0.02 mg/kg IV/IO (min 0.1 mg, max 0.5 mg) for infants and children under 8 yrs — prevents vagal bradycardia from laryngoscopy.",
      "INDUCTION: Ketamine 1.5–2 mg/kg IV/IO preferred — maintains airway reflexes, bronchodilates, hemodynamically stable. OR Midazolam 0.1–0.3 mg/kg IV/IO.",
      "PARALYSIS: Succinylcholine 1.5–2 mg/kg IV/IO (infants up to 3 mg/kg) — onset 45–60 sec, duration 8–10 min. AVOID if burns >24 hr, crush injury, spinal cord injury, denervation, or hyperkalemia. Rocuronium 1.2 mg/kg IV/IO if succinylcholine contraindicated — onset 60–90 sec, duration 30–60 min.",
      "TUBE SIZING: Uncuffed (age/4)+4 for age <8. Cuffed (age/4)+3.5 for age ≥2. Confirm with colorimetric CO₂ + waveform capnography. Tape at 3× tube size at lip.",
      "POST-INTUBATION: Bilateral breath sounds, waveform capnography, SpO₂. Ongoing sedation + analgesia to maintain tube tolerance. Reassess continuously.",
    ],
    meds:["Succinylcholine","Rocuronium","Ketamine","Midazolam (Versed)","Atropine (RSI pre-tx)","Atropine"],
    triggers:["failedAirway","apneicRisk"],
  },
  {
    id:"peds-svt",
    system:"cardiac",
    title:"Pediatric Tachycardia / SVT",
    sub:"Most common peds dysrhythmia · weight-based adenosine · cardioversion",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["unstable","Hemodynamically UNSTABLE — poor perfusion, AMS, hypotension, or respiratory distress?"],
      ["svt","Narrow-complex tachycardia — HR >220 bpm (infant) or >180 bpm (child), fixed rate?"],
      ["wideComplex","Wide-complex tachycardia (QRS ≥0.09 sec for age)?"],
      ["weightKnown","Weight known? (required for weight-based dosing)"],
    ],
    steps:[
      "SVT is the most common symptomatic dysrhythmia in children. Infant SVT: HR >220 bpm, fixed rate. Child SVT: HR >180 bpm. Sinus tach varies with stimulation — SVT is fixed.",
      "UNSTABLE SVT: Synchronized cardioversion 0.5–1 J/kg. If no conversion: 2 J/kg. Do NOT delay cardioversion for IV access.",
      "STABLE SVT: Vagal maneuvers — ice pack/cold water to face (infant), Valsalva (older child). If no conversion: Adenosine 0.1 mg/kg IV/IO RAPID push via proximal site + rapid flush (max first dose 6 mg). Second dose: 0.2 mg/kg (max 12 mg).",
      "WIDE-COMPLEX TACHYCARDIA: Treat as VT. Amiodarone 5 mg/kg IV/IO over 20–60 min (Medic scope) OR synchronized cardioversion 0.5–1 J/kg if unstable.",
      "Infant signs of decompensated SVT/CHF: poor feeding, tachypnea, diaphoresis, irritability, hepatomegaly, weak pulses.",
      "Establish IV/IO. Obtain weight. Continuous monitoring. 12-lead if available.",
      "Priority transport with pediatric hospital pre-notification.",
    ],
    meds:["Adenosine","Amiodarone"],
    triggers:["unstable","svt"],
  },
  {
    id:"peds-bradycardia",
    system:"cardiac",
    title:"Pediatric Symptomatic Bradycardia",
    sub:"Hypoxia is #1 cause — oxygenate FIRST · CPR if poor perfusion · weight-based epi",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["hypoxia","Suspected hypoxia as primary cause?"],
      ["sympt","SYMPTOMATIC — poor perfusion, AMS, or hemodynamic instability?"],
      ["cpr","HR <60 with poor perfusion despite oxygenation — initiate CPR?"],
      ["weightKnown","Weight known? (required for weight-based dosing)"],
    ],
    steps:[
      "OXYGENATE FIRST — peds bradycardia is caused by hypoxia in the vast majority of cases. Airway + oxygen is the first and most critical intervention.",
      "Open airway, provide high-flow oxygen or BVM ventilation. Reassess HR after 1–2 min of oxygenation before proceeding to medications.",
      "HR <60 bpm with signs of poor perfusion DESPITE adequate oxygenation: Begin CPR. Peds bradycardia + poor perfusion = CPR indication — do not wait for drug effect.",
      "Epinephrine 0.01 mg/kg (0.1 mL/kg of 1:10,000) IV/IO q3–5 min (max 1 mg/dose) — primary vasopressor/chronotrope for peds bradycardia.",
      "Atropine 0.02 mg/kg IV/IO (min dose 0.1 mg, max 0.5 mg/dose, max total 1 mg) — for vagal tone, AV block, or peri-intubation bradycardia.",
      "Transcutaneous pacing as bridge if equipment available and bradycardia not hypoxia-driven. Requires appropriately sized pediatric pads.",
      "Reversible causes: Hypoxia (most common), hypothermia, heart block, drug/toxin effect (beta-blockers, Ca-channel blockers, digoxin, opioids).",
      "Priority transport with continuous monitoring and pediatric hospital pre-notification.",
    ],
    meds:["Epinephrine 1:10,000","Atropine"],
    triggers:["sympt","cpr"],
  },
  {
    id:"peds-chest-pain",
    system:"cardiac",
    title:"Pediatric Chest Pain",
    sub:"ACS rare in peds · myocarditis · exertional = red flag · MSK most common",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["exertional","Pain triggered or worsened by exertion or physical activity?"],
      ["syncope","Syncope or near-syncope associated with the pain?"],
      ["diaphoretic","Diaphoresis, pallor, or signs of poor perfusion?"],
      ["fever","Fever or recent viral illness?"],
      ["reproduced","Pain reproducible with palpation (musculoskeletal)?"],
    ],
    steps:[
      "Pediatric ACS is rare but occurs in teens. Most peds chest pain is musculoskeletal (~30%), respiratory, or functional. RED FLAGS: exertional onset, associated syncope, diaphoresis, family history of sudden cardiac death.",
      "Cardiac monitor, pulse oximetry, full vitals. 12-lead ECG if available.",
      "EXERTIONAL + SYNCOPE + ECG CHANGES: Treat as cardiac emergency — transport to cardiac-capable facility with monitoring.",
      "FEVER + CHEST PAIN + RECENT VIRAL ILLNESS: Consider myocarditis or pericarditis. Pleuritic (sharp, positional, worse inspiration) or pericarditic (worse lying flat, better leaning forward) pain patterns. Transport with monitoring.",
      "SICKLE CELL DISEASE + CHEST PAIN: High concern for acute chest syndrome (ACS equivalent) — oxygen, IV access, analgesia, priority transport.",
      "MUSCULOSKELETAL (reproducible with palpation, positional, no exertional component): Less urgent but transport for evaluation.",
      "Aspirin 81–325 mg PO if >12 yrs, suspected cardiac cause, no contraindication — per medical direction.",
      "Transport all peds chest pain. Many structural and electrical causes are not apparent prehospital.",
    ],
    meds:["Aspirin","Fentanyl","Morphine","Normal Saline (0.9% NaCl)"],
    triggers:["exertional","syncope","diaphoretic"],
  },
  {
    id:"peds-febrile-seizure",
    system:"neuro",
    title:"Febrile Seizure",
    sub:"Pediatric — fever, airway, benzo if >5 min",
    scope:"Medic",
    patientType:"peds",
    questions:[
      ["active","Active or prolonged seizure (>5 minutes)?"],
      ["recurrent","Recurrent seizures without full recovery between episodes?"],
      ["airway","Airway compromise, hypoxia, or apnea?"],
      ["complex","Focal deficit, age <6 months, or complex/atypical features?"],
    ],
    steps:[
      "Protect from injury; position lateral; suction if needed; oxygen and monitor SpO2.",
      "Assess airway; assist ventilations if inadequate or apneic.",
      "Check blood glucose — treat hypoglycemia with D25 (child) or D10 (neonate/infant).",
      "Seizure >5 min or recurrent: Midazolam IM/IN 0.2 mg/kg (max 10 mg) per protocol.",
      "Febrile seizures are usually brief and self-limited — reassess; monitor closely after medication.",
      "For complex features (focal, age <6 mo, prolonged): treat as status and transport with priority.",
    ],
    meds:["Midazolam (Versed)","Dextrose 25% (D25)","Dextrose 10% (D10)"],
    triggers:["active","recurrent","airway"],
  },
  {
    id:"overdose",
    system:"neuro",
    title:"Opioid / Toxicological Overdose (Adult)",
    sub:"Naloxone · airway · toxidrome identification · TCA bicarb",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["opioid","Opioid toxidrome — miosis, RR <12, unresponsive, or track marks?"],
      ["stimulant","Stimulant toxidrome — agitation, hyperthermia, tachycardia, diaphoresis?"],
      ["tca","TCA/antidepressant concern — wide QRS, hypotension, seizure, anticholinergic signs?"],
      ["unknown","Substance unknown or multiple substances?"],
    ],
    steps:[
      "AIRWAY AND BREATHING first. BVM ventilate immediately for inadequate rate or depth — do not wait for naloxone.",
      "OPIOID TOXIDROME: Naloxone 0.4–2 mg IV/IO/IM/IN — titrate to adequate respirations, not awakening. Repeat q2–3 min as needed. Fentanyl/carfentanil analogs may require higher doses. Duration of naloxone shorter than many opioids — watch for re-narcotization.",
      "STIMULANT (cocaine, methamphetamine, MDMA): Agitation, hyperthermia, hypertension, tachycardia, diaphoresis. Benzodiazepines for agitation/seizure. Cool environment. Avoid physical restraint alone (excited delirium risk — hyperthermia + restraint = death).",
      "BENZODIAZEPINE / CNS DEPRESSANT: Supportive airway and ventilation. No prehospital reversal agent. Monitor closely for respiratory depression.",
      "TCA OVERDOSE (amitriptyline, nortriptyline, etc.): Wide QRS >0.10 sec + hypotension + seizure = high lethality. Sodium Bicarbonate 1–2 mEq/kg IV for QRS >0.10 sec or ventricular dysrhythmia (Medic scope). Avoid flumazenil if TCA suspected.",
      "UNKNOWN TOXIDROME: ABCs first. Identify: pupil size, skin findings (diaphoresis, flushing, dry), odors (fruity, garlic, bitter almond), pill bottles at scene. BGL check.",
      "Activated Charcoal 1 g/kg PO (max 50 g) ONLY if: within 1 hr of ingestion, airway intact, NOT caustics/alcohols/metals/lithium/iron. Medic scope per protocol.",
      "Poison Control: 1-800-222-1222. Transport ALL intentional overdoses regardless of clinical improvement.",
    ],
    meds:["Naloxone (Narcan)","Sodium Bicarbonate","Activated Charcoal","Midazolam (Versed)"],
    triggers:["opioid","tca"],
  },
  {
    id:"peds-overdose",
    system:"neuro",
    title:"Pediatric Overdose / Accidental Ingestion",
    sub:"Button batteries · medications · weight-based naloxone · charcoal criteria",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["opioid","Opioid/sedative signs — respiratory depression, miosis, decreased tone?"],
      ["battery","Suspected button battery or foreign body ingestion?"],
      ["severeNeuro","Seizure, unresponsive, or rapidly deteriorating?"],
      ["asymptomatic","Currently asymptomatic but confirmed ingestion?"],
    ],
    steps:[
      "ALL pediatric ingestions require transport — even asymptomatic patients. Some drugs are highly toxic in small peds doses: digoxin, beta-blockers, Ca-channel blockers, TCAs, opioids.",
      "AIRWAY AND VENTILATION first. Peds airways are small — position, suction, and support as needed.",
      "IDENTIFY SUBSTANCE: Pill bottles, plants, household chemicals, batteries. Document estimated dose and time of ingestion. Bring evidence to hospital.",
      "BUTTON BATTERY INGESTION: If in the esophagus (drooling, dysphagia, vomiting, refusal to eat) — EMERGENCY. Esophageal necrosis within 2 hours. Do NOT induce vomiting. Priority immediate transport.",
      "OPIOID/SEDATIVE TOXIDROME (respiratory depression, pinpoint pupils, decreased tone): Naloxone 0.01 mg/kg IV/IO OR 0.1 mg/kg IN (max 2 mg per dose). Titrate to respiratory effort — not wakefulness.",
      "SEIZURE FROM INGESTION: Midazolam 0.1–0.2 mg/kg IV/IO/IM/IN per protocol.",
      "Activated Charcoal 1 g/kg PO (max 50 g) ONLY if: awake with intact airway, within 1 hr of ingestion, substance adsorbs to charcoal (NOT caustics, alcohols, iron, lithium). Medic scope per protocol.",
      "Poison Control: 1-800-222-1222. Priority transport to pediatric-capable emergency facility.",
    ],
    meds:["Naloxone (Narcan)","Activated Charcoal","Midazolam (Versed)"],
    triggers:["opioid","severeNeuro","battery"],
  },
  {
    id:"behavioral",
    system:"neuro",
    title:"Behavioral / Psychiatric Emergency (Adult)",
    sub:"Excited delirium · chemical restraint · scene safety",
    scope:"Medic",
    patientType:"adult",
    questions:[
      ["violent","Violent, combative, or danger to self or others?"],
      ["excitedDelirium","Excited delirium signs — hyperthermia, superhuman strength, disrobing, exhaustion?"],
      ["psychosis","Active psychosis, hallucinations, or paranoid delusions?"],
      ["substanceSuspected","Suspected stimulant intoxication (cocaine, methamphetamine, bath salts, PCP)?"],
    ],
    steps:[
      "SCENE SAFETY FIRST — do not enter until scene is secured. Law enforcement should be present for actively violent patients. Position yourself near an exit.",
      "De-escalation: calm non-threatening tone, minimize stimulation, reduce personnel at bedside, give patient simple choices and space.",
      "EXCITED DELIRIUM SYNDROME (ExDS): Hyperthermia + bizarre behavior + agitation + apparent superhuman strength + sudden quiet = HIGH lethality. Immediate chemical restraint required — do not delay.",
      "Ketamine 4–5 mg/kg IM (Medic scope) preferred for ExDS/severe agitation — rapid onset 1–2 min, does not require patient cooperation. Monitor airway closely for laryngospasm.",
      "Moderate agitation: Midazolam 5–10 mg IM (Medic scope) OR Haloperidol 5–10 mg IM. Avoid haloperidol alone if stimulant intoxication suspected (lowers seizure threshold).",
      "AVOID prone restraint combined with chemical sedation — risk of positional asphyxia and sudden death. Lateral position preferred.",
      "Post-sedation monitoring: Airway, SpO₂, RR, temperature, BGL, ECG. ExDS patients can deteriorate rapidly after apparent calm.",
      "Transport all sedated patients on continuous monitoring. Document restraint application times, methods, and all clinical interventions.",
    ],
    meds:["Ketamine","Haloperidol (Haldol)","Midazolam (Versed)"],
    triggers:["violent","excitedDelirium"],
  },
  {
    id:"peds-behavioral",
    system:"neuro",
    title:"Pediatric Behavioral Emergency",
    sub:"Medical cause first · de-escalation · weight-based sedation",
    scope:"Medic",
    patientType:"peds",
    questions:[
      ["violent","Violent or immediate danger to self or others?"],
      ["medicalCause","Medical cause not yet excluded — BGL, hypoxia, head injury, ingestion?"],
      ["autismDD","Known autism spectrum disorder or developmental disability?"],
      ["substanceSuspected","Suspected substance use or intoxication?"],
    ],
    steps:[
      "RULE OUT MEDICAL CAUSE FIRST — hypoglycemia, hypoxia, head injury, infection, and drug ingestion all present as behavioral emergencies in children. BGL and SpO₂ check mandatory.",
      "De-escalation is first-line for all peds behavioral emergencies: calm environment, familiar person present, simple language, sensory reduction.",
      "Autism / Developmental Disability: Sensory sensitivities and communication barriers are common — do not interpret non-verbal behavior as aggression. Use consistent calm voice, visual cues, routine.",
      "Chemical restraint when de-escalation fails and patient is at immediate risk: Midazolam 0.1–0.2 mg/kg IM/IN/IV/IO (max 10 mg) — weight-based. Monitor airway and SpO₂ closely.",
      "Ketamine 3–4 mg/kg IM (Medic scope) for severe agitation unresponsive to midazolam — onset 1–2 min. Airway equipment immediately available.",
      "AVOID physical prone restraint — associated with sudden death in children. If restraint necessary, lateral position with continuous monitoring.",
      "All sedated peds patients require continuous SpO₂, RR, and level of consciousness monitoring.",
      "Transport with parent/guardian when possible. Document all interventions and clinical reasoning.",
    ],
    meds:["Midazolam (Versed)","Ketamine"],
    triggers:["violent","medicalCause"],
  },
  {
    id:"organophosphate",
    system:"neuro",
    title:"Organophosphate / Nerve Agent Poisoning",
    sub:"SLUDGE · decontamination · atropine titration · benzo for seizures",
    scope:"AEMT",
    patientType:"both",
    questions:[
      ["exposure","Known or suspected organophosphate, pesticide, or nerve agent exposure?"],
      ["sludge","SLUDGE symptoms — salivation, lacrimation, urination, defecation, GI cramps, emesis?"],
      ["seizure","Seizure activity present?"],
      ["miosis","Miosis (pinpoint pupils) + bradycardia + bronchospasm?"],
    ],
    steps:[
      "SCENE SAFETY — organophosphate/nerve agent scenes are hazmat environments. Do NOT enter without PPE (gloves, eye protection, avoid skin contact). Secondary rescuer contamination is a real risk.",
      "DECONTAMINATION: Remove patient from exposure. Remove all contaminated clothing. Copious water irrigation of skin and eyes for ≥15 min. Decontaminate before transport when possible.",
      "SLUDGE/MUDDLES: Salivation, Lacrimation, Urination, Defecation, GI cramps, Emesis / Miosis, Urination, Diaphoresis, Defecation, Lacrimation, Emesis, Seizures. Any 3+ signs = treat aggressively.",
      "ATROPINE: Adult 2–4 mg IV/IO; Peds 0.05 mg/kg IV/IO (min 0.1 mg). Repeat every 5–10 min — endpoint is DRY SECRETIONS, not tachycardia. Extremely large doses (20–100+ mg) may be required. Do NOT under-dose.",
      "SEIZURES: Diazepam 5–10 mg IV adult (0.2 mg/kg peds), OR Midazolam 5 mg IM adult (0.1–0.2 mg/kg IM/IV/IN peds). Benzodiazepines are the ONLY effective antiseizure treatment for nerve agent seizures.",
      "AIRWAY: Expect copious secretions, bronchospasm, laryngospasm. Suction aggressively. Atropine will reduce secretions but advanced airway may be required.",
      "BRONCHOSPASM: Albuterol nebulizer as adjunct after atropine.",
      "Pralidoxime (2-PAM) not available prehospital in most systems — in-hospital treatment. Contact Poison Control 1-800-222-1222. Priority transport.",
    ],
    meds:["Atropine (Organophosphate)","Midazolam (Versed)","Diazepam (Valium)","Albuterol"],
    triggers:["sludge","seizure","miosis"],
  },
  {
    id:"peds-hypoglycemia",
    system:"metabolic",
    title:"Pediatric Hypoglycemia",
    sub:"D10 neonates · D25 children · glucagon if no access",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["lowBgl","BGL below local treatment threshold?"],
      ["neonate","Neonate or infant (<3 months old)?"],
      ["canSwallow","Awake, age ≥2, and able to swallow safely?"],
      ["noAccess","No IV/IO access available?"],
    ],
    steps:[
      "Assess mental status and airway; obtain blood glucose.",
      "If awake, age ≥2, safe to swallow: Oral Glucose 15 g PO; recheck BGL in 15 min.",
      "Neonate/infant: D10 at 2 mL/kg IV/IO — do NOT use D50 in neonates (hyperosmolar injury risk).",
      "Child with IV/IO access: D25 at 2–4 mL/kg IV/IO; recheck BGL in 5 min.",
      "No IV/IO access: Glucagon IM — <20 kg: 0.5 mg · ≥20 kg: 1 mg; onset 5–15 min. Protect airway (vomiting risk).",
      "If mental status does not improve after glucose correction: consider sepsis, toxic ingestion, or metabolic disorder.",
    ],
    meds:["Oral Glucose","Dextrose 25% (D25)","Dextrose 10% (D10)","Glucagon"],
    triggers:["lowBgl"],
  },
  {
    id:"hyperglycemia-dka",
    system:"metabolic",
    title:"Hyperglycemia / DKA (Adult)",
    sub:"BGL >300 · Kussmaul respirations · aggressive fluid resuscitation",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["highBgl","BGL >300 mg/dL (or >250 with known DKA history)?"],
      ["kussmaul","Deep, rapid labored breathing (Kussmaul respirations) or fruity/acetone breath?"],
      ["dehydrated","Signs of dehydration — dry mucous membranes, poor skin turgor, tachycardia?"],
      ["ams","Altered mental status, lethargy, or confusion?"],
      ["vomiting","Nausea, vomiting, or abdominal pain?"],
      ["severAcidosis","Signs of severe acidosis — hemodynamic instability or near-unresponsive?"],
    ],
    steps:[
      "Confirm BGL. DKA: BGL typically >250–300 mg/dL with Kussmaul respirations, fruity breath, N/V, abdominal pain. Hyperglycemic Hyperosmolar State (HHS): BGL often >600, minimal ketosis, severe dehydration, neuro changes.",
      "Establish IV/IO access × 2 large bore. Administer NS 500 mL–1 L IV bolus over 30–60 min for initial resuscitation. Reassess lung sounds and BP after each bolus.",
      "DKA patients are severely volume depleted — fluid is the most critical prehospital intervention. Goal: restore perfusion and urine output. Typical deficit 3–6 L.",
      "Do NOT administer insulin prehospital unless specifically authorized by protocol and online medical direction.",
      "Potassium: DKA patients are total-body K⁺ depleted even if serum K⁺ appears elevated (acidosis shifts K⁺ extracellularly). Do NOT add K⁺ to prehospital fluids.",
      "Sodium Bicarbonate: Medic scope — administer ONLY if pH <7.0 AND hemodynamically unstable per medical direction. Routine bicarb in DKA is NOT indicated and may worsen cerebral edema.",
      "AMS or hemodynamic instability: priority transport. Monitor ECG — hyperkalemia (peaked T-waves, wide QRS) indicates critical K⁺ level.",
      "Reassess mental status, BP, HR, SpO₂, and RR continuously. Transport with early hospital notification — definitive treatment requires insulin drip and electrolyte management.",
    ],
    meds:["Normal Saline (0.9% NaCl)","Sodium Bicarbonate"],
    triggers:["highBgl","kussmaul","ams"],
  },
  {
    id:"peds-hyperglycemia-dka",
    system:"metabolic",
    title:"Pediatric Hyperglycemia / DKA",
    sub:"BGL >200 · cautious fluid resuscitation · cerebral edema risk",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["highBgl","BGL >200 mg/dL (new onset DKA can present at lower BGL in peds)?"],
      ["kussmaul","Deep, rapid breathing (Kussmaul) or fruity/acetone odor?"],
      ["dehydrated","Signs of dehydration — dry mucous membranes, sunken eyes, poor skin turgor, tachycardia?"],
      ["ams","Altered mental status, drowsiness, confusion, or headache?"],
      ["cerebraledema","Sudden worsening neuro status, bradycardia + hypertension, or posturing after initial treatment?"],
    ],
    steps:[
      "Pediatric DKA is a life-threatening emergency. BGL >200 with symptoms (Kussmaul breathing, fruity breath, N/V, dehydration) = treat as DKA until proven otherwise.",
      "Obtain weight for dosing. Establish IV/IO access.",
      "CAUTIOUS fluid resuscitation — cerebral edema is the leading cause of DKA death in children. Administer 10–20 mL/kg NS IV/IO over 1 hr (NOT rapid bolus as in adults).",
      "Reassess after initial fluid. Repeat 10 mL/kg bolus ONLY if hemodynamically unstable (SBP below threshold). Avoid fluid rates >1.5–2× maintenance.",
      "Do NOT administer insulin prehospital — risk of cerebral edema increases with rapid osmolar shifts.",
      "Monitor closely for cerebral edema: new headache, deteriorating neuro status, bradycardia + hypertension (Cushing triad), posturing. If cerebral edema suspected — call medical direction immediately.",
      "Maintain SpO₂ ≥94%; apply oxygen. Monitor ECG for hyperkalemia (peaked T-waves, wide QRS).",
      "Priority transport with pediatric hospital pre-notification. DKA in children requires ICU-level care — insulin drip and hourly electrolyte monitoring.",
    ],
    meds:["Normal Saline (0.9% NaCl)"],
    triggers:["highBgl","kussmaul","ams"],
  },
  {
    id:"fever-sepsis",
    system:"metabolic",
    title:"Fever / Sepsis (Adult)",
    sub:"qSOFA screening · fluid resuscitation · vasopressor for refractory shock",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["fever","Fever (T >38.3°C / 101°F) or hypothermia (<36°C / 96.8°F)?"],
      ["infectionSource","Suspected or confirmed source of infection?"],
      ["ams","Altered mental status from baseline?"],
      ["rr22","Respiratory rate ≥22 breaths/min?"],
      ["sbp100","Systolic BP ≤100 mmHg?"],
      ["shockPersist","Hypotension persists after initial fluid bolus?"],
    ],
    steps:[
      "qSOFA Screening: AMS + RR ≥22 + SBP ≤100. Score ≥2 with suspected infection = HIGH concern for sepsis/organ dysfunction.",
      "Establish IV/IO × 2 large bore. Administer 250–500 mL NS or LR IV bolus. Reassess lung sounds after each bolus — stop if crackles develop or SpO₂ drops.",
      "Goal MAP ≥65 mmHg. Repeat boluses targeting up to 30 mL/kg total if shock persists and lungs tolerate.",
      "Identify infection source: lungs (crackles, cough), UTI (foley, dysuria), abdomen (rigidity, surgical hx), skin/soft tissue (wound, cellulitis), CNS (neck stiffness, AMS).",
      "Maintain SpO₂ ≥94% — apply oxygen. Prepare airway early if mental status is deteriorating.",
      "Fever/pain management: Acetaminophen IV 1,000 mg over 15 min — Medic scope; avoid if hepatic failure. Max 4 g/24 hrs.",
      "Refractory hypotension after adequate fluid resuscitation: Dopamine 5–20 mcg/kg/min IV infusion (Medic scope). Titrate to MAP ≥65 mmHg. Reassess HR and perfusion q3–5 min.",
      "Early transport with hospital pre-notification — definitive care requires IV antibiotics, blood cultures, and lactate. Time to antibiotics matters.",
    ],
    meds:["Normal Saline (0.9% NaCl)","Acetaminophen IV (Ofirmev)","Dopamine"],
    triggers:["sbp100","ams","shockPersist"],
  },
  {
    id:"peds-fever-sepsis",
    system:"metabolic",
    title:"Pediatric Fever / Sepsis",
    sub:"PAT + SIRS · weight-based fluid bolus · vasopressor for refractory shock",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["fever","Fever (T >38°C / 100.4°F) or hypothermia (<36°C)?"],
      ["infectionSource","Suspected source of infection?"],
      ["appearance","Abnormal appearance — irritable, inconsolable, lethargic, or toxic-looking?"],
      ["perfusion","Poor perfusion — mottling, cap refill >2 sec, or cool extremities?"],
      ["sbpLow","BP below age-appropriate threshold? (SBP <70 + 2×age in yrs mmHg)"],
      ["shockPersist","Shock signs persist after 20 mL/kg fluid bolus?"],
    ],
    steps:[
      "PAT at doorway: Appearance ↓ + Circulation ↓ = high concern for septic shock. Move quickly.",
      "Obtain weight for weight-based dosing. Establish IV/IO access.",
      "Administer 20 mL/kg NS or LR IV/IO bolus over 5–10 min. Reassess perfusion, lung sounds, and mental status after each bolus.",
      "Repeat bolus ×2–3 (up to 60 mL/kg total) if shock persists and lungs remain clear. Reassess between each bolus.",
      "Age-appropriate SBP thresholds: Infant <70 mmHg, 1–10 yrs <70 + (2×age) mmHg, >10 yrs <90 mmHg.",
      "Maintain SpO₂ ≥94% — apply oxygen. Prepare airway for any mental status decline — peds septic shock deteriorates rapidly.",
      "Fever management: Acetaminophen IV 15 mg/kg over 15 min (max 750 mg if <50 kg) — Medic scope.",
      "Refractory shock after fluid resuscitation: Dopamine 5–20 mcg/kg/min IV/IO infusion (Medic scope). Titrate to age-appropriate BP. Reassess q3–5 min.",
      "Priority transport with pediatric hospital pre-notification. Septic children can decompensate suddenly — continuous monitoring.",
    ],
    meds:["Normal Saline (0.9% NaCl)","Acetaminophen IV (Ofirmev)","Dopamine"],
    triggers:["perfusion","sbpLow","shockPersist"],
  },
  {
    id:"hyperkalemia",
    system:"metabolic",
    title:"Hyperkalemia (Adult)",
    sub:"ECG changes · calcium membrane stabilization · K⁺ shifting",
    scope:"Medic",
    patientType:"adult",
    questions:[
      ["ecgChanges","ECG changes — peaked T-waves, widened QRS, or sine-wave pattern?"],
      ["riskFactors","Risk factors — renal failure, crush injury, burns >24 hr, or metabolic acidosis?"],
      ["hemodynamic","Hemodynamic instability or ventricular dysrhythmia?"],
    ],
    steps:[
      "ECG is the most critical prehospital tool. Progression: Peaked T-waves → PR prolongation → Wide QRS → Sine-wave pattern → Ventricular fibrillation.",
      "CARDIAC MEMBRANE STABILIZATION (treat first — most urgent): Calcium Chloride 10% 1 g (10 mL) IV over 3–5 min. INCOMPATIBLE with sodium bicarbonate — use separate IV line. Onset 1–3 min. Does NOT lower K⁺, only stabilizes cardiac membrane.",
      "SHIFT K⁺ INTO CELLS: Sodium Bicarbonate 1 mEq/kg IV over 5 min — effective especially in metabolic acidosis. Alkalinizes serum, shifts K⁺ intracellularly.",
      "SHIFT K⁺ INTO CELLS: Albuterol 10–20 mg continuous nebulization — beta-2 stimulation shifts K⁺ intracellularly. Effective adjunct to IV therapy.",
      "CRUSH SYNDROME: Aggressive NS fluid resuscitation for rhabdomyolysis. Calcium Chloride if ECG changes present.",
      "CARDIAC ARREST with suspected hyperkalemia: Calcium Chloride + Sodium Bicarbonate + Albuterol in addition to standard ACLS. Definitive treatment requires dialysis.",
      "Identify cause: Renal failure (most common), ACE inhibitors, K-sparing diuretics, succinylcholine (RSI), crush injury, burns, acidosis.",
      "Dual IV access, continuous ECG monitoring, priority transport with hospital notification.",
    ],
    meds:["Calcium Chloride 10%","Sodium Bicarbonate","Albuterol"],
    triggers:["ecgChanges","hemodynamic"],
  },
  {
    id:"peds-hyperkalemia",
    system:"metabolic",
    title:"Pediatric Hyperkalemia",
    sub:"ECG changes · weight-based calcium · crush / rhabdo",
    scope:"Medic",
    patientType:"peds",
    questions:[
      ["ecgChanges","ECG changes — peaked T-waves, wide QRS, or dysrhythmia?"],
      ["riskFactors","Risk factors — renal failure, crush injury, rhabdomyolysis, or acidosis?"],
      ["hemodynamic","Hemodynamic instability?"],
    ],
    steps:[
      "Pediatric hyperkalemia: ECG changes identical to adults but can occur at lower absolute K⁺ levels, especially in infants. Peaked T-waves, wide QRS, sine-wave = treat immediately.",
      "CARDIAC MEMBRANE STABILIZATION: Calcium Chloride 10% 0.2 mL/kg (20 mg/kg) IV slowly over 5–10 min (max 1 g, Medic scope). Monitor HR during infusion — bradycardia if given too fast.",
      "SHIFT K⁺: Sodium Bicarbonate 1 mEq/kg IV over 5 min (Medic scope) — effective in metabolic acidosis context.",
      "SHIFT K⁺: Albuterol 2.5 mg nebulized (all ages) — adjunct. Beta-2 stimulation shifts K⁺ intracellularly.",
      "CRUSH INJURY / RHABDOMYOLYSIS: Normal saline 20 mL/kg IV/IO bolus for volume and renal protection.",
      "Neonates at highest risk: Iatrogenic hyperkalemia from blood transfusions, renal tubular immaturity, or high K⁺ intake.",
      "IV/IO access, continuous ECG monitoring, SpO₂. Priority transport with pediatric hospital notification.",
    ],
    meds:["Calcium Chloride 10%","Sodium Bicarbonate","Albuterol"],
    triggers:["ecgChanges","hemodynamic"],
  },

  // ─── ASSESSMENT TOOLS ──────────────────────────────────────────────────────
  {
    id:"cpss",
    system:"assess",
    title:"Cincinnati Prehospital Stroke Scale",
    sub:"1 of 3 abnormal = STROKE ALERT — sensitivity 66%, specificity 87%",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["facialDroop","FACIAL DROOP — Asymmetry when patient shows teeth or smiles?"],
      ["armDrift","ARM DRIFT — One arm drifts down or pronates in 10 sec with eyes closed and arms extended?"],
      ["speech","SPEECH ABNORMAL — Slurred, wrong words, or unable to speak at all?"],
    ],
    steps:[
      "FACE: Ask patient to show teeth or smile. NORMAL = both sides of face move equally and symmetrically. ABNORMAL = one side droops or does not move.",
      "ARMS: Ask patient to close eyes, extend both arms with palms up, hold for 10 seconds. NORMAL = both arms hold position equally. ABNORMAL = one arm drifts downward or pronates (palm turns down).",
      "SPEECH: Ask patient to repeat 'You can't teach an old dog new tricks.' NORMAL = says phrase correctly, clearly. ABNORMAL = slurred words, wrong words, or unable to speak.",
      "SCORE: 0 positive = stroke less likely (but do not rule out if clinical suspicion is high). 1–3 positive = STROKE SUSPECTED — activate stroke alert immediately.",
      "Record EXACT last known well (LKW) time — ask patient, family, bystanders. 'When was the very last time you saw them completely normal?' This determines tPA eligibility (window 3–4.5 h) and thrombectomy eligibility (up to 24 h with imaging).",
      "Early hospital pre-notification: STROKE ALERT + CPSS findings + LKW time + blood glucose + current vitals + ETA.",
    ],
    meds:["Dextrose 50% (D50)","Dextrose 25% (D25)","Oral Glucose"],
    triggers:["facialDroop","armDrift","speech"],
  },
  {
    id:"befast-lvo",
    system:"assess",
    title:"BE-FAST + LVO Screen",
    sub:"Stroke screen with large vessel occlusion detection — sensitivity ~96%",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["balance","B — BALANCE: Sudden, unexplained loss of balance or coordination?"],
      ["eyes","E — EYES: Sudden vision loss, blurred vision, or forced gaze deviation to one side?"],
      ["face","F — FACE: Facial droop or asymmetry?"],
      ["arm","A — ARM/LEG: Sudden weakness, numbness, or paralysis (especially one side)?"],
      ["speech","S — SPEECH: Sudden slurred, wrong words, or absent speech?"],
      ["gazeDeviation","LVO — Gaze deviation: Eyes forced or deviated toward one direction?"],
      ["densePlegia","LVO — Dense hemiplegia: No movement at all in affected arm?"],
      ["neglect","LVO — Neglect: Patient ignores or is unaware of one side of their body?"],
    ],
    steps:[
      "BE-FAST outperforms FAST (F-A-S-T) by adding Balance and Eyes — catches posterior circulation strokes (PICA/AICA/basilar artery) that FAST misses. Sensitivity ~96% vs ~79%.",
      "B — Balance: Sudden unexplained ataxia, stumbling, or loss of coordination. Ask if they fell or feel unsteady. Posterior circulation stroke sign.",
      "E — Eyes: Double vision (diplopia), sudden vision loss in one or both eyes, or gaze deviation. Gaze deviation = eyes pulled toward the side of the lesion — key LVO sign.",
      "LVO Identification (≥2 of 3 = HIGH suspicion): Forced gaze deviation + dense hemiplegia (arm does not move at all) + hemispatial neglect (ignores one side). NIHSS typically ≥6 in LVO.",
      "LVO Destination: Your system may have a bypass protocol to transport suspected LVO directly to a Comprehensive Stroke Center (thrombectomy-capable) rather than a Primary Stroke Center. Know your local destination matrix.",
      "Always check blood glucose first — hypoglycemia mimics stroke perfectly. Correct if low and reassess before declaring stroke alert.",
    ],
    meds:["Dextrose 50% (D50)","Dextrose 25% (D25)","Oral Glucose"],
    triggers:["face","arm","speech","gazeDeviation","densePlegia"],
  },
  {
    id:"sepsis-screen",
    system:"assess",
    title:"Sepsis Screening (qSOFA + SIRS)",
    sub:"qSOFA ≥2 of 3 = organ dysfunction suspected. Septic shock = qSOFA + SBP ≤100",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["ams","qSOFA 1 — Altered mental status: New confusion or any change from patient baseline?"],
      ["rr22","qSOFA 2 — Respiratory rate ≥22 breaths/min?"],
      ["sbp100","qSOFA 3 — Systolic BP ≤100 mmHg?"],
      ["temp","SIRS — Temperature >38.3°C (101°F) or <36°C (96.8°F)?"],
      ["hr90","SIRS — Heart rate >90 bpm without an obvious benign cause?"],
      ["infectionSource","INFECTION — Suspected or confirmed source of infection present?"],
    ],
    steps:[
      "qSOFA Score (SEPSIS-3, 2016): Count YES answers from first 3 questions. Score ≥2 + suspected infection = HIGH suspicion for sepsis with organ dysfunction. Mortality risk increases sharply.",
      "SIRS Criteria (≥2 of 4): Temp >38.3°C or <36°C, HR >90, RR >20, WBC >12k or <4k. SIRS alone is less specific — a patient can have SIRS without sepsis. Combine with clinical picture.",
      "Septic Shock: Sepsis + vasopressor requirement to maintain MAP ≥65 AND serum lactate >2 mmol/L despite adequate resuscitation. In-hospital mortality >25%.",
      "Identify infection source: lungs (fever, cough, crackles), urinary tract (dysuria, foley catheter), abdomen (pain, rigidity, surgical history), skin/soft tissue (wound, cellulitis), CNS (neck stiffness, AMS).",
      "Establish IV/IO access. Administer crystalloid fluid bolus per local protocol (typically 250–500 mL NS bolus, reassess lung response — stop if crackles develop). Repeat as needed to MAP ≥65.",
      "Maintain SpO₂ ≥94%. Prepare for airway if AMS + respiratory compromise. Transport with early notification — sepsis requires rapid antibiotics and source control in-hospital.",
    ],
    meds:["Normal Saline (0.9% NaCl)","Dopamine"],
    triggers:["ams","sbp100","infectionSource"],
  },
  {
    id:"pat",
    system:"assess",
    title:"Pediatric Assessment Triangle (PAT)",
    sub:"30-second from-the-doorway impression: Appearance · Work of Breathing · Circulation",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["appearanceAbnormal","APPEARANCE (TICLS) — Abnormal tone, not interactive, inconsolable, abnormal gaze, or weak cry?"],
      ["wobAbnormal","WORK OF BREATHING — Audible sounds, retractions, nasal flaring, tripod position, or head bobbing?"],
      ["circulationAbnormal","CIRCULATION TO SKIN — Pallor, mottling, cyanosis, or obviously decreased perfusion to skin?"],
    ],
    steps:[
      "The PAT is completed in under 30 seconds from the doorway before touching the patient. No equipment needed. It tells you URGENCY and type of problem.",
      "APPEARANCE — TICLS mnemonic: Tone (moving/resisting vs limp), Interactiveness (curious/engaged vs glazed/unresponsive), Consolability (settles with parent vs inconsolable), Look/Gaze (tracks/recognizes vs vacant stare), Speech/Cry (strong vs weak/absent/hoarse).",
      "WORK OF BREATHING — Audible sounds without stethoscope: Stridor = upper airway obstruction. Wheeze = lower airway (asthma/bronchiolitis). Grunting = alveolar collapse (respiratory failure/NTE). Retractions (suprasternal, intercostal, subcostal). Head bobbing in infant = severe distress.",
      "CIRCULATION TO SKIN — Pallor = anemia or poor cardiac output. Mottling = inadequate peripheral perfusion. Central cyanosis (lips, tongue) = significant hypoxemia. Acrocyanosis (blue hands/feet only) in newborns is normal.",
      "PAT Pattern → Physiologic Category: Appearance ↓ only = primary CNS or metabolic problem. WOB ↓ only = primary respiratory problem. Circulation ↓ only = shock. Appearance + WOB ↓ = severe respiratory failure. All 3 ↓ = cardiopulmonary failure — immediate intervention.",
      "Any 2–3 PAT abnormalities = critically ill child until proven otherwise. Move quickly to primary ABCDE survey and early intervention.",
    ],
    meds:[],
    triggers:["appearanceAbnormal","wobAbnormal","circulationAbnormal"],
  },
  {
    id:"apgar",
    system:"assess",
    special:"apgar",
    title:"APGAR Score — Newborn",
    sub:"Assess at 1 min and 5 min. Score ≥7 = reassuring · 4–6 = stimulate · 0–3 = resuscitate",
    scope:"EMT",
    patientType:"peds",
    questions:[
      ["toneLow","ACTIVITY/TONE — Limp (0) or only some flexion (1) rather than active motion (2)?"],
      ["pulseLow","PULSE — Absent (0) or below 100 bpm (1) rather than ≥100 bpm (2)?"],
      ["grimaceLow","GRIMACE — No response (0) or grimace only (1) rather than strong cry/cough/sneeze (2)?"],
      ["colorPoor","APPEARANCE — Blue or pale all over (0) or blue extremities only (1) rather than pink all over (2)?"],
      ["respLow","RESPIRATION — Absent (0) or weak/irregular/gasping (1) rather than strong cry (2)?"],
    ],
    steps:[
      "Assess APGAR at 1 minute and 5 minutes after birth. If 5-min score <7, reassess every 5 minutes up to 20 minutes.",
      "A — Activity (Muscle Tone): Completely limp = 0 · Some flexion of arms/legs = 1 · Active flexion/movement = 2",
      "P — Pulse (Heart Rate): Absent = 0 · Less than 100 bpm = 1 · 100 bpm or above = 2. Use stethoscope or feel umbilical cord pulsation.",
      "G — Grimace (Reflex Irritability): No response to flicking sole of foot = 0 · Grimace = 1 · Cry, cough, or sneeze = 2",
      "A — Appearance (Color): Blue or pale all over = 0 · Pink body with blue extremities (acrocyanosis) = 1 · Completely pink = 2",
      "R — Respiration: Absent = 0 · Weak, irregular, or gasping = 1 · Strong cry = 2",
      "TOTAL: 7–10 = Reassuring. 4–6 = Moderate concern — stimulate, blow-by O₂, monitor. 0–3 = Severe — begin NRP: warm/dry/stimulate, position airway, suction if needed, PPV if HR <100, chest compressions if HR <60 after 30 sec PPV.",
    ],
    meds:[],
    triggers:["pulseLow","respLow","toneLow"],
  },
  {
    id:"ob-emergency",
    system:"assess",
    title:"OB Emergency / Eclampsia",
    sub:"Active labor · eclampsia · postpartum hemorrhage · delivery support",
    scope:"EMT",
    patientType:"adult",
    questions:[
      ["crowning","Crowning visible or delivery imminent?"],
      ["seizure","Seizure activity in pregnant patient (≥20 weeks gestation)?"],
      ["hemorrhage","Significant postpartum hemorrhage?"],
      ["hypertensive","SBP ≥160 mmHg or known preeclampsia?"],
    ],
    steps:[
      "ECLAMPSIA (seizure in pregnant patient ≥20 wks): Magnesium Sulfate 4–6 g IV over 15–20 min (Medic scope). Hold if RR <12 or DTRs absent — toxicity. Calcium chloride/gluconate is antidote.",
      "SEVERE HYPERTENSION in pregnancy (SBP ≥160): Monitor and priority transport — antihypertensive management is in-hospital.",
      "DELIVERY: Warm environment. Support infant head during crowning — do NOT pull. Gentle downward traction for anterior shoulder, upward for posterior. Suction only if meconium + non-vigorous infant.",
      "UMBILICAL CORD: Double-clamp at 2–3 cm and 5 cm from umbilicus at 1–2 min after delivery (delayed cord clamping preferred for term infants). Cut between clamps.",
      "POSTPARTUM HEMORRHAGE (PPH): Uterine massage. Oxytocin (Pitocin) 10–40 units in 1 L NS IV infusion AFTER placental delivery — NEVER before (risk of retained placenta and maternal death).",
      "SHOULDER DYSTOCIA: McRoberts maneuver (extreme hip flexion into chest), suprapubic pressure applied downward. Do NOT apply fundal pressure. Document time head delivered.",
      "NUCHAL CORD: If loose, slip over head. If tight, double-clamp and cut before completing delivery.",
      "NEONATAL RESUSCITATION: Dry, warm, stimulate immediately. If HR <100, apneic, or gasping — begin NRP. See Neonatal Resuscitation protocol.",
    ],
    meds:["Magnesium Sulfate","Oxytocin (Pitocin)","Epinephrine 1:1,000"],
    triggers:["crowning","seizure","hemorrhage"],
  },
  {
    id:"neonatal-resus",
    system:"assess",
    title:"Neonatal Resuscitation",
    sub:"Birth to 28 days · NRP algorithm · weight-based epinephrine",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["termGestation","≥37 weeks gestation and amniotic fluid clear?"],
      ["breathingCrying","Good respiratory effort and crying at birth?"],
      ["goodTone","Good muscle tone?"],
      ["hrBelow100","Heart rate below 100 bpm despite initial steps?"],
    ],
    steps:[
      "INITIAL STEPS — the 'golden minute': Warm and dry, stimulate (rub back/flick soles), clear airway only if obstructed. Position: slight neck extension (sniffing position). Suction only if meconium + non-vigorous.",
      "EVALUATE: Respiratory effort, heart rate, color/tone. Breathing + HR ≥100 + good tone = routine care and monitoring.",
      "HR <100 OR inadequate breathing: Positive Pressure Ventilation (PPV) — 40–60 breaths/min at 21% FiO₂ initially. Titrate oxygen to SpO₂ targets (1 min: 60–65%, 5 min: 80–85%, 10 min: 85–95%).",
      "PPV ×30 sec — HR still <100: Ventilation corrective steps (MR SOPA): Mask adjustment, Reposition airway, Suction, Open mouth, Pressure increase, Airway — intubate.",
      "HR <60 after 30 sec adequate PPV: Begin chest compressions. 2-thumb encircling technique preferred. Rate 90/min + 30 breaths/min (3:1 ratio). Increase FiO₂ to 100%. IV/IO access.",
      "HR <60 DESPITE CPR ×30 sec: Epinephrine 0.01–0.03 mg/kg IV/IO (0.1–0.3 mL/kg of 1:10,000). Via ET tube: 0.05–0.1 mg/kg (less reliable).",
      "GLUCOSE: Neonates are highly vulnerable to hypoglycemia. Check BGL if possible. D10 at 2 mL/kg IV/IO if BGL <40 mg/dL.",
      "MECONIUM + NON-VIGOROUS: Do NOT delay PPV for extensive suctioning. Intubate and suction below cords if HR <100 or poor tone.",
    ],
    meds:["Epinephrine 1:10,000","Dextrose 10% (D10)","Normal Saline (0.9% NaCl)"],
    triggers:["hrBelow100"],
  },
  {
    id:"pain-management",
    system:"assess",
    title:"Pain Management (Adult)",
    sub:"Multimodal analgesia · titrate to effect · hemodynamic screen",
    scope:"AEMT",
    patientType:"adult",
    questions:[
      ["severeAcute","Severe acute pain (score ≥7/10) requiring parenteral analgesia?"],
      ["traumaPain","Traumatic pain — injury-related?"],
      ["hemodynamicOk","Hemodynamically stable (SBP ≥90)?"],
      ["allergyOpioid","Known opioid or NSAID allergy?"],
    ],
    steps:[
      "ASSESS: Pain 0–10 scale, character, location, radiation, onset. Document baseline and reassess after each intervention.",
      "NON-OPIOID FIRST when appropriate: Reduces opioid requirement and side effects.",
      "Ketorolac (Toradol) 15–30 mg IV or 30–60 mg IM (Medic scope) — for musculoskeletal, renal colic, or inflammatory pain. Avoid in renal failure, active GI bleed, or pregnancy.",
      "Fentanyl 1 mcg/kg IV/IO or 1.5–2 mcg/kg IN (max 100 mcg/dose) — rapid onset, titratable. Repeat 0.5 mcg/kg q5 min as needed. Intranasal effective without IV access.",
      "Morphine Sulfate 0.1 mg/kg IV/IO (max 4 mg/dose) — slower onset than fentanyl, longer duration. Screen BP/RR before each dose.",
      "Sub-dissociative Ketamine 0.1–0.3 mg/kg IV over 10–15 min (Medic scope) — excellent for trauma, burns, opioid-tolerant patients. Warn patient of possible dissociative sensation.",
      "SCREEN BEFORE EACH OPIOID DOSE: SBP ≥90, RR ≥12, SpO₂ acceptable. Hold if SpO₂ <94% or RR <10.",
      "Titrate to functional relief (≤4/10), not zero. Document dose, route, and patient response to each intervention.",
    ],
    meds:["Fentanyl","Morphine Sulfate","Ketorolac (Toradol)","Ketamine"],
    triggers:["severeAcute","traumaPain"],
  },
  {
    id:"peds-pain",
    system:"assess",
    title:"Pediatric Pain Management",
    sub:"Age-appropriate scale · weight-based dosing · multimodal",
    scope:"AEMT",
    patientType:"peds",
    questions:[
      ["severeAcute","Severe acute pain requiring pharmacological intervention?"],
      ["weightKnown","Weight known? (required for weight-based dosing)"],
      ["hemodynamicOk","Hemodynamically stable?"],
      ["ageAbove2","Age ≥2 years?"],
    ],
    steps:[
      "ASSESS with age-appropriate tool: FLACC (<4 yrs/non-verbal) — Face, Legs, Activity, Cry, Consolability. FACES scale (≥3 yrs). Numeric 0–10 (≥8 yrs). Document baseline.",
      "Non-pharmacological first: positioning, ice/heat, distraction, parental presence, fracture splinting.",
      "Fentanyl 1–1.5 mcg/kg IV/IO or 1.5–2 mcg/kg IN (max 100 mcg/dose) — rapid onset, preferred first-line opioid in peds. Repeat 0.5 mcg/kg q5 min as needed.",
      "Morphine 0.05–0.1 mg/kg IV/IO (max 4 mg/dose, Medic scope) — moderate-severe pain when IV established. Slower onset than fentanyl.",
      "Ketorolac (Toradol) 0.5 mg/kg IV/IO (max 15–30 mg) for age ≥2 yrs (Medic scope) — excellent for musculoskeletal, renal colic, inflammatory pain. Avoid in infants <6 months.",
      "Sub-dissociative Ketamine 0.1–0.3 mg/kg IV over 10–15 min (Medic scope) — severe pain, trauma, or opioid failure. Warn caregiver about possible emergence reaction.",
      "SCREEN BEFORE EACH OPIOID: SBP above age threshold, RR ≥12, SpO₂ acceptable.",
      "Reassess pain score 5–10 min after each intervention. Document dose, weight used for calculation, route, and response.",
    ],
    meds:["Fentanyl","Morphine","Ketorolac (Toradol)","Ketamine"],
    triggers:["severeAcute"],
  },
  {
    id:"revised-trauma-score",
    system:"assess",
    title:"Revised Trauma Score (RTS)",
    sub:"GCS + SBP + RR scored 0–4 each — guides trauma center destination",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["gcsDown","GCS ABNORMAL — Glasgow Coma Scale ≤13?"],
      ["sbpDown","SBP LOW — Systolic BP <90 mmHg?"],
      ["rrAbnormal","RR ABNORMAL — Respiratory rate <10 or >29 breaths/min?"],
      ["majorMech","MECHANISM — Major traumatic mechanism (ejection, rollover, fall >20 ft, penetrating trunk/head)?"],
    ],
    steps:[
      "RTS uses three coded physiologic parameters: GCS, Systolic BP, and Respiratory Rate. Each scored 0–4.",
      "GCS coded: 13–15 = 4 · 9–12 = 3 · 6–8 = 2 · 4–5 = 1 · 3 = 0",
      "Systolic BP coded: ≥90 = 4 · 76–89 = 3 · 50–75 = 2 · 1–49 = 1 · 0 = 0",
      "Respiratory Rate coded: 10–29 = 4 · >29 = 3 · 6–9 = 2 · 1–5 = 1 · 0 = 0",
      "Field triage trigger (Step 1 of CDC Field Triage Guidelines): Any single abnormal parameter (GCS <14, SBP <90, RR <10 or >29) = transport to highest-level trauma center available.",
      "Load and go: Time to definitive hemorrhage control in the OR is the priority. Do not delay transport for scene interventions beyond lifesaving airway and bleeding control.",
    ],
    meds:["Tranexamic Acid (TXA)","Fentanyl","Ketamine","Normal Saline (0.9% NaCl)"],
    triggers:["gcsDown","sbpDown","rrAbnormal"],
  },
  {
    id:"start-triage",
    system:"assess",
    title:"START Triage (MCI)",
    sub:"Simple Triage And Rapid Treatment — walking · breathing · perfusion · mental status",
    scope:"EMT",
    patientType:"both",
    questions:[
      ["canWalk","WALKING — Can patient walk to a designated safe area on command?"],
      ["notBreathing","BREATHING — Breathing absent even after one airway repositioning attempt?"],
      ["rrOver30","RATE — Respiratory rate >30 breaths/min?"],
      ["noPulse","PERFUSION — Radial pulse absent OR capillary refill >2 seconds?"],
      ["noCommands","MENTAL STATUS — Unable to follow simple commands (e.g., squeeze my hand)?"],
    ],
    steps:[
      "Step 1 — WALK: Announce 'If you can walk, move to [designated area].' All ambulatory patients → tag GREEN (Minor/Delayed). Now focus only on non-ambulatory patients.",
      "Step 2 — BREATHE: For each non-ambulatory patient: open airway with head-tilt/chin-lift or jaw-thrust. If STILL not breathing → tag BLACK (Expectant/Deceased — no resuscitation in START). If breathing STARTS after repositioning → tag RED (Immediate).",
      "Step 3 — RESPIRATION RATE: Count breaths for 15 sec × 4. RR >30/min → tag RED (Immediate). RR ≤30 → continue.",
      "Step 4 — PERFUSION: Check radial pulse OR capillary refill. Absent pulse OR CR >2 sec → tag RED (Immediate). Control life-threatening external bleeding before leaving. If perfusion adequate → continue.",
      "Step 5 — MENTAL STATUS: Ask patient to follow a simple command ('squeeze my fingers'). Cannot follow → tag RED (Immediate). Can follow command → tag YELLOW (Delayed — serious but stable).",
      "Tag Colors: RED = Immediate (life-threatening, salvageable — highest priority). YELLOW = Delayed (serious but stable). GREEN = Minor (walking wounded). BLACK = Expectant (deceased or unsurvivable injuries). Move rapidly — do not treat during START. Treatment comes after all patients are triaged.",
    ],
    meds:[],
    triggers:["notBreathing","noPulse","noCommands"],
  },
];

const PROTOCOL_MED_RULES = {
  acs: [
    { med:"Aspirin", when:{ aspirinAllergy:"no" }, blockedBy:{ aspirinAllergy:"yes" }, note:"Consider for suspected ACS after allergy/bleeding screen." },
    { med:"Nitroglycerin", when:{ hypotension:"no", pde5:"no" }, blockedBy:{ hypotension:"yes", pde5:"yes" }, note:"Consider only after BP, RVI, and PDE-5 screening." },
    { med:"Fentanyl", when:{ hypotension:"no" }, note:"Consider for persistent severe pain per protocol." },
    { med:"Morphine Sulfate", when:{ hypotension:"no" }, blockedBy:{ hypotension:"yes" }, note:"Consider if approved for ACS pain and hemodynamics allow." },
  ],
  "resp-distress": [
    { med:"Albuterol", when:{ wheezing:"yes" }, note:"Consider for wheezing/bronchospasm." },
    { med:"Ipratropium (Atrovent)", when:{ wheezing:"yes" }, note:"Consider with bronchodilator pathway per protocol." },
    { med:"Epinephrine 1:1,000", when:{ severe:"yes" }, note:"Consider for severe bronchospasm/anaphylaxis pathway per protocol." },
    { med:"Magnesium Sulfate", when:{ severe:"yes", wheezing:"yes" }, note:"Consider for severe refractory bronchospasm per protocol." },
  ],
  stroke: [
    { med:"Dextrose 50% (D50)", when:{ hypoglycemia:"yes" }, note:"Treat low glucose before continuing stroke pathway." },
    { med:"Dextrose 25% (D25)", when:{ hypoglycemia:"yes" }, note:"Pediatric dextrose option per protocol." },
    { med:"Oral Glucose", when:{ hypoglycemia:"yes" }, note:"Only if awake and able to swallow safely." },
  ],
  seizure: [
    { med:"Midazolam (Versed)", when:{ active:"yes" }, note:"Consider for active/recurrent seizure per protocol." },
    { med:"Diazepam (Valium)", when:{ active:"yes" }, note:"Alternative benzodiazepine if included locally." },
    { med:"Lorazepam (Ativan)", when:{ active:"yes" }, note:"Alternative benzodiazepine if included locally." },
    { med:"Dextrose 50% (D50)", note:"Consider if BGL is low or unavailable with compatible presentation." },
    { med:"Magnesium Sulfate", when:{ pregnant:"yes" }, note:"Consider for eclampsia pathway per protocol." },
  ],
  "trauma-shock": [
    { med:"Tranexamic Acid (TXA)", when:{ txaWindow:"yes" }, note:"Consider for significant hemorrhage inside local time window." },
    { med:"Fentanyl", when:{ shock:"no" }, note:"Consider for pain when perfusion allows." },
    { med:"Ketamine", note:"Consider for severe traumatic pain per protocol and patient status." },
    { med:"Normal Saline (0.9% NaCl)", when:{ shock:"yes" }, note:"Consider fluid strategy per local trauma shock guidance." },
  ],
  hypoglycemia: [
    { med:"Oral Glucose", when:{ lowBgl:"yes", canSwallow:"yes" }, note:"Use if awake and able to swallow safely." },
    { med:"Dextrose 50% (D50)", when:{ lowBgl:"yes", canSwallow:"no" }, note:"Adult IV/IO option per protocol." },
    { med:"Dextrose 25% (D25)", when:{ lowBgl:"yes", canSwallow:"no" }, note:"Pediatric IV/IO option per protocol." },
    { med:"Glucagon", when:{ lowBgl:"yes", noAccess:"yes" }, note:"Consider when IV/IO access is unavailable per protocol." },
  ],
  anaphylaxis: [
    { med:"Epinephrine 1:1,000", when:{ airway:"yes" }, note:"Give promptly for anaphylaxis with airway/respiratory/circulatory compromise." },
    { med:"Epinephrine 1:1,000", when:{ shock:"yes" }, note:"Give promptly for anaphylaxis with shock or poor perfusion." },
    { med:"Albuterol", when:{ wheezing:"yes" }, note:"Consider for bronchospasm after epinephrine." },
    { med:"Diphenhydramine (Benadryl)", note:"Consider adjunct after epinephrine when allowed by protocol." },
    { med:"Normal Saline (0.9% NaCl)", when:{ shock:"yes" }, note:"Consider for hypotension/shock support." },
  ],
  "peds-resp": [
    { med:"Albuterol", when:{ wheezing:"yes" }, note:"Weight-tiered dose: ≥20 kg → 2.5 mg · <20 kg → 1.25 mg. Repeat q20 min." },
    { med:"Ipratropium (Atrovent)", when:{ wheezing:"yes" }, note:"Give ONCE with albuterol. Weight-tiered dose per protocol." },
    { med:"Epinephrine 1:1,000 (Nebulized)", when:{ croup:"yes" }, note:"5 mL undiluted via neb for croup. Observe ≥2 hrs for rebound." },
    { med:"Dexamethasone", when:{ croup:"yes" }, note:"0.6 mg/kg IM/IV/PO max 16 mg for croup — single dose." },
    { med:"Epinephrine 1:1,000", when:{ severe:"yes" }, note:"0.01 mg/kg IM (max 0.5 mg) for near-fatal bronchospasm refractory to nebs." },
    { med:"Methylprednisolone", when:{ severe:"yes", wheezing:"yes" }, note:"1–2 mg/kg IV/IM (max 125 mg) for severe asthma." },
  ],
  "peds-febrile-seizure": [
    { med:"Midazolam (Versed)", when:{ active:"yes" }, note:"0.2 mg/kg IM/IN (max 10 mg) for seizure >5 min or recurrent." },
    { med:"Midazolam (Versed)", when:{ recurrent:"yes" }, note:"Re-dose per protocol interval if seizures recur without recovery." },
    { med:"Dextrose 25% (D25)", note:"If BGL low: 2–4 mL/kg IV/IO for children. Recheck BGL in 5 min." },
    { med:"Dextrose 10% (D10)", note:"Neonates/infants only: 2 mL/kg IV/IO. Do not use D50." },
  ],
  "peds-hypoglycemia": [
    { med:"Oral Glucose", when:{ lowBgl:"yes", canSwallow:"yes" }, note:"15 g PO if age ≥2, awake, and safe to swallow." },
    { med:"Dextrose 10% (D10)", when:{ lowBgl:"yes", neonate:"yes" }, note:"Neonate/infant: 2 mL/kg IV/IO only. Do not use D50." },
    { med:"Dextrose 25% (D25)", when:{ lowBgl:"yes", canSwallow:"no", neonate:"no" }, note:"Child: 2–4 mL/kg IV/IO. Recheck BGL in 5 min." },
    { med:"Glucagon", when:{ lowBgl:"yes", noAccess:"yes" }, note:"<20 kg: 0.5 mg IM · ≥20 kg: 1 mg IM when IV/IO unavailable." },
  ],
  // Assessment tool med rules
  cpss: [
    { med:"Dextrose 50% (D50)", note:"Rule out hypoglycemia first — check BGL and correct if low before stroke alert." },
    { med:"Dextrose 25% (D25)", note:"Peds: 2–4 mL/kg IV/IO if hypoglycemia is the cause of deficit." },
    { med:"Oral Glucose", when:{ speech:"no" }, note:"If awake and safe to swallow, correct hypoglycemia before declaring stroke." },
  ],
  "befast-lvo": [
    { med:"Dextrose 50% (D50)", note:"Always rule out hypoglycemia — check BGL before activating stroke alert." },
    { med:"Dextrose 25% (D25)", note:"Peds: correct hypoglycemia first if BGL is low." },
    { med:"Oral Glucose", note:"If awake and safe to swallow, correct hypoglycemia and reassess deficits." },
  ],
  "sepsis-screen": [
    { med:"Normal Saline (0.9% NaCl)", when:{ sbp100:"yes" }, note:"Fluid bolus 250–500 mL IV per protocol. Reassess lung sounds and BP after each bolus." },
    { med:"Dopamine", when:{ sbp100:"yes" }, note:"Vasopressor if hypotension persists despite adequate fluids — per Medic scope and protocol." },
  ],
  "revised-trauma-score": [
    { med:"Tranexamic Acid (TXA)", when:{ majorMech:"yes" }, note:"If significant hemorrhage + within local TXA time window per protocol." },
    { med:"Fentanyl", note:"Pain management for conscious, hemodynamically stable trauma patients." },
    { med:"Ketamine", when:{ sbpDown:"yes" }, note:"Preferred analgesic/sedative in hemodynamically unstable trauma." },
    { med:"Normal Saline (0.9% NaCl)", when:{ sbpDown:"yes" }, note:"Permissive hypotension per protocol for penetrating trauma. Titrate to palpable radial pulse." },
  ],
};

const PROTOCOL_MED_SAFETY = {
  "Aspirin": { interval:null, max:1, safety:"Check allergy, active bleeding, and prior aspirin before giving." },
  "Nitroglycerin": { interval:5, max:3, safety:"Hold for hypotension, suspected RVI, or recent PDE-5 inhibitor use." },
  "Fentanyl": { interval:10, max:null, safety:"Reassess BP, RR, SpO2, mental status, and pain before repeat dosing." },
  "Morphine Sulfate": { interval:10, max:null, safety:"Hold for hypotension or respiratory depression." },
  "Albuterol": { interval:5, max:null, safety:"Reassess lung sounds, HR, SpO2, and work of breathing." },
  "Ipratropium (Atrovent)": { interval:20, max:3, safety:"Use with bronchodilator pathway; reassess respiratory status." },
  "Epinephrine 1:1,000": { interval:5, max:null, safety:"Confirm anaphylaxis/severe bronchospasm pathway; monitor HR/BP." },
  "Magnesium Sulfate": { interval:null, max:1, safety:"Monitor BP, RR, reflexes, and ECG where applicable." },
  "Dextrose 50% (D50)": { interval:15, max:null, safety:"Confirm/recheck BGL; ensure patent IV due to tissue injury risk." },
  "Dextrose 25% (D25)": { interval:15, max:null, safety:"Confirm/recheck BGL; pediatric concentration per protocol." },
  "Oral Glucose": { interval:15, max:null, safety:"Only if awake and able to swallow safely." },
  "Midazolam (Versed)": { interval:5, max:null, safety:"Prepare airway support; reassess RR, SpO2, BP, and sedation." },
  "Diazepam (Valium)": { interval:5, max:null, safety:"Prepare airway support; reassess RR, SpO2, BP, and sedation." },
  "Lorazepam (Ativan)": { interval:5, max:null, safety:"Prepare airway support; reassess RR, SpO2, BP, and sedation." },
  "Tranexamic Acid (TXA)": { interval:null, max:1, safety:"Confirm significant hemorrhage and local time window." },
  "Ketamine": { interval:10, max:null, safety:"Monitor airway, BP, emergence reaction risk, and pain response." },
  "Normal Saline (0.9% NaCl)": { interval:10, max:null, safety:"Reassess lung sounds, BP, perfusion, and protocol fluid goal." },
  "Glucagon": { interval:15, max:null, safety:"Use when unable to obtain IV/IO or oral route; protect airway." },
  "Diphenhydramine (Benadryl)": { interval:null, max:1, safety:"Adjunct only; do not delay epinephrine for anaphylaxis." },
  "Epinephrine 1:1,000 (Nebulized)": { interval:20, max:2, safety:"Observe for rebound croup ≥2 hrs. Monitor HR." },
  "Dexamethasone": { interval:null, max:1, safety:"Single dose for croup. Onset hours — reassess for clinical improvement." },
  "Methylprednisolone": { interval:null, max:1, safety:"Single EMS dose. Onset ~1–2 hr. Monitor BP and blood glucose." },
  "Dextrose 10% (D10)": { interval:5, max:null, safety:"Confirm BGL; neonates/infants only — do not use D50." },
  "Dopamine": { interval:null, max:null, safety:"Titrate via IV pump. Reassess BP, HR, and perfusion q3–5 min. Discontinue or reduce rate if HR >120 or signs of tissue ischemia." },
};

const PROTOCOL_STOP_RULES = {
  acs: [
    { when:{ hypotension:"yes" }, label:"Stop before nitrates", detail:"Hold nitroglycerin. Treat instability and contact medical control per protocol." },
    { when:{ pde5:"yes" }, label:"Stop before nitrates", detail:"PDE-5 use blocks nitroglycerin consideration." },
  ],
  "resp-distress": [
    { when:{ severe:"yes" }, label:"Immediate airway priority", detail:"Do not wait on the checklist. Support ventilation, prepare escalation, and transport." },
  ],
  stroke: [
    { when:{ hypoglycemia:"yes" }, label:"Correct glucose first", detail:"Treat hypoglycemia, reassess neuro status, then continue stroke pathway if deficits remain." },
  ],
  seizure: [
    { when:{ airway:"yes" }, label:"Airway first", detail:"Suction, position, oxygenate/ventilate, then continue medication pathway." },
  ],
  "trauma-shock": [
    { when:{ majorBleed:"yes" }, label:"Bleeding control first", detail:"Control life-threatening hemorrhage before continuing down the algorithm." },
  ],
  hypoglycemia: [
    { when:{ lowBgl:"no" }, label:"Stop hypoglycemia pathway", detail:"BGL does not support hypoglycemia treatment. Reassess for other causes." },
  ],
  anaphylaxis: [
    { when:{ airway:"yes" }, label:"Epinephrine / airway priority", detail:"Treat anaphylaxis immediately; do not delay for lower-priority steps." },
    { when:{ shock:"yes" }, label:"Epinephrine / shock priority", detail:"Treat circulatory compromise immediately and prepare rapid transport." },
  ],
};

const matchesAnswers = (answers, criteria={}) => Object.entries(criteria).every(([id, value]) => answers[id] === value);

function ProtocolMedTimer({ name, activeCall, isDarkMode }) {
  const safety = PROTOCOL_MED_SAFETY[name] || { interval:null, max:null, safety:"Reassess vitals, contraindications, and patient response before repeat dosing." };
  const administrations = (activeCall?.medLog?.[name] || []);
  const doseCount = administrations.length;
  const lastAt = administrations[doseCount - 1];
  const now = activeCall?.now || Date.now();
  const elapsed = lastAt ? Math.floor((now - lastAt) / 1000) : null;
  const intervalSecs = safety.interval ? safety.interval * 60 : null;
  const remain = intervalSecs && elapsed != null ? Math.max(0, intervalSecs - elapsed) : null;
  const maxReached = safety.max != null && doseCount >= safety.max;
  const canRepeat = !maxReached && (!intervalSecs || elapsed == null || elapsed >= intervalSecs);
  const status = maxReached ? "Max reached" : !doseCount ? "Selected" : canRepeat ? "Reassess / eligible" : `Wait ${fmt(remain)}`;
  const color = maxReached ? "#ef4444" : canRepeat ? "#22c55e" : "#f59e0b";
  return (
    <div style={{border:`1px solid ${color}`,background:isDarkMode?color+"12":"#ffffff",borderRadius:7,padding:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color,letterSpacing:"0.06em",textTransform:"uppercase"}}>{name}</div>
          <div style={{fontSize:10.5,color:"var(--c-text4)",marginTop:2}}>{status}{doseCount ? ` | dose ${doseCount}${safety.max?`/${safety.max}`:""}` : ""}</div>
        </div>
        <button onClick={()=>activeCall?.onLogMed?.(name)} disabled={!canRepeat} style={{border:`1px solid ${canRepeat?color:"var(--c-border-sub)"}`,background:canRepeat?color+"22":"var(--c-input)",color:canRepeat?color:"var(--c-text-ghost)",borderRadius:6,padding:"6px 8px",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:canRepeat?"pointer":"default"}}>
          {doseCount ? "Repeat" : "Log Dose"}
        </button>
      </div>
      <div style={{marginTop:6,fontSize:10.5,lineHeight:1.35,color:isDarkMode?"var(--c-text4)":"#374151"}}>{safety.safety}</div>
    </div>
  );
}

function ActiveCallWorkspace({ protocolTitle, events, vitalsDraft, setVitalsDraft, onLogEvent, onClear, onLogMed, now, isDarkMode, medLog={}, activeMeds=[] }) {
  const vitalsFields = [
    ["bp","BP","118/76"],
    ["hr","HR","88"],
    ["rr","RR","18"],
    ["spo2","SpO2","98"],
    ["bgl","BGL","96"],
  ];
  const hasVitals = Object.values(vitalsDraft).some(v => String(v || "").trim());
  const saveVitals = () => {
    const parts = vitalsFields
      .map(([id,label]) => vitalsDraft[id] ? `${label} ${vitalsDraft[id]}` : null)
      .filter(Boolean);
    if(!parts.length) return;
    onLogEvent("Vitals", parts.join(" | "));
    setVitalsDraft({});
  };
  const quickEvents = [
    ["Assessment","Primary assessment completed"],
    ["Reassess","Patient reassessed"],
    ["Intervention","Oxygen / airway support provided"],
    ["Notify","Receiving facility / med control notified"],
    ["Transport","Transport decision documented"],
  ];
  return (
    <section style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10,display:"flex",flexDirection:"column",gap:9}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:"#14b8a6"}}/>
        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:"var(--c-text)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Active Call</div>
          <div style={{fontSize:10.5,color:"var(--c-text4)",marginTop:2}}>{protocolTitle}</div>
        </div>
        {events.length>0&&(
          <button onClick={onClear} style={{marginLeft:"auto",border:"1px solid var(--c-border-sub)",background:"var(--c-input)",color:"var(--c-text4)",borderRadius:6,padding:"4px 7px",fontSize:9,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer"}}>Clear</button>
        )}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>
        {vitalsFields.map(([id,label,ph]) => (
          <label key={id} style={{display:"flex",flexDirection:"column",gap:3}}>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.08em"}}>{label}</span>
            <input value={vitalsDraft[id] || ""} onChange={e=>setVitalsDraft(prev=>({ ...prev, [id]:e.target.value }))} placeholder={ph} style={{width:"100%",background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:5,padding:"6px 5px",color:"var(--c-text)",fontSize:11,outline:"none"}}/>
          </label>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
        <button onClick={saveVitals} disabled={!hasVitals} style={{border:hasVitals?"1px solid #14b8a6":"1px solid var(--c-border-sub)",background:hasVitals?(isDarkMode?"#052c2d":"#ccfbf1"):"var(--c-input)",color:hasVitals?(isDarkMode?"#5eead4":"#0f766e"):"var(--c-text-ghost)",borderRadius:6,padding:"8px 6px",fontSize:10,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",cursor:hasVitals?"pointer":"default"}}>Log Vitals</button>
        <button onClick={()=>onLogEvent("Note","Protocol step reviewed")} style={{border:"1px solid var(--c-border-sub)",background:"var(--c-input)",color:"var(--c-text4)",borderRadius:6,padding:"8px 6px",fontSize:10,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer"}}>Log Note</button>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
        {quickEvents.map(([type,detail]) => (
          <button key={type} onClick={()=>onLogEvent(type,detail)} style={{border:"1px solid var(--c-border-sub)",background:"var(--c-input)",color:"var(--c-text2)",borderRadius:16,padding:"5px 8px",fontSize:10,fontWeight:800,cursor:"pointer"}}>{type}</button>
        ))}
      </div>

      <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:7,overflow:"hidden"}}>
        <div style={{padding:"7px 8px",borderBottom:"1px solid var(--c-border-sub)",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Call Events {events.length}</div>
        {events.length===0 ? (
          <div style={{padding:9,color:"var(--c-text-ghost)",fontSize:11}}>No protocol events logged yet</div>
        ) : (
          <div style={{maxHeight:180,overflowY:"auto"}}>
            {events.slice(0,8).map(event => (
              <div key={event.id} style={{display:"grid",gridTemplateColumns:"54px 1fr",gap:7,padding:"7px 8px",borderTop:"1px solid var(--c-border-sub)"}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#14b8a6",fontWeight:800}}>{fmtTime(event.ts,false).slice(0,5)}</div>
                <div>
                  <div style={{fontSize:10.5,fontWeight:800,color:"var(--c-text2)"}}>{event.type}</div>
                  <div style={{fontSize:10.5,color:"var(--c-text4)",lineHeight:1.35,marginTop:1}}>{event.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeMeds.length>0&&(
        <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:7,padding:8}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:7}}>Dose Timers</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {activeMeds.map(name => <ProtocolMedTimer key={name} name={name} activeCall={{ medLog, onLogMed, now }} isDarkMode={isDarkMode}/>)}
          </div>
        </div>
      )}
    </section>
  );
}

function PedsProtocolWeightGate({ wkg, wlb, setWkg, setWlb, isDarkMode }) {
  const setLbs = value => {
    const lbs = parseFloat(value) || 0;
    setWlb(lbs);
    setWkg(lbs ? +(lbs / 2.2046).toFixed(1) : 0);
  };
  return (
    <section style={{background:isDarkMode?"#1a1000":"#fff7ed",border:"1px solid #f59e0b",borderRadius:8,padding:12}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:"#f59e0b",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Pediatric weight required</div>
      <div style={{fontSize:12,color:"var(--c-text2)",lineHeight:1.45,marginBottom:10}}>
        Enter weight in pounds before starting Active Call, selecting medications, or using dose timers in pediatric protocol mode. The app converts it to kg for dosing.
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <input type="number" min="0" step="0.1" value={wlb || ""} onChange={e=>setLbs(e.target.value)} placeholder="lbs" style={{width:96,background:"var(--c-input)",border:"1px solid #f59e0b",borderRadius:6,padding:"8px 9px",color:"var(--c-text)",fontSize:13,fontFamily:"'IBM Plex Mono',monospace",outline:"none"}}/>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:"var(--c-text4)"}}>lbs</span>
        {wkg>0&&<span style={{marginLeft:"auto",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:"#22c55e"}}>{wkg} kg ready</span>}
      </div>
    </section>
  );
}

function GenericProtocolAlgorithm({ protocol, values, setValues, onBack, isDarkMode, onJumpDrug, findDrugLocation, activeCall, patientType, wkg, wlb, setWkg, setWlb }) {
  const setAnswer = (id, value) => setValues(prev => ({ ...prev, [protocol.id]: { ...(prev[protocol.id] || {}), [id]: value } }));
  const answers = values[protocol.id] || {};
  const activeTriggers = (protocol.triggers || []).filter(id => answers[id] === "yes");
  const system = PROTOCOL_SYSTEMS.find(s => s.id === protocol.system) || PROTOCOL_SYSTEMS[0];
  const firstUnansweredIndex = (protocol.questions || []).findIndex(([id]) => !answers[id]);
  const nextQuestion = firstUnansweredIndex >= 0 ? protocol.questions[firstUnansweredIndex] : null;
  const stopRule = (PROTOCOL_STOP_RULES[protocol.id] || []).find(rule => matchesAnswers(answers, rule.when));
  const medRules = PROTOCOL_MED_RULES[protocol.id] || [];
  const medState = rule => {
    if(rule.blockedBy && Object.entries(rule.blockedBy).some(([id, value]) => answers[id] === value)) return "blocked";
    if(rule.when && !matchesAnswers(answers, rule.when)) return "pending";
    return "consider";
  };
  const pedsWeightBlocked = patientType === "peds" && (!wkg || wkg <= 0);
  const [stepsDone, setStepsDone] = React.useState({});
  React.useEffect(() => { setStepsDone({}); }, [protocol.id]);
  const toggleStep = i => setStepsDone(p => ({...p,[i]:!p[i]}));
  return (
    <section style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={onBack} style={{width:34,height:34,borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-input)",color:"var(--c-text)",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800}}>Back</button>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:"var(--c-text)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{protocol.title}</div>
            <div style={{fontSize:11,color:"var(--c-text4)",marginTop:2}}>{protocol.sub}</div>
          </div>
        </div>
      </div>

      <div style={{background:activeTriggers.length?(isDarkMode?"#160b0b":"#f5d2d2"):"var(--c-input)",border:`1px solid ${activeTriggers.length?"#ef4444":"var(--c-border-sub)"}`,borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:activeTriggers.length?"#ef4444":"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>
          {activeTriggers.length ? "High-priority finding selected" : "Protocol guidance"}
        </div>
        <div style={{fontSize:12,color:"var(--c-text2)",lineHeight:1.45}}>
          {activeTriggers.length ? "Expedite treatment, reassessment, transport decision, and receiving-facility notification per local protocol." : "Answer decision points, complete steps, and document interventions/vitals as the call progresses."}
        </div>
      </div>

      <div style={{background:stopRule?(isDarkMode?"#2a0808":"#fee2e2"):(isDarkMode?"#071a0e":"#dcfce7"),border:`1px solid ${stopRule?"#ef4444":"#22c55e"}`,borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:stopRule?"#ef4444":"#16a34a",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>
          {stopRule ? stopRule.label : nextQuestion ? "Next decision" : "Algorithm path complete"}
        </div>
        <div style={{fontSize:12,color:isDarkMode?"var(--c-text2)":"#111827",lineHeight:1.45}}>
          {stopRule ? stopRule.detail : nextQuestion ? `Answer: ${nextQuestion[1]}` : "All decision points have been answered. Continue reassessment, documentation, and transport decision per protocol."}
        </div>
      </div>

      {pedsWeightBlocked && <PedsProtocolWeightGate wkg={wkg} wlb={wlb} setWkg={setWkg} setWlb={setWlb} isDarkMode={isDarkMode}/>}

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Decision points</div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {(protocol.questions || []).map(([id,label], index) => {
            const isFuture = firstUnansweredIndex >= 0 && index > firstUnansweredIndex;
            return (
            <div key={id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",background:"var(--c-input)",border:index===firstUnansweredIndex?`1px solid ${system.color}`:"1px solid var(--c-border-sub)",borderRadius:7,padding:9,opacity:isFuture?0.48:1}}>
              <div style={{fontSize:12,fontWeight:800,color:"var(--c-text)",lineHeight:1.35}}>{label}</div>
              <div style={{display:"flex",gap:5}}>
                {["yes","no"].map(answer => {
                  const selected = answers[id] === answer;
                  return (
                    <button key={answer} onClick={()=>{setAnswer(id, answer);activeCall?.onLogEvent("Decision",`${label} ${answer.toUpperCase()}`);}} style={{minWidth:38,padding:"6px 7px",borderRadius:6,border:selected?`1px solid ${answer==="yes"?"#ef4444":"#22c55e"}`:"1px solid var(--c-border-sub)",background:selected?(answer==="yes"?(isDarkMode?"#2a0808":"#fee2e2"):(isDarkMode?"#071a0e":"#dcfce7")):"transparent",color:selected?(answer==="yes"?(isDarkMode?"#fca5a5":"#7f1d1d"):(isDarkMode?"#86efac":"#064e3b")):"var(--c-text4)",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:"pointer",textTransform:"uppercase"}}>
                      {answer}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase"}}>Treatment algorithm</div>
          {Object.values(stepsDone).some(Boolean) && (
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#4ade80",fontWeight:700}}>
              {Object.values(stepsDone).filter(Boolean).length}/{(protocol.steps||[]).length} done
            </div>
          )}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {(protocol.steps || []).map((item, index) => {
            const done = !!stepsDone[index];
            const dimmed = !done && !!stopRule && index > 1;
            return (
              <div key={`${protocol.id}-${index}`} onClick={()=>toggleStep(index)}
                style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",borderRadius:8,cursor:"pointer",
                  border:`1.5px solid ${done?"#4ade80":"var(--c-border-sub)"}`,
                  background:done?(isDarkMode?"#052e16":"#f0fdf4"):"var(--c-input)",
                  opacity:dimmed?0.4:1,transition:"all 0.15s"}}>
                <div style={{flexShrink:0,width:24,height:24,borderRadius:7,
                  border:`2px solid ${done?"#4ade80":system.color}`,
                  background:done?"#4ade80":system.color+"22",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  marginTop:1,transition:"all 0.15s",
                  fontFamily:"'IBM Plex Mono',monospace",fontSize:done?14:10,fontWeight:800,
                  color:done?"#052e16":system.color}}>
                  {done?"✓":index+1}
                </div>
                <div style={{fontSize:12,color:done?"#4ade80":"var(--c-text2)",lineHeight:1.5,
                  textDecoration:done?"line-through":"none",opacity:done?0.75:1}}>
                  {item}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:7}}>Medication shortcuts</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {medRules.map((rule, index) => {
            const state = medState(rule);
            const isConsider = state === "consider";
            const isBlocked = state === "blocked";
            const isPending = state === "pending";
            const canTap = !isBlocked && !pedsWeightBlocked;
            const borderColor = isBlocked ? "#ef4444" : isConsider ? system.color : "var(--c-border-sub)";
            const bgColor = isBlocked ? (isDarkMode?"#2a0808":"#fee2e2") : isConsider ? system.color+"18" : "var(--c-input)";
            const textColor = isBlocked ? "#ef4444" : isConsider ? system.color : "var(--c-text-ghost)";
            return (
              <button
                key={`${rule.med}-${index}`}
                onClick={()=>{ if(canTap) onJumpDrug?.(rule.med); }}
                disabled={isBlocked || pedsWeightBlocked}
                style={{
                  border:`1px solid ${borderColor}`,
                  background:bgColor,
                  borderRadius:6,
                  padding:"7px 8px",
                  fontSize:11,
                  color:textColor,
                  fontWeight:800,
                  cursor:canTap?"pointer":"not-allowed",
                  opacity:isPending?0.65:1,
                  fontFamily:"'DM Sans',sans-serif",
                  textAlign:"left",
                }}
              >
                <span style={{display:"block",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  {isBlocked ? "⛔ Hold" : isConsider ? "→ Consider" : "◷ Pending"} — {rule.med}
                </span>
                <span style={{display:"block",marginTop:2,color:isDarkMode?"var(--c-text4)":"#374151",fontSize:10.5,lineHeight:1.35,fontWeight:600}}>{rule.note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ActiveCallWorkspace
        protocolTitle={protocol.title}
        events={activeCall.events}
        vitalsDraft={activeCall.vitalsDraft}
        setVitalsDraft={activeCall.setVitalsDraft}
        onLogEvent={activeCall.onLogEvent}
        onClear={activeCall.onClear}
        onLogMed={activeCall.onLogMed}
        now={activeCall.now}
        isDarkMode={isDarkMode}
        medLog={activeCall.medLog}
        activeMeds={activeCall.activeMeds}
      />
    </section>
  );
}

function ApgarAlgorithm({ onBack, isDarkMode }) {
  const t   = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu  = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su  = isDarkMode ? "#0d1120" : "#ffffff";
  const bd  = isDarkMode ? "#1a2338" : "#d1d5db";
  const inp = isDarkMode ? "#090e1c" : "#f9fafb";

  const APGAR_CATS = [
    { key:"a",  letter:"A", label:"Activity",  sublabel:"Muscle Tone", opts:[
      { v:0, l:"0 – Limp / no tone" },
      { v:1, l:"1 – Some flexion" },
      { v:2, l:"2 – Active motion" },
    ]},
    { key:"p",  letter:"P", label:"Pulse",     sublabel:"Heart Rate", opts:[
      { v:0, l:"0 – Absent" },
      { v:1, l:"1 – Below 100 bpm" },
      { v:2, l:"2 – ≥100 bpm" },
    ]},
    { key:"g",  letter:"G", label:"Grimace",   sublabel:"Reflex Irritability", opts:[
      { v:0, l:"0 – No response" },
      { v:1, l:"1 – Grimace" },
      { v:2, l:"2 – Cry / Cough / Sneeze" },
    ]},
    { key:"a2", letter:"A", label:"Appearance", sublabel:"Color", opts:[
      { v:0, l:"0 – Blue or pale all over" },
      { v:1, l:"1 – Blue extremities only" },
      { v:2, l:"2 – Pink all over" },
    ]},
    { key:"r",  letter:"R", label:"Respiration", sublabel:"Breathing", opts:[
      { v:0, l:"0 – Absent" },
      { v:1, l:"1 – Weak / Irregular" },
      { v:2, l:"2 – Strong cry" },
    ]},
  ];

  const empty = () => ({ a:"", p:"", g:"", a2:"", r:"" });
  const [scores1, setScores1] = React.useState(empty());
  const [scores5, setScores5] = React.useState(empty());
  const [activeSet, setActiveSet] = React.useState("1min");
  const [birthTs, setBirthTs] = React.useState(null);
  const [now, setNow] = React.useState(Date.now());
  const [cprStartTs, setCprStartTs] = React.useState(null);
  const [nrpDone, setNrpDone] = React.useState({});
  const toggleNrp = k => setNrpDone(p => ({...p,[k]:!p[k]}));

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const calcTotal = s => {
    const vals = Object.values(s);
    if(vals.some(v => v === "")) return null;
    return vals.reduce((acc, v) => acc + +v, 0);
  };
  const total1 = calcTotal(scores1);
  const total5 = calcTotal(scores5);
  const activeScores = activeSet === "1min" ? scores1 : scores5;
  const setActiveScores = activeSet === "1min" ? setScores1 : setScores5;
  const activeTotal = activeSet === "1min" ? total1 : total5;

  const scoreColor = n => n === null ? mu : n >= 7 ? "#4ade80" : n >= 4 ? "#facc15" : "#f87171";
  const scoreLabel = n => n === null ? "Score incomplete" : n >= 7 ? "Reassuring — routine care" : n >= 4 ? "Moderate concern — stimulate, O₂, reassess" : "Severe — begin NRP immediately";

  const elapsed = birthTs ? Math.floor((now - birthTs) / 1000) : null;
  const fmtElapsed = elapsed !== null ? `${Math.floor(elapsed/60)}m ${elapsed%60}s` : null;

  return (
    <section style={{display:"flex",flexDirection:"column",gap:10,paddingBottom:40}}>
      {/* Header */}
      <div style={{background:su,border:`1px solid ${bd}`,borderRadius:8,padding:12,display:"flex",alignItems:"center",gap:10}}>
        <button onClick={onBack} style={{width:34,height:34,borderRadius:8,border:`1px solid ${bd}`,background:inp,color:t,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,flexShrink:0}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:t,letterSpacing:"0.08em",textTransform:"uppercase"}}>APGAR Score</div>
          <div style={{fontSize:11,color:mu,marginTop:2}}>Newborn assessment — 1 min and 5 min</div>
        </div>
        {activeTotal !== null && (
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:26,fontWeight:800,color:scoreColor(activeTotal),lineHeight:1}}>{activeTotal}<span style={{fontSize:13,fontWeight:600}}>/10</span></div>
            <div style={{fontSize:9,color:mu,fontFamily:"'IBM Plex Mono',monospace",marginTop:2}}>{activeSet==="1min"?"1 MIN":"5 MIN"}</div>
          </div>
        )}
      </div>

      {/* Birth Timer */}
      <div style={{background:su,border:`1px solid ${bd}`,borderRadius:8,padding:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Birth Timer</div>
        {birthTs ? (
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:22,fontWeight:800,color:t}}>{fmtElapsed}</div>
              <div style={{fontSize:10,color:mu,marginTop:2}}>since birth</div>
            </div>
            <button onClick={()=>setBirthTs(null)} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${bd}`,background:"transparent",color:mu,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer"}}>Reset</button>
          </div>
        ) : (
          <button onClick={()=>setBirthTs(Date.now())} style={{width:"100%",padding:"11px 0",borderRadius:8,border:"none",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",letterSpacing:"0.05em",boxShadow:"0 4px 12px rgba(14,165,233,.3)"}}>
            ▶  Start Birth Timer
          </button>
        )}
        {birthTs && elapsed !== null && elapsed >= 60 && elapsed < 300 && (
          <div style={{marginTop:8,fontSize:10,color:"#4ade80",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>✓ 1-minute mark passed — complete 1-min APGAR if not done</div>
        )}
        {birthTs && elapsed !== null && elapsed >= 300 && (
          <div style={{marginTop:8,fontSize:10,color:"#facc15",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>⚠ 5-minute mark reached — score 5-min APGAR now</div>
        )}
      </div>

      {/* 1-min / 5-min tab */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:`1px solid ${bd}`,borderRadius:10,padding:3,gap:3}}>
        {[["1min","1 Minute"],["5min","5 Minutes"]].map(([k,l])=>{
          const tot = k==="1min"?total1:total5;
          return(
            <button key={k} onClick={()=>setActiveSet(k)} style={{padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:"0.04em",
              background:activeSet===k?(isDarkMode?"#1a2338":"#d1d5db"):"transparent",
              color:activeSet===k?t:mu,transition:"all 0.15s"}}>
              {l}{tot!==null?<span style={{color:scoreColor(tot)}}> · {tot}/10</span>:""}
            </button>
          );
        })}
      </div>

      {/* Interpretation banner */}
      {activeTotal !== null && (
        <div style={{background:isDarkMode?"#0d1120":"#f0f9f4",border:`1.5px solid ${scoreColor(activeTotal)}`,borderRadius:8,padding:"11px 14px",display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:22,fontWeight:800,color:scoreColor(activeTotal),flexShrink:0}}>{activeTotal}</div>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:scoreColor(activeTotal),textTransform:"uppercase",letterSpacing:"0.08em"}}>
              {activeTotal>=7?"REASSURING":activeTotal>=4?"MODERATE CONCERN":"SEVERE — RESUSCITATE NOW"}
            </div>
            <div style={{fontSize:11,color:mu,marginTop:3,lineHeight:1.4}}>{scoreLabel(activeTotal)}</div>
          </div>
        </div>
      )}

      {/* ═══ NEWBORN CPR ALERT — triggers when active score ≤ 3 ═══ */}
      {activeTotal !== null && activeTotal <= 3 && (()=>{
        const cprElapsed = cprStartTs ? Math.floor((now - cprStartTs)/1000) : null;
        const cprMin = cprElapsed !== null ? Math.floor(cprElapsed/60) : 0;
        const cprSec = cprElapsed !== null ? cprElapsed%60 : 0;
        const epiDue = cprElapsed !== null && cprElapsed >= 180;
        const NRP_STEPS = [
          { k:"s1", urgent:true,  label:"CALL FOR HELP",            body:"Activate additional resources NOW. Announce 'Newborn resuscitation needed.' Assign roles: airway, compressions, timer, documentation." },
          { k:"s2", urgent:true,  label:"WARM · DRY · STIMULATE",   body:"Place under warmer. Dry vigorously with warm towel. Remove wet linen. Tactile stimulation: rub back firmly, flick soles of feet. 30 seconds max." },
          { k:"s3", urgent:false, label:"POSITION AIRWAY",          body:"Sniffing position — slight neck extension, head midline. Place a small roll under shoulders. Avoid hyperextension (floppy newborn airway collapses)." },
          { k:"s4", urgent:false, label:"SUCTION (if needed)",       body:"Bulb syringe: mouth first, then nose — ONLY if secretions are visible obstructing the airway. Do NOT suction routinely (vagal response can cause bradycardia)." },
          { k:"s5", urgent:true,  label:"PPV — HR <100 or Apneic",  body:"BVM at 40–60 breaths/min. Initial PIP: 20–25 cmH₂O (up to 30–40 if poor compliance). O₂: 21% (room air) for term; titrate SpO₂ to target. Apply SpO₂ probe to RIGHT hand (preductal). Watch for chest rise.\n\nMR SOPA if no chest rise:\n  M – Mask seal adjustment\n  R – Reposition airway\n  S – Suction mouth & nose\n  O – Open mouth / jaw thrust\n  P – Pressure increase\n  A – Alternative airway (LMA or ETT)" },
          { k:"s6", urgent:true,  label:"COMPRESSIONS — HR <60 after 30s PPV", body:"2-THUMB technique (preferred): encircle chest with both hands, thumbs side by side on lower ⅓ of sternum (just below nipple line).\n\nRate: 3:1 ratio — 90 compressions + 30 breaths = 120 events/min.\nDepth: ⅓ anterior-posterior diameter of chest.\nAllow full chest recoil between compressions.\nSwitch to 100% O₂ when compressions begin.\nPause compressions for each PPV breath — coordinate." },
          { k:"s7", urgent:true,  label:"EPINEPHRINE — HR <60 after CCM",       body:"IV/IO (preferred): 0.01–0.03 mg/kg of 1:10,000 solution. Repeat q3–5 min.\nETT (until access): 0.05–0.1 mg/kg of 1:10,000 (larger dose, less predictable).\n\nEstimated term newborn weight ≈ 3 kg:\n  · IV/IO: 0.3–0.9 mL of 1:10,000\n  · ETT: 1.5–3 mL of 1:10,000\n\nFollow each ETT dose with 1 mL NS flush. Continue CCM during drug administration." },
          { k:"s8", urgent:false, label:"VOLUME EXPANSION",         body:"If suspected hypovolemia (pale, weak pulses, no response to resuscitation): Normal Saline (or pRBCs if fetal hemorrhage) 10 mL/kg IV/IO over 5–10 minutes. Repeat if needed." },
        ];
        return(
          <div style={{border:"2px solid #f87171",borderRadius:10,overflow:"hidden",boxShadow:"0 0 24px rgba(248,113,113,0.35)"}}>
            {/* Red header */}
            <div style={{background:"linear-gradient(135deg,#7f1d1d,#991b1b)",padding:"13px 14px",display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:"#fca5a5",letterSpacing:"0.1em",textTransform:"uppercase"}}>
                  APGAR {activeTotal}/10 — INITIATE NRP
                </div>
                <div style={{fontSize:10,color:"#fecaca",marginTop:3}}>Newborn CPR — AHA NRP 8th Edition Protocol</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:28,fontWeight:800,color:"#f87171",lineHeight:1}}>{activeTotal}<span style={{fontSize:13}}>/10</span></div>
              </div>
            </div>

            {/* CPR Timer */}
            <div style={{background:"#1c0505",borderBottom:"1px solid #7f1d1d",padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
              {cprStartTs ? (
                <>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>CPR Elapsed</div>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:24,fontWeight:800,color:epiDue?"#fbbf24":"#fca5a5",lineHeight:1}}>
                      {`${String(cprMin).padStart(2,"0")}:${String(cprSec).padStart(2,"0")}`}
                    </div>
                    {epiDue && <div style={{fontSize:10,color:"#fbbf24",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,marginTop:3}}>⚠ EPI INTERVAL — reassess dose</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#fca5a5",marginBottom:4}}>90/min compressions</div>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#fca5a5"}}>30/min ventilations</div>
                    <button onClick={()=>{setCprStartTs(null);setNrpDone({});}} style={{marginTop:8,padding:"4px 12px",borderRadius:6,border:"1px solid #7f1d1d",background:"transparent",color:"#fca5a5",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer"}}>Reset</button>
                  </div>
                </>
              ) : (
                <button onClick={()=>setCprStartTs(Date.now())} style={{width:"100%",padding:"12px 0",borderRadius:8,border:"none",background:"linear-gradient(135deg,#b91c1c,#dc2626)",color:"#fff",fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,cursor:"pointer",letterSpacing:"0.06em",boxShadow:"0 4px 14px rgba(220,38,38,.5)"}}>
                  ▶  START CPR TIMER
                </button>
              )}
            </div>

            {/* NRP Steps */}
            <div style={{background:isDarkMode?"#1a0404":"#fff5f5",padding:14,display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#f87171",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>NRP Algorithm — Check off each step as completed</div>
              {NRP_STEPS.map((step,i)=>{
                const done = !!nrpDone[step.k];
                return(
                  <div key={step.k} onClick={()=>toggleNrp(step.k)}
                    style={{borderRadius:8,border:`1.5px solid ${done?"#4ade80":step.urgent?"#f87171":"#7f1d1d"}`,
                      background:done?(isDarkMode?"#052e16":"#f0fdf4"):step.urgent?(isDarkMode?"#2a0808":"#fff1f2"):(isDarkMode?"#1c0505":"#fef2f2"),
                      padding:"10px 12px",cursor:"pointer",transition:"all 0.15s"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <div style={{flexShrink:0,width:22,height:22,borderRadius:6,border:`2px solid ${done?"#4ade80":step.urgent?"#f87171":"#7f1d1d"}`,
                        background:done?"#4ade80":"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginTop:1,transition:"all 0.15s"}}>
                        {done&&<span style={{color:"#052e16",fontWeight:900,fontSize:13}}>✓</span>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:done?"#4ade80":step.urgent?"#fca5a5":"#f87171",
                            textTransform:"uppercase",letterSpacing:"0.06em",textDecoration:done?"line-through":"none"}}>
                            {i+1}. {step.label}
                          </span>
                          {step.urgent&&!done&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,color:"#f87171",background:"#7f1d1d",borderRadius:4,padding:"1px 5px"}}>URGENT</span>}
                        </div>
                        {!done&&<div style={{fontSize:10,color:isDarkMode?"#fca5a5":"#7f1d1d",marginTop:5,lineHeight:1.65,whiteSpace:"pre-line"}}>{step.body}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Compression Rate Reference */}
              <div style={{borderRadius:8,background:isDarkMode?"#0d0505":"#fff0f0",border:"1px solid #7f1d1d",padding:12,marginTop:4}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Rate Reference</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
                  {[["COMPRESSIONS","90/min","3:1 ratio"],["VENTILATIONS","30/min","every 3rd"],["EVENTS/MIN","120","combined"]].map(([l,v,s])=>(
                    <div key={l} style={{background:isDarkMode?"#1c0505":"#fff5f5",borderRadius:6,padding:"8px 4px",border:"1px solid #7f1d1d"}}>
                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:800,color:"#f87171"}}>{v}</div>
                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:700,color:"#fca5a5",textTransform:"uppercase",marginTop:2}}>{l}</div>
                      <div style={{fontSize:9,color:"#7f1d1d",marginTop:1}}>{s}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SpO2 targets */}
              <div style={{borderRadius:8,background:isDarkMode?"#0d0505":"#fff0f0",border:"1px solid #7f1d1d",padding:12}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Target Pre-Ductal SpO₂ (Right Hand)</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {[["1 min","60–65%"],["2 min","65–70%"],["3 min","70–75%"],["4 min","75–80%"],["5 min","80–85%"],["10 min","85–95%"]].map(([t,s])=>(
                    <div key={t} style={{display:"flex",justifyContent:"space-between",fontFamily:"'IBM Plex Mono',monospace",fontSize:10}}>
                      <span style={{color:"#fca5a5",fontWeight:600}}>{t}</span>
                      <span style={{color:isDarkMode?"#e2e8f0":"#7f1d1d",fontWeight:800}}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Scoring Component Buttons */}
      <div style={{background:su,border:`1px solid ${bd}`,borderRadius:8,padding:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>
          {activeSet==="1min"?"1-Minute":"5-Minute"} APGAR — Select Score for Each Component
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {APGAR_CATS.map(cat=>(
            <div key={cat.key}>
              <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:6}}>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:t}}>{cat.letter}</span>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,color:t}}> — {cat.label}</span>
                <span style={{fontSize:9,color:mu}}>({cat.sublabel})</span>
                {activeScores[cat.key]!==""&&<span style={{marginLeft:"auto",fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:800,color:scoreColor(+activeScores[cat.key])}}>{activeScores[cat.key]}</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5}}>
                {cat.opts.map(opt=>{
                  const sel = activeScores[cat.key]===opt.v || activeScores[cat.key]===String(opt.v);
                  const oc  = opt.v===2?"#4ade80":opt.v===1?"#facc15":"#f87171";
                  return(
                    <button key={opt.v} onClick={()=>setActiveScores(p=>({...p,[cat.key]:opt.v}))}
                      style={{padding:"9px 4px",borderRadius:8,border:`1.5px solid ${sel?oc:bd}`,
                        background:sel?(isDarkMode?`${oc}18`:"#f0f9f4"):"transparent",
                        color:sel?oc:mu,
                        fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:sel?800:500,
                        cursor:"pointer",textAlign:"center",lineHeight:1.5,transition:"all 0.12s"}}>
                      {opt.l}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Score Summary Table */}
      {(total1!==null||total5!==null||Object.values(scores1).some(v=>v!=="")||Object.values(scores5).some(v=>v!==""))&&(
        <div style={{background:su,border:`1px solid ${bd}`,borderRadius:8,padding:12}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Score Summary</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:"8px 16px",alignItems:"center"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:mu}}/>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textAlign:"center"}}>1 MIN</div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textAlign:"center"}}>5 MIN</div>
            {APGAR_CATS.map(cat=>(
              <React.Fragment key={cat.key}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:t,fontWeight:600}}>{cat.letter} – {cat.label}</div>
                <div style={{textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:800,color:scores1[cat.key]===""?mu:scoreColor(+scores1[cat.key])}}>{scores1[cat.key]===""?"·":scores1[cat.key]}</div>
                <div style={{textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:800,color:scores5[cat.key]===""?mu:scoreColor(+scores5[cat.key])}}>{scores5[cat.key]===""?"·":scores5[cat.key]}</div>
              </React.Fragment>
            ))}
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:t,borderTop:`1px solid ${bd}`,paddingTop:8,marginTop:4}}>TOTAL</div>
            <div style={{textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:800,color:total1!==null?scoreColor(total1):mu,borderTop:`1px solid ${bd}`,paddingTop:8,marginTop:4}}>{total1!==null?`${total1}/10`:"—"}</div>
            <div style={{textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:800,color:total5!==null?scoreColor(total5):mu,borderTop:`1px solid ${bd}`,paddingTop:8,marginTop:4}}>{total5!==null?`${total5}/10`:"—"}</div>
          </div>
        </div>
      )}

      {/* NRP Response Guide */}
      <div style={{background:isDarkMode?"#0d1120":"#f8fafc",border:`1px solid ${bd}`,borderRadius:8,padding:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#60a5fa",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>NRP Response Guide</div>
        {[
          ["7–10","Reassuring","#4ade80","Continue warmth, drying, and stimulation. Standard newborn care. Reassess at 5 min."],
          ["4–6","Moderate","#facc15","Stimulate (rub back, flick soles of feet), position airway, apply supplemental O₂. Reassess response closely. Prepare PPV if no improvement."],
          ["0–3","Severe — NRP","#f87171","WARMTH → DRY → STIMULATE → POSITION AIRWAY → SUCTION (if needed). If apneic or HR <100 after stimulation: initiate PPV immediately. If HR <60 after 30 sec of effective PPV: begin chest compressions."],
        ].map(([range,label,color,action])=>(
          <div key={range} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
            <div style={{flexShrink:0,background:isDarkMode?"#00000030":"#f0f4ff",borderRadius:6,padding:"4px 8px",textAlign:"center"}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color}}>{range}</div>
            </div>
            <div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{label}</div>
              <div style={{fontSize:11,color:mu,lineHeight:1.55}}>{action}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BurnProtocolAlgorithm({ patientType, totals, active, values, setValues, onBack, isDarkMode, surface, onJumpDrug, findDrugLocation, activeCall, wkg, wlb, setWkg, setWlb }) {
  const setAnswer = (id, value) => setValues(prev => ({ ...prev, [id]: value }));
  const thirdDegreeTbsa = totals.byDegree[3] || 0;
  const hasDeepBurn = thirdDegreeTbsa > 0;
  const tbsaThreshold = patientType === "peds" ? 5 : 10;
  const tbsaConsult = totals.total >= tbsaThreshold;
  const burnCenterTriggers = [
    patientType === "peds",
    tbsaConsult,
    hasDeepBurn,
    values.inhalation === "yes",
    values.chemical === "yes",
    values.electrical === "yes",
    values.criticalArea === "yes",
    values.circumferential === "yes",
    values.trauma === "yes",
    values.pain === "yes",
    values.comorbidity === "yes",
  ];
  const consultRecommended = burnCenterTriggers.some(Boolean);
  const immediateActions = [
    "Scene safe, stop the burning process, remove heat source.",
    "Primary survey: airway, breathing, circulation, disability, exposure.",
    "Remove jewelry and non-adherent clothing. Do not pull material stuck to skin.",
    "Cool thermal burn with cool running water when practical; avoid ice and prevent hypothermia.",
    "Cover with clean dry sterile dressing or sheet; keep the patient warm.",
    "Estimate TBSA using the map, document depth, reassess vitals, treat pain per protocol.",
  ];
  const specialActions = [];
  if(values.inhalation === "yes") specialActions.push("Airway alert: high-flow oxygen, prepare early airway support, rapid transport.");
  if(values.chemical === "yes") specialActions.push("Chemical burn: remove contaminated items and irrigate; protect providers from exposure.");
  if(values.electrical === "yes") specialActions.push("Electrical burn: cardiac monitor, 12-lead when available, evaluate trauma and entry/exit wounds.");
  if(values.circumferential === "yes") specialActions.push("Circumferential burn: monitor distal PMS and ventilatory restriction; notify receiving facility early.");
  if(values.trauma === "yes") specialActions.push("Trauma present: control hemorrhage and follow trauma triage if trauma is the immediate life threat.");
  if(values.pain === "yes") specialActions.push("Pain uncontrolled: escalate analgesia per local protocol and consider burn-center consultation.");
  if(active.length === 0) specialActions.push("No TBSA areas selected yet: mark burn regions on the Rule of 9s map before final destination decision.");
  const burnMedRules = [
    { med:"Fentanyl", state:values.pain === "yes" ? "consider" : "pending", note:"Consider for burn pain per protocol after vitals/respiratory screen." },
    { med:"Morphine Sulfate", state:values.pain === "yes" ? "consider" : "pending", note:"Consider if pain persists and hemodynamics allow." },
    { med:"Ketamine", state:values.pain === "yes" ? "consider" : "pending", note:"Consider for severe pain or difficult analgesia per protocol." },
    { med:"Albuterol", state:values.inhalation === "yes" ? "consider" : "pending", note:"Consider if inhalation exposure includes bronchospasm/wheezing." },
    { med:"Normal Saline (0.9% NaCl)", state:totals.total >= (patientType === "peds" ? 10 : 20) ? "consider" : "pending", note:"Consider burn fluid pathway for major TBSA burns per local protocol." },
  ];
  const pedsWeightBlocked = patientType === "peds" && (!wkg || wkg <= 0);

  return (
    <section style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={onBack} style={{width:34,height:34,borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-input)",color:"var(--c-text)",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800}}>←</button>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:"var(--c-text)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Burn Protocol</div>
            <div style={{fontSize:11,color:"var(--c-text4)",marginTop:2}}>Interactive field algorithm</div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:22,fontWeight:800,color:"#ef4444",lineHeight:1}}>{Number.isInteger(totals.total) ? totals.total : +totals.total.toFixed(2)}%</div>
            <div style={{fontSize:9,color:"var(--c-text4)",fontFamily:"'IBM Plex Mono',monospace"}}>TBSA</div>
          </div>
        </div>
      </div>

      <div style={{background:consultRecommended?(isDarkMode?"#160b0b":"#f5d2d2"):(isDarkMode?"#071a0e":"#d9eadf"),border:`1px solid ${consultRecommended?(isDarkMode?"#7f1d1d":"#b91c1c"):(isDarkMode?"#14532d":"#15803d")}`,borderRadius:8,padding:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:consultRecommended?(isDarkMode?"#fca5a5":"#7f1d1d"):(isDarkMode?"#86efac":"#064e3b"),letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:5}}>
          {consultRecommended ? "Burn center consult / transfer trigger" : "No major transfer trigger selected"}
        </div>
        <div style={{fontSize:12,lineHeight:1.45,color:isDarkMode?"var(--c-text2)":"#111827"}}>
          {consultRecommended
            ? "Notify medical control and receiving facility early. Use local destination rules and transport to the appropriate burn or trauma center."
            : "Continue local protocol, wound care, pain control, and reassessment. Recheck destination if findings change."}
        </div>
      </div>

      {pedsWeightBlocked && <PedsProtocolWeightGate wkg={wkg} wlb={wlb} setWkg={setWkg} setWlb={setWlb} isDarkMode={isDarkMode}/>}

      {surface}

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Decision points</div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {BURN_PROTOCOL_QUESTIONS.map(q => (
            <div key={q.id} style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:7,padding:9}}>
              <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:800,color:"var(--c-text)"}}>{q.label}</div>
                  <div style={{fontSize:10.5,color:"var(--c-text4)",lineHeight:1.35,marginTop:2}}>{q.detail}</div>
                </div>
                <div style={{display:"flex",gap:5}}>
                  {["yes","no"].map(answer => {
                    const selected = values[q.id] === answer;
                    return (
                      <button key={answer} onClick={()=>{setAnswer(q.id, answer);activeCall?.onLogEvent("Decision",`${q.label} ${answer.toUpperCase()}`);}} style={{minWidth:38,padding:"6px 7px",borderRadius:6,border:selected?`1px solid ${answer==="yes"?"#ef4444":"#22c55e"}`:"1px solid var(--c-border-sub)",background:selected?(answer==="yes"?(isDarkMode?"#2a0808":"#fee2e2"):(isDarkMode?"#071a0e":"#dcfce7")):"transparent",color:selected?(answer==="yes"?(isDarkMode?"#fca5a5":"#7f1d1d"):(isDarkMode?"#86efac":"#064e3b")):"var(--c-text4)",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:"pointer",textTransform:"uppercase"}}>
                        {answer}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Algorithm</div>
        {[...immediateActions, ...specialActions].map((item, index) => (
          <div key={`${item}-${index}`} style={{display:"grid",gridTemplateColumns:"22px 1fr",gap:8,alignItems:"start",padding:"7px 0",borderTop:index===0?"none":"1px solid var(--c-border-sub)"}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:isDarkMode?"#0d1f3a":"#dbeafe",color:isDarkMode?"#93c5fd":"#172554",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800}}>{index+1}</div>
            <div style={{fontSize:12,color:"var(--c-text2)",lineHeight:1.45}}>{item}</div>
          </div>
        ))}
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:7}}>Medication considerations</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {burnMedRules.map(rule => {
            const isConsider = rule.state === "consider";
            return (
              <button key={rule.med} onClick={()=>{if(isConsider){activeCall?.onSelectMed?.(rule.med, "Burn Protocol");}}} disabled={!isConsider || pedsWeightBlocked} title={pedsWeightBlocked ? "Enter pediatric weight first" : isConsider ? `Select ${rule.med} within this protocol` : rule.note} style={{border:isConsider?"1px solid #ef4444":"1px solid var(--c-border-sub)",background:isConsider?(isDarkMode?"#2a080822":"#fee2e2"):"var(--c-input)",borderRadius:6,padding:"7px 8px",fontSize:11,color:isConsider?"#ef4444":"var(--c-text-ghost)",fontWeight:800,cursor:isConsider&&!pedsWeightBlocked?"pointer":"default",opacity:pedsWeightBlocked?0.55:1,fontFamily:"'DM Sans',sans-serif",textAlign:"left"}}>
                <span style={{display:"block",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>{isConsider ? "Consider" : "Pending"} - {rule.med}</span>
                <span style={{display:"block",marginTop:2,color:isDarkMode?"var(--c-text4)":"#374151",fontSize:10.5,lineHeight:1.35,fontWeight:600}}>{rule.note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ActiveCallWorkspace
        protocolTitle="Burn Protocol"
        events={activeCall.events}
        vitalsDraft={activeCall.vitalsDraft}
        setVitalsDraft={activeCall.setVitalsDraft}
        onLogEvent={activeCall.onLogEvent}
        onClear={activeCall.onClear}
        onLogMed={activeCall.onLogMed}
        now={activeCall.now}
        isDarkMode={isDarkMode}
        medLog={activeCall.medLog}
        activeMeds={activeCall.activeMeds}
      />

      <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10,color:"var(--c-text4)",fontSize:10.5,lineHeight:1.45}}>
        Reference guidance: superficial burns are not counted in TBSA; partial/full-thickness burns are counted. Follow local protocols, medical direction, and receiving-facility guidance.
      </div>
    </section>
  );
}

function ProtocolsScreen({ mode, setMode, isDarkMode, burnMaps, setBurnMaps, onJumpDrug, findDrugLocation, wkg, wlb, setWkg, setWlb, authUser, initialSystem="assess" }) {
  const [selectedSystem, setSelectedSystem] = useState(initialSystem);
  const [sysDropOpen, setSysDropOpen] = useState(false);
  const [activeProtocol, setActiveProtocol] = useState(null);
  const [protocolValues, setProtocolValues] = useState({});
  const [protocolEvents, setProtocolEvents] = useState([]);
  const [protocolVitalsDraft, setProtocolVitalsDraft] = useState({});
  const [protocolMedLog, setProtocolMedLog] = useState({});
  const [protocolActiveMeds, setProtocolActiveMeds] = useState([]);
  const [protocolNow, setProtocolNow] = useState(Date.now());
  const patientType = mode === "peds" ? "peds" : "adult";
  const regions = BURN_REGIONS[patientType];
  const selectedSystemInfo = PROTOCOL_SYSTEMS.find(system => system.id === selectedSystem) || PROTOCOL_SYSTEMS[0];
  const sysColor = (sys) => (!isDarkMode && sys.lightColor) ? sys.lightColor : sys.color;
  const modeFilter = p => patientType === "adult"
    ? (!p.patientType || p.patientType === "adult" || p.patientType === "both")
    : (p.patientType === "peds" || p.patientType === "both");
  const availableProtocols = PROTOCOL_DEFINITIONS.filter(p => p.system === selectedSystem && modeFilter(p));
  const currentProtocol = PROTOCOL_DEFINITIONS.find(protocol => protocol.id === activeProtocol);
  const totals = useMemo(() => {
    const byDegree = { 1:0, 2:0, 3:0 };
    const burnMap = burnMaps[patientType] || {};
    regions.forEach(region => {
      const depth = burnMap[region.id] || 0;
      if(depth) byDegree[depth] += region.pct;
    });
    return { total: byDegree[1] + byDegree[2] + byDegree[3], byDegree };
  }, [burnMaps, patientType, regions]);
  const active = regions.filter(region => (burnMaps[patientType] || {})[region.id]);
  const logProtocolEvent = useCallback((type, detail) => {
    setProtocolEvents(prev => [{ id:Date.now()+Math.random(), ts:Date.now(), type, detail }, ...prev]);
  }, []);
  useEffect(()=>{
    const id=setInterval(()=>setProtocolNow(Date.now()),1000);
    return()=>clearInterval(id);
  },[]);
  const selectProtocolMed = useCallback((name, protocolTitle) => {
    const ts = Date.now();
    const safety = PROTOCOL_MED_SAFETY[name] || {};
    setProtocolActiveMeds(prev => prev.includes(name) ? prev : [name, ...prev]);
    setProtocolMedLog(prev => {
      const times = prev[name] || [];
      const lastAt = times[times.length - 1];
      const intervalSecs = safety.interval ? safety.interval * 60 : null;
      const elapsed = lastAt ? Math.floor((ts - lastAt) / 1000) : null;
      const maxReached = safety.max != null && times.length >= safety.max;
      const tooSoon = intervalSecs && elapsed != null && elapsed < intervalSecs;
      if(maxReached || tooSoon){
        const detail = maxReached
          ? `${name} blocked: max dose reached`
          : `${name} blocked: reassess/re-dose in ${fmt(intervalSecs - elapsed)}`;
        setProtocolEvents(events => [{ id:ts+Math.random(), ts, type:"Medication safety hold", detail }, ...events]);
        return prev;
      }
      setProtocolEvents(events => [{
        id:ts+Math.random(),
        ts,
        type:"Medication given",
        detail:`${name} from ${protocolTitle}${safety.interval?` | next reassess ${safety.interval} min`:" | reassess per protocol"}`,
      }, ...events]);
      return { ...prev, [name]: [...times, ts] };
    });
  }, []);
  const logProtocolMed = useCallback((name) => {
    const safety = PROTOCOL_MED_SAFETY[name] || {};
    setProtocolMedLog(prev => ({ ...prev, [name]: [...(prev[name] || []), Date.now()] }));
    setProtocolEvents(prev => [{ id:Date.now()+Math.random(), ts:Date.now(), type:"Medication given", detail:`${name}${safety.interval?` | next reassess ${safety.interval} min`:" | single-dose/reassess per protocol"}` }, ...prev]);
  }, []);
  const activeCall = {
    events: protocolEvents,
    vitalsDraft: protocolVitalsDraft,
    setVitalsDraft: setProtocolVitalsDraft,
    onLogEvent: logProtocolEvent,
    onSelectMed: selectProtocolMed,
    onLogMed: logProtocolMed,
    onClear: () => {
      setProtocolEvents([]);
      setProtocolMedLog({});
      setProtocolActiveMeds([]);
      setProtocolVitalsDraft({});
    },
    medLog: protocolMedLog,
    activeMeds: protocolActiveMeds,
    now: protocolNow,
  };

  if(currentProtocol?.special === "apgar") {
    return <ApgarAlgorithm onBack={()=>setActiveProtocol(null)} isDarkMode={isDarkMode}/>;
  }

  if(currentProtocol?.special === "burns") {
    return (
      <BurnProtocolAlgorithm
        patientType={patientType}
        totals={totals}
        active={active}
        values={protocolValues}
        setValues={setProtocolValues}
        onBack={()=>setActiveProtocol(null)}
        isDarkMode={isDarkMode}
        surface={<BurnsTool mode={mode} setMode={setMode} isDarkMode={isDarkMode} burnMaps={burnMaps} setBurnMaps={setBurnMaps} embedded/>}
        onJumpDrug={onJumpDrug}
        findDrugLocation={findDrugLocation}
        activeCall={activeCall}
        wkg={wkg}
        wlb={wlb}
        setWkg={setWkg}
        setWlb={setWlb}
      />
    );
  }

  if(currentProtocol) {
    return (
      <GenericProtocolAlgorithm
        protocol={currentProtocol}
        values={protocolValues}
        setValues={setProtocolValues}
        onBack={()=>setActiveProtocol(null)}
        isDarkMode={isDarkMode}
        onJumpDrug={onJumpDrug}
        findDrugLocation={findDrugLocation}
        activeCall={activeCall}
        patientType={patientType}
        wkg={wkg}
        wlb={wlb}
        setWkg={setWkg}
        setWlb={setWlb}
      />
    );
  }

  return (
    <section style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#c084fc"}}/>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,color:"var(--c-text)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Protocols</div>
            <div style={{fontSize:11,color:"var(--c-text4)",marginTop:2}}>Guided treatment workflows by body system</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:3,gap:3}}>
          {[["adult","ADULT"],["peds","PEDS"]].map(([key,label])=>(
            <button key={key} onClick={()=>setMode(key)} style={{padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,letterSpacing:"0.08em",background:patientType===key?(key==="adult"?(isDarkMode?"#0d1f3a":"#9fbce2"):(isDarkMode?"#0a2318":"#99c7ae")):"transparent",color:patientType===key?(key==="adult"?(isDarkMode?"#93c5fd":"#172554"):(isDarkMode?"#86efac":"#064e3b")):"var(--c-text4)"}}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{position:"relative"}}>
        {sysDropOpen&&<div onClick={()=>setSysDropOpen(false)} style={{position:"fixed",inset:0,zIndex:98}}/>}
        <button
          onClick={()=>setSysDropOpen(v=>!v)}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,border:`1px solid ${sysColor(selectedSystemInfo)}`,background:sysColor(selectedSystemInfo)+"22",color:sysColor(selectedSystemInfo),fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",letterSpacing:"0.06em",boxSizing:"border-box"}}
        >
          <span>{selectedSystemInfo.label} · {PROTOCOL_DEFINITIONS.filter(p=>p.system===selectedSystem&&modeFilter(p)).length} protocols</span>
          <span style={{fontSize:9,opacity:0.7}}>{sysDropOpen?"▲":"▼"}</span>
        </button>
        {sysDropOpen&&(
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:99,background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:4,display:"grid",gap:3,boxShadow:"0 8px 24px rgba(0,0,0,0.25)"}}>
            {PROTOCOL_SYSTEMS.map(system=>{
              const count=PROTOCOL_DEFINITIONS.filter(p=>p.system===system.id&&modeFilter(p)).length;
              const active=selectedSystem===system.id;
              return(
                <button key={system.id} onClick={()=>{setSelectedSystem(system.id);setSysDropOpen(false);}} style={{padding:"11px 14px",borderRadius:8,border:active?`1px solid ${sysColor(system)}`:"none",background:active?sysColor(system)+"22":"transparent",color:active?sysColor(system):"var(--c-text4)",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>{system.label}</span>
                  <span style={{fontSize:10,opacity:0.6}}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:sysColor(selectedSystemInfo),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>{selectedSystemInfo.label} protocols</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {(()=>{
            const CERT_SCOPE_MAP_PROTO={EMT:"EMT",AEMT:"AEMT",Paramedic:"Medic"};
            const scopeRank={EMT:1,AEMT:2,Medic:3};
            const SCOPE_BADGE_COLORS={EMT:{bg:"#052e16",text:"#86efac",border:"#166534"},AEMT:{bg:"#1e3a5f",text:"#93c5fd",border:"#1e40af"},Medic:{bg:"#3b1a6a",text:"#d8b4fe",border:"#7c3aed"}};
            const fullRoles=["Student","PaidGuest"];
            const certKey=(authUser?.certLevel && !fullRoles.includes(authUser?.role)) ? CERT_SCOPE_MAP_PROTO[authUser.certLevel] : null;
            const certRank=certKey ? (scopeRank[certKey]||3) : 3;
            return availableProtocols.map(protocol => {
              const pRank=protocol.scope ? (scopeRank[protocol.scope]||1) : 1;
              const locked=certKey && pRank>certRank;
              const badgeColor=protocol.scope ? SCOPE_BADGE_COLORS[protocol.scope] : null;
              return (
                <button
                  key={protocol.id}
                  onClick={()=>{ if(!locked) setActiveProtocol(protocol.id); }}
                  style={{
                    minHeight:96,
                    textAlign:"left",
                    border:`1px solid ${locked?"var(--c-border-sub)":sysColor(selectedSystemInfo)}`,
                    borderLeft:`4px solid ${locked?"#6b7280":sysColor(selectedSystemInfo)}`,
                    background:locked?"var(--c-nav)":"var(--c-input)",
                    color:locked?"var(--c-text4)":"var(--c-text)",
                    borderRadius:8,
                    padding:10,
                    cursor:locked?"not-allowed":"pointer",
                    opacity:locked?0.6:1,
                    position:"relative",
                  }}
                >
                  {protocol.scope && badgeColor && (
                    <div style={{position:"absolute",top:6,right:6,background:badgeColor.bg,color:badgeColor.text,border:`1px solid ${badgeColor.border}`,borderRadius:4,padding:"1px 5px",fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,letterSpacing:"0.08em"}}>
                      {locked?"🔒 ":""}{protocol.scope==="Medic"?"MEDIC":protocol.scope}
                    </div>
                  )}
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:locked?"var(--c-text4)":sysColor(selectedSystemInfo),marginBottom:5,paddingRight:protocol.scope?36:0}}>{protocol.title}</div>
                  <div style={{fontSize:11,color:"var(--c-text4)",lineHeight:1.35}}>{protocol.sub}</div>
                  <div style={{marginTop:10,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:locked?"#6b7280":sysColor(selectedSystemInfo),textTransform:"uppercase"}}>
                    {locked?"🔒 Scope locked":("Start protocol")}
                  </div>
                </button>
              );
            });
          })()}
        </div>
      </div>

      <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10,color:"var(--c-text4)",fontSize:10.5,lineHeight:1.45}}>
        Select a body system, start a protocol, then use the active-call panel to capture vitals, decisions, interventions, and medications without leaving the guided workflow.
      </div>
    </section>
  );
}

function BurnsTool({ mode, setMode, isDarkMode, burnMaps, setBurnMaps, embedded=false }) {
  const patientType = mode === "peds" ? "peds" : "adult";
  const burnMap = burnMaps[patientType] || {};
  const regions = BURN_REGIONS[patientType];
  const totals = useMemo(() => {
    const byDegree = { 1:0, 2:0, 3:0 };
    regions.forEach(region => {
      const depth = burnMap[region.id] || 0;
      if(depth) byDegree[depth] += region.pct;
    });
    return { total: byDegree[1] + byDegree[2] + byDegree[3], byDegree };
  }, [burnMap, regions]);
  const active = regions.filter(region => burnMap[region.id]);
  const fmtPct = value => Number.isInteger(value) ? value : +value.toFixed(2);
  const toggleRegion = id => {
    setBurnMaps(prev => {
      const current = prev[patientType] || {};
      const nextDepth = ((current[id] || 0) + 1) % BURN_DEPTHS.length;
      const nextMap = { ...current };
      if(nextDepth) nextMap[id] = nextDepth; else delete nextMap[id];
      return { ...prev, [patientType]: nextMap };
    });
  };
  const clear = () => setBurnMaps(prev => ({ ...prev, [patientType]: {} }));

  return (
    <section style={{display:"flex",flexDirection:"column",gap:10}}>
      {!embedded&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:3,gap:3}}>
          {[["adult","ADULT"],["peds","PEDS"]].map(([key,label])=>(
            <button key={key} onClick={()=>setMode(key)} style={{padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11.5,fontWeight:800,letterSpacing:"0.08em",background:patientType===key?(key==="adult"?(isDarkMode?"#0d1f3a":"#9fbce2"):(isDarkMode?"#0a2318":"#99c7ae")):"transparent",color:patientType===key?(key==="adult"?(isDarkMode?"#93c5fd":"#172554"):(isDarkMode?"#86efac":"#064e3b")):"var(--c-text4)"}}>{label}</button>
          ))}
        </div>
      )}

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#ef4444"}}/>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:"var(--c-text)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Rule of 9s Burn Surface</div>
            <div style={{fontSize:11,color:"var(--c-text4)",marginTop:2}}>{patientType==="adult"?"Adult":"Pediatric"} TBSA estimate</div>
          </div>
          <button onClick={clear} style={{marginLeft:"auto",border:"1px solid var(--c-border)",background:"var(--c-input)",color:"var(--c-text4)",borderRadius:6,padding:"5px 8px",fontSize:10,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer"}}>Clear</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <BurnMapFigure side="front" patientType={patientType} burnMap={burnMap} onToggle={toggleRegion} isDarkMode={isDarkMode}/>
          <BurnMapFigure side="back" patientType={patientType} burnMap={burnMap} onToggle={toggleRegion} isDarkMode={isDarkMode}/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1.15fr .85fr",gap:8}}>
        <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:11}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Burn depth</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {[1,2,3].map(depth=>(
              <div key={depth} style={{border:`1px solid ${BURN_DEPTHS[depth].border}`,background:BURN_DEPTHS[depth].color,borderRadius:6,padding:"7px 4px",textAlign:"center",color:isDarkMode?"#fff":"#111827",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800}}>
                {BURN_DEPTHS[depth].label}<br/>{fmtPct(totals.byDegree[depth])}%
              </div>
            ))}
          </div>
        </div>
        <div style={{background:isDarkMode?"#160b0b":"#f5d2d2",border:isDarkMode?"1px solid #7f1d1d":"1px solid #b91c1c",borderRadius:8,padding:11,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center"}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:isDarkMode?"#fca5a5":"#7f1d1d",letterSpacing:"0.1em",textTransform:"uppercase"}}>Total TBSA</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:34,fontWeight:800,color:isDarkMode?"#fecaca":"#7f1d1d",lineHeight:1}}>{fmtPct(totals.total)}%</div>
        </div>
      </div>

      <div style={{background:"var(--c-surface)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:10}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"var(--c-text4)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:7}}>Selected areas</div>
        {active.length===0 ? (
          <div style={{color:"var(--c-text-ghost)",fontSize:12}}>No burn areas selected</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {active.map(region=>{
              const depth = burnMap[region.id];
              return (
                <button key={region.id} onClick={()=>toggleRegion(region.id)} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,alignItems:"center",textAlign:"left",background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:6,padding:"7px 8px",cursor:"pointer",color:"var(--c-text)"}}>
                  <span style={{fontSize:12,fontWeight:700}}>{region.name}</span>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"var(--c-text4)"}}>{region.pct}%</span>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:BURN_DEPTHS[depth].border}}>{BURN_DEPTHS[depth].label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const AUTH_USERS_KEY = "medic-ai-users";
const GUEST_COUNT_KEY = "medic-ai-guest-count";

function getGuestCount(){
  if(typeof window==="undefined") return 0;
  return parseInt(localStorage.getItem(GUEST_COUNT_KEY)||"0",10);
}
function incrementGuestCount(){
  if(typeof window!=="undefined") localStorage.setItem(GUEST_COUNT_KEY,String(getGuestCount()+1));
}

const PAID_ACCESS_KEY  = "medic-ai-paid-access";
const PAID_ACCESS_PRICE = "$4.99";
const VALID_SCHOOL_CODES = ["EMSCLASS2025","NREMT-PREP","MEDIC-EDU101","AAOS-ACCESS"];

function getPaidAccess(){
  if(typeof window==="undefined") return null;
  try{
    const raw=localStorage.getItem(PAID_ACCESS_KEY);
    if(!raw) return null;
    const d=JSON.parse(raw);
    if(Date.now()>d.expiresAt){ localStorage.removeItem(PAID_ACCESS_KEY); return null; }
    return d;
  }catch{ return null; }
}
function activatePaidAccess(certLevel){
  const d={ purchasedAt:Date.now(), expiresAt:Date.now()+24*3600*1000, certLevel:certLevel||null };
  if(typeof window!=="undefined") localStorage.setItem(PAID_ACCESS_KEY,JSON.stringify(d));
  return d;
}
function updatePaidAccessCertLevel(certLevel){
  const d=getPaidAccess();
  if(d) localStorage.setItem(PAID_ACCESS_KEY,JSON.stringify({...d,certLevel}));
}

function getStoredUsers(){
  if(typeof window==="undefined") return [];
  try {
    const users = JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || "[]");
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveStoredUsers(users){
  if(typeof window!=="undefined") localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function generateCallId() {
  const now = new Date();
  const d = now.toISOString().slice(0,10).replace(/-/g,"");
  const t = now.toTimeString().slice(0,5).replace(":","");
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `ROMAN-${d}-${t}-${rand}`;
}

const TC_LOG_KEY = "medic-ai-tc-log";
function logTCAcceptance(user) {
  if(typeof window === "undefined") return;
  try {
    const existing = JSON.parse(localStorage.getItem(TC_LOG_KEY) || "[]");
    existing.push({
      name:       user?.name      || "Unknown",
      email:      user?.email     || "unknown",
      role:       user?.role      || "unknown",
      certLevel:  user?.certLevel || null,
      acceptedAt: new Date().toISOString(),
    });
    localStorage.setItem(TC_LOG_KEY, JSON.stringify(existing));
  } catch {}
}

function providerNameFromEmail(email){
  const label=email.split("@")[0].replace(/[._-]+/g," ").trim() || "Provider";
  return label.replace(/\b\w/g,c=>c.toUpperCase());
}

function GuestBlockedScreen({ isDarkMode, onLogin, onSignup, onStudentCode, on24hr, onToggleTheme }) {
  const bg = "#020617";
  const text = "#f8fafc";
  const muted = "#94a3b8";
  const buttonBase = { width:"100%", height:52, borderRadius:10, fontSize:16, fontWeight:800, cursor:"pointer", border:"none", fontFamily:"'DM Sans',sans-serif" };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:"#020617",color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center",alignItems:"center"}}>
        <div style={{width:"100%",maxWidth:430,padding:"32px 20px",display:"flex",flexDirection:"column",gap:0}}>

          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:48,marginBottom:16}}>🔒</div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:1.2,color:"#14b8a6",marginBottom:10}}>Guest limit reached</div>
            <h1 style={{fontSize:30,fontWeight:800,color:text,margin:"0 0 12px",lineHeight:1.1}}>You've used your 2 free sessions.</h1>
            <p style={{fontSize:15,color:muted,lineHeight:1.6}}>Choose how you'd like to continue.</p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={onSignup} style={{...buttonBase,background:"linear-gradient(135deg,#2dd4bf,#0284c7)",color:"#fff",border:"1px solid rgba(125,249,255,.88)",boxShadow:"0 14px 34px rgba(20,184,166,.26)"}}>Create Free Account</button>
            <button onClick={onLogin} style={{...buttonBase,background:"rgba(2,14,38,.9)",color:"#f8fafc",border:"1px solid rgba(125,249,255,.72)"}}>Log In</button>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:2}}>
              <button onClick={onStudentCode} style={{height:48,borderRadius:10,border:"1px solid #7c3aed",background:"rgba(124,58,237,.15)",color:"#d8b4fe",fontWeight:800,fontSize:14,cursor:"pointer"}}>🎓 School Code</button>
              <button onClick={on24hr} style={{height:48,borderRadius:10,border:"1px solid #d97706",background:"rgba(217,119,6,.12)",color:"#fde68a",fontWeight:800,fontSize:14,cursor:"pointer"}}>⚡ 24hr — {PAID_ACCESS_PRICE}</button>
            </div>
            <p style={{fontSize:12,color:muted,textAlign:"center",marginTop:4,lineHeight:1.5}}>
              EMS student? Enter your school access code for full, unlimited access.
            </p>
          </div>

        </div>
      </main>
    </>
  );
}

function StudentCodeScreen({ isDarkMode, onBack, onEnter, onToggleTheme }){
  const bg=isDarkMode?"#060a15":"#f4efe7";
  const panel=isDarkMode?"#0d1120":"#fbf7f0";
  const text=isDarkMode?"#e2e8f0":"#0f172a";
  const muted=isDarkMode?"#8aa0c2":"#374151";
  const border=isDarkMode?"#1a2338":"#9a9286";
  const inputBg=isDarkMode?"#090e1c":"#f2ece4";
  const[code,setCode]=useState("");
  const[error,setError]=useState("");
  const[step,setStep]=useState("code"); // "code" | "level"
  const[validCode,setValidCode]=useState("");
  const inp={width:"100%",height:46,borderRadius:8,border:`1px solid ${border}`,background:inputBg,color:text,padding:"0 13px",outline:"none",fontSize:16,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.12em",textTransform:"uppercase"};

  function handleSubmit(e){
    e.preventDefault();
    const t=code.trim().toUpperCase();
    if(VALID_SCHOOL_CODES.includes(t)){ setValidCode(t); setStep("level"); }
    else setError("Invalid access code. Check with your instructor or program director.");
  }

  const LEVELS=[
    {key:"EMT",       label:"EMT",        sub:"Basic life support · EMT-level drugs & protocols",      bd:"#166534", bg:isDarkMode?"#052e16":"#f0fdf4", fg:isDarkMode?"#86efac":"#14532d"},
    {key:"AEMT",      label:"AEMT",        sub:"EMT + advanced airway · AEMT-level drugs & protocols",  bd:"#1e40af", bg:isDarkMode?"#060f1e":"#eff6ff", fg:isDarkMode?"#93c5fd":"#1e3a8a"},
    {key:"Paramedic", label:"Paramedic",   sub:"Full ALS · all drugs, all protocols",                   bd:"#7c3aed", bg:isDarkMode?"#100a1f":"#faf5ff", fg:isDarkMode?"#d8b4fe":"#4c1d95"},
  ];

  return(
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 32px",display:"flex",flexDirection:"column"}}>
          <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
            <button onClick={step==="level"?()=>setStep("code"):onBack} style={{height:38,padding:"0 13px",borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:700}}>← Back</button>
            <button onClick={onToggleTheme} style={{width:38,height:38,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:800}}>{isDarkMode?"L":"D"}</button>
          </header>

          {step==="code"&&(<>
            <div style={{marginBottom:18}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#a78bfa",marginBottom:8}}>🎓 Student Access</div>
              <h1 style={{fontSize:32,lineHeight:1.1,fontWeight:800,color:text,margin:"0 0 10px"}}>Enter your school access code.</h1>
              <p style={{fontSize:14.5,lineHeight:1.6,color:muted}}>Your instructor or EMS program director will provide a school access code. Access is scoped to your cert level.</p>
            </div>
            <form onSubmit={handleSubmit} style={{background:panel,border:`1px solid ${border}`,borderRadius:10,padding:18,display:"grid",gap:14}}>
              <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
                School Access Code
                <input value={code} onChange={e=>{setCode(e.target.value);setError("");}} placeholder="ENTER-YOUR-CODE" style={inp} autoFocus autoComplete="off" spellCheck={false}/>
              </label>
              {error&&<div style={{border:"1px solid #fecaca",background:isDarkMode?"#2a0808":"#fff1f2",color:isDarkMode?"#fecaca":"#991b1b",borderRadius:8,padding:"10px 12px",fontSize:13}}>{error}</div>}
              <button type="submit" style={{height:50,borderRadius:9,border:"1px solid #7c3aed",background:"linear-gradient(135deg,#7c3aed,#5b21b6)",color:"#fff",fontWeight:800,cursor:"pointer",fontSize:15,letterSpacing:"0.01em"}}>
                Continue
              </button>
            </form>
            <p style={{fontSize:12,color:muted,textAlign:"center",marginTop:14,lineHeight:1.55}}>No account required. Contact your program director if you don't have a code.</p>
          </>)}

          {step==="level"&&(<>
            <div style={{marginBottom:24}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#a78bfa",marginBottom:8}}>🎓 Student Access</div>
              <h1 style={{fontSize:28,lineHeight:1.1,fontWeight:800,color:text,margin:"0 0 10px"}}>What level are you studying for?</h1>
              <p style={{fontSize:14,lineHeight:1.6,color:muted}}>Your drug and protocol access will be scoped to match your program level.</p>
            </div>
            <div style={{display:"grid",gap:10}}>
              {LEVELS.map(({key,label,sub,bd,bg:lbg,fg})=>(
                <button key={key} onClick={()=>onEnter(validCode,key)} style={{width:"100%",padding:"16px 18px",borderRadius:10,border:`1px solid ${bd}`,background:lbg,color:fg,fontWeight:800,fontSize:16,cursor:"pointer",textAlign:"left",display:"grid",gap:3}}>
                  {label}
                  <span style={{fontSize:12,fontWeight:500,opacity:0.8}}>{sub}</span>
                </button>
              ))}
            </div>
          </>)}
        </div>
      </main>
    </>
  );
}

function Purchase24hrScreen({ isDarkMode, onBack, onSuccess, onToggleTheme }){
  const bg=isDarkMode?"#060a15":"#f4efe7";
  const panel=isDarkMode?"#0d1120":"#fbf7f0";
  const text=isDarkMode?"#e2e8f0":"#0f172a";
  const muted=isDarkMode?"#8aa0c2":"#374151";
  const border=isDarkMode?"#1a2338":"#9a9286";
  const existing=getPaidAccess();
  const[step,setStep]=useState(()=>existing ? (existing.certLevel?"active":"certlevel") : "info");
  const[accessData,setAccessData]=useState(existing);

  function fmtRemaining(ms){
    if(ms<=0) return "Expired";
    const h=Math.floor(ms/3600000);
    const m=Math.floor((ms%3600000)/60000);
    return h>0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  }

  function handlePurchase(){
    // TODO: integrate Stripe or PayPal here before going live
    const d=activatePaidAccess(null);
    setAccessData(d);
    setStep("certlevel");
  }

  function handleCertLevel(certLevel){
    updatePaidAccessCertLevel(certLevel);
    onSuccess(certLevel);
  }

  const CERT_LEVELS=[
    {key:"EMT",       label:"EMT",       sub:"Basic life support · EMT-level drugs & protocols",     bd:"#166534", bg:isDarkMode?"#052e16":"#f0fdf4", fg:isDarkMode?"#86efac":"#14532d"},
    {key:"AEMT",      label:"AEMT",      sub:"EMT + advanced airway · AEMT-level drugs & protocols",  bd:"#1e40af", bg:isDarkMode?"#060f1e":"#eff6ff", fg:isDarkMode?"#93c5fd":"#1e3a8a"},
    {key:"Paramedic", label:"Paramedic", sub:"Full ALS · all drugs, all protocols",                   bd:"#7c3aed", bg:isDarkMode?"#100a1f":"#faf5ff", fg:isDarkMode?"#d8b4fe":"#4c1d95"},
  ];

  const features=[
    "Full drug calculator — all cert levels",
    "All adult & PALS guided protocols",
    "ACLS arrest tracker with real-time timers",
    "Patient vitals log & med documentation",
    "No session limits for 24 hours",
  ];

  if(step==="active"){
    const rem=accessData ? accessData.expiresAt-Date.now() : 0;
    return(
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button{font:inherit}`}</style>
        <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center",alignItems:"center",padding:20}}>
          <div style={{width:"100%",maxWidth:420,textAlign:"center",display:"grid",gap:16}}>
            <div style={{fontSize:52}}>⚡</div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#fbbf24"}}>Active Pass</div>
            <h2 style={{fontSize:28,fontWeight:800,color:text,margin:0}}>Your 24-hour pass is active</h2>
            <div style={{background:isDarkMode?"#1a1200":"#fffbeb",border:"1px solid #92400e",borderRadius:10,padding:"14px 16px",fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:800,color:"#fde68a"}}>
              {fmtRemaining(rem)}
            </div>
            <button onClick={()=>onSuccess(accessData?.certLevel)} style={{height:52,borderRadius:9,border:"1px solid #f59e0b",background:"linear-gradient(135deg,#d97706,#b45309)",color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer"}}>
              Enter R.O.M.A.N.
            </button>
            <button onClick={onBack} style={{background:"none",border:"none",color:muted,cursor:"pointer",fontSize:14,padding:"6px 0"}}>← Back</button>
          </div>
        </main>
      </>
    );
  }

  if(step==="certlevel"){
    return(
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button{font:inherit}`}</style>
        <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
          <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 32px",display:"flex",flexDirection:"column"}}>
            <div style={{marginBottom:28,marginTop:24}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#fbbf24",marginBottom:8}}>⚡ 24HR Pass</div>
              <h1 style={{fontSize:28,lineHeight:1.1,fontWeight:800,color:text,margin:"0 0 10px"}}>What's your cert level?</h1>
              <p style={{fontSize:14,lineHeight:1.6,color:muted}}>Your drug and protocol access will be scoped to your certification level.</p>
            </div>
            <div style={{display:"grid",gap:10}}>
              {CERT_LEVELS.map(({key,label,sub,bd,bg:lbg,fg})=>(
                <button key={key} onClick={()=>handleCertLevel(key)} style={{width:"100%",padding:"16px 18px",borderRadius:10,border:`1px solid ${bd}`,background:lbg,color:fg,fontWeight:800,fontSize:16,cursor:"pointer",textAlign:"left",display:"grid",gap:3}}>
                  {label}
                  <span style={{fontSize:12,fontWeight:500,opacity:0.8}}>{sub}</span>
                </button>
              ))}
            </div>
          </div>
        </main>
      </>
    );
  }

  return(
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 32px",display:"flex",flexDirection:"column"}}>
          <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
            <button onClick={onBack} style={{height:38,padding:"0 13px",borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:700}}>← Back</button>
            <button onClick={onToggleTheme} style={{width:38,height:38,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:800}}>{isDarkMode?"L":"D"}</button>
          </header>
          <div style={{marginBottom:18}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#fbbf24",marginBottom:8}}>⚡ 24-Hour Full Access</div>
            <h1 style={{fontSize:32,lineHeight:1.1,fontWeight:800,color:text,margin:"0 0 10px"}}>Unlock everything for 24 hours.</h1>
            <p style={{fontSize:14.5,lineHeight:1.6,color:muted}}>No account required. Pay once and get full access from the time of purchase — automatically restored if you reopen the app.</p>
          </div>
          <div style={{background:isDarkMode?"#120d00":"#fffbeb",border:"1px solid #92400e",borderRadius:10,padding:"12px 16px",marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:isDarkMode?"#fde68a":"#92400e"}}>24-Hour Full Access Pass</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:800,color:isDarkMode?"#fbbf24":"#b45309"}}>{PAID_ACCESS_PRICE}</span>
            </div>
            {features.map(f=>(
              <div key={f} style={{display:"flex",gap:9,alignItems:"flex-start",marginBottom:6}}>
                <span style={{color:"#fbbf24",fontSize:13,flexShrink:0,marginTop:1}}>✓</span>
                <span style={{fontSize:13,color:isDarkMode?"#fde68a":"#92400e"}}>{f}</span>
              </div>
            ))}
          </div>
          <button onClick={handlePurchase} style={{height:52,borderRadius:9,border:"1px solid #f59e0b",background:"linear-gradient(135deg,#d97706,#92400e)",color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer",letterSpacing:"0.01em",marginBottom:10}}>
            Purchase Access — {PAID_ACCESS_PRICE}
          </button>
          <p style={{fontSize:11,color:muted,textAlign:"center",lineHeight:1.6,margin:0}}>
            ⚠ Payment processor integration required before live billing.<br/>
            Access is stored locally on this device for 24 hours from purchase.
          </p>
          <p style={{fontSize:12,color:muted,textAlign:"center",marginTop:16,lineHeight:1.55}}>
            Prefer unlimited access?{" "}
            <button onClick={onBack} style={{background:"none",border:"none",color:"#14b8a6",fontWeight:700,cursor:"pointer",fontSize:12,padding:0}}>Create a free account →</button>
          </p>
        </div>
      </main>
    </>
  );
}

function PermissionScreen({ isDarkMode, onDone }) {
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [requesting, setRequesting] = useState(false);

  async function handleAllow() {
    setRequesting(true);
    _unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      const result = await Notification.requestPermission().catch(() => "denied");
      setNotifStatus(result);
    }
    setRequesting(false);
    setTimeout(onDone, 600);
  }

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=DM+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#020617}button{font:inherit}`}</style>
      <main style={{ minHeight:"100vh", background:"#020617", color:"#e2e8f0", fontFamily:"'DM Sans',sans-serif", display:"flex", justifyContent:"center", alignItems:"center", padding:"24px 16px" }}>
        <div style={{ width:"100%", maxWidth:430, display:"flex", flexDirection:"column", gap:24 }}>

          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#14b8a6", marginBottom:10 }}>R.O.M.A.N.</div>
            <div style={{ fontSize:28, fontWeight:800, color:"#f1f5f9", lineHeight:1.15, marginBottom:10 }}>Before we get started</div>
            <div style={{ fontSize:14, color:"#7a90b0", lineHeight:1.6 }}>
              R.O.M.A.N. needs one permission to alert you during a cardiac arrest even when you switch screens.
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"flex-start", gap:14, background:"#0d1829", border:"1px solid #1a2e4a", borderRadius:12, padding:"16px" }}>
            <div style={{ fontSize:30, lineHeight:1, flexShrink:0, marginTop:2 }}>🔔</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:15, color:"#e2e8f0", marginBottom:4 }}>Push Notifications</div>
              <div style={{ fontSize:13, color:"#7a90b0", lineHeight:1.5 }}>CPR cycle alerts and epinephrine reminders. Nothing else — no marketing, no tracking.</div>
            </div>
            <div style={{
              alignSelf:"center", flexShrink:0, fontSize:11, fontWeight:700, padding:"3px 9px",
              borderRadius:20, background: notifStatus === "granted" ? "#052e16" : "#0d1525",
              color: notifStatus === "granted" ? "#4ade80" : "#64748b",
              border: `1px solid ${notifStatus === "granted" ? "#166534" : "#1e2d42"}`
            }}>
              {notifStatus === "granted" ? "✓ Allowed" : "Pending"}
            </div>
          </div>

          <button
            onClick={handleAllow}
            disabled={requesting}
            style={{ height:54, borderRadius:999, border:"1px solid rgba(125,249,255,.6)", background: requesting ? "#0f3a30" : "linear-gradient(135deg,#0f766e,#0284c7)", color:"#fff", fontWeight:800, fontSize:17, cursor: requesting ? "default" : "pointer", transition:"opacity 0.2s", opacity: requesting ? 0.7 : 1 }}>
            {requesting ? "Enabling…" : "Allow Notifications & Continue"}
          </button>

          <button onClick={onDone} style={{ background:"none", border:"none", color:"#334155", fontSize:13, fontWeight:600, cursor:"pointer", textAlign:"center", paddingBottom:8 }}>
            Skip for now
          </button>

        </div>
      </main>
    </>
  );
}

function HomeScreen({ isDarkMode, onLogin, onSignup, onGuest, onStudentCode, on24hr, onToggleTheme }) {
  const bg = "#020617";
  const text = "#f8fafc";
  const muted = "#d9f8ff";
  const buttonBase = {
    width:"100%",
    height:54,
    borderRadius:999,
    cursor:"pointer",
    fontWeight:800,
    fontSize:18,
    letterSpacing:0,
  };
  const hasPaidAccess = !!getPaidAccess();

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:"#020617",color:text,fontFamily:"'DM Sans',sans-serif",overflow:"hidden",display:"flex",justifyContent:"center",alignItems:"center"}}>
        <div style={{width:"100%",maxWidth:430,minHeight:"100vh",background:"#020617",overflow:"hidden",display:"flex",flexDirection:"column",padding:"14px 18px 28px"}}>
          <section style={{flex:1,borderRadius:22,overflow:"hidden",boxShadow:"0 24px 70px rgba(0,0,0,.45)",background:"#031a3f"}}>
            <img src="/login-screen.png" alt="R.O.M.A.N Medic-AI login screen" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"top center",display:"block"}} />
          </section>
          <section style={{padding:"20px 0 0",display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={onLogin} style={{...buttonBase,border:"1px solid rgba(125,249,255,.88)",background:"linear-gradient(135deg,#2dd4bf,#0284c7)",color:"#ffffff",boxShadow:"0 14px 34px rgba(20,184,166,.26)"}}>Let's Get Started</button>
          </section>
          <div style={{textAlign:"center",color:muted,fontSize:13,fontWeight:700,letterSpacing:0,paddingTop:8}}>Secure. Reliable. Built for EMS.</div>
        </div>
      </main>
    </>
  );
}

function LoginScreen({ isDarkMode, values, onChange, onSubmit, onBack, onSignup, onGuest, onStudentCode, on24hr, error, onToggleTheme }) {
  const bg = isDarkMode ? "#060a15" : "#f4efe7";
  const panel = isDarkMode ? "#0d1120" : "#fbf7f0";
  const inputBg = isDarkMode ? "#090e1c" : "#f2ece4";
  const text = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted = isDarkMode ? "#8aa0c2" : "#374151";
  const border = isDarkMode ? "#1a2338" : "#9a9286";

  const [forgotModal, setForgotModal] = useState(null); // "password" | "login" | null
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotResult, setForgotResult] = useState(null); // { type:"success"|"error", msg }

  const inputStyle = {
    width:"100%",
    height:46,
    borderRadius:8,
    border:`1px solid ${border}`,
    background:inputBg,
    color:text,
    padding:"0 13px",
    outline:"none",
    fontSize:15,
  };

  function openModal(type) {
    setForgotModal(type);
    setForgotEmail("");
    setForgotResult(null);
  }

  function closeModal() {
    setForgotModal(null);
    setForgotEmail("");
    setForgotResult(null);
  }

  function handleForgotPassword(e) {
    e.preventDefault();
    const users = getStoredUsers();
    const account = users.find(u => u.email === forgotEmail.trim().toLowerCase());
    if (!account) {
      setForgotResult({ type:"error", msg:"No account found with that email. Try signing up." });
    } else {
      setForgotResult({ type:"success", msg:`Your password is: ${account.password}` });
    }
  }

  function handleForgotLogin(e) {
    e.preventDefault();
    const users = getStoredUsers();
    if (!users.length) {
      setForgotResult({ type:"error", msg:"No accounts have been registered on this device yet." });
    } else {
      setForgotResult({ type:"success", msg:`Registered email${users.length > 1 ? "s" : ""} on this device:\n${users.map(u => u.email).join("\n")}` });
    }
  }

  const modalOverlay = forgotModal && (
    <div onClick={closeModal} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:400,background:isDarkMode?"#0f1e38":"#fbf7f0",border:`1px solid ${border}`,borderRadius:12,padding:24,display:"grid",gap:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontWeight:800,fontSize:17,color:text}}>
            {forgotModal==="password" ? "Forgot Password" : "Forgot Login"}
          </span>
          <button onClick={closeModal} style={{background:"transparent",border:"none",color:muted,fontSize:20,cursor:"pointer",lineHeight:1}}>&times;</button>
        </div>

        {forgotModal==="password" ? (
          <form onSubmit={handleForgotPassword} style={{display:"grid",gap:12}}>
            <p style={{fontSize:13,color:muted,lineHeight:1.5}}>Enter the email you signed up with and we'll show your password.</p>
            <input
              type="email"
              value={forgotEmail}
              onChange={e=>{setForgotEmail(e.target.value);setForgotResult(null);}}
              placeholder="provider@medic.ai"
              style={inputStyle}
              autoFocus
            />
            {forgotResult && (
              <div style={{borderRadius:8,padding:"10px 12px",fontSize:13,whiteSpace:"pre-wrap",
                border:`1px solid ${forgotResult.type==="success"?"#6ee7b7":"#fecaca"}`,
                background:forgotResult.type==="success"?(isDarkMode?"#052e16":"#ecfdf5"):(isDarkMode?"#2a0808":"#fff1f2"),
                color:forgotResult.type==="success"?(isDarkMode?"#6ee7b7":"#065f46"):(isDarkMode?"#fecaca":"#991b1b")}}>
                {forgotResult.msg}
              </div>
            )}
            <button type="submit" style={{height:44,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer"}}>Look up password</button>
          </form>
        ) : (
          <form onSubmit={handleForgotLogin} style={{display:"grid",gap:12}}>
            <p style={{fontSize:13,color:muted,lineHeight:1.5}}>Tap the button below to see all emails registered on this device.</p>
            {forgotResult && (
              <div style={{borderRadius:8,padding:"10px 12px",fontSize:13,whiteSpace:"pre-wrap",
                border:`1px solid ${forgotResult.type==="success"?"#6ee7b7":"#fecaca"}`,
                background:forgotResult.type==="success"?(isDarkMode?"#052e16":"#ecfdf5"):(isDarkMode?"#2a0808":"#fff1f2"),
                color:forgotResult.type==="success"?(isDarkMode?"#6ee7b7":"#065f46"):(isDarkMode?"#fecaca":"#991b1b")}}>
                {forgotResult.msg}
              </div>
            )}
            <button type="submit" style={{height:44,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer"}}>Show registered emails</button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <>
      {modalOverlay}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 28px",display:"flex",flexDirection:"column"}}>
          <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:34}}>
            <button onClick={onBack} style={{height:38,padding:"0 13px",borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:700}}>Back</button>
            <button onClick={onToggleTheme} title="Switch theme" style={{width:38,height:38,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:800}}>
              {isDarkMode ? "L" : "D"}
            </button>
          </header>

          <section style={{textAlign:"left",marginBottom:22}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:1.2,color:"#14b8a6",marginBottom:10}}>R.O.M.A.N. access</div>
            <h1 style={{fontSize:36,lineHeight:1.08,letterSpacing:0,fontWeight:800,color:text,margin:"0 0 10px"}}>Log in for your shift.</h1>
            <p style={{fontSize:15,lineHeight:1.55,color:muted}}>Enter the email and password you signed up with to continue into the medication calculator.</p>
          </section>

          <form onSubmit={onSubmit} style={{background:panel,border:`1px solid ${border}`,borderRadius:8,padding:16,display:"grid",gap:13,textAlign:"left",boxShadow:isDarkMode?"0 24px 70px rgba(0,0,0,.22)":"0 24px 70px rgba(40,37,32,.10)"}}>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Email
              <input name="email" type="email" value={values.email} onChange={onChange} placeholder="provider@medic.ai" style={inputStyle} />
            </label>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Password
              <input name="password" type="password" value={values.password} onChange={onChange} placeholder="Enter password" style={inputStyle} />
            </label>
            {error && <div style={{border:"1px solid #fecaca",background:isDarkMode?"#2a0808":"#fff1f2",color:isDarkMode?"#fecaca":"#991b1b",borderRadius:8,padding:"10px 12px",fontSize:13}}>{error}</div>}
            <button type="submit" style={{height:48,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer",marginTop:2}}>Enter R.O.M.A.N.</button>
          </form>

          <div style={{display:"flex",justifyContent:"space-between",marginTop:10,padding:"0 2px"}}>
            <button onClick={()=>openModal("password")} style={{background:"transparent",border:"none",color:"#14b8a6",fontSize:13,fontWeight:700,cursor:"pointer",padding:"6px 0"}}>Forgot password?</button>
            <button onClick={()=>openModal("login")} style={{background:"transparent",border:"none",color:"#14b8a6",fontSize:13,fontWeight:700,cursor:"pointer",padding:"6px 0"}}>Forgot login?</button>
          </div>

          <button onClick={onSignup} style={{height:46,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,fontWeight:700,cursor:"pointer",marginTop:8}}>Create account</button>
          <button onClick={onGuest} style={{height:46,borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:muted,fontWeight:700,cursor:"pointer",marginTop:10}}>Continue as guest (EMT scope)</button>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
            <button onClick={onStudentCode} style={{height:42,borderRadius:8,border:`1px solid ${isDarkMode?"#7c3aed":"#5b21b6"}`,background:isDarkMode?"transparent":"rgba(109,40,217,.1)",color:isDarkMode?"#a78bfa":"#4c1d95",fontWeight:700,fontSize:13,cursor:"pointer"}}>🎓 School Code</button>
            <button onClick={on24hr} style={{height:42,borderRadius:8,border:`1px solid ${isDarkMode?"#d97706":"#b45309"}`,background:isDarkMode?"transparent":"rgba(180,83,9,.08)",color:isDarkMode?"#fbbf24":"#92400e",fontWeight:700,fontSize:13,cursor:"pointer"}}>⚡ 24hr Full Access</button>
          </div>
        </div>
      </main>
    </>
  );
}

/* �������������������������������������������������������
   PROVIDER PROFILE SETUP SCREEN
������������������������������������������������������� */
function daysUntil(dateStr){
  if(!dateStr) return null;
  let d;
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)){
    // YYYY-MM-DD from type="date" — parse as local to avoid UTC offset issues
    const [y,m,day]=dateStr.split("-");
    d=new Date(+y,+m-1,+day);
  } else if(/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)){
    const [m,day,y]=dateStr.split("/");
    d=new Date(+y,+m-1,+day);
  } else {
    d=new Date(dateStr);
  }
  if(isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}
function expBadge(dateStr){
  const d = daysUntil(dateStr);
  if(d === null) return null;
  if(d < 0)  return { label:`Expired ${Math.abs(d)}d ago`, color:"#fca5a5", bg:"#2a0808", bd:"#7f1d1d" };
  if(d <= 30) return { label:`Expires in ${d}d`, color:"#fdba74", bg:"#1a0c04", bd:"#9a3412" };
  if(d <= 90) return { label:`Expires in ${d}d`, color:"#fde68a", bg:"#1a1604", bd:"#92400e" };
  return { label:`Valid · ${d}d left`, color:"#86efac", bg:"#071a0e", bd:"#14532d" };
}

function fmtDateInput(raw){
  const d=raw.replace(/\D/g,"").slice(0,8);
  if(d.length<=2) return d;
  if(d.length<=4) return d.slice(0,2)+"/"+d.slice(2);
  return d.slice(0,2)+"/"+d.slice(2,4)+"/"+d.slice(4);
}

function DateRow({ label, issVal, issSet, expVal, expSet, required=false, bdr, inp, text, isDarkMode }){
  const badge=expBadge(expVal);
  const ls={ display:"grid", gap:5, fontSize:12, fontWeight:700, color:text };
  const ds={ width:"100%", height:42, borderRadius:7, border:`1px solid ${bdr}`, background:inp, color:text, padding:"0 11px", outline:"none", fontSize:14, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em" };
  return(
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
      <label style={ls}>
        {label} — Issue date
        <input type="text" inputMode="numeric" value={issVal} onChange={e=>issSet(fmtDateInput(e.target.value))} placeholder="MM/DD/YYYY" maxLength={10} style={ds}/>
      </label>
      <label style={ls}>
        <span>{label} — Exp. date{required&&<span style={{color:"#f87171",marginLeft:3}}>*</span>}</span>
        <input type="text" inputMode="numeric" value={expVal} onChange={e=>expSet(fmtDateInput(e.target.value))} placeholder="MM/DD/YYYY" maxLength={10} style={ds}/>
      </label>
      {badge&&<div style={{gridColumn:"1/-1",display:"inline-flex",alignItems:"center",gap:6,background:badge.bg,border:`1px solid ${badge.bd}`,borderRadius:5,padding:"3px 9px",width:"fit-content"}}>
        <span style={{fontSize:10,fontWeight:700,color:badge.color,fontFamily:"'IBM Plex Mono',monospace"}}>{badge.label}</span>
      </div>}
    </div>
  );
}

function ProfileSetupScreen({ isDarkMode, providerName, onSave, onSkip, onToggleTheme, initialData={} }){
  const bg    = isDarkMode ? "#060a15" : "#f4efe7";
  const panel = isDarkMode ? "#0d1120" : "#fbf7f0";
  const text  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted = isDarkMode ? "#8aa0c2" : "#374151";
  const bdr   = isDarkMode ? "#1a2338" : "#9a9286";
  const inp   = isDarkMode ? "#090e1c" : "#f2ece4";

  const [certLevel, setCertLevel]   = useState(initialData.certLevel || "");
  const [phone,     setPhone]       = useState(initialData.phone || "");
  const [agency,    setAgency]      = useState(initialData.agency || "");
  const [unit,      setUnit]        = useState(initialData.unit || "");
  const [stateL,    setStateL]      = useState(initialData.stateOfLicense || "");
  const [nremt,     setNremt]       = useState(initialData.nremtNumber || "");
  const [stateCert, setStateCert]   = useState(initialData.stateCertNumber || "");
  const [certIss,   setCertIss]     = useState(initialData.certIssueDate || "");
  const [certExp,   setCertExp]     = useState(initialData.certExpDate || "");
  const [cprType,    setCprType]    = useState(()=>{ const v=initialData.cprType; return Array.isArray(v)?v:(v?[v]:[]); });
  const [cprDetails, setCprDetails] = useState(()=>{
    const d=initialData.cprDetails||{};
    // migrate old single-card format
    if(!Object.keys(d).length && initialData.cprNumber){
      const t=Array.isArray(initialData.cprType)?initialData.cprType[0]:initialData.cprType;
      if(t) return { [t]:{ number:initialData.cprNumber||"", issueDate:initialData.cprIssueDate||"", expDate:initialData.cprExpDate||"" } };
    }
    return d;
  });
  const [aclsNum,   setAclsNum]     = useState(initialData.aclsNumber || "");
  const [aclsIss,   setAclsIss]     = useState(initialData.aclsIssueDate || "");
  const [aclsExp,   setAclsExp]     = useState(initialData.aclsExpDate || "");
  const [palsNum,   setPalsNum]     = useState(initialData.palsNumber || "");
  const [palsIss,   setPalsIss]     = useState(initialData.palsIssueDate || "");
  const [palsExp,   setPalsExp]     = useState(initialData.palsExpDate || "");
  const [error,     setError]       = useState("");

  const inpStyle = { width:"100%", height:42, borderRadius:7, border:`1px solid ${bdr}`, background:inp, color:text, padding:"0 11px", outline:"none", fontSize:13, fontFamily:"'DM Sans',sans-serif" };
  const labelStyle = { display:"grid", gap:5, fontSize:12, fontWeight:700, color:text };

  function SectionHead({ title, sub }){
    return(
      <div style={{ borderBottom:`1px solid ${bdr}`, paddingBottom:8, marginBottom:14, marginTop:6 }}>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:1.1, color:"#14b8a6" }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:muted, marginTop:2 }}>{sub}</div>}
      </div>
    );
  }

  const DR = { bdr, inp, text, isDarkMode };

  const CERT_LEVELS = [
    { key:"EMT",       label:"EMT",       sub:"Emergency Medical Technician",  color:isDarkMode?"#86efac":"#14532d", bg:isDarkMode?"#071a0e":"#d1fae5", bd:isDarkMode?"#14532d":"#15803d" },
    { key:"AEMT",      label:"AEMT",      sub:"Advanced EMT",                  color:isDarkMode?"#93c5fd":"#1e3a8a", bg:isDarkMode?"#060f1e":"#dbeafe", bd:isDarkMode?"#1e3a8a":"#1d4ed8" },
    { key:"Paramedic", label:"Paramedic", sub:"Licensed Paramedic / EMT-P",    color:isDarkMode?"#fdba74":"#7c2d12", bg:isDarkMode?"#1a0c04":"#ffedd5", bd:isDarkMode?"#9a3412":"#b45309" },
  ];
  const CPR_TYPES = ["AHA BLS Provider","AHA Heartsaver","AHA ACLS","AHA PALS"];

  const handleSave = () => {
    if(!certLevel){ setError("Select your certification level to continue."); return; }
    if(cprType.length===0){ setError("Select at least one CPR card type."); return; }
    const hasAnyCprExp=cprType.some(t=>cprDetails[t]?.expDate);
    if(!hasAnyCprExp){ setError("Enter an expiration date for at least one CPR card."); return; }
    // expose primary CPR exp for cert warning system (use earliest expiring card)
    const cprExpDate=cprType.reduce((earliest,t)=>{
      const e=cprDetails[t]?.expDate||"";
      if(!e) return earliest;
      if(!earliest) return e;
      return daysUntil(e)<daysUntil(earliest)?e:earliest;
    },"");
    const profile = {
      phone, agency, unit, stateOfLicense:stateL,
      nremtNumber:nremt, stateCertNumber:stateCert, certIssueDate:certIss, certExpDate:certExp,
      cprType, cprDetails, cprExpDate,
      aclsNumber:aclsNum, aclsIssueDate:aclsIss, aclsExpDate:aclsExp,
      palsNumber:palsNum, palsIssueDate:palsIss, palsExpDate:palsExp,
    };
    onSave(certLevel, profile);
  };

  return(
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input,select{font:inherit}input[type=date]{color-scheme:${isDarkMode?"dark":"light"}}`}</style>
      <main style={{ minHeight:"100vh", background:bg, color:text, fontFamily:"'DM Sans',sans-serif", display:"flex", justifyContent:"center" }}>
        <div style={{ width:"100%", maxWidth:480, padding:"18px 16px 40px", display:"flex", flexDirection:"column" }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
            <div>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:1.2, color:"#14b8a6" }}>Account created</div>
              <h1 style={{ fontSize:24, fontWeight:800, color:text, margin:"4px 0 0" }}>
                {providerName ? `Complete your profile, ${providerName.split(" ")[0]}.` : "Complete your provider profile."}
              </h1>
              <div style={{ fontSize:12, color:muted, marginTop:4, lineHeight:1.5 }}>
                This verifies your scope of practice and tracks your certification renewals.
              </div>
            </div>
            <button onClick={onToggleTheme} style={{ flexShrink:0, width:36, height:36, borderRadius:8, border:`1px solid ${bdr}`, background:panel, color:text, fontWeight:800, cursor:"pointer", marginLeft:10 }}>
              {isDarkMode?"L":"D"}
            </button>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* ── CERT LEVEL ── */}
            <div style={{ background:panel, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px" }}>
              <SectionHead title="Certification Level" sub="Required — determines your drug scope of practice"/>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {CERT_LEVELS.map(lv=>(
                  <button key={lv.key} onClick={()=>setCertLevel(lv.key)} style={{
                    width:"100%", textAlign:"left", padding:"12px 14px", cursor:"pointer",
                    background: certLevel===lv.key ? lv.bg : "transparent",
                    border: `2px solid ${certLevel===lv.key ? lv.color : bdr}`,
                    borderRadius:8, transition:"all 0.12s",
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      {certLevel===lv.key && <span style={{ color:lv.color, fontSize:13 }}>✓</span>}
                      <div>
                        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:800, color: certLevel===lv.key ? lv.color : text }}>{lv.label}</span>
                        <span style={{ fontSize:11, color:muted, marginLeft:9 }}>{lv.sub}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── EMS LICENSE ── */}
            <div style={{ background:panel, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px" }}>
              <SectionHead title="EMS License / Certification" sub="NREMT & state license details"/>
              <div style={{ display:"grid", gap:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <label style={labelStyle}>
                    NREMT Number
                    <input value={nremt} onChange={e=>setNremt(e.target.value)} placeholder="e.g. E-12345678" style={inpStyle}/>
                  </label>
                  <label style={labelStyle}>
                    State Cert Number
                    <input value={stateCert} onChange={e=>setStateCert(e.target.value)} placeholder="e.g. GA-987654" style={inpStyle}/>
                  </label>
                </div>
                <label style={labelStyle}>
                  State of Licensure
                  <input value={stateL} onChange={e=>setStateL(e.target.value)} placeholder="e.g. Georgia" style={inpStyle}/>
                </label>
                <DateRow label="EMS Cert" issVal={certIss} issSet={setCertIss} expVal={certExp} expSet={setCertExp} required {...DR}/>
              </div>
            </div>

            {/* ── CPR / BLS ── */}
            <div style={{ background:panel, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px" }}>
              <SectionHead title="CPR / BLS Certification" sub="Required for all provider levels"/>
              <div style={{ display:"grid", gap:12 }}>

                {/* Dropdown to add a card */}
                <label style={labelStyle}>
                  <span>Add CPR Card<span style={{color:"#f87171",marginLeft:3}}>*</span></span>
                  <select
                    value=""
                    onChange={e=>{
                      const t=e.target.value;
                      if(t&&!cprType.includes(t)) setCprType(prev=>[...prev,t]);
                    }}
                    style={{...inpStyle, height:42}}
                  >
                    <option value="">Select card type to add…</option>
                    {CPR_TYPES.filter(t=>!cprType.includes(t)).map(t=>(
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                {/* Per-card info panels */}
                {cprType.map(t=>{
                  const cd=cprDetails[t]||{};
                  const upd=(f,v)=>setCprDetails(p=>({...p,[t]:{...(p[t]||{}),[f]:v}}));
                  return(
                    <div key={t} style={{background:isDarkMode?"#110808":"#fff5f5",border:"1px solid #ef444450",borderRadius:8,padding:"12px 12px 10px",display:"grid",gap:9}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div>
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#f87171",letterSpacing:"0.1em",textTransform:"uppercase"}}>AHA</span>
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:text,marginLeft:6}}>{t.replace("AHA ","")}</span>
                        </div>
                        <button type="button" onClick={()=>setCprType(prev=>prev.filter(x=>x!==t))} style={{background:"none",border:"none",color:"#f87171",fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                      </div>
                      <label style={labelStyle}>
                        Card / Cert Number
                        <input value={cd.number||""} onChange={e=>upd("number",e.target.value)} placeholder="Card or cert number" style={inpStyle}/>
                      </label>
                      <DateRow label={t.replace("AHA ","")} issVal={cd.issueDate||""} issSet={v=>upd("issueDate",v)} expVal={cd.expDate||""} expSet={v=>upd("expDate",v)} required {...DR}/>
                    </div>
                  );
                })}

                {cprType.length===0&&(
                  <div style={{fontSize:12,color:muted,fontStyle:"italic",paddingLeft:2}}>No CPR cards added yet — select a card type above.</div>
                )}
              </div>
            </div>

            {/* ── AGENCY ── */}
            <div style={{ background:panel, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px" }}>
              <SectionHead title="Agency & Contact" sub="Optional — pre-fills ePCR fields"/>
              <div style={{ display:"grid", gap:10 }}>
                <label style={labelStyle}>
                  Agency / Department
                  <input value={agency} onChange={e=>setAgency(e.target.value)} placeholder="e.g. Fulton County EMS" style={inpStyle}/>
                </label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <label style={labelStyle}>
                    Unit / Station
                    <input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="e.g. Medic 12" style={inpStyle}/>
                  </label>
                  <label style={labelStyle}>
                    Phone Number
                    <input
                      value={phone}
                      onChange={e=>{
                        const digits=e.target.value.replace(/\D/g,"").slice(0,10);
                        let fmt=digits;
                        if(digits.length>6) fmt=digits.slice(0,3)+"-"+digits.slice(3,6)+"-"+digits.slice(6);
                        else if(digits.length>3) fmt=digits.slice(0,3)+"-"+digits.slice(3);
                        setPhone(fmt);
                      }}
                      placeholder="555-867-5309"
                      inputMode="tel"
                      style={inpStyle}
                    />
                  </label>
                </div>
              </div>
            </div>

          </div>

          {/* Error */}
          {error && (
            <div style={{ marginTop:14, padding:"10px 13px", background:"#1a0808", border:"1px solid #7f1d1d", borderRadius:7, color:"#fca5a5", fontSize:12 }}>{error}</div>
          )}

          {/* Actions */}
          <div style={{ display:"grid", gap:9, marginTop:18 }}>
            <button onClick={handleSave} style={{ height:50, borderRadius:9, border:"1px solid #0f766e", background:"#14b8a6", color:"#042f2e", fontWeight:800, fontSize:15, cursor:"pointer" }}>
              Save Profile &amp; Enter R.O.M.A.N.
            </button>
            <button onClick={onSkip} style={{ height:44, borderRadius:9, border:`1px solid ${bdr}`, background:"transparent", color:muted, fontWeight:600, fontSize:13, cursor:"pointer" }}>
              Skip for now — complete later
            </button>
          </div>

        </div>
      </main>
    </>
  );
}

function CertSetupScreen({ isDarkMode, providerName, onSelect, onToggleTheme }) {
  const bg     = isDarkMode ? "#060a15" : "#f4efe7";
  const panel  = isDarkMode ? "var(--c-surface)" : "#fbf7f0";
  const text   = isDarkMode ? "var(--c-text)" : "#0f172a";
  const muted  = isDarkMode ? "#8aa0c2" : "#374151";
  const border = isDarkMode ? "var(--c-border)" : "#9a9286";

  const levels = [
    {
      key: "EMT",
      label: "EMT",
      sub: "Emergency Medical Technician",
      desc: "Basic life support · BLS drugs only · Epinephrine auto-injector, Aspirin, Albuterol, Naloxone, Oral glucose, Nitroglycerin",
      color: isDarkMode ? "#86efac" : "#14532d",
      bg: isDarkMode ? "#071a0e" : "#d1fae5",
      bd: isDarkMode ? "#14532d" : "#15803d",
    },
    {
      key: "AEMT",
      label: "AEMT",
      sub: "Advanced Emergency Medical Technician",
      desc: "Advanced BLS · IV/IO access · D50, Atropine, Epi 1:10,000, Diphenhydramine, Normal Saline, Glucagon",
      color: isDarkMode ? "#93c5fd" : "#1e3a8a",
      bg: isDarkMode ? "#060f1e" : "#dbeafe",
      bd: isDarkMode ? "#1e3a8a" : "#1d4ed8",
    },
    {
      key: "Paramedic",
      label: "Paramedic",
      sub: "Licensed Paramedic / EMT-P",
      desc: "Full ALS scope · All drugs · RSI, cardiac medications, sedation, pain management, advanced airway",
      color: isDarkMode ? "#fdba74" : "#7c2d12",
      bg: isDarkMode ? "#1a0c04" : "#ffedd5",
      bd: isDarkMode ? "#9a3412" : "#b45309",
    },
  ];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button{font:inherit;cursor:pointer}`}</style>
      <main style={{ minHeight:"100vh", background:bg, color:text, fontFamily:"'DM Sans',sans-serif", display:"flex", justifyContent:"center" }}>
        <div style={{ width:"100%", maxWidth:480, minHeight:"100vh", padding:"24px 16px 32px", display:"flex", flexDirection:"column" }}>

          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:28 }}>
            <button onClick={onToggleTheme} style={{ width:38, height:38, borderRadius:8, border:`1px solid ${border}`, background:panel, color:text, fontWeight:800 }}>
              {isDarkMode ? "L" : "D"}
            </button>
          </div>

          <div style={{ marginBottom:28 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:1.2, color:"#14b8a6", marginBottom:10 }}>
              Account created
            </div>
            <h1 style={{ fontSize:30, lineHeight:1.1, fontWeight:800, color:text, margin:"0 0 8px" }}>
              {providerName ? `Welcome, ${providerName.split(" ")[0]}.` : "One more step."}
            </h1>
            <p style={{ fontSize:14, lineHeight:1.6, color:muted }}>
              Select your certification level. R.O.M.A.N. will lock your drug access to your scope of practice — you will only be able to administer medications within your cert level.
            </p>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {levels.map(lv => (
              <button
                key={lv.key}
                onClick={() => onSelect(lv.key)}
                style={{
                  width:"100%", textAlign:"left", padding:"16px 18px",
                  background: lv.bg, border:`2px solid ${lv.bd}`,
                  borderRadius:12, transition:"transform 0.1s, border-color 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = lv.color}
                onMouseLeave={e => e.currentTarget.style.borderColor = lv.bd}
              >
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                  <div>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:16, fontWeight:800, color:lv.color }}>{lv.label}</span>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:muted, marginLeft:10 }}>{lv.sub}</span>
                  </div>
                  <span style={{ color:lv.color, fontSize:16 }}>→</span>
                </div>
                <div style={{ fontSize:11.5, color: isDarkMode ? "#6b82a8" : "#4b5563", lineHeight:1.55 }}>{lv.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop:20, padding:"11px 14px", background: isDarkMode ? "#0a1020" : "#e8f0f8", border:`1px solid ${border}`, borderRadius:8 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9.5, color: isDarkMode ? "#4a6a8a" : "#374151", lineHeight:1.6 }}>
              Your cert level is saved to your account on this device. Drugs outside your scope will be visible but locked — you will not be able to administer them.
            </div>
          </div>

        </div>
      </main>
    </>
  );
}

function SignupScreen({ isDarkMode, values, onChange, onSubmit, onBack, onLogin, error, onToggleTheme }) {
  const bg = isDarkMode ? "#060a15" : "#f4efe7";
  const panel = isDarkMode ? "#0d1120" : "#fbf7f0";
  const inputBg = isDarkMode ? "#090e1c" : "#f2ece4";
  const text = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted = isDarkMode ? "#8aa0c2" : "#374151";
  const border = isDarkMode ? "#1a2338" : "#9a9286";

  const inputStyle = {
    width:"100%",
    height:46,
    borderRadius:8,
    border:`1px solid ${border}`,
    background:inputBg,
    color:text,
    padding:"0 13px",
    outline:"none",
    fontSize:15,
  };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 28px",display:"flex",flexDirection:"column"}}>
          <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:34}}>
            <button onClick={onBack} style={{height:38,padding:"0 13px",borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:700}}>Back</button>
            <button onClick={onToggleTheme} title="Switch theme" style={{width:38,height:38,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:800}}>
              {isDarkMode ? "L" : "D"}
            </button>
          </header>

          <section style={{textAlign:"left",marginBottom:22}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:1.2,color:"#14b8a6",marginBottom:10}}>New provider account</div>
            <h1 style={{fontSize:36,lineHeight:1.08,letterSpacing:0,fontWeight:800,color:text,margin:"0 0 10px"}}>Sign up for R.O.M.A.N..</h1>
            <p style={{fontSize:15,lineHeight:1.55,color:muted}}>Create a local demo account on this device, then use it to log in for future shifts.</p>
          </section>

          <form onSubmit={onSubmit} style={{background:panel,border:`1px solid ${border}`,borderRadius:8,padding:16,display:"grid",gap:13,textAlign:"left",boxShadow:isDarkMode?"0 24px 70px rgba(0,0,0,.22)":"0 24px 70px rgba(40,37,32,.10)"}}>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Full name
              <input name="name" type="text" value={values.name} onChange={onChange} placeholder="Provider name" style={inputStyle} />
            </label>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Email
              <input name="email" type="email" value={values.email} onChange={onChange} placeholder="provider@medic.ai" style={inputStyle} />
            </label>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Password
              <input name="password" type="password" value={values.password} onChange={onChange} placeholder="At least 6 characters" style={inputStyle} />
            </label>
            <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700,color:text}}>
              Confirm password
              <input name="confirmPassword" type="password" value={values.confirmPassword} onChange={onChange} placeholder="Re-enter password" style={inputStyle} />
            </label>
            {error && <div style={{border:"1px solid #fecaca",background:isDarkMode?"#2a0808":"#fff1f2",color:isDarkMode?"#fecaca":"#991b1b",borderRadius:8,padding:"10px 12px",fontSize:13}}>{error}</div>}
            <button type="submit" style={{height:48,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer",marginTop:2}}>Create account</button>
          </form>

          <button onClick={onLogin} style={{height:46,borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:muted,fontWeight:700,cursor:"pointer",marginTop:12}}>Already have an account</button>
        </div>
      </main>
    </>
  );
}

/* ─── PLAN DATA (module-level — shared by PricingScreen + CheckoutScreen) ─── */
const PLAN_DATA = [
  {
    key: "emt",
    label: "EMT",
    badge: "Free",
    accentColor: "#14b8a6",
    monthly: "$0", yearly: "$0",
    monthlyRaw: 0, yearlyRaw: 0,
    cta: "Current Plan", ctaDisabled: true,
    description: "Essential BLS reference for certified EMTs.",
    benefits: [
      "EMT-scope drug reference (Aspirin, Naloxone, Nitro, Albuterol, Epi, Glucose & more)",
      "Basic contraindication flags & dosing reminders",
      "Limited protocol companion (cardiac & respiratory)",
      "Arrest tracker with CPR cycle timer",
      "2 guest sessions for evaluation",
      "Dark & light mode",
    ],
    stripeMonthlyPriceId: null, stripeYearlyPriceId: null,
  },
  {
    key: "aemt",
    label: "AEMT",
    badge: "Most Popular",
    accentColor: "#3b82f6",
    monthly: "$4.99", yearly: "$39.99",
    monthlyRaw: 4.99, yearlyRaw: 39.99,
    yearlySave: "Save $19.89 vs monthly",
    cta: "Upgrade to AEMT", ctaDisabled: false,
    description: "Advanced pre-hospital tools for AEMT providers.",
    benefits: [
      "Everything in EMT Free",
      "AEMT-scope drugs (D50, Glucagon, Ipratropium, Calcium Chloride, IV NS & more)",
      "Weight-based dosing calculator (mg/kg, mcg/kg auto-draw)",
      "Full protocol library — all 6 systems",
      "Adult & pediatric burn body maps (TBSA estimation)",
      "Sequential vitals log tied to drug events",
      "Unlimited patient sessions",
      "Student access code support",
    ],
    stripeMonthlyPriceId: "price_REPLACE_AEMT_MONTHLY",
    stripeYearlyPriceId: "price_REPLACE_AEMT_YEARLY",
  },
  {
    key: "paramedic",
    label: "Paramedic",
    badge: "Full ALS",
    accentColor: "#a855f7",
    monthly: "$9.99", yearly: "$79.99",
    monthlyRaw: 9.99, yearlyRaw: 79.99,
    yearlySave: "Save $39.89 vs monthly",
    cta: "Upgrade to Medic", ctaDisabled: false,
    description: "Complete ALS toolkit for paramedics operating at full scope.",
    benefits: [
      "Everything in AEMT",
      "Full Medic-scope drugs (Fentanyl, Ketamine, Amiodarone, TXA, RSI agents, Mag Sulfate, all ALS meds)",
      "ePCR builder — auto-populated narrative from call data",
      "Radio report generator (SBAR-formatted)",
      "Saved calls with Firebase cloud sync",
      "Med log export — timestamped administration history",
      "Cert expiration tracker (EMT, CPR/BLS, ACLS, PALS)",
      "Live pre-check vital screening with block/warn logic",
      "Re-dose interval enforcement & max dose alerts",
      "Pediatric PALS drug reference with age/weight dosing",
    ],
    stripeMonthlyPriceId: "price_REPLACE_PARAMEDIC_MONTHLY",
    stripeYearlyPriceId: "price_REPLACE_PARAMEDIC_YEARLY",
  },
  {
    key: "agency",
    label: "Agency",
    badge: "Team",
    accentColor: "#f59e0b",
    monthly: "Request a Quote", yearly: "Request a Quote",
    monthlyRaw: null, yearlyRaw: null,
    cta: "Request a Quote + Demo", ctaDisabled: false,
    description: "Full fleet coverage for EMS agencies, fire departments, and training programs.",
    benefits: [
      "Everything in Paramedic",
      "Multi-seat management — add, remove, and monitor provider accounts",
      "Agency admin dashboard — usage analytics & T&C compliance log",
      "Bulk cert-level assignment across your roster",
      "Dedicated onboarding & setup support",
      "Priority bug fixes and protocol update notifications",
      "Volume pricing at 10+ seats",
      "Custom SOP integration available (on request)",
    ],
    stripeMonthlyPriceId: null, stripeYearlyPriceId: null,
  },
];

/* ─── CHECKOUT SCREEN ────────────────────────────────────────────────────── */
function CheckoutScreen({ isDarkMode, authUser, planKey, billing, onBack, onChangeBilling }) {
  const plan = PLAN_DATA.find(p => p.key === planKey);
  const [name,  setName]  = React.useState(authUser?.name  || "");
  const [email, setEmail] = React.useState(authUser?.email || "");
  const [loading,   setLoading]   = React.useState(false);
  const [error,     setError]     = React.useState(null);
  const [submitted, setSubmitted] = React.useState(false);

  if (!plan) return null;

  const bg         = isDarkMode ? "#060a15"  : "#f4efe7";
  const text       = isDarkMode ? "#e2e8f0"  : "#0f172a";
  const muted      = isDarkMode ? "#8aa0c2"  : "#374151";
  const card       = isDarkMode ? "#0d1120"  : "#f5ede0";
  const cardBorder = isDarkMode ? "#1a2338"  : "#c5b9a8";
  const inputBg    = isDarkMode ? "#090e1c"  : "#ffffff";
  const inputBd    = isDarkMode ? "#1e2d4a"  : "#d1d5db";
  const { accentColor } = plan;

  const price      = billing === "yearly" ? plan.yearly : plan.monthly;
  const priceId    = billing === "yearly" ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;
  const stripeReady = priceId && !priceId.startsWith("price_REPLACE");
  const emailValid  = email.trim().includes("@");

  const handleCheckout = async () => {
    if (!stripeReady) return;
    if (!emailValid) { setError("A valid email is required."); return; }
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: plan.key, billing,
          email: email.trim(), name: name.trim(),
          successUrl: `${window.location.origin}?checkout=success&plan=${plan.key}`,
          cancelUrl:  `${window.location.origin}?checkout=cancel`,
        }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; }
      else { setError(data.error || "Could not start checkout. Try again."); setLoading(false); }
    } catch { setError("Network error — check your connection and try again."); setLoading(false); }
  };

  const handleEarlyAccess = () => {
    if (!emailValid) { setError("A valid email is required."); return; }
    setSubmitted(true);
    const sub  = encodeURIComponent(`R.O.M.A.N. Early Access — ${plan.label} (${billing})`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nPlan: ${plan.label} · ${billing}\n`);
    window.open(`mailto:dayvon.byers@gmail.com?subject=${sub}&body=${body}`, "_blank");
  };

  if (submitted) {
    return (
      <div style={{paddingBottom:32}}>
        <div style={{background:card,border:`1.5px solid ${accentColor}88`,borderRadius:12,padding:28,textAlign:"center",marginTop:20}}>
          <div style={{fontSize:40,marginBottom:16}}>✅</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:accentColor,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Request Received</div>
          <div style={{fontSize:14,color:text,fontWeight:600,marginBottom:8}}>{plan.label} Plan · {billing==="yearly"?"Yearly":"Monthly"}</div>
          <div style={{fontSize:13,color:muted,lineHeight:1.6,marginBottom:24}}>
            We'll reach out to <strong style={{color:text}}>{email}</strong> once billing goes live. Your rate is locked in.
          </div>
          <button onClick={onBack} style={{padding:"11px 28px",borderRadius:8,border:`1px solid ${accentColor}88`,background:`${accentColor}22`,color:accentColor,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer"}}>← Back to Plans</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{paddingBottom:32}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,paddingTop:4}}>
        <button onClick={onBack} style={{width:34,height:34,borderRadius:8,border:`1px solid ${cardBorder}`,background:card,color:text,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,flexShrink:0}}>←</button>
        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:accentColor}}>Secure Checkout</div>
          <div style={{fontSize:13,fontWeight:700,color:text,marginTop:1}}>Complete your upgrade</div>
        </div>
      </div>

      {/* Plan summary */}
      <div style={{background:card,border:`1.5px solid ${accentColor}88`,borderRadius:10,padding:16,marginBottom:12}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:plan.monthlyRaw?12:0}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:800,color:accentColor}}>{plan.label}</span>
              <span style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",background:accentColor+"22",color:accentColor,border:`1px solid ${accentColor}55`,borderRadius:4,padding:"2px 6px"}}>{plan.badge}</span>
            </div>
            <div style={{fontSize:12,color:muted}}>{plan.description}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:800,color:text,lineHeight:1}}>{price}</div>
            {plan.monthlyRaw && <div style={{fontSize:10,color:muted,marginTop:2}}>{billing==="yearly"?"/year":"/month"}</div>}
            {billing==="yearly" && plan.yearlySave && <div style={{fontSize:9,color:"#14b8a6",fontWeight:700,marginTop:3}}>{plan.yearlySave}</div>}
          </div>
        </div>
        {plan.monthlyRaw > 0 && (
          <div style={{display:"flex",gap:0,background:isDarkMode?"#080c18":"#e8e0d4",borderRadius:7,padding:3,border:`1px solid ${cardBorder}`}}>
            {["monthly","yearly"].map(b=>(
              <button key={b} onClick={()=>onChangeBilling(b)} style={{flex:1,padding:"7px 0",borderRadius:5,border:"none",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",transition:"all 0.15s",
                background:billing===b?accentColor:"transparent",color:billing===b?"#fff":muted}}>
                {b==="monthly"?"Monthly":"Yearly"}{b==="yearly"&&<span style={{marginLeft:5,fontSize:9,opacity:0.85}}>33% off</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* What's included */}
      <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:10}}>What's included</div>
        <div style={{display:"grid",gap:7}}>
          {plan.benefits.slice(0,4).map((b,i)=>(
            <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start"}}>
              <span style={{color:accentColor,fontSize:13,flexShrink:0,lineHeight:1.4}}>✓</span>
              <span style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.5}}>{b}</span>
            </div>
          ))}
          {plan.benefits.length>4 && <div style={{fontSize:11,color:accentColor,fontWeight:700,marginTop:2}}>+ {plan.benefits.length-4} more features</div>}
        </div>
      </div>

      {/* Contact info */}
      <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:12}}>Your info</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <label style={{display:"flex",flexDirection:"column",gap:4}}>
            <span style={{fontSize:11,fontWeight:700,color:muted}}>Full name</span>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{background:inputBg,border:`1px solid ${inputBd}`,borderRadius:7,padding:"10px 12px",color:text,fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"}}/>
          </label>
          <label style={{display:"flex",flexDirection:"column",gap:4}}>
            <span style={{fontSize:11,fontWeight:700,color:muted}}>Email address</span>
            <input type="email" value={email} onChange={e=>{setEmail(e.target.value);setError(null);}} placeholder="you@email.com"
              style={{background:inputBg,border:`1px solid ${email&&!emailValid?"#ef4444":inputBd}`,borderRadius:7,padding:"10px 12px",color:text,fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"}}/>
          </label>
        </div>
      </div>

      {/* Order summary */}
      {plan.monthlyRaw > 0 && (
        <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:16}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:10}}>Order summary</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:13,color:muted}}>R.O.M.A.N. {plan.label} · {billing==="yearly"?"Yearly":"Monthly"}</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:text}}>{price}</span>
          </div>
          {billing==="yearly"&&plan.yearlySave&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:12,color:"#14b8a6"}}>Annual discount</span>
              <span style={{fontSize:12,fontWeight:700,color:"#14b8a6"}}>Applied ✓</span>
            </div>
          )}
          <div style={{borderTop:`1px solid ${cardBorder}`,paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:14,fontWeight:800,color:text}}>Total due {billing==="yearly"?"today":""}</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:800,color:accentColor}}>{price}</span>
          </div>
        </div>
      )}

      {error && <div style={{background:isDarkMode?"#2a0808":"#fee2e2",border:"1px solid #ef4444",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#ef4444"}}>{error}</div>}

      {/* CTA */}
      {stripeReady ? (
        <button onClick={handleCheckout} disabled={loading} style={{width:"100%",height:50,borderRadius:10,border:"none",
          background:loading?"#374151":`linear-gradient(135deg,${accentColor}cc,${accentColor})`,
          color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:800,cursor:loading?"default":"pointer",
          letterSpacing:"0.01em",boxShadow:loading?"none":`0 4px 16px ${accentColor}44`,transition:"all 0.2s",marginBottom:10}}>
          {loading?"Redirecting to Stripe...":"Continue to Secure Payment →"}
        </button>
      ) : (
        <>
          <button onClick={handleEarlyAccess} disabled={!emailValid} style={{width:"100%",height:50,borderRadius:10,border:"none",
            background:!emailValid?"#374151":`linear-gradient(135deg,${accentColor}cc,${accentColor})`,
            color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:800,cursor:emailValid?"pointer":"default",
            letterSpacing:"0.01em",boxShadow:emailValid?`0 4px 16px ${accentColor}44`:"none",transition:"all 0.2s",marginBottom:10}}>
            Request Early Access →
          </button>
          <div style={{textAlign:"center",fontSize:11,color:muted,lineHeight:1.55,marginBottom:12}}>
            Billing not yet live — we'll reach out when your plan is ready. Rate locked at today's price.
          </div>
        </>
      )}

      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,opacity:0.45}}>
        <span style={{fontSize:11,color:muted}}>🔒 Secured by</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:muted}}>Stripe</span>
        <span style={{fontSize:11,color:muted}}>· Encrypted · No card stored here</span>
      </div>
    </div>
  );
}

/* ─── AGENCY QUOTE SCREEN ────────────────────────────────────────────────── */
function AgencyQuoteScreen({ isDarkMode, authUser, onBack }) {
  const [form, setForm] = React.useState({
    agencyName: "", agencyType: "", seats: "", contactName: authUser?.name || "",
    contactEmail: authUser?.email || "", contactPhone: "", currentSystem: "",
    goLive: "", notes: "", wantsDemo: true,
  });
  const [loading,   setLoading]   = React.useState(false);
  const [error,     setError]     = React.useState(null);
  const [submitted, setSubmitted] = React.useState(false);

  const text       = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted      = isDarkMode ? "#8aa0c2" : "#374151";
  const card       = isDarkMode ? "#0d1120" : "#f5ede0";
  const cardBorder = isDarkMode ? "#1a2338" : "#c5b9a8";
  const inputBg    = isDarkMode ? "#090e1c" : "#ffffff";
  const inputBd    = isDarkMode ? "#1e2d4a" : "#d1d5db";
  const accent     = "#f59e0b";

  const set = (k, v) => { setForm(p=>({...p,[k]:v})); setError(null); };
  const emailValid = form.contactEmail.trim().includes("@");
  const canSubmit  = form.agencyName.trim() && form.contactName.trim() && emailValid;

  const handleSubmit = async () => {
    if (!canSubmit) { setError("Agency name, contact name, and a valid email are required."); return; }
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/agency-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, submittedAt: new Date().toISOString() }),
      });
      const data = await res.json();
      if (res.ok) { setSubmitted(true); }
      else { setError(data.error || "Submission failed. Try again."); setLoading(false); }
    } catch { setError("Network error — check your connection and try again."); setLoading(false); }
  };

  const inputStyle = (extra={}) => ({
    background:inputBg, border:`1px solid ${inputBd}`, borderRadius:7,
    padding:"10px 12px", color:text, fontSize:13, outline:"none",
    fontFamily:"'DM Sans',sans-serif", width:"100%", boxSizing:"border-box", ...extra,
  });
  const labelStyle = { display:"flex", flexDirection:"column", gap:4 };
  const labelTxt   = { fontSize:11, fontWeight:700, color:muted };

  if (submitted) {
    return (
      <div style={{paddingBottom:32}}>
        <div style={{background:card,border:`1.5px solid ${accent}88`,borderRadius:12,padding:28,textAlign:"center",marginTop:20}}>
          <div style={{fontSize:44,marginBottom:16}}>🚒</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:accent,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Quote Request Received</div>
          <div style={{fontSize:14,color:text,fontWeight:600,marginBottom:8}}>{form.agencyName}</div>
          <div style={{fontSize:13,color:muted,lineHeight:1.65,marginBottom:24}}>
            We'll send a custom quote to <strong style={{color:text}}>{form.contactEmail}</strong>
            {form.wantsDemo && <> and schedule your demo</>} within 1–2 business days.
          </div>
          <button onClick={onBack} style={{padding:"11px 28px",borderRadius:8,border:`1px solid ${accent}88`,background:`${accent}22`,color:accent,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer"}}>← Back to Plans</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{paddingBottom:32}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,paddingTop:4}}>
        <button onClick={onBack} style={{width:34,height:34,borderRadius:8,border:`1px solid ${cardBorder}`,background:card,color:text,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,flexShrink:0}}>←</button>
        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:accent}}>Agency Plan</div>
          <div style={{fontSize:13,fontWeight:700,color:text,marginTop:1}}>Request a Quote + Demo</div>
        </div>
      </div>

      {/* Intro */}
      <div style={{background:isDarkMode?"#1a1000":"#fffbeb",border:`1px solid ${accent}55`,borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:accent,marginBottom:6}}>Custom pricing for your team</div>
        <div style={{fontSize:12,color:muted,lineHeight:1.6}}>
          Agency pricing is based on seat count, agency type, and contract term. Fill in the form below and we'll send a tailored quote within 1–2 business days. Request a live demo and we'll schedule it at the same time.
        </div>
      </div>

      {/* Agency info */}
      <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:12}}>Agency info</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <label style={labelStyle}>
            <span style={labelTxt}>Agency / organization name <span style={{color:"#ef4444"}}>*</span></span>
            <input value={form.agencyName} onChange={e=>set("agencyName",e.target.value)} placeholder="e.g. Metro EMS District 4" style={inputStyle()}/>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Agency type</span>
            <select value={form.agencyType} onChange={e=>set("agencyType",e.target.value)} style={inputStyle()}>
              <option value="">Select type…</option>
              {["EMS / Ambulance Service","Fire Department / Fire-EMS","Hospital / Health System","Training Program / EMS School","Military / Federal","Law Enforcement (First Aid)","Other"].map(t=>(
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Estimated number of providers / seats</span>
            <select value={form.seats} onChange={e=>set("seats",e.target.value)} style={inputStyle()}>
              <option value="">Select range…</option>
              {["1–9","10–24","25–49","50–99","100–249","250+"].map(r=>(
                <option key={r} value={r}>{r} providers</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Current drug reference / documentation system</span>
            <input value={form.currentSystem} onChange={e=>set("currentSystem",e.target.value)} placeholder="e.g. paper protocols, ImageTrend, ESO…" style={inputStyle()}/>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Target go-live / start date</span>
            <input type="date" value={form.goLive} onChange={e=>set("goLive",e.target.value)} style={inputStyle()}/>
          </label>
        </div>
      </div>

      {/* Contact info */}
      <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:12}}>Your contact info</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <label style={labelStyle}>
            <span style={labelTxt}>Full name <span style={{color:"#ef4444"}}>*</span></span>
            <input value={form.contactName} onChange={e=>set("contactName",e.target.value)} placeholder="Your name" style={inputStyle()}/>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Email address <span style={{color:"#ef4444"}}>*</span></span>
            <input type="email" value={form.contactEmail} onChange={e=>set("contactEmail",e.target.value)} placeholder="you@agency.org"
              style={inputStyle({borderColor:form.contactEmail&&!emailValid?"#ef4444":inputBd})}/>
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Phone number (optional)</span>
            <input type="tel" value={form.contactPhone} onChange={e=>set("contactPhone",e.target.value)} placeholder="(555) 000-0000" style={inputStyle()}/>
          </label>
        </div>
      </div>

      {/* Additional notes */}
      <div style={{background:card,border:`1px solid ${cardBorder}`,borderRadius:10,padding:14,marginBottom:12}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:12}}>Additional details</div>
        <label style={labelStyle}>
          <span style={labelTxt}>Specific needs or questions (optional)</span>
          <textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3} placeholder="Custom protocol integration, SSO requirements, training support, billing questions…"
            style={{...inputStyle(), resize:"vertical", minHeight:72, lineHeight:1.55}}/>
        </label>
      </div>

      {/* Demo toggle */}
      <div style={{background:card,border:`1.5px solid ${form.wantsDemo?accent+"88":cardBorder}`,borderRadius:10,padding:14,marginBottom:16}}>
        <label style={{display:"flex",alignItems:"flex-start",gap:12,cursor:"pointer"}} onClick={()=>set("wantsDemo",!form.wantsDemo)}>
          <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${form.wantsDemo?accent:"#6b7280"}`,background:form.wantsDemo?accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all 0.15s"}}>
            {form.wantsDemo&&<span style={{color:"#fff",fontWeight:900,fontSize:13}}>✓</span>}
          </div>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:form.wantsDemo?accent:muted,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:3}}>Request a live demo</div>
            <div style={{fontSize:12,color:muted,lineHeight:1.5}}>We'll schedule a walkthrough of R.O.M.A.N. with your team — protocols, arrest tracker, drug reference, and admin dashboard.</div>
          </div>
        </label>
      </div>

      {error && <div style={{background:isDarkMode?"#2a0808":"#fee2e2",border:"1px solid #ef4444",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#ef4444"}}>{error}</div>}

      <button onClick={handleSubmit} disabled={loading||!canSubmit} style={{width:"100%",height:50,borderRadius:10,border:"none",
        background:(loading||!canSubmit)?"#374151":`linear-gradient(135deg,${accent}cc,${accent})`,
        color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:800,
        cursor:(loading||!canSubmit)?"default":"pointer",letterSpacing:"0.01em",
        boxShadow:(!loading&&canSubmit)?`0 4px 16px ${accent}44`:"none",transition:"all 0.2s",marginBottom:12}}>
        {loading?"Submitting...":form.wantsDemo?"Submit Quote Request + Schedule Demo →":"Submit Quote Request →"}
      </button>

      <div style={{textAlign:"center",fontSize:11,color:muted,opacity:0.6}}>We respond within 1–2 business days · No commitment required</div>
    </div>
  );
}

function PricingScreen({ isDarkMode, authUser, onSelectPlan }) {
  const [billing, setBilling] = React.useState("monthly");
  const bg   = isDarkMode ? "#060a15" : "#f4efe7";
  const text  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted = isDarkMode ? "#8aa0c2" : "#374151";
  const card  = isDarkMode ? "#0d1120" : "#f5ede0";
  const cardBorder = isDarkMode ? "#1a2338" : "#c5b9a8";

  const BADGE_THEME = {
    emt:       { badgeColor:"#14b8a6", badgeBg:isDarkMode?"#052e1e":"#d1faf0", borderColor:isDarkMode?"#0f4035":"#99f0da" },
    aemt:      { badgeColor:"#3b82f6", badgeBg:isDarkMode?"#0c1a3a":"#dbeafe", borderColor:isDarkMode?"#1e3a8a":"#93c5fd" },
    paramedic: { badgeColor:"#a855f7", badgeBg:isDarkMode?"#1a0c2e":"#f3e8ff", borderColor:isDarkMode?"#7c3aed":"#c084fc" },
    agency:    { badgeColor:"#f59e0b", badgeBg:isDarkMode?"#1a1000":"#fefce8", borderColor:isDarkMode?"#92400e":"#fbbf24" },
  };
  const PLANS = PLAN_DATA.map(p => ({ ...p, ...BADGE_THEME[p.key] }));

  const currentCert = authUser?.certLevel || null;

  return (
    <div style={{paddingBottom: 32}}>
      {/* Header */}
      <div style={{marginBottom: 20, paddingTop: 4}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:1.3,color:"#14b8a6",marginBottom:6}}>R.O.M.A.N. Plans</div>
        <h2 style={{fontSize:24,fontWeight:800,color:text,margin:"0 0 6px",lineHeight:1.15}}>Choose your access level.</h2>
        <p style={{fontSize:13,color:muted,lineHeight:1.55,margin:0}}>All plans include the core drug reference. Upgrade to unlock your full scope.</p>
      </div>

      {/* Billing toggle */}
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:18,background:isDarkMode?"#080c18":"#e8e0d4",borderRadius:8,padding:3,border:`1px solid ${cardBorder}`,width:"fit-content"}}>
        {["monthly","yearly"].map(b=>(
          <button key={b} onClick={()=>setBilling(b)} style={{padding:"7px 18px",borderRadius:6,border:"none",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em",transition:"all 0.15s",
            background: billing===b ? (isDarkMode?"#14b8a6":"#0f766e") : "transparent",
            color: billing===b ? (isDarkMode?"#042f2e":"#fff") : muted,
          }}>
            {b==="monthly" ? "Monthly" : "Yearly"}
            {b==="yearly" && <span style={{marginLeft:6,fontSize:9,background:"#14b8a680",color:"#14b8a6",borderRadius:3,padding:"1px 4px"}}>33% off</span>}
          </button>
        ))}
      </div>

      {/* Plan cards */}
      <div style={{display:"grid",gap:12}}>
        {PLANS.map(plan => {
          const price = billing === "yearly" ? plan.yearly : plan.monthly;
          const isCurrentScope = currentCert === plan.label || (plan.key === "emt" && !currentCert);
          return (
            <div key={plan.key} style={{background:card,border:`1px solid ${isCurrentScope ? plan.accentColor+"88" : cardBorder}`,borderRadius:10,overflow:"hidden",boxShadow:isCurrentScope?`0 0 0 1px ${plan.accentColor}33`:"none",transition:"border-color 0.2s"}}>

              {/* Card header */}
              <div style={{padding:"14px 16px 0",display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:800,color:plan.accentColor}}>{plan.label}</span>
                    <span style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",background:plan.badgeBg,color:plan.badgeColor,border:`1px solid ${plan.borderColor}`,borderRadius:4,padding:"2px 6px"}}>{plan.badge}</span>
                    {isCurrentScope && <span style={{fontSize:9,fontWeight:800,background:"#14b8a620",color:"#14b8a6",border:"1px solid #14b8a640",borderRadius:4,padding:"2px 6px"}}>Active</span>}
                  </div>
                  <p style={{fontSize:12,color:muted,margin:0,lineHeight:1.45}}>{plan.description}</p>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:plan.key==="agency"?13:20,fontWeight:800,color:plan.key==="agency"?plan.accentColor:text,lineHeight:1}}>{price}</div>
                  {plan.monthlyRaw>0 && <div style={{fontSize:10,color:muted,marginTop:2}}>{billing==="yearly"?"/year":"/month"}</div>}
                  {billing==="yearly" && plan.yearlySave && plan.key!=="agency" && <div style={{fontSize:9,color:"#14b8a6",fontWeight:700,marginTop:3}}>{plan.yearlySave}</div>}
                </div>
              </div>

              {/* Benefits */}
              <div style={{padding:"12px 16px"}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:isDarkMode?"#2a3a54":"#9a9286",marginBottom:8}}>What's included</div>
                <div style={{display:"grid",gap:6}}>
                  {plan.benefits.map((b,i) => (
                    <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start"}}>
                      <span style={{color:plan.accentColor,fontSize:13,flexShrink:0,marginTop:0,lineHeight:1.4}}>✓</span>
                      <span style={{fontSize:12,color:isDarkMode?"#94a3b8":"#374151",lineHeight:1.5}}>{b}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div style={{padding:"0 16px 14px"}}>
                <button
                  disabled={plan.ctaDisabled || isCurrentScope}
                  onClick={() => { if (!plan.ctaDisabled && !isCurrentScope) onSelectPlan?.(plan.key, billing); }}
                  style={{
                    width:"100%",height:42,borderRadius:8,border:`1px solid ${plan.accentColor}88`,
                    background: (plan.ctaDisabled || isCurrentScope) ? (isDarkMode?"#0d1120":"#e8e0d4") : `linear-gradient(135deg, ${plan.accentColor}cc, ${plan.accentColor})`,
                    color: (plan.ctaDisabled || isCurrentScope) ? muted : "#fff",
                    fontWeight:800,fontSize:13,cursor:(plan.ctaDisabled||isCurrentScope)?"default":"pointer",
                    fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.01em",
                    transition:"all 0.2s",
                  }}
                >
                  {isCurrentScope ? "Current Scope" : plan.cta}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div style={{marginTop:18,padding:"12px 14px",background:isDarkMode?"#080c18":"#ede7dc",border:`1px solid ${cardBorder}`,borderRadius:8}}>
        <p style={{fontSize:11,color:isDarkMode?"#475569":"#6b7280",lineHeight:1.6,margin:0,textAlign:"center"}}>
          Individual plans are billed in USD via Stripe. Agency pricing is custom — request a quote for team rates. 24-hour guest passes are available on the login screen for one-time access.
        </p>
      </div>
    </div>
  );
}

/* �������������������������������������������������������
   APP TOUR
������������������������������������������������������� */
const TOUR_STEPS = [
  { icon:"🚑", title:"Welcome to R.O.M.A.N.", tag:null, levels:["EMT","AEMT","Medic","Guest"],
    body:"Rapid On-Scene Medical AI Navigator — your field-side EMS companion for drug reference, documentation, and clinical decision support." },
  { icon:"🟢", title:"Starting a Call", tag:"New PT", levels:["EMT","AEMT","Medic"],
    body:"Tap '+ New PT' in the top banner to begin a patient encounter. This stamps the call start time and opens the ePCR for demographics." },
  { icon:"📋", title:"ePCR — Patient Demographics", tag:"HIPAA", levels:["EMT","AEMT","Medic"],
    body:"Enter the patient's Age and Chief Complaint to unlock the drug screen. No patient names are ever stored — a system-generated Call ID is used instead." },
  { icon:"💡", title:"Chief Complaint Suggestions", tag:"ePCR", levels:["EMT","AEMT","Medic"],
    body:"Select a CC and R.O.M.A.N. suggests relevant drugs for that system. Tap the system badge to open its protocol, or tap any drug chip to jump directly to its card." },
  { icon:"💊", title:"Drug Screen", tag:"Drugs", levels:["EMT","AEMT","Medic","Guest"],
    body:"Browse drugs by body system — Cardiac, Trauma, Respiratory, Neuro, and more. Each card shows dose, route, concentration, contraindications, and weight-based calculations." },
  { icon:"⚕", title:"Pre-Checks & Safety Gates", tag:"Safety", levels:["EMT","AEMT","Medic","Guest"],
    body:"Before logging a dose the app walks you through required vitals and yes/no checks. ⛔ Red = contraindication blocked. ⚠ Yellow = caution — review before giving." },
  { icon:"📝", title:"Medication Log", tag:"Med Log", levels:["EMT","AEMT","Medic"],
    body:"The Med Log tracks every drug given this call with exact timestamps and doses. Tap any active drug pill in the banner to jump back to that card instantly." },
  { icon:"📈", title:"Vitals Tracking", tag:"Vitals", levels:["AEMT","Medic"],
    body:"Log BP, HR, RR, SpO₂, BGL, and GCS at any time from the Arrest / Vitals tab. Vitals entered during drug pre-checks are captured automatically — nothing gets lost." },
  { icon:"❤", title:"Cardiac Arrest Tracker", tag:"CPR", levels:["AEMT","Medic"],
    body:"The CPR tab runs a full arrest timer — 2-minute cycle tracking, epinephrine intervals, ROSC detection, airway management, and H's & T's documentation." },
  { icon:"📖", title:"Clinical Protocols", tag:"Protocols", levels:["AEMT","Medic"],
    body:"Step-by-step decision trees for ACS, burns, OB emergencies, and more. Your answers update the 'Next Action' card in real time to guide your treatment." },
  { icon:"🔒", title:"Closing & Locking a Call", tag:"HIPAA", levels:["EMT","AEMT","Medic"],
    body:"When transport is complete, tap 'Close Call'. Confirm the lock — call data is immediately archived to back-office, hidden on device, and auto-wiped after 5 hours." },
  { icon:"🛡", title:"HIPAA Safeguards", tag:"Privacy", levels:["EMT","AEMT","Medic","Guest"],
    body:"No patient names, ever. Only system-generated Call IDs. Archived records are locked and released to your agency only on formal request." },
  { icon:"🚀", title:"You're All Set!", tag:null, levels:["EMT","AEMT","Medic","Guest"],
    body:"Tap any icon in the nav menu to get started. You can replay this tour anytime by tapping '🗺 Tour' in the nav." },
];

function TourOverlay({ steps, stepIdx, onNext, onBack, onFinish, isDarkMode }) {
  if(!steps.length) return null;
  const step=steps[stepIdx];
  const isLast=stepIdx===steps.length-1;
  const isFirst=stepIdx===0;
  const accent="#3b82f6";
  const panel=isDarkMode?"#0d1728":"#ffffff";
  const text=isDarkMode?"#e2e8f0":"#1a1a1a";
  const sub=isDarkMode?"#64748b":"#6b7280";
  const border=isDarkMode?"#1e3a5f":"#d1d5db";
  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:isDarkMode?"rgba(0,0,0,0.88)":"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",backdropFilter:"blur(4px)"}}>
      <div style={{background:panel,borderRadius:16,padding:"28px 22px 22px",maxWidth:370,width:"100%",textAlign:"center",border:`1px solid ${border}`,boxShadow:"0 24px 80px rgba(0,0,0,0.45)",position:"relative"}}>
        {/* Skip */}
        <button onClick={onFinish} style={{position:"absolute",top:12,right:12,background:"transparent",border:`1px solid ${border}`,color:sub,borderRadius:6,padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>SKIP</button>
        {/* Counter */}
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,color:sub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>{stepIdx+1} / {steps.length}</div>
        {/* Icon */}
        <div style={{fontSize:44,marginBottom:10,lineHeight:1}}>{step.icon}</div>
        {/* Tag */}
        {step.tag&&<div style={{display:"inline-block",marginBottom:8,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",background:`${accent}22`,color:accent,border:`1px solid ${accent}44`,borderRadius:4,padding:"2px 8px"}}>{step.tag}</div>}
        {/* Title */}
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:800,color:text,marginBottom:10,lineHeight:1.3,marginTop:step.tag?0:4}}>{step.title}</div>
        {/* Body */}
        <div style={{fontSize:13,color:sub,lineHeight:1.65,marginBottom:22,fontFamily:"'DM Sans',sans-serif"}}>{step.body}</div>
        {/* Buttons */}
        <div style={{display:"flex",gap:8}}>
          {!isFirst&&<button onClick={onBack} style={{flex:1,padding:"11px 0",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:text,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>← Back</button>}
          <button onClick={isLast?onFinish:onNext} style={{flex:2,padding:"11px 0",borderRadius:8,border:"none",background:isLast?"#22c55e":accent,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{isLast?"Let's Go! 🚀":"Next →"}</button>
        </div>
        {/* Dot progress */}
        <div style={{display:"flex",justifyContent:"center",gap:4,marginTop:16}}>
          {steps.map((_,i)=>(
            <div key={i} style={{width:i===stepIdx?18:6,height:6,borderRadius:3,background:i===stepIdx?accent:border,transition:"all 0.2s"}}/>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   REFERENCE SCREEN — Pharmacology & Medical Terminology
───────────────────────────────────────────────────── */
const PHARM_DATA = [
  // CARDIAC
  { name:"Epinephrine 1:10,000", aka:"Adrenaline — Cardiac Dose", cat:"Cardiac", cls:"Catecholamine / Vasopressor",
    moa:"Non-selective α/β adrenergic agonist. α-1 vasoconstriction raises coronary and cerebral perfusion pressure during CPR. β-1 increases myocardial contractility and heart rate.",
    indications:["Cardiac arrest (VF, pVT, PEA, asystole)","Severe anaphylaxis — adjunct (second-line after IM epi)"],
    contras:["Pulse present — do NOT use this concentration in non-arrest patients"],
    se:["Tachyarrhythmias post-ROSC","Severe hypertension","Increased myocardial O₂ demand","Tissue necrosis if extravasation"],
    notes:"Arrest dose: 1 mg IV/IO q3–5 min. Flush with 20 mL NS, elevate limb. Never confuse 1:10,000 with 1:1,000 concentration.", col:"#f87171", bg:"#2a0808" },

  { name:"Epinephrine 1:1,000", aka:"Adrenaline — IM/Anaphylaxis Dose", cat:"Cardiac", cls:"Catecholamine / Bronchodilator",
    moa:"Same α/β agonist. IM route for anaphylaxis: β-2 bronchodilation, α-1 reverses vasodilation and urticaria, β-1 improves cardiac output.",
    indications:["Anaphylaxis / severe allergic reaction","Severe asthma refractory to albuterol (subcutaneous)"],
    contras:["No absolute contraindications in anaphylaxis — benefit always outweighs risk","Caution: known coronary artery disease"],
    se:["Palpitations / tachycardia","Anxiety / tremor","Transient hypertension","Headache"],
    notes:"Adult: 0.3–0.5 mg IM anterolateral thigh. Peds: 0.01 mg/kg IM (max 0.3 mg). Repeat q5–15 min. Thigh preferred — faster absorption than deltoid.", col:"#f87171", bg:"#2a0808" },

  { name:"Adenosine", aka:"Adenocard", cat:"Cardiac", cls:"Antiarrhythmic (Class V — Purinergic)",
    moa:"Transiently blocks AV nodal conduction by activating A1 purinergic receptors → hyperpolarization of AV nodal cells. Terminates AV-nodal-dependent reentry SVT circuits.",
    indications:["Narrow-complex SVT (PSVT, reentrant)","Diagnostic for wide-complex tachycardia of uncertain origin"],
    contras:["2nd or 3rd degree AV block","Sick sinus syndrome without pacemaker","WPW with atrial flutter/fib (may accelerate accessory pathway)","Known hypersensitivity"],
    se:["Transient asystole (seconds — warn patient)","Chest pressure / flushing","Bronchospasm (caution in severe asthma/COPD)","Brief hypotension"],
    notes:"Rapid IV push at antecubital fossa or above, followed immediately by 20 mL NS flush. First dose: 6 mg. 2nd/3rd: 12 mg. Half-life <10 seconds.", col:"#60a5fa", bg:"#0d1f3a" },

  { name:"Atropine", aka:"Atropine Sulfate", cat:"Cardiac", cls:"Anticholinergic / Parasympatholytic",
    moa:"Competitive antagonist at muscarinic acetylcholine receptors. Blocks vagal tone at SA and AV nodes → increases heart rate and AV conduction velocity.",
    indications:["Symptomatic bradycardia (hypotension, AMS, syncope, ischemic chest pain)","Organophosphate / nerve agent poisoning","Bradycardia during RSI (peds)"],
    contras:["High-degree AV block Type II or complete — atropine may paradoxically worsen","Tachycardia","Acute angle-closure glaucoma"],
    se:["Tachycardia","Dry mouth and skin","Urinary retention","Blurred vision","Hyperthermia","AMS / delirium in elderly"],
    notes:"Bradycardia: 0.5 mg IV q3–5 min (max 3 mg). Doses <0.5 mg may paradoxically slow heart rate. Consider transcutaneous pacing if no response.", col:"#60a5fa", bg:"#0d1f3a" },

  { name:"Amiodarone", aka:"Cordarone, Nexterone", cat:"Cardiac", cls:"Antiarrhythmic (Class III)",
    moa:"Prolongs action potential duration and refractory period in atrial and ventricular tissue. Blocks Na⁺, K⁺, Ca²⁺ channels. Broadest antiarrhythmic spectrum (Classes I–IV properties).",
    indications:["VF/pVT refractory to defibrillation","Stable wide-complex tachycardia","Atrial fibrillation with rapid ventricular rate"],
    contras:["Bradycardia / AV block without pacemaker","Cardiogenic shock","Known hypersensitivity to amiodarone or iodine"],
    se:["Hypotension (especially IV bolus)","Bradycardia","QT prolongation / Torsades","Phlebitis at IV site","Long-term: thyroid, pulmonary, hepatic toxicity"],
    notes:"Cardiac arrest: 300 mg IV/IO push; repeat 150 mg for refractory VF. Stable VT/AF: 150 mg IV over 10 min. Infuse slowly to reduce hypotension.", col:"#60a5fa", bg:"#0d1f3a" },

  { name:"Lidocaine", aka:"Xylocaine", cat:"Cardiac", cls:"Antiarrhythmic (Class Ib) / Local Anesthetic",
    moa:"Blocks voltage-gated Na⁺ channels → suppresses automaticity in His-Purkinje fibers and ventricular myocardium. Minimal effect on SA node or atrial tissue.",
    indications:["VF/pVT (alternative to amiodarone in cardiac arrest)","Stable VT refractory to other measures","IO administration to reduce procedural pain"],
    contras:["Adams-Stokes syndrome without pacemaker","Severe SA or AV node dysfunction","Known hypersensitivity to amide-type local anesthetics"],
    se:["CNS toxicity: tinnitus, perioral numbness, seizures, AMS","Cardiovascular depression at high doses","Bradycardia"],
    notes:"Arrest: 1–1.5 mg/kg IV/IO push; repeat 0.5–0.75 mg/kg q5–10 min (max 3 mg/kg). Pre-IO: 40–50 mg IO to reduce intraosseous pain.", col:"#60a5fa", bg:"#0d1f3a" },

  { name:"Aspirin", aka:"ASA, Acetylsalicylic Acid", cat:"Cardiac", cls:"Antiplatelet / NSAID",
    moa:"Irreversibly inhibits COX-1 and COX-2 → reduces thromboxane A₂ synthesis → inhibits platelet aggregation. Effect lasts the platelet's entire lifespan (7–10 days) since platelets cannot synthesize new COX.",
    indications:["Suspected ACS / STEMI (first-line, early administration)","Chest pain of probable cardiac origin"],
    contras:["Active GI bleed or peptic ulcer","Known ASA or NSAID hypersensitivity","Full 324 mg dose already taken today","Children with viral illness (Reye syndrome risk)"],
    se:["GI upset / nausea","Tinnitus (toxicity)","Bronchospasm in ASA-sensitive asthma","Increased bleeding"],
    notes:"324 mg (four 81 mg tabs) chewed — not swallowed whole — for fastest buccal absorption. Reduce dose if prior aspirin taken today.", col:"#f87171", bg:"#2a0808" },

  { name:"Nitroglycerin", aka:"Nitrostat, NTG", cat:"Cardiac", cls:"Organic Nitrate / Vasodilator",
    moa:"Converted to nitric oxide (NO) in vascular smooth muscle → activates guanylyl cyclase → ↑ cGMP → smooth muscle relaxation. Venodilation reduces preload; arterial dilation reduces afterload and myocardial O₂ demand.",
    indications:["Ischemic chest pain / ACS","Acute cardiogenic pulmonary edema (Medic level, with adequate SBP)","Hypertensive urgency"],
    contras:["SBP <100 mmHg","PDE-5 inhibitor use within 48 h (sildenafil, tadalafil, vardenafil) — severe hypotension risk","Suspected RVI (preload-dependent)","Severe aortic stenosis"],
    se:["Hypotension (can be profound)","Reflex tachycardia","Headache","Dizziness / syncope"],
    notes:"0.4 mg SL q3–5 min, max 3 doses. Check SBP before each dose. Burning/tingling under tongue confirms potency. Do not swallow — sublingual absorption only.", col:"#f87171", bg:"#2a0808" },

  { name:"Dopamine", aka:"Intropin", cat:"Cardiac", cls:"Catecholamine / Vasoactive Infusion",
    moa:"Dose-dependent receptor activity: Low (1–5 mcg/kg/min): dopaminergic → renal/mesenteric vasodilation. Moderate (5–10): β-1 → ↑ contractility and HR. High (10–20): α-1 dominant → vasoconstriction, ↑ SVR.",
    indications:["Symptomatic hypotension unresponsive to fluid resuscitation","Cardiogenic shock","Post-ROSC hypotension with bradycardia"],
    contras:["Uncorrected hypovolemia (give fluids first)","Pheochromocytoma","VF/VT","Known hypersensitivity"],
    se:["Tachycardia and arrhythmias","Tissue necrosis if extravasation","Nausea / vomiting","Increased myocardial O₂ demand"],
    notes:"5–20 mcg/kg/min IV infusion titrated to SBP >90. Weight-based calculation required. Central line preferred — extravasation causes serious tissue injury.", col:"#60a5fa", bg:"#0d1f3a" },

  // RESPIRATORY
  { name:"Albuterol", aka:"Proventil, Ventolin, AccuNeb", cat:"Respiratory", cls:"Short-Acting Beta-2 Agonist (SABA)",
    moa:"Selective β-2 adrenergic agonist → ↑ intracellular cAMP → relaxes bronchial smooth muscle → bronchodilation. Also mildly reduces mast cell mediator release.",
    indications:["Acute asthma exacerbation","COPD exacerbation with bronchospasm","Anaphylaxis bronchospasm component","Suspected hyperkalemia (β-2 shifts K⁺ intracellularly — temporizing)"],
    contras:["Known hypersensitivity to albuterol or levalbuterol","Tachyarrhythmias (relative — benefit usually outweighs risk in bronchospasm)"],
    se:["Tachycardia (most common)","Tremor / anxiety","Hypokalemia (continuous high doses)","Paradoxical bronchospasm (rare)"],
    notes:"Nebulizer: 2.5 mg in 3 mL NS over 8–10 min. Continuous neb for severe attacks. MDI via spacer: 4–8 puffs equivalent to one neb treatment.", col:"#86efac", bg:"#071a0e" },

  { name:"Ipratropium", aka:"Atrovent", cat:"Respiratory", cls:"Short-Acting Muscarinic Antagonist (SAMA)",
    moa:"Blocks muscarinic (M3) receptors in bronchial smooth muscle → reduces bronchoconstriction and secretions. Complements albuterol via different pathway (anticholinergic vs. adrenergic).",
    indications:["COPD exacerbation (first-line bronchodilator)","Moderate-severe asthma combined with albuterol"],
    contras:["Hypersensitivity to ipratropium, atropine, or solanaceous alkaloids","Peanut/soy allergy (MDI formulation)"],
    se:["Dry mouth","Headache","Blurred vision if contacts eyes","Urinary retention (less common than systemic atropine)"],
    notes:"0.5 mg via nebulizer combined with albuterol (DuoNeb). Minimal systemic absorption — acts locally. Onset 15 min, peak effect 1–2 h.", col:"#86efac", bg:"#071a0e" },

  { name:"Methylprednisolone", aka:"Solu-Medrol", cat:"Respiratory", cls:"Corticosteroid / Anti-inflammatory",
    moa:"Binds glucocorticoid receptors → suppresses inflammatory cytokines, prostaglandins, leukotrienes → reduces airway inflammation and mucosal edema. Onset slow — effect develops over 4–6 hours.",
    indications:["Moderate-severe asthma exacerbation","COPD exacerbation","Anaphylaxis (second-line adjunct after epinephrine)","Spinal cord injury (per medical direction — NASCIS protocol, controversial)"],
    contras:["Systemic fungal infection","Active untreated tuberculosis (relative)"],
    se:["Hyperglycemia","Hypertension","Fluid retention","Immunosuppression","GI upset"],
    notes:"Asthma/COPD: 125 mg IV. Anaphylaxis: 125 mg IV. NOT a first-line acute bronchodilator — onset too slow. Bridges patient to definitive care.", col:"#86efac", bg:"#071a0e" },

  // ANALGESICS
  { name:"Fentanyl", aka:"Sublimaze, Duragesic", cat:"Analgesic", cls:"Opioid Analgesic (μ-Opioid Agonist)",
    moa:"Binds μ (mu) opioid receptors in CNS and spinal cord → inhibits substance P release → reduces pain signal transmission. Brainstem μ receptors mediate respiratory depression.",
    indications:["Moderate-severe acute pain (trauma, burns, ischemia, fractures)","Procedural analgesia","RSI (blunts laryngoscopy hemodynamic response)"],
    contras:["Severe respiratory depression RR <10","Known hypersensitivity","Caution: hypotension, concurrent CNS depressants"],
    se:["Respiratory depression (dose-dependent, most dangerous effect)","Chest wall rigidity (wooden chest) at high IV doses","Nausea / vomiting","Bradycardia","Hypotension"],
    notes:"Adult: 1–2 mcg/kg IV (25–100 mcg). Intranasal: 2 mcg/kg via atomizer. 100× more potent than morphine. Preferred in hemodynamic instability. Reversed by naloxone.", col:"#fb923c", bg:"#1a0500" },

  { name:"Morphine Sulfate", aka:"MS Contin, Roxanol", cat:"Analgesic", cls:"Opioid Analgesic (μ-Opioid Agonist)",
    moa:"Binds μ opioid receptors → reduces pain. Triggers histamine release → venodilation and reduced preload (beneficial in pulmonary edema). Slower onset than fentanyl.",
    indications:["Moderate-severe pain (ACS, renal colic, major trauma)","Acute cardiogenic pulmonary edema — adjunct (reduces anxiety and preload)"],
    contras:["SBP <90","RR <10","Known hypersensitivity","Caution in COPD/asthma (histamine release may worsen bronchospasm)"],
    se:["Respiratory depression","Hypotension (histamine-mediated vasodilation)","Nausea / vomiting","Pruritis","Urinary retention"],
    notes:"0.1 mg/kg IV (typical adult: 2–4 mg, titrated q5–10 min). Avoid in hemodynamic instability — use fentanyl instead. Reversed by naloxone.", col:"#fb923c", bg:"#1a0500" },

  { name:"Ketamine", aka:"Ketalar", cat:"Analgesic", cls:"Dissociative Anesthetic / NMDA Antagonist",
    moa:"Antagonizes NMDA glutamate receptors → dissociation, analgesia, amnesia. Stimulates sympathetic nervous system — maintains BP/HR. Preserves protective airway reflexes and spontaneous respirations at procedural doses.",
    indications:["Procedural sedation (dislocation, wound care)","Sub-dissociative analgesia","RSI induction (especially hemodynamically unstable patients)","Excited delirium / severe agitation","Status asthmaticus refractory to standard treatment"],
    contras:["Active psychosis or schizophrenia (emergence reactions can be severe)","Uncontrolled hypertension (relative)","Use caution: suspected elevated ICP (previous restriction largely abandoned — evidence evolving)"],
    se:["Emergence reactions (hallucinations, dysphoria — adult > peds)","Hypertension and tachycardia","Hypersalivation","Laryngospasm (rare)","Transient apnea at high IV doses"],
    notes:"Sedation: 1–2 mg/kg IV or 4–6 mg/kg IM. Analgesia: 0.1–0.3 mg/kg IV slow push. Benzodiazepine premedication reduces emergence reactions.", col:"#fb923c", bg:"#1a0500" },

  { name:"Ketorolac", aka:"Toradol", cat:"Analgesic", cls:"NSAID / Non-Opioid Analgesic",
    moa:"Inhibits COX-1 and COX-2 → reduces prostaglandin synthesis → anti-inflammatory and analgesic. No opioid receptor activity — no respiratory depression.",
    indications:["Moderate pain (renal colic, musculoskeletal, headache)","Opioid-sparing strategy","Non-opioid alternative when respiratory depression risk is high"],
    contras:["Renal impairment","Active or recent GI bleed / peptic ulcer","Known NSAID or ASA hypersensitivity","Pregnancy 3rd trimester","Volume depletion / hemorrhagic shock"],
    se:["GI upset and ulceration","Renal impairment with prolonged use","Platelet inhibition / increased bleeding risk","Hypersensitivity reaction"],
    notes:"15–30 mg IV; 30–60 mg IM. Onset 30 min. Short-term only (≤5 days). Avoid in dehydrated patients — NSAIDs reduce renal perfusion.", col:"#fb923c", bg:"#1a0500" },

  // SEDATION
  { name:"Midazolam", aka:"Versed", cat:"Sedation", cls:"Short-Acting Benzodiazepine",
    moa:"Positive allosteric modulator at GABA-A receptors → potentiates GABA (chief inhibitory neurotransmitter) → CNS depression, sedation, anxiolysis, anterograde amnesia, anticonvulsant, muscle relaxation.",
    indications:["Active seizures / status epilepticus","Procedural sedation","Excited delirium (chemical restraint)","RSI adjunct","Acute severe anxiety"],
    contras:["SBP <90","RR <8 — hold, significant respiratory depression present","No airway management capability available","Known hypersensitivity"],
    se:["Respiratory depression (profound with opioid combination)","Hypotension","Paradoxical agitation (children, elderly)","Anterograde amnesia"],
    notes:"Seizures: 5–10 mg IM, 0.1 mg/kg IV/IO, or 5 mg intranasal. IN route works without IV access — fastest field option. Reversed by flumazenil.", col:"#c084fc", bg:"#1a0e28" },

  { name:"Lorazepam", aka:"Ativan", cat:"Sedation", cls:"Intermediate-Acting Benzodiazepine",
    moa:"Positive allosteric modulation at GABA-A receptors (same mechanism as midazolam). Longer clinical duration due to slower redistribution from CNS.",
    indications:["Status epilepticus","Acute severe anxiety / agitation","Alcohol withdrawal seizures","Procedural sedation"],
    contras:["SBP <90","RR <8","Acute angle-closure glaucoma","Known hypersensitivity"],
    se:["Respiratory depression","Hypotension","Prolonged sedation","Paradoxical agitation"],
    notes:"Seizures: 2–4 mg IV/IM. May repeat once after 5–10 min. Duration 6–12 h. Some formulations require refrigeration — check agency policy.", col:"#c084fc", bg:"#1a0e28" },

  { name:"Haloperidol", aka:"Haldol", cat:"Sedation", cls:"Typical Antipsychotic (D2 Antagonist / Butyrophenone)",
    moa:"Blocks D2 dopamine receptors in mesolimbic pathway → antipsychotic. D2 blockade in CTZ → antiemetic. Does NOT cause respiratory depression at clinical IM doses.",
    indications:["Excited delirium","Acute psychosis / severe agitation","Nausea and vomiting refractory to other antiemetics"],
    contras:["Parkinson's disease (dopamine blockade worsens motor symptoms)","Known QT prolongation or concurrent QT-prolonging meds","Known hypersensitivity"],
    se:["QT prolongation / Torsades de Pointes (major risk)","Extrapyramidal symptoms: acute dystonia, akathisia","Neuroleptic malignant syndrome (rare)","Hypotension"],
    notes:"Agitation: 5–10 mg IM (adult). Often combined with midazolam ± diphenhydramine (DRD protocol). Stimulant toxicity: caution — may unmask arrhythmias.", col:"#c084fc", bg:"#1a0e28" },

  // ANTIDOTES
  { name:"Naloxone", aka:"Narcan, Evzio, Kloxxado", cat:"Antidote", cls:"Opioid Antagonist",
    moa:"Competitive antagonist at μ, κ, and δ opioid receptors → rapidly reverses opioid-induced respiratory depression, sedation, and analgesia. Higher receptor affinity than most opioids.",
    indications:["Opioid overdose (triad: respiratory depression, AMS, miosis)","Reversal of iatrogenic opioid respiratory depression","Empiric therapy in unexplained AMS"],
    contras:["Known hypersensitivity (rare)","Caution in opioid-dependent patients — precipitates acute withdrawal (agitation, hypertensive emergency, pulmonary edema)"],
    se:["Acute opioid withdrawal (N/V, diaphoresis, hypertension, agitation)","Re-narcotization when naloxone wears off (half-life shorter than most opioids)","Pulmonary edema (rare)"],
    notes:"Titrate to respirations, NOT consciousness. Adult: 0.4–2 mg IV/IO/IM; 4 mg IN per nostril. May repeat q2–3 min. Half-life 30–90 min — re-dosing often needed. Monitor closely.", col:"#fb923c", bg:"#1a0500" },

  { name:"Diphenhydramine", aka:"Benadryl", cat:"Antidote", cls:"H1 Antihistamine / Anticholinergic",
    moa:"Competitively blocks H1 histamine receptors → reduces allergic response. Crosses blood-brain barrier → sedation and antiemesis. Strong anticholinergic activity.",
    indications:["Mild-moderate allergic reaction (urticaria, pruritus)","Anaphylaxis adjunct — H1 blockade after epinephrine","Extrapyramidal reactions from antipsychotics (acute dystonia)","Nausea / motion sickness"],
    contras:["Acute angle-closure glaucoma","Benign prostatic hypertrophy (urinary retention)","MAO inhibitor use","Neonates"],
    se:["Sedation (potentiates all CNS depressants)","Dry mouth, urinary retention, constipation","Tachycardia","Paradoxical excitation in young children"],
    notes:"25–50 mg IV/IM (adult). NOT first-line for anaphylaxis — epinephrine always first. Useful for urticaria and extrapyramidal reactions.", col:"#fb923c", bg:"#1a0500" },

  // METABOLIC
  { name:"Dextrose", aka:"D50W, D10W, D25W (peds)", cat:"Metabolic", cls:"Carbohydrate / Glucose Supplement",
    moa:"Provides exogenous glucose directly into circulation → rapidly raises blood glucose → reverses hypoglycemia-induced cerebral dysfunction (brain's primary fuel is glucose).",
    indications:["Symptomatic hypoglycemia (BGL <60–70 with symptoms)","AMS of unknown etiology — empiric therapy","Suspected hypoglycemia without IV access (use glucagon)"],
    contras:["Confirmed hyperglycemia","Suspected CVA (large glucose load may worsen ischemic injury — controversial)","Caution: Wernicke's encephalopathy (give thiamine first)"],
    se:["Hyperglycemia","Phlebitis and tissue necrosis if extravasation (hypertonic — caustic)","Hypokalemia at high doses"],
    notes:"Adult: D50W 25 g (50 mL) IV push. Peds: D10W 5 mL/kg or D25W 2 mL/kg. D10W preferred in peds to reduce osmolality. Confirm IV patency — extravasation causes serious injury. Recheck BGL at 10 min.", col:"#fde68a", bg:"#1a1200" },

  { name:"Glucagon", aka:"GlucaGen", cat:"Metabolic", cls:"Pancreatic Hormone / Hyperglycemic Agent",
    moa:"Activates hepatic glucagon receptors → stimulates glycogenolysis and gluconeogenesis → raises blood glucose. Also positive inotrope/chronotrope via non-adrenergic cAMP pathway — useful in beta-blocker overdose.",
    indications:["Hypoglycemia without IV/IO access","Beta-blocker overdose refractory to standard treatment","Calcium channel blocker overdose (adjunct)"],
    contras:["Pheochromocytoma (may trigger catecholamine release)","Known hypersensitivity","Chronic alcoholism / starvation (depleted glycogen — reduced efficacy)"],
    se:["Nausea / vomiting (reposition to prevent aspiration)","Tachycardia","Hyperglycemia"],
    notes:"1 mg IM/SQ (peds: 0.5 mg or 0.02 mg/kg). Onset 10–15 min IM. Ineffective in glycogen-depleted states. Once conscious, give oral glucose.", col:"#fde68a", bg:"#1a1200" },

  { name:"Magnesium Sulfate", aka:"MgSO₄, Mag", cat:"Metabolic", cls:"Electrolyte / Anticonvulsant / Antiarrhythmic",
    moa:"Replaces magnesium deficit; competes with calcium at vascular smooth muscle → vasodilation; blocks NMDA receptors; inhibits neuromuscular junction; slows SA/AV node conduction.",
    indications:["Eclampsia and severe pre-eclampsia (drug of choice)","Torsades de Pointes","Refractory VF/pVT with suspected hypomagnesemia","Severe asthma / status asthmaticus","Preterm labor — tocolytic"],
    contras:["Significant renal failure (accumulation risk)","Heart block without pacemaker","Myasthenia gravis"],
    se:["Hypotension","Respiratory depression and arrest (toxicity)","Loss of deep tendon reflexes (early toxicity warning)","Facial flushing and warmth","Cardiac arrest at very high serum levels"],
    notes:"Eclampsia: 4–6 g IV over 15–20 min SLOWLY. Torsades: 1–2 g IV over 5–20 min. Monitor DTRs as toxicity marker. Antidote: calcium gluconate 1 g IV. Peds: 25–50 mg/kg IV (max 2 g).", col:"#fde68a", bg:"#1a1200" },

  { name:"Ondansetron", aka:"Zofran", cat:"Metabolic", cls:"5-HT3 Serotonin Antagonist / Antiemetic",
    moa:"Selectively blocks 5-HT3 serotonin receptors in the chemoreceptor trigger zone (CTZ) and peripheral vagal nerve terminals → interrupts vomiting reflex pathway.",
    indications:["Nausea and vomiting (opioid-induced, GI, head trauma, vertigo)","Post-procedure nausea","Gastroenteritis"],
    contras:["Known hypersensitivity","Concurrent QT-prolonging medications","Caution: congenital long QT syndrome"],
    se:["Headache","QT prolongation (dose-dependent)","Constipation","Dizziness"],
    notes:"4 mg IV/IM or ODT. Peds: 0.1 mg/kg IV (max 4 mg). Does NOT cause sedation — neurological assessment remains valid.", col:"#fde68a", bg:"#1a1200" },

  { name:"Sodium Bicarbonate", aka:"NaHCO₃, Bicarb", cat:"Metabolic", cls:"Buffer / Alkalinizing Agent",
    moa:"Provides bicarbonate ions → buffers excess hydrogen ions → raises blood pH. In TCA overdose, alkalinization increases protein binding of TCAs → reduces free toxic drug and narrows QRS.",
    indications:["TCA overdose with wide QRS or arrhythmia","Severe metabolic acidosis pH <7.1 (per medical direction)","Hyperkalemia — temporizing (shifts K⁺ intracellularly)","Cardiac arrest with prolonged downtime (per medical direction)"],
    contras:["Inadequate ventilation (produces CO₂ — worsens respiratory acidosis)","Metabolic alkalosis","Hypocalcemia"],
    se:["Hypernatremia","Hypokalemia","Paradoxical intracellular acidosis","Metabolic alkalosis overshoot","Precipitates with calcium-containing solutions"],
    notes:"1 mEq/kg IV bolus (adult: typically 50–100 mEq). NEVER mix in same line as calcium — immediate precipitation. TCA: target arterial pH 7.45–7.55.", col:"#fde68a", bg:"#1a1200" },

  { name:"Calcium Chloride", aka:"CaCl₂", cat:"Metabolic", cls:"Electrolyte / Cardiac Membrane Stabilizer",
    moa:"Raises ionized calcium → antagonizes hyperkalemia and calcium channel blocker effects on cardiac membrane potential. Restores membrane resting potential without reversing channel blockade directly.",
    indications:["Hyperkalemia with cardiac manifestations (peaked T waves, wide QRS)","Calcium channel blocker overdose","Magnesium toxicity (antidote)","Fluoride poisoning"],
    contras:["Digoxin toxicity (may cause fatal arrhythmia)","Hypercalcemia","Do NOT infuse with sodium bicarbonate in same line (precipitates)"],
    se:["Bradycardia with rapid infusion","Severe tissue necrosis if extravasation","Hypercalcemia","Hypotension at high rates"],
    notes:"1 g (10 mL of 10% solution) IV slowly over 2–5 min. Contains 3× more elemental calcium than calcium gluconate. Central line preferred — very irritating to peripheral veins.", col:"#fde68a", bg:"#1a1200" },

  // OB
  { name:"Oxytocin", aka:"Pitocin", cat:"OB", cls:"Uterotonic Hormone",
    moa:"Binds uterine oxytocin receptors → stimulates uterine smooth muscle contractions → increases frequency and force. Requires delivery of placenta to avoid fetal hemodynamic effects.",
    indications:["Postpartum hemorrhage after placenta delivery","Uterine atony unresponsive to uterine massage"],
    contras:["Placenta NOT yet delivered — risk of fetal distress","Cardiovascular disease (vasodilatory hypotension)","Antepartum use in field (relative)"],
    se:["Hypotension (rapid IV push — NEVER give as bolus)","Uterine tetany / hyperstimulation","Water intoxication (prolonged infusion)","Nausea"],
    notes:"10–20 units IM OR 10–40 units in 1 L NS as IV infusion. NEVER rapid IV bolus. Confirm placenta delivered before administering.", col:"#f9a8d4", bg:"#1a0515" },
];

const MED_TERMS = [
  { term:"ACS", cat:"Cardiovascular", def:"Acute Coronary Syndrome — umbrella term for sudden reduction in coronary blood flow: unstable angina, NSTEMI, and STEMI. All require immediate ASA and time-sensitive treatment." },
  { term:"STEMI", cat:"Cardiovascular", def:"ST-Elevation Myocardial Infarction — complete coronary artery occlusion causing full-thickness (transmural) myocardial injury. Identified by ≥1 mm ST elevation in two contiguous leads. Time-critical reperfusion." },
  { term:"NSTEMI", cat:"Cardiovascular", def:"Non-ST-Elevation MI — partial coronary occlusion with elevated troponin but no ST elevation on 12-lead. ST depression or T-wave inversions may be present." },
  { term:"VF", cat:"Cardiovascular", def:"Ventricular Fibrillation — completely disorganized ventricular electrical activity with no effective cardiac output. Immediately life-threatening. Treatment: immediate defibrillation + CPR." },
  { term:"VT", cat:"Cardiovascular", def:"Ventricular Tachycardia — ≥3 consecutive ventricular beats at >100 bpm. Wide-complex QRS (>0.12 sec). Can be with pulse (stable/unstable) or pulseless." },
  { term:"pVT", cat:"Cardiovascular", def:"Pulseless Ventricular Tachycardia — VT without a palpable pulse. Treated identically to VF: immediate defibrillation." },
  { term:"PEA", cat:"Cardiovascular", def:"Pulseless Electrical Activity — organized electrical rhythm without adequate mechanical cardiac output. Reversible causes: 5H/5T (hypovolemia, hypoxia, H⁺ acidosis, hypo/hyperkalemia, hypothermia; tension PTX, tamponade, toxins, thrombosis PE, thrombosis coronary)." },
  { term:"SVT", cat:"Cardiovascular", def:"Supraventricular Tachycardia — rapid rhythm originating above the bundle of His. Typically narrow-complex, regular, HR 150–250 bpm. Most common type in EMS is AVNRT (AV nodal reentry)." },
  { term:"ROSC", cat:"Cardiovascular", def:"Return of Spontaneous Circulation — reestablishment of a palpable pulse after cardiac arrest. Signs: organized rhythm, palpable pulse, possible purposeful movement, rising EtCO₂." },
  { term:"RVI", cat:"Cardiovascular", def:"Right Ventricular Infarction — occurs with inferior STEMI (ST elevation II, III, aVF). Right side is preload-dependent: avoid nitroglycerin, morphine, diuretics. Give IV fluids." },
  { term:"Preload", cat:"Cardiovascular", def:"Volume of blood filling the ventricle at end-diastole. Stretching force on myocardium before contraction (Frank-Starling law). Reduced by nitroglycerin, furosemide; increased by IV fluids." },
  { term:"Afterload", cat:"Cardiovascular", def:"Resistance the ventricle must overcome to eject blood — primarily systemic vascular resistance. Elevated in hypertension, vasopressors. Reduced by vasodilators." },
  { term:"5Hs and 5Ts", cat:"Cardiovascular", def:"Reversible causes of cardiac arrest. H: Hypovolemia, Hypoxia, H⁺ (acidosis), Hypo/Hyperkalemia, Hypothermia. T: Tension pneumothorax, Tamponade (cardiac), Toxins, Thrombosis (PE), Thrombosis (coronary/STEMI)." },
  { term:"Beck's Triad", cat:"Cardiovascular", def:"Classic signs of cardiac tamponade: (1) hypotension, (2) muffled/distant heart sounds, (3) jugular venous distension (JVD). Pulsus paradoxus also classic." },
  { term:"Pulsus Paradoxus", cat:"Cardiovascular", def:"Exaggerated drop of >10 mmHg in SBP during inspiration. Seen in cardiac tamponade and severe asthma/COPD. Caused by respiratory variation in ventricular filling." },
  { term:"PAC", cat:"Cardiovascular", def:"Premature Atrial Contraction — early beat from an ectopic atrial focus. P-wave morphology differs from sinus P wave. Generally benign; monitor for frequency in ACS." },
  { term:"PVC", cat:"Cardiovascular", def:"Premature Ventricular Contraction — early beat from a ventricular ectopic focus. Wide, bizarre QRS without preceding P wave. Concerning if: >6/min, runs of 2+ (couplets, triplets), or R-on-T." },
  { term:"SBP", cat:"Vitals", def:"Systolic Blood Pressure — peak arterial pressure generated during ventricular contraction. Normal adult: 100–140 mmHg. <90 = hypotension (shock threshold); >180 = hypertensive urgency." },
  { term:"DBP", cat:"Vitals", def:"Diastolic Blood Pressure — arterial pressure during ventricular relaxation. Normal adult: 60–90 mmHg. Reflects systemic vascular resistance." },
  { term:"MAP", cat:"Vitals", def:"Mean Arterial Pressure — average arterial pressure during one cardiac cycle. Formula: DBP + ⅓(SBP − DBP). Target: ≥65 mmHg in septic shock; ≥70 for traumatic brain injury." },
  { term:"SpO₂", cat:"Vitals", def:"Peripheral oxygen saturation via pulse oximetry. Estimates hemoglobin saturation. Normal ≥95%. Unreliable in: poor perfusion, CO poisoning, severe anemia, dark nail polish or varnish." },
  { term:"EtCO₂", cat:"Vitals", def:"End-Tidal CO₂ — CO₂ at end of exhalation by capnography. Normal 35–45 mmHg. Confirms ETT placement. Monitors ventilation, circulation (↓ EtCO₂ in low CO), and detects ROSC (sudden rise)." },
  { term:"BGL", cat:"Vitals", def:"Blood Glucose Level — capillary glucose by glucometer. Normal fasting: 70–110 mg/dL. <70 = hypoglycemia; >200 = hyperglycemia; >400 = critical. Always check in AMS." },
  { term:"GCS", cat:"Neurological", def:"Glasgow Coma Scale — Eyes (1–4), Verbal (1–5), Motor (1–6). Max 15 = fully alert. ≤8 = severe impairment, consider airway. Serial GCS tracks trajectory over time." },
  { term:"AMS", cat:"Neurological", def:"Altered Mental Status — any deviation from patient's baseline mentation. First check: BGL. Other causes: hypoxia, CVA, toxidrome, head trauma, sepsis, metabolic derangement." },
  { term:"CVA", cat:"Neurological", def:"Cerebrovascular Accident (Stroke) — sudden neurological deficit from ischemia (thrombotic or embolic) or hemorrhage. Ischemic: tPA window 3–4.5 h from symptom onset. Time is brain." },
  { term:"TIA", cat:"Neurological", def:"Transient Ischemic Attack — stroke-like symptoms resolving within 24 h (usually <1 h). High short-term stroke risk (up to 10% within 48 h). Treat as potential stroke in field." },
  { term:"ICP", cat:"Neurological", def:"Intracranial Pressure — pressure inside the skull. Normal <15 mmHg. Elevated ICP → herniation. Signs: Cushing's triad, fixed/dilated pupil, decorticate/decerebrate posturing." },
  { term:"Cushing's Triad", cat:"Neurological", def:"Late sign of severely elevated ICP with impending herniation: (1) hypertension with widened pulse pressure, (2) bradycardia, (3) irregular / agonal respirations. Immediate intervention required." },
  { term:"Postictal", cat:"Neurological", def:"Post-seizure recovery phase: confusion, lethargy, AMS lasting minutes to hours. Patient gradually returns to baseline. Differentiate from new stroke or ongoing seizure." },
  { term:"Status Epilepticus", cat:"Neurological", def:"Seizure lasting >5 minutes OR ≥2 seizures without full recovery between them. Medical emergency — the longer untreated, the harder to stop and greater neurological injury. First-line: benzodiazepine." },
  { term:"AVPU", cat:"Neurological", def:"Rapid mental status scale: Alert, Verbal (responds to voice), Painful (responds to pain only), Unresponsive. P = approximately GCS 8. Use for rapid trending." },
  { term:"SOB / Dyspnea", cat:"Respiratory", def:"Shortness of breath — subjective sensation of difficult, uncomfortable, or labored breathing. Assess objectively: respiratory rate, accessory muscle use, SpO₂, position of comfort (tripod = severe)." },
  { term:"CPAP", cat:"Respiratory", def:"Continuous Positive Airway Pressure — non-invasive ventilation delivering constant pressure to recruit collapsed alveoli. Used in CHF pulmonary edema, COPD exacerbation. Contraindicated: vomiting, unable to cooperate, facial trauma." },
  { term:"BVM", cat:"Respiratory", def:"Bag-Valve Mask — manual positive-pressure ventilation. Two-person technique (one seals mask, one squeezes bag) significantly improves seal and tidal volume delivery." },
  { term:"ETT", cat:"Respiratory", def:"Endotracheal Tube — definitive airway placed through the glottis into the trachea. Confirm with: direct visualization of cords, EtCO₂ waveform, bilateral breath sounds, chest rise." },
  { term:"RSI", cat:"Respiratory", def:"Rapid Sequence Intubation — simultaneous sedative + neuromuscular blocking agent to facilitate urgent ETT placement. Minimizes aspiration risk and time to definitive airway." },
  { term:"PEEP", cat:"Respiratory", def:"Positive End-Expiratory Pressure — pressure maintained in airway at end of exhalation during ventilation. Prevents alveolar collapse. Optimal PEEP typically 5–10 cmH₂O." },
  { term:"Wheeze", cat:"Respiratory", def:"High-pitched, musical expiratory sound from narrowed intrathoracic airways. Hallmark of bronchospasm (asthma, anaphylaxis, COPD). A silent chest in severe asthma means no air movement — emergent." },
  { term:"Stridor", cat:"Respiratory", def:"High-pitched inspiratory sound from upper airway (larynx/trachea) obstruction. Causes: croup, epiglottitis, anaphylaxis, foreign body, post-extubation edema. Indicates critical narrowing." },
  { term:"Crackles / Rales", cat:"Respiratory", def:"Discontinuous, non-musical lung sounds from collapsed or fluid-filled alveoli re-opening on inspiration. Fine crackles: pulmonary edema (CHF). Coarse: secretions, pneumonia." },
  { term:"Diaphoresis", cat:"Assessment", def:"Profuse sweating — autonomic response. Commonly associated with MI, hypoglycemia, shock, sympathomimetic toxidrome, opioid withdrawal, severe pain. Always a significant finding." },
  { term:"Pallor", cat:"Assessment", def:"Abnormal paleness from reduced peripheral perfusion, anemia, or vasovagal response. Check conjunctivae and palms in patients with darker skin tones." },
  { term:"Cyanosis", cat:"Assessment", def:"Bluish-purple discoloration from deoxygenated hemoglobin >5 g/dL. Central (lips, tongue) = significant systemic hypoxia. Peripheral (fingertips only) may be cold-related." },
  { term:"Mottling", cat:"Assessment", def:"Patchy, irregular skin discoloration (blotchy red/white/purple) from inadequate perfusion. Late sign of severe shock. Typically starts at knees and progresses toward trunk." },
  { term:"JVD", cat:"Assessment", def:"Jugular Venous Distension — jugular veins distended >3 cm at 45° head elevation. Indicates elevated right heart filling pressure: tension pneumothorax, cardiac tamponade, right heart failure, RVI." },
  { term:"Tracheal Deviation", cat:"Assessment", def:"Tracheal shift from midline away from affected side. Late sign of tension pneumothorax. Do NOT wait for this sign to treat suspected tension PTX — treat based on clinical presentation." },
  { term:"SAMPLE", cat:"Assessment", def:"EMS history mnemonic: Signs/Symptoms, Allergies, Medications, Pertinent past medical history, Last oral intake (time and what), Events leading to emergency." },
  { term:"OPQRST", cat:"Assessment", def:"Pain assessment mnemonic: Onset (when/how it started), Provocation/Palliation (better or worse with anything), Quality (describe the pain), Region/Radiation, Severity (0–10), Time (duration and changes)." },
  { term:"DCAP-BTLS", cat:"Assessment", def:"Trauma physical exam mnemonic: Deformities, Contusions, Abrasions, Punctures/Penetrations, Burns, Tenderness, Lacerations, Swelling. Applied to each body region during rapid trauma assessment." },
  { term:"Shock", cat:"Assessment", def:"Inadequate tissue perfusion and oxygen delivery. Types: Hypovolemic (blood/fluid loss), Cardiogenic (pump failure), Distributive (septic/anaphylactic/neurogenic), Obstructive (tension PTX, tamponade, massive PE)." },
  { term:"Sepsis", cat:"Assessment", def:"Life-threatening organ dysfunction from dysregulated host response to infection. Signs: fever >38°C or <36°C, HR >90, RR >20, AMS, SBP <90. Early recognition and fluid resuscitation are critical." },
  { term:"Toxidrome", cat:"Pharmacology", def:"Constellation of signs and symptoms characteristic of a specific class of toxin. Five classic EMS toxidromes: opioid, sympathomimetic, anticholinergic, cholinergic, sedative-hypnotic." },
  { term:"Opioid Toxidrome", cat:"Pharmacology", def:"Classic triad: pinpoint miosis, respiratory depression (RR <12), decreased LOC. Skin may be cool and clammy. Bowel sounds decreased. Reversed by naloxone." },
  { term:"Sympathomimetic Toxidrome", cat:"Pharmacology", def:"Tachycardia, hypertension, hyperthermia, mydriasis (dilated pupils), diaphoresis, agitation, psychosis. Caused by cocaine, methamphetamine, amphetamines, synthetic cathinones." },
  { term:"Anticholinergic Toxidrome", cat:"Pharmacology", def:"Mnemonic — dry as a bone (anhidrosis), blind as a bat (mydriasis), red as a beet (flushing), mad as a hatter (AMS/delirium), hot as a hare (hyperthermia), fast as a fiddle (tachycardia). Causes: antihistamines, TCAs, jimsonweed." },
  { term:"Cholinergic Toxidrome (SLUDGE)", cat:"Pharmacology", def:"Salivation, Lacrimation, Urination, Defecation, GI distress, Emesis — plus bradycardia, bronchospasm, bronchorrhea, miosis. From organophosphates, nerve agents. Treat: atropine + pralidoxime." },
  { term:"Half-Life", cat:"Pharmacology", def:"Time for plasma drug concentration to decrease by 50%. Clinical relevance: naloxone half-life (~60 min) is shorter than most opioids — re-narcotization is a real risk requiring monitoring or repeat dosing." },
  { term:"First-Pass Metabolism", cat:"Pharmacology", def:"Drug absorbed from GI tract passes through liver before reaching systemic circulation — significantly reduces bioavailability. Sublingual and rectal routes bypass first-pass. IV = 100% bioavailability." },
  { term:"Tidal Volume", cat:"Respiratory", def:"Volume of air moved per breath. Normal adult: ~500 mL (6–8 mL/kg IBW). BVM target: ~6 mL/kg to avoid overinflation and gastric distension. Avoid over-ventilation — worsens cardiac output in arrest." },
];

function ReferenceScreen({ isDarkMode=true, authUser=null, onUpgrade=null }) {
  const t   = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu  = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su  = isDarkMode ? "#0d1120" : "#ffffff";
  const bd  = isDarkMode ? "#1a2338" : "#d1d5db";
  const inp = isDarkMode ? "#090e1c" : "#f9fafb";

  const [tab, setTab]            = React.useState("pharm");
  const [q, setQ]                = React.useState("");
  const [catFilter, setCatFilter]= React.useState("All");
  const [expanded, setExpanded]  = React.useState(null);

  const isGuest = authUser?.role === "Guest";

  const PHARM_CATS = ["All","Cardiac","Respiratory","Analgesic","Sedation","Antidote","Metabolic","OB"];
  const TERM_CATS  = ["All","Cardiovascular","Respiratory","Neurological","Assessment","Pharmacology","Vitals"];
  const cats = tab === "pharm" ? PHARM_CATS : TERM_CATS;

  const CAT_COLORS = {
    Cardiac:"#f87171", Respiratory:"#86efac", Analgesic:"#fb923c",
    Sedation:"#c084fc", Antidote:"#fde68a", Metabolic:"#38bdf8", OB:"#f9a8d4",
    Cardiovascular:"#f87171", Neurological:"#a78bfa", Assessment:"#60a5fa",
    Pharmacology:"#fb923c", Vitals:"#4ade80",
  };

  const filteredPharm = React.useMemo(() => {
    let list = PHARM_DATA;
    if(catFilter !== "All") list = list.filter(d => d.cat === catFilter);
    if(q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(lq) ||
        (d.aka||"").toLowerCase().includes(lq) ||
        d.cls.toLowerCase().includes(lq) ||
        d.moa.toLowerCase().includes(lq) ||
        d.indications.some(i => i.toLowerCase().includes(lq))
      );
    }
    return list;
  }, [q, catFilter]);

  const filteredTerms = React.useMemo(() => {
    let list = MED_TERMS;
    if(catFilter !== "All") list = list.filter(d => d.cat === catFilter);
    if(q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(d =>
        d.term.toLowerCase().includes(lq) ||
        d.def.toLowerCase().includes(lq) ||
        d.cat.toLowerCase().includes(lq)
      );
    }
    return list;
  }, [q, catFilter]);

  return (
    <div style={{paddingBottom:60}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:14}}>
        📚 Reference Library
      </div>

      {isGuest && (
        <div style={{background:isDarkMode?"#0d1120":"#f0f4ff",border:"1px solid #1e3a8a",borderRadius:12,padding:"22px 18px",marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:8}}>🔒</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,color:"#60a5fa",marginBottom:6,letterSpacing:"0.06em"}}>PAID FEATURE</div>
          <div style={{fontSize:13,color:mu,marginBottom:18,lineHeight:1.6}}>
            The Reference Library — full pharmacology, mechanisms of action, and medical terminology — is included in the AEMT and Paramedic plans.
          </div>
          <button onClick={onUpgrade} style={{padding:"11px 28px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,cursor:"pointer",letterSpacing:"0.06em",boxShadow:"0 4px 12px rgba(14,165,233,.35)"}}>
            View Plans →
          </button>
        </div>
      )}

      {/* Tab Toggle */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:`1px solid ${bd}`,borderRadius:10,padding:3,gap:3,marginBottom:12,opacity:isGuest?0.35:1,pointerEvents:isGuest?"none":"auto"}}>
        {[["pharm","💊 Pharmacology"],["terms","📖 Med Terms"]].map(([k,l])=>(
          <button key={k} onClick={()=>{setTab(k);setCatFilter("All");setExpanded(null);setQ("");}}
            style={{padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:"0.04em",
              background:tab===k?(isDarkMode?"#1a2338":"#d1d5db"):"transparent",
              color:tab===k?t:mu,transition:"all 0.15s"}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{opacity:isGuest?0.35:1,pointerEvents:isGuest?"none":"auto"}}>
        {/* Search */}
        <div style={{position:"relative",marginBottom:10}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none",color:mu}}>🔍</span>
          <input type="text" value={q} onChange={e=>setQ(e.target.value)}
            placeholder={tab==="pharm"?"Search drug, class, indication…":"Search term or definition…"}
            style={{width:"100%",padding:"10px 34px 10px 34px",borderRadius:9,border:`1px solid ${bd}`,background:inp,color:t,fontSize:12,fontFamily:"'DM Sans',sans-serif",outline:"none",boxSizing:"border-box"}}/>
          {q&&<button onClick={()=>setQ("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:mu,cursor:"pointer",fontSize:14,padding:2}}>✕</button>}
        </div>

        {/* Category Filter Chips */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:4,marginBottom:12,scrollbarWidth:"none",WebkitOverflowScrolling:"touch"}}>
          {cats.map(c=>{
            const cc=CAT_COLORS[c]||"#60a5fa";
            const active=catFilter===c;
            return(
              <button key={c} onClick={()=>{setCatFilter(c);setExpanded(null);}}
                style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:`1px solid ${active?cc:bd}`,
                  background:active?(isDarkMode?"#0d1120":"#e2e8f0"):"transparent",
                  color:active?cc:mu,
                  fontFamily:"'IBM Plex Mono',monospace",fontSize:9.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.12s"}}>
                {c}
              </button>
            );
          })}
        </div>

        {/* PHARMACOLOGY CARDS */}
        {tab==="pharm"&&(
          filteredPharm.length===0
          ? <div style={{textAlign:"center",color:mu,fontSize:12,padding:"36px 0",fontFamily:"'IBM Plex Mono',monospace"}}>No results for "{q}"</div>
          : filteredPharm.map(drug=>{
              const key=`ph-${drug.name}`;
              const isOpen=expanded===key;
              const cc=CAT_COLORS[drug.cat]||"#60a5fa";
              return(
                <div key={key} style={{marginBottom:7,borderRadius:11,border:`1px solid ${isOpen?cc:bd}`,overflow:"hidden",transition:"border-color 0.15s"}}>
                  <button onClick={()=>setExpanded(isOpen?null:key)} style={{width:"100%",background:isOpen?drug.bg:su,padding:"13px 14px",display:"flex",alignItems:"center",gap:10,border:"none",cursor:"pointer",textAlign:"left",transition:"background 0.15s"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:isOpen?cc:t,fontFamily:"'DM Sans',sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{drug.name}</div>
                      <div style={{fontSize:9.5,color:mu,fontFamily:"'IBM Plex Mono',monospace",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{drug.aka}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      <span style={{background:isDarkMode?"#0d1120":"#f1f5f9",border:`1px solid ${cc}`,color:cc,borderRadius:5,padding:"2px 7px",fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800}}>{drug.cat}</span>
                      <span style={{color:mu,fontSize:10}}>{isOpen?"▲":"▼"}</span>
                    </div>
                  </button>
                  {isOpen&&(
                    <div style={{padding:"0 14px 16px",background:drug.bg,borderTop:`1px solid ${cc}25`}}>
                      <div style={{background:"#00000025",borderRadius:7,padding:"8px 11px",marginTop:12,marginBottom:14}}>
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Drug Class</div>
                        <div style={{fontSize:12,color:t,fontWeight:600}}>{drug.cls}</div>
                      </div>

                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:cc,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Mechanism of Action</div>
                      <div style={{fontSize:12,color:t,lineHeight:1.65,marginBottom:14}}>{drug.moa}</div>

                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:"#4ade80",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Indications</div>
                      <div style={{marginBottom:14}}>
                        {drug.indications.map((ind,j)=>(
                          <div key={j} style={{fontSize:12,color:t,lineHeight:1.6,paddingLeft:14,position:"relative"}}>
                            <span style={{position:"absolute",left:2,color:"#4ade80",fontSize:10}}>▸</span>{ind}
                          </div>
                        ))}
                      </div>

                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Contraindications</div>
                      <div style={{marginBottom:14}}>
                        {drug.contras.map((c,j)=>(
                          <div key={j} style={{fontSize:12,color:"#fca5a5",lineHeight:1.6,paddingLeft:14,position:"relative"}}>
                            <span style={{position:"absolute",left:2,fontSize:10}}>⚠</span>{c}
                          </div>
                        ))}
                      </div>

                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:"#fdba74",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Side Effects</div>
                      <div style={{fontSize:12,color:mu,lineHeight:1.6,marginBottom:14}}>{drug.se.join(" · ")}</div>

                      <div style={{background:"#ffffff0d",borderRadius:9,padding:"11px 13px",border:`1px solid ${cc}35`}}>
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,fontWeight:800,color:cc,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>⚕ EMS Clinical Notes</div>
                        <div style={{fontSize:12,color:t,lineHeight:1.65}}>{drug.notes}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        )}

        {/* MEDICAL TERMS */}
        {tab==="terms"&&(
          filteredTerms.length===0
          ? <div style={{textAlign:"center",color:mu,fontSize:12,padding:"36px 0",fontFamily:"'IBM Plex Mono',monospace"}}>No results for "{q}"</div>
          : filteredTerms.map(term=>{
              const key=`tr-${term.term}`;
              const isOpen=expanded===key;
              const cc=CAT_COLORS[term.cat]||"#60a5fa";
              return(
                <div key={key} style={{marginBottom:6,borderRadius:10,border:`1px solid ${isOpen?cc:bd}`,overflow:"hidden",transition:"border-color 0.12s"}}>
                  <button onClick={()=>setExpanded(isOpen?null:key)} style={{width:"100%",background:isOpen?(isDarkMode?"#0d1120":"#f0f4ff"):su,padding:"11px 14px",display:"flex",alignItems:"center",gap:10,border:"none",cursor:"pointer",textAlign:"left",transition:"background 0.12s"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:800,color:isOpen?cc:t,fontFamily:"'IBM Plex Mono',monospace",marginBottom:isOpen?0:2}}>{term.term}</div>
                      {!isOpen&&<div style={{fontSize:10,color:mu,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{term.def.slice(0,65)}…</div>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      <span style={{border:`1px solid ${cc}`,color:cc,borderRadius:5,padding:"2px 6px",fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:700,whiteSpace:"nowrap"}}>{term.cat}</span>
                      <span style={{color:mu,fontSize:10}}>{isOpen?"▲":"▼"}</span>
                    </div>
                  </button>
                  {isOpen&&(
                    <div style={{padding:"4px 14px 14px",background:isDarkMode?"#090e1c":"#f8fafc",borderTop:`1px solid ${cc}25`}}>
                      <div style={{fontSize:12.5,color:t,lineHeight:1.7,paddingTop:8}}>{term.def}</div>
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

// Keyword aliases for fuzzy CC matching
const CC_KEYWORDS = {
  "Chest Pain / ACS":["chest pain","chest pressure","chest tightness","chest discomfort","cp","mi","acs","stemi","nstemi","angina","cardiac","heart attack","arm pain","jaw pain","diaphoretic"],
  "Cardiac Arrest":["arrest","cardiac arrest","pulseless","no pulse","cpr","code","down","flatline","unresponsive no pulse"],
  "Symptomatic Bradycardia":["bradycardia","slow heart","slow pulse","low heart rate","bradycardia"],
  "Palpitations / SVT":["palpitations","racing heart","fast heart","tachycardia","svt","flutter","afib","atrial","rapid pulse","heart racing"],
  "Syncope":["syncope","passed out","fainted","fainting","blackout","lost consciousness","syncopal","fall unresponsive"],
  "Shortness of Breath":["shortness of breath","sob","dyspnea","can't breathe","difficulty breathing","labored breathing","respiratory distress","breathing hard","short of breath"],
  "Asthma / Bronchospasm":["asthma","bronchospasm","wheeze","wheezing","inhaler","albuterol","reactive airway"],
  "COPD Exacerbation":["copd","emphysema","chronic bronchitis","copd flare","exacerbation"],
  "Altered Mental Status":["ams","altered","confusion","confused","altered mental","not responding","lethargic","disoriented","unresponsive altered","altered level"],
  "Seizure":["seizure","seizures","convulsion","shaking","postictal","epilepsy","epileptic","status epilepticus"],
  "Stroke / CVA":["stroke","cva","tia","facial droop","slurred speech","one sided weakness","aphasia","paralysis","numbness face","facial weakness","face droop"],
  "Diabetic Emergency / Hypoglycemia":["diabetic","diabetes","hypoglycemia","low blood sugar","low bgl","glucose low","dka","hyperglycemia","hypoglycemic","blood sugar"],
  "Allergic Reaction / Anaphylaxis":["allergic","allergy","anaphylaxis","anaphylactic","hives","rash","swelling","angioedema","bee sting","epipen","allergic reaction"],
  "Opioid Overdose":["opioid overdose","heroin","fentanyl","opioid","narcan","opiate","overdose opioid","drug overdose opioid","opioid od"],
  "Overdose / Poisoning":["overdose","od","ingestion","poisoning","toxic","poison","pills","drug ingestion","substance","suicidal ingestion"],
  "Trauma / Injury":["trauma","injury","injured","accident","mvc","mva","motor vehicle","car accident","gsw","gunshot","stabbing","assault","blunt trauma","penetrating"],
  "Burns":["burn","burns","burned","fire","thermal","chemical burn","scald","scalding","smoke inhalation"],
  "Hemorrhage / Bleeding":["bleeding","hemorrhage","blood loss","laceration","wound","cut","blood","massive hemorrhage","hemorrhagic"],
  "Pain (General)":["pain","painful","hurts","aching","sore","generalized pain"],
  "Abdominal Pain":["abdominal pain","abdominal","abdomen","stomach pain","belly pain","nausea","vomiting","n/v","nauseous","gi bleed","belly"],
  "OB Emergency":["ob","obstetric","pregnancy","pregnant","labor","delivery","crowning","contractions","miscarriage","ectopic","birth","baby"],
  "Behavioral / Psychiatric Emergency":["psychiatric","psych","behavioral","mental health","suicidal","homicidal","agitation","agitated","violent","combative","excited delirium","hallucinations","psychosis"],
  "Fever / Sepsis":["fever","sepsis","septic","infection","febrile","temperature elevated","chills","rigors","hot","hypothermia"],
};

function matchCcInput(text) {
  if(!text.trim()) return null;
  const q = text.toLowerCase();
  let best = null, bestScore = 0;
  for(const [cc, kws] of Object.entries(CC_KEYWORDS)) {
    let score = 0;
    for(const kw of kws) {
      if(q.includes(kw)) score += kw.split(" ").length * 10;
    }
    // Also score against the CC key itself
    const ccLower = cc.toLowerCase();
    for(const word of q.split(/\s+/)) {
      if(word.length > 2 && ccLower.includes(word)) score += 5;
    }
    if(score > bestScore) { bestScore = score; best = cc; }
  }
  return bestScore >= 10 ? best : null;
}

function CallOverviewScreen({ ccList, patient, isDarkMode, onOpenProtocol, onOpenDrugs }) {
  const t   = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu  = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su  = isDarkMode ? "#060a15" : "#f4efe7";
  const bd  = isDarkMode ? "#1a2338" : "#d1d5db";

  const SYS_LABEL = { cardiac:"Cardiac", respiratory:"Respiratory", neuro:"Neuro", metabolic:"Metabolic", anaphylaxis:"Anaphylaxis", trauma:"Trauma", burns:"Burns", assess:"Assessment" };

  const patientLine = [patient.age, patient.sex, patient.cc].filter(Boolean).join(" · ");

  return (
    <div style={{paddingBottom:24}}>

      {/* Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#38bdf8",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Active Call</div>
        <div style={{fontSize:20,fontWeight:800,color:t,marginBottom:6}}>Call Overview</div>
        {patientLine && (
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:mu,background:isDarkMode?"#0d1120":"#e8edf5",border:`1px solid ${bd}`,borderRadius:6,padding:"5px 10px",display:"inline-block"}}>
            {patientLine}
          </div>
        )}
      </div>

      {/* Subheader */}
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>
        {ccList.length} Chief Complaint{ccList.length !== 1 ? "s" : ""} — tap a protocol to open it
      </div>

      {/* CC cards */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {ccList.map((cc, i) => {
          const info  = cc.matched ? CC_DRUG_MAP[cc.matched] : null;
          const color = info?.color || (isDarkMode ? "#4b5563" : "#9ca3af");
          return (
            <div key={i} style={{borderRadius:12,border:`1px solid ${color}44`,borderLeft:`4px solid ${color}`,background:isDarkMode?"#080d1a":"#ffffff",overflow:"hidden"}}>
              {/* Card header */}
              <div style={{padding:"12px 14px 8px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:15,fontWeight:800,color:t}}>{cc.matched || cc.raw}</span>
                  {info ? (
                    <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,padding:"2px 7px",borderRadius:4,background:`${color}20`,color,border:`1px solid ${color}44`,textTransform:"uppercase"}}>
                      {SYS_LABEL[info.sys]||info.sys} System
                    </span>
                  ) : (
                    <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,padding:"2px 7px",borderRadius:4,background:isDarkMode?"#1e293b":"#f1f5f9",color:mu,border:`1px solid ${bd}`,textTransform:"uppercase"}}>
                      Free Text
                    </span>
                  )}
                </div>
                {info && (
                  <>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                      {info.drugs.map(d=>(
                        <span key={d} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,padding:"2px 8px",borderRadius:4,background:`${color}15`,color,border:`1px solid ${color}30`}}>{d}</span>
                      ))}
                    </div>
                    <div style={{fontSize:10,color:mu,lineHeight:1.55}}>{info.hint}</div>
                  </>
                )}
              </div>
              {/* Action buttons */}
              <div style={{display:"grid",gridTemplateColumns:info?"1fr 1fr":"1fr",gap:0,borderTop:`1px solid ${color}22`}}>
                {info && (
                  <button onClick={()=>onOpenProtocol(info.sys)}
                    style={{padding:"11px 8px",border:"none",borderRight:`1px solid ${color}22`,background:"transparent",color,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:"pointer",textAlign:"center",letterSpacing:"0.04em"}}>
                    Open Protocol →
                  </button>
                )}
                <button onClick={onOpenDrugs}
                  style={{padding:"11px 8px",border:"none",background:"transparent",color:mu,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer",textAlign:"center",letterSpacing:"0.04em"}}>
                  View Drugs →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{marginTop:18,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:mu,textAlign:"center",lineHeight:1.6}}>
        Use the nav menu to switch screens at any time.<br/>
        Tap <span style={{color:"#f59e0b",fontWeight:800}}>📋 Overview</span> in the header to return here.
      </div>
    </div>
  );
}

function QuickIntakeModal({ isDarkMode, onStart, onCancel, defaultAgeUnit="yrs" }) {
  const [age, setAge]                   = useState("");
  const [ageUnit, setAgeUnit]           = useState(defaultAgeUnit);
  const [sex, setSex]                   = useState("");
  const [weightLb, setWeightLb]         = useState("");
  const [ccInput, setCcInput]           = useState("");
  const [ccInputMatch, setCcInputMatch] = useState(null);
  const [ccList, setCcList]             = useState([]); // [{raw, matched}]

  const t   = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu  = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su  = isDarkMode ? "#0d1120" : "#ffffff";
  const bd  = isDarkMode ? "#1a2338" : "#d1d5db";
  const inp = isDarkMode ? "#090e1c" : "#f9fafb";

  const ageNum = parseInt(age, 10);
  const isPeds = age !== "" && !isNaN(ageNum) && (ageUnit === "mos" || ageNum < 18);
  const wLb    = parseFloat(weightLb) || 0;
  const wKg    = wLb > 0 ? +(wLb / 2.2046).toFixed(1) : 0;

  const handleCcInputChange = (val) => {
    setCcInput(val);
    setCcInputMatch(matchCcInput(val));
  };

  const addCc = () => {
    const raw = ccInput.trim();
    if (!raw) return;
    const label = (ccInputMatch || raw).toLowerCase();
    if (ccList.some(c => (c.matched || c.raw).toLowerCase() === label)) {
      setCcInput(""); setCcInputMatch(null); return;
    }
    setCcList(p => [...p, { raw, matched: ccInputMatch }]);
    setCcInput(""); setCcInputMatch(null);
  };

  const removeCc = (i) => setCcList(p => p.filter((_,idx) => idx !== i));

  const canStart = ccList.length > 0 || ccInput.trim().length > 0;

  const handleStart = () => {
    if (!canStart) return;
    let finalList = [...ccList];
    if (ccInput.trim()) finalList = [...finalList, { raw: ccInput.trim(), matched: ccInputMatch }];
    const firstMatched = finalList.find(c => c.matched)?.matched || null;
    const ccDisplay = finalList.map(c => c.matched || c.raw).join(" / ");
    onStart({ age: age.trim(), ageUnit, sex, cc: firstMatched || ccDisplay, hpi: ccDisplay, weightLb: wLb, weightKg: wKg, ccList: finalList });
  };

  const SYS_LABEL = { cardiac:"Cardiac", respiratory:"Respiratory", neuro:"Neuro", metabolic:"Metabolic", anaphylaxis:"Anaphylaxis", trauma:"Trauma", burns:"Burns", assess:"Assessment" };
  const inputMatchInfo = ccInputMatch ? CC_DRUG_MAP[ccInputMatch] : null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:9999}}>
      <div style={{width:"100%",maxWidth:480,background:su,borderRadius:"18px 18px 0 0",padding:"22px 18px 36px",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -16px 48px rgba(0,0,0,.55)"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#38bdf8",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>New Patient Encounter</div>
            <div style={{fontSize:19,fontWeight:800,color:t}}>Quick Intake</div>
          </div>
          <button onClick={onCancel} style={{background:"transparent",border:"none",color:mu,fontSize:22,cursor:"pointer",lineHeight:1,padding:"2px 6px"}}>✕</button>
        </div>

        {/* Age + Sex row */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Age</div>
            <div style={{display:"flex",gap:6}}>
              <input type="number" value={age} onChange={e=>setAge(e.target.value)} placeholder="e.g. 6" min={0} max={999}
                style={{flex:1,padding:"10px 10px",borderRadius:9,border:`1px solid ${isPeds?"#38bdf8":bd}`,background:inp,color:t,fontSize:15,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",outline:"none",minWidth:0}}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,flexShrink:0}}>
                {[["yrs","Yrs"],["mos","Mos"]].map(([u,l])=>(
                  <button key={u} onClick={()=>setAgeUnit(u)}
                    style={{padding:"6px 4px",borderRadius:7,border:`1px solid ${ageUnit===u?"#38bdf8":bd}`,background:ageUnit===u?(isDarkMode?"#0c2a3e":"#dbeafe"):"transparent",color:ageUnit===u?"#38bdf8":mu,fontWeight:700,fontSize:10,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",whiteSpace:"nowrap"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Sex</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5}}>
              {[["M","M"],["F","F"],["?","Unk"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSex(p=>p===v?"":v)}
                  style={{padding:"9px 4px",borderRadius:8,border:`1px solid ${sex===v?"#38bdf8":bd}`,background:sex===v?(isDarkMode?"#0c2a3e":"#dbeafe"):"transparent",color:sex===v?"#38bdf8":mu,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Peds weight */}
        {isPeds&&(
          <div style={{background:isDarkMode?"#050e1c":"#eff6ff",border:"1px solid #38bdf8",borderRadius:11,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#38bdf8",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>
              👶 Pediatric Patient — Enter Weight
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1}}>
                <input type="number" value={weightLb} onChange={e=>setWeightLb(e.target.value)}
                  placeholder="Weight in lbs" min={0} max={220} step={0.1}
                  style={{width:"100%",padding:"11px 12px",borderRadius:9,border:`1px solid ${wLb>0?"#4ade80":bd}`,background:inp,color:t,fontSize:16,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",outline:"none"}}/>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:800,color:wKg>0?"#4ade80":mu,lineHeight:1}}>
                  {wKg>0?`${wKg} kg`:"— kg"}
                </div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:mu,marginTop:3}}>auto-converted</div>
              </div>
            </div>
            {wLb===0&&(
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:isDarkMode?"#1d4ed8":"#2563eb",marginTop:7}}>
                Weight required for peds dosing — enter above or estimate via Broselow/Handtevy.
              </div>
            )}
          </div>
        )}

        {/* Chief Complaints — multi-add */}
        <div style={{marginBottom:12}}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:mu,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,display:"flex",alignItems:"center",gap:8}}>
            <span>Chief Complaint(s) <span style={{color:"#ef4444"}}>*</span></span>
            {ccList.length > 0 && (
              <span style={{color:"#4ade80",fontWeight:800}}>{ccList.length} added</span>
            )}
          </div>
          {/* Input + Add */}
          <div style={{display:"flex",gap:8}}>
            <input
              value={ccInput}
              onChange={e=>handleCcInputChange(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); addCc(); } }}
              placeholder="Type complaint and press Enter or tap + Add…"
              autoFocus
              style={{flex:1,padding:"10px 12px",borderRadius:9,border:`1px solid ${inputMatchInfo?inputMatchInfo.color:bd}`,background:inp,color:t,fontSize:13,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",outline:"none",transition:"border-color 0.18s",minWidth:0}}
            />
            <button onClick={addCc} disabled={!ccInput.trim()}
              style={{padding:"10px 14px",borderRadius:9,border:`1px solid ${ccInput.trim()?"#38bdf8":bd}`,background:ccInput.trim()?(isDarkMode?"#0c2a3e":"#dbeafe"):"transparent",color:ccInput.trim()?"#38bdf8":mu,fontWeight:700,fontSize:12,cursor:ccInput.trim()?"pointer":"not-allowed",fontFamily:"'IBM Plex Mono',monospace",whiteSpace:"nowrap",flexShrink:0}}>
              + Add
            </button>
          </div>
          {/* Live match hint */}
          {inputMatchInfo && ccInput.trim() && (
            <div style={{marginTop:6,padding:"6px 10px",borderRadius:7,background:`${inputMatchInfo.color}12`,border:`1px solid ${inputMatchInfo.color}33`,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,color:inputMatchInfo.color,textTransform:"uppercase"}}>Match:</span>
              <span style={{fontSize:11,fontWeight:700,color:t}}>{ccInputMatch}</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,padding:"1px 5px",borderRadius:3,background:`${inputMatchInfo.color}22`,color:inputMatchInfo.color,border:`1px solid ${inputMatchInfo.color}44`,textTransform:"uppercase"}}>{SYS_LABEL[inputMatchInfo.sys]||inputMatchInfo.sys}</span>
            </div>
          )}
          {ccInput.trim().length > 3 && !inputMatchInfo && (
            <div style={{fontSize:10,color:mu,marginTop:5,fontFamily:"'IBM Plex Mono',monospace"}}>
              No protocol match — will add as free-text CC.
            </div>
          )}
        </div>

        {/* Added CC cards */}
        {ccList.length > 0 && (
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {ccList.map((cc,i) => {
              const info  = cc.matched ? CC_DRUG_MAP[cc.matched] : null;
              const color = info?.color || (isDarkMode ? "#4b5563" : "#9ca3af");
              return (
                <div key={i} style={{borderRadius:9,border:`1px solid ${color}33`,borderLeft:`3px solid ${color}`,background:isDarkMode?"#060f1e":"#f8fafc",padding:"10px 12px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:700,color:t,lineHeight:1.2}}>{cc.matched || cc.raw}</span>
                        {info ? (
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,padding:"2px 6px",borderRadius:4,background:`${color}20`,color,border:`1px solid ${color}44`,textTransform:"uppercase",flexShrink:0}}>{SYS_LABEL[info.sys]||info.sys}</span>
                        ) : (
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,padding:"2px 6px",borderRadius:4,background:isDarkMode?"#1e293b":"#f1f5f9",color:mu,border:`1px solid ${bd}`,textTransform:"uppercase",flexShrink:0}}>Free Text</span>
                        )}
                      </div>
                      {info && (
                        <>
                          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:4}}>
                            {info.drugs.slice(0,3).map(d=>(
                              <span key={d} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,padding:"1px 6px",borderRadius:3,background:`${color}15`,color,border:`1px solid ${color}30`}}>{d}</span>
                            ))}
                          </div>
                          <div style={{fontSize:9,color:mu,lineHeight:1.5}}>{info.hint}</div>
                        </>
                      )}
                    </div>
                    <button onClick={()=>removeCc(i)}
                      style={{flexShrink:0,background:"transparent",border:"none",color:mu,fontSize:18,cursor:"pointer",lineHeight:1,padding:"0 2px",marginTop:1}}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button onClick={handleStart} disabled={!canStart}
          style={{width:"100%",height:52,borderRadius:12,border:"none",background:canStart?"linear-gradient(135deg,#0369a1,#0ea5e9)":"#1a2338",color:canStart?"#fff":(isDarkMode?"#374151":"#9ca3af"),fontWeight:800,fontSize:16,cursor:canStart?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif",marginTop:4,letterSpacing:"0.02em",transition:"all 0.18s"}}>
          🚑  Start Call →
        </button>
      </div>
    </div>
  );
}

function ShiftHomeScreen({ authUser, isDarkMode, onNewPatient, onNavigate, callStartTs, patient, tick, totalDoses, onJumpDrug }) {
  const hour      = new Date().getHours();
  const timeEmoji = hour < 6 ? "🌙" : hour < 12 ? "☀️" : hour < 18 ? "🌤" : "🌙";
  const greeting  = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr   = new Date().toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"});

  const t    = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mu   = isDarkMode ? "#8aa0c2" : "#4b5563";
  const su   = isDarkMode ? "#0d1120" : "#fbf7f0";
  const bd   = isDarkMode ? "#1a2338" : "#c8bfb4";
  const card = isDarkMode ? "#080c18" : "#f0e9df";

  const isCallActive = !!callStartTs;
  const certLabel    = authUser?.certLevel || "Provider";
  const hasPatient   = isCallActive && (patient.age || patient.sex || patient.cc);

  const TOOLS = [
    { label:"Drugs",      icon:"💊", s:"drugs",       color:"#60a5fa" },
    { label:"Protocols",  icon:"📋", s:"protocols",   color:"#c084fc" },
    { label:"Assess",     icon:"🩺", s:"assessments", color:"#22d3ee" },
    { label:"Arrest",     icon:"❤", s:"arrest",      color:"#f87171" },
    { label:"Med Log",    icon:"⏱", s:"medlog",      color:"#fb923c" },
    { label:"Narrative",  icon:"✨", s:"epcr",        color:"#a78bfa" },
    { label:"Reference",  icon:"📚", s:"ref",         color:"#38bdf8" },
  ];

  const SPOTLIGHTS = [
    { cc:"Chest Pain / ACS",               icon:"💙", color:"#3b82f6" },
    { cc:"Cardiac Arrest",                  icon:"❤",  color:"#ef4444" },
    { cc:"Shortness of Breath",             icon:"🫁", color:"#22c55e" },
    { cc:"Altered Mental Status",           icon:"🧠", color:"#a855f7" },
    { cc:"Seizure",                         icon:"⚡", color:"#a855f7" },
    { cc:"Allergic Reaction / Anaphylaxis", icon:"⚠️", color:"#ef4444" },
    { cc:"Trauma / Injury",                 icon:"🩹", color:"#f59e0b" },
    { cc:"Opioid Overdose",                 icon:"💊", color:"#e11d48" },
    { cc:"Diabetic Emergency / Hypoglycemia",icon:"🩸",color:"#f97316" },
    { cc:"Stroke / CVA",                    icon:"🧠", color:"#a855f7" },
    { cc:"OB Emergency",                    icon:"👶", color:"#ec4899" },
    { cc:"Fever / Sepsis",                  icon:"🌡", color:"#f97316" },
  ];
  const spot     = SPOTLIGHTS[new Date().getDate() % SPOTLIGHTS.length];
  const spotInfo = CC_DRUG_MAP[spot.cc];

  return (
    <div style={{padding:"20px 0 48px"}}>

      {/* Header — greeting + status inline */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <div style={{fontSize:11,color:mu,fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>{timeEmoji} {dateStr}</div>
          <div style={{fontSize:23,fontWeight:800,color:t,lineHeight:1.15}}>{greeting},<br/>{(()=>{ const n=authUser?.name||""; return (!n||n.startsWith("R.O.M.A.N")) ? "Provider" : n.split(" ")[0]; })()}.</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0,paddingTop:2}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:20,
            background:isCallActive?(isDarkMode?"#071a0e":"#dcfce7"):(isDarkMode?"#080c18":"#f0e9df"),
            border:`1px solid ${isCallActive?"#14532d":bd}`}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:isCallActive?"#4ade80":"#22c55e"}} />
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,
              color:isCallActive?"#4ade80":isDarkMode?"#38bdf8":"#1d4ed8"}}>
              {isCallActive?"ON CALL":"READY"}
            </span>
          </div>
          <div style={{fontSize:10,color:mu,fontFamily:"'IBM Plex Mono',monospace",marginTop:4}}>{certLabel}</div>
          {totalDoses>0&&<div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#fb923c",marginTop:2,fontWeight:700}}>{totalDoses} dose{totalDoses!==1?"s":""} given</div>}
        </div>
      </div>

      {/* Active patient card */}
      {hasPatient&&(
        <div style={{background:isDarkMode?"#071a0e":"#dcfce7",border:"1px solid #14532d",borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:16,animation:"pulse 1.5s ease-in-out infinite",display:"inline-block"}}>🟢</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:"#4ade80"}}>ACTIVE PATIENT</div>
            <div style={{fontSize:13,color:"#86efac",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>
              {patient.cc||"No CC"}{patient.age?` · ${patient.age}yo`:""}{patient.sex?` ${patient.sex}`:""}
            </div>
          </div>
          <button onClick={()=>onNavigate("epcr")} style={{padding:"7px 11px",borderRadius:8,border:"1px solid #14532d",background:"transparent",color:"#4ade80",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>Narrative →</button>
        </div>
      )}

      {/* New Patient CTA */}
      <button onClick={onNewPatient}
        style={{width:"100%",height:62,borderRadius:14,border:"none",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",fontWeight:800,fontSize:17,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginBottom:24,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 6px 20px rgba(14,165,233,.35)",letterSpacing:"0.02em",transition:"all 0.18s"}}>
        <span style={{fontSize:22}}>🚑</span>New Patient
      </button>

      {/* Tools — horizontal scroll row */}
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>Tools</div>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,marginBottom:22,scrollbarWidth:"none",msOverflowStyle:"none"}}>
        {TOOLS.map(({label,icon,s,color})=>(
          <button key={s} onClick={()=>onNavigate(s)}
            style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 10px",borderRadius:14,border:`1px solid ${bd}`,background:su,cursor:"pointer",minWidth:68,transition:"all 0.1s"}}>
            <span style={{fontSize:22,lineHeight:1}}>{icon}</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color,whiteSpace:"nowrap"}}>{label}</span>
          </button>
        ))}
      </div>

      {/* Protocol Spotlight */}
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:mu,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>Protocol Spotlight</div>
      <div style={{background:card,border:`1px solid ${bd}`,borderRadius:14,overflow:"hidden",marginBottom:22,cursor:"pointer"}}
        onClick={()=>onNavigate(spotInfo?`protocols:${spotInfo.sys}`:"protocols")}>
        <div style={{background:`linear-gradient(135deg,${spot.color}22,${spot.color}08)`,borderBottom:`1px solid ${spot.color}33`,padding:"14px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:22}}>{spot.icon}</span>
            <div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:800,color:spot.color,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Today's Focus</div>
              <div style={{fontSize:15,fontWeight:800,color:t}}>{spot.cc}</div>
            </div>
          </div>
        </div>
        {spotInfo&&(
          <div style={{padding:"12px 16px"}}>
            <div style={{fontSize:11,color:mu,lineHeight:1.6,marginBottom:10}}>{spotInfo.hint}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {spotInfo.drugs.slice(0,3).map(d=>(
                <button key={d} onClick={e=>{e.stopPropagation();onJumpDrug&&onJumpDrug(d);}}
                  style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,padding:"3px 8px",borderRadius:5,cursor:"pointer",
                    background:`${spot.color}18`,color:spot.color,border:`1px solid ${spot.color}33`}}>{d}</button>
              ))}
            </div>
          </div>
        )}
      </div>


    </div>
  );
}

function WelcomeScreen({ isDarkMode, authUser, onContinue }) {
  const [agreed, setAgreed] = React.useState(false);
  const bg   = isDarkMode ? "#060a15" : "#f4efe7";
  const text  = isDarkMode ? "#e2e8f0" : "#0f172a";
  const muted = isDarkMode ? "#8aa0c2" : "#374151";
  const card  = isDarkMode ? "#0d1120" : "#ede7dc";
  const cardBorder = isDarkMode ? "#1a2338" : "#c5b9a8";
  const firstName = authUser?.name?.split(" ")[0] || "Provider";

  const features = [
    ["Drug Reference",     "Dosing, contraindications, and warnings for common ALS/BLS medications — filtered to your cert level."],
    ["Live Pre-Check",     "Vital sign screening with automatic block/warn triggers run before each dose is given."],
    ["Medication Log",     "Timestamped administration log auto-captured with every dose given during the call."],
    ["Protocol Companion", "Cardiac, trauma, OB, and pediatric protocol guides with embedded clinical cues."],
    ["AI Narrative",       "Auto-populated PCR narrative generated from your live call data — review, edit, copy, and paste into your agency ePCR."],
  ];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",display:"flex",flexDirection:"column"}}>

          <div style={{width:"100%",height:260,overflow:"hidden",position:"relative",flexShrink:0}}>
            <img src="/login-screen.png" alt="R.O.M.A.N. EMS companion" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"top center",display:"block"}} />
            <div style={{position:"absolute",inset:0,background:`linear-gradient(to bottom, transparent 40%, ${bg} 100%)`}} />
          </div>

          <div style={{flex:1,padding:"4px 20px 32px",display:"flex",flexDirection:"column"}}>
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.4,color:"#14b8a6",marginBottom:8}}>R.O.M.A.N. · EMS Drug Reference</div>
              <h1 style={{fontSize:30,fontWeight:800,lineHeight:1.1,color:text,margin:0}}>Welcome back,<br />{firstName}.</h1>
              <p style={{fontSize:14,lineHeight:1.6,color:muted,marginTop:10}}>
                R.O.M.A.N. is your field-side clinical decision support tool — built for ALS/BLS providers on the call.
              </p>
            </div>

            <div style={{display:"grid",gap:9,marginBottom:20}}>
              {features.map(([title, desc]) => (
                <div key={title} style={{display:"flex",gap:12,alignItems:"flex-start",background:card,border:`1px solid ${cardBorder}`,borderRadius:8,padding:"11px 13px"}}>
                  <span style={{color:"#14b8a6",fontSize:16,flexShrink:0,marginTop:1}}>›</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:text,marginBottom:2}}>{title}</div>
                    <div style={{fontSize:12,color:muted,lineHeight:1.5}}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Terms & Conditions */}
            <div style={{marginBottom:16}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:1.2,color:isDarkMode?"#475569":"#6b7280",marginBottom:8}}>Terms &amp; Conditions</div>
              <div style={{background:isDarkMode?"#080c18":"#f0e9df",border:`1px solid ${cardBorder}`,borderRadius:8,padding:"12px 14px",height:180,overflowY:"auto",marginBottom:12}}>
                <p style={{fontSize:11.5,color:isDarkMode?"#64748b":"#6b7280",lineHeight:1.65,margin:0}}>
                  <strong style={{color:isDarkMode?"#94a3b8":"#374151",display:"block",marginBottom:6}}>1. Clinical Disclaimer</strong>
                  R.O.M.A.N. (Rapid On-Scene Medical AI Navigator) is a clinical reference and decision-support tool intended solely to assist licensed EMS providers. It does not replace the judgment of a qualified medical professional. All clinical decisions must be made in accordance with your agency's standing orders, local protocols, and the direction of your medical director.
                </p>
                <p style={{fontSize:11.5,color:isDarkMode?"#64748b":"#6b7280",lineHeight:1.65,margin:"12px 0 0"}}>
                  <strong style={{color:isDarkMode?"#94a3b8":"#374151",display:"block",marginBottom:6}}>2. Scope of Use</strong>
                  This application is designed for use by certified Emergency Medical Technicians (EMTs), Advanced EMTs (AEMTs), and Paramedics operating within their licensed scope of practice. Unauthorized use by uncertified individuals is strictly prohibited. Drug dosing, contraindication flags, and clinical guidance within this app are based on nationally recognized guidelines (GA SOP-2024, NASEMSO v3, AHA/AAP 2025 PALS) and are subject to change.
                </p>
                <p style={{fontSize:11.5,color:isDarkMode?"#64748b":"#6b7280",lineHeight:1.65,margin:"12px 0 0"}}>
                  <strong style={{color:isDarkMode?"#94a3b8":"#374151",display:"block",marginBottom:6}}>3. No Liability</strong>
                  The developers and maintainers of R.O.M.A.N. assume no liability for clinical outcomes resulting from use or misuse of information provided within this application. Users accept full professional and legal responsibility for all clinical decisions made while using this tool.
                </p>
                <p style={{fontSize:11.5,color:isDarkMode?"#64748b":"#6b7280",lineHeight:1.65,margin:"12px 0 0"}}>
                  <strong style={{color:isDarkMode?"#94a3b8":"#374151",display:"block",marginBottom:6}}>4. Data & Privacy</strong>
                  Patient data entered into R.O.M.A.N. is stored locally on your device and is not transmitted to external servers unless Firebase sync is explicitly enabled. You are responsible for ensuring that any patient information entered complies with applicable HIPAA regulations and your agency's data handling policies.
                </p>
                <p style={{fontSize:11.5,color:isDarkMode?"#64748b":"#6b7280",lineHeight:1.65,margin:"12px 0 0"}}>
                  <strong style={{color:isDarkMode?"#94a3b8":"#374151",display:"block",marginBottom:6}}>5. Updates & Accuracy</strong>
                  Clinical guidelines and drug protocols evolve. R.O.M.A.N. is updated on a best-effort basis but may not immediately reflect the most current evidence-based recommendations. Always verify critical dosing information against your agency's current standing orders before administration.
                </p>
              </div>

              {/* Acknowledgment checkbox */}
              <label style={{display:"flex",alignItems:"flex-start",gap:11,cursor:"pointer",userSelect:"none"}}>
                <div
                  onClick={()=>setAgreed(v=>!v)}
                  style={{
                    width:20,height:20,borderRadius:5,flexShrink:0,marginTop:1,
                    border:`2px solid ${agreed?"#14b8a6":isDarkMode?"#2a3a54":"#9a9286"}`,
                    background:agreed?"#14b8a6":"transparent",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    transition:"all 0.18s",cursor:"pointer",
                  }}
                >
                  {agreed && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#042f2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span style={{fontSize:13,color:muted,lineHeight:1.5}}>
                  I have read and agree to the Terms &amp; Conditions. I understand that R.O.M.A.N. is a reference tool only and does not replace my agency's protocols or medical director guidance.
                </span>
              </label>
            </div>

            <button
              onClick={agreed ? onContinue : undefined}
              style={{
                height:52,borderRadius:10,fontFamily:"'DM Sans',sans-serif",
                border:agreed?"1px solid rgba(125,249,255,.6)":"1px solid transparent",
                background:agreed?"linear-gradient(135deg,#0f766e,#0284c7)":isDarkMode?"#1a2338":"#c5b9a8",
                color:agreed?"#fff":isDarkMode?"#2a3a54":"#8a9286",
                fontWeight:800,fontSize:16,letterSpacing:"0.01em",
                cursor:agreed?"pointer":"not-allowed",
                boxShadow:agreed?"0 12px 30px rgba(20,184,166,.22)":"none",
                transition:"all 0.2s",
              }}
            >
              Enter App
            </button>
          </div>

        </div>
      </main>
    </>
  );
}

function getCertWarnings(user){
  if(!user || ["Guest","Student","PaidGuest"].includes(user.role)) return [];
  const p = user.profile || {};
  const warnings = [];
  const check = (label, expDate) => {
    const d = daysUntil(expDate);
    if(d === null) return;
    if(d < 0)   warnings.push({ label, msg:`EXPIRED ${Math.abs(d)} day${Math.abs(d)!==1?"s":""} ago`, color:"#fca5a5", bg:"#2a0808", bd:"#7f1d1d", urgent:true });
    else if(d <= 30) warnings.push({ label, msg:`Expires in ${d} day${d!==1?"s":""}`, color:"#fdba74", bg:"#1a0c04", bd:"#9a3412", urgent:true });
    else if(d <= 90) warnings.push({ label, msg:`Expires in ${d} days`, color:"#fde68a", bg:"#1a1604", bd:"#92400e", urgent:false });
  };
  check("EMS Cert",  p.certExpDate);
  check("CPR/BLS",   p.cprExpDate);
  check("ACLS",      p.aclsExpDate);
  check("PALS",      p.palsExpDate);
  return warnings;
}

export default function App(){
  const[isDarkMode,setIsDarkMode]=useState(()=>{
    if(typeof window==="undefined") return true;
    const saved=localStorage.getItem("medic-ai-theme");
    if(saved) return saved==="dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const[appView,setAppView]=useState(()=>{
    if(typeof window==="undefined") return "home";
    const paid=getPaidAccess();
    if(paid) return paid.certLevel ? "app" : "purchase24hr";
    const saved=localStorage.getItem("medic-ai-user");
    try { if(saved && JSON.parse(saved)) return "app"; } catch {}
    // Show permission screen on very first launch only
    if(!localStorage.getItem("roman-perms-asked")) return "permissions";
    return "home";
  });
  const[authUser,setAuthUser]=useState(()=>{
    if(typeof window==="undefined") return null;
    const paid=getPaidAccess();
    if(paid) return { name:"R.O.M.A.N. Pass", email:"paid@medic.ai", role:"PaidGuest", certLevel:paid.certLevel||null };
    const saved=localStorage.getItem("medic-ai-user");
    try { return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });
  const[loginForm,setLoginForm]=useState({ email:"", password:"" });
  const[loginError,setLoginError]=useState("");
  const[signupForm,setSignupForm]=useState({ name:"", email:"", password:"", confirmPassword:"" });
  const[signupError,setSignupError]=useState("");
  const[certSetupUser,setCertSetupUser]=useState(null); // temp user pending cert selection
  const[showGuestAck,setShowGuestAck]=useState(false);

  const[mode,setMode]=useState("adult");
  const[aSys,setASys]=useState("cardiac");
  const[pSys,setPSys]=useState("cardiac");
  const[adultWkg,setAdultWkg]=useState(0);
  const[adultWlb,setAdultWlb]=useState(0);
  const[pedsWkg,setPedsWkg]=useState(0);
  const[pedsWlb,setPedsWlb]=useState(0);
  const[search,setSearch]=useState("");
  const[scope,setScope]=useState("all");
  const[adminLog,setAdminLog]=useState({});
  const[initChecks,setInitChecks]=useState({});
  const[reChecks,setReChecks]=useState({});
  const[tick,setTick]=useState(0);
  const[screen,setScreen]=useState("home");
  const[checkoutPlan,setCheckoutPlan]=useState({planKey:null,billing:"monthly"});
  const[navOpen,setNavOpen]=useState(false);
  const[sysDdOpen,setSysDdOpen]=useState(false);
  const[vitalsEntries,setVitalsEntries]=useState([]);
  const[highlightDrug,setHighlightDrug]=useState(null);
  const highlightTimerRef=useRef(null);
  const[arrestState,setArrestState]=useState({
    startTs:null, endTs:null, endReason:null,
    rhythm:null, cycleStartTs:null, lastEpiTs:null,
    events:[], airway:null, hts:{}, access:[],
    patientType:null  // "adult" | "infant" | "child"
  });
  const[burnMaps,setBurnMaps]=useState({ adult:{}, peds:{} });
  const[patient,setPatient]=useState({ age:"", sex:"", cc:"" });
  const[callCcList,setCallCcList]=useState([]);
  const[callStartTs,setCallStartTs]=useState(null);
  const[showQuickIntake,setShowQuickIntake]=useState(false);
  const[protocolInitSys,setProtocolInitSys]=useState("assess");
  const[showTour,setShowTour]=useState(false);
  const[tourStep,setTourStep]=useState(0);
  const[showEndCallModal,setShowEndCallModal]=useState(false);
  const[showNewCallWarning,setShowNewCallWarning]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  const[fontSize,setFontSize]=useState(()=>localStorage.getItem("roman-font-size")||"md");
  const[soundOn,setSoundOn]=useState(()=>localStorage.getItem("roman-sound")!=="0");
  const[vibrationOn,setVibrationOn]=useState(()=>localStorage.getItem("roman-vibrate")!=="0");
  const[notifyOn,setNotifyOn]=useState(()=>localStorage.getItem("roman-notify")==="1");
  const[defaultAgeUnit,setDefaultAgeUnit]=useState(()=>localStorage.getItem("roman-age-unit")||"yrs");
  const[defaultWeightUnit,setDefaultWeightUnit]=useState(()=>localStorage.getItem("roman-wt-unit")||"lbs");

  const CERT_SCOPE_MAP={ EMT:"EMT", AEMT:"AEMT", Paramedic:"Medic" };

  const playSound=useCallback((type="beep")=>{
    if(!soundOn) return;
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      const osc=ctx.createOscillator(); const gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      if(type==="click"){
        osc.type="sine"; osc.frequency.value=800;
        gain.gain.setValueAtTime(0.07,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.08);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.08);
      } else if(type==="alert"){
        osc.type="square"; osc.frequency.value=880;
        gain.gain.setValueAtTime(0.15,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.25);
      } else if(type==="success"){
        osc.type="sine"; osc.frequency.setValueAtTime(600,ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(920,ctx.currentTime+0.15);
        gain.gain.setValueAtTime(0.1,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.2);
      } else if(type==="warn"){
        osc.type="sawtooth"; osc.frequency.value=380;
        gain.gain.setValueAtTime(0.12,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.4);
      } else {
        osc.type="sine"; osc.frequency.value=660;
        gain.gain.setValueAtTime(0.1,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.15);
      }
      setTimeout(()=>ctx.close(),600);
    }catch(e){}
  },[soundOn]);

  const enterApp=useCallback((user)=>{
    setAuthUser(user);
    const noSave=["Guest","Student","PaidGuest"];
    if(!noSave.includes(user.role)) localStorage.setItem("medic-ai-user", JSON.stringify(user));
    if(user.certLevel) setScope(CERT_SCOPE_MAP[user.certLevel] || "all");
    // Ask for notification permission + unlock audio — login button tap is the required user gesture on iOS
    _unlockAudio();
    if('Notification' in window && Notification.permission==='default'){
      Notification.requestPermission();
    }
    setAppView("welcome");
  },[]);

  const handleHomeLogin=useCallback(()=>{
    setLoginError("");
    setAppView("login");
  },[]);

  const handleShowSignup=useCallback(()=>{
    setSignupError("");
    setAppView("signup");
  },[]);


  const handleLoginChange=useCallback((e)=>{
    const { name, value } = e.target;
    setLoginForm(p=>({ ...p, [name]:value }));
    setLoginError("");
  },[]);

  const handleLoginSubmit=useCallback((e)=>{
    e.preventDefault();
    const email=loginForm.email.trim().toLowerCase();
    const password=loginForm.password.trim();
    if(!email || !password){
      setLoginError("Enter an email and password to continue.");
      return;
    }
    const account=getStoredUsers().find(user=>user.email===email);
    if(!account || account.password!==password){
      setLoginError("Email or password is incorrect. Sign up first if you do not have an account.");
      return;
    }
    if(!account.certLevel){
      setCertSetupUser({ name:account.name, email:account.email, role:"Provider" });
      setAppView("profilesetup");
    } else {
      enterApp({ name:account.name, email:account.email, role:"Provider", certLevel:account.certLevel, profile: account.profile || {} });
    }
  },[enterApp,loginForm.email,loginForm.password]);

  const handleSignupChange=useCallback((e)=>{
    const { name, value } = e.target;
    setSignupForm(p=>({ ...p, [name]:value }));
    setSignupError("");
  },[]);

  const handleSignupSubmit=useCallback((e)=>{
    e.preventDefault();
    const name=signupForm.name.trim() || providerNameFromEmail(signupForm.email);
    const email=signupForm.email.trim().toLowerCase();
    const password=signupForm.password.trim();
    const confirmPassword=signupForm.confirmPassword.trim();
    if(!email || !password || !confirmPassword){
      setSignupError("Enter an email, password, and confirmation to sign up.");
      return;
    }
    if(password.length<6){
      setSignupError("Password must be at least 6 characters.");
      return;
    }
    if(password!==confirmPassword){
      setSignupError("Passwords do not match.");
      return;
    }
    const users=getStoredUsers();
    if(users.some(user=>user.email===email)){
      setSignupError("An account already exists for this email. Log in instead.");
      return;
    }
    const nextUser={ name, email, password, certLevel: null };
    saveStoredUsers([...users,nextUser]);
    setSignupForm({ name:"", email:"", password:"", confirmPassword:"" });
    setLoginForm({ email, password:"" });
    setCertSetupUser({ name, email, role:"Provider" });
    setAppView("profilesetup");
  },[enterApp,signupForm.confirmPassword,signupForm.email,signupForm.name,signupForm.password]);

  const handleGuest=useCallback(()=>{
    if(getGuestCount()>=2){
      setAppView("guestBlocked");
      return;
    }
    setShowGuestAck(true);
  },[]);

  const handleGuestAckConfirm=useCallback(()=>{
    setShowGuestAck(false);
    incrementGuestCount();
    enterApp({ name:"Guest Provider", email:"guest@medic.ai", role:"Guest", certLevel:"EMT" });
  },[enterApp]);

  const handleStudentCode=useCallback(()=>setAppView("studentcode"),[]);
  const handle24hr=useCallback(()=>setAppView("purchase24hr"),[]);
  const handleStudentEnter=useCallback((code,certLevel)=>{
    enterApp({ name:"Student Access", email:`student-${code.toLowerCase()}@medic.ai`, role:"Student", certLevel });
  },[enterApp]);
  const handle24hrSuccess=useCallback((certLevel)=>{
    enterApp({ name:"R.O.M.A.N. Pass", email:"paid@medic.ai", role:"PaidGuest", certLevel });
  },[enterApp]);

  const handleLogout=useCallback(()=>{
    if(typeof window!=="undefined") localStorage.removeItem("medic-ai-user");
    setAuthUser(null);
    setLoginForm({ email:"", password:"" });
    setAppView("login");
  },[]);

  useEffect(()=>{
    const theme=isDarkMode?"dark":"light";
    document.documentElement.setAttribute("data-theme",theme);
    localStorage.setItem("medic-ai-theme",theme);
  },[isDarkMode]);

  const findDrugLocation=useCallback((name)=>DRUG_LOCATION_MAP.get(name)||null,[]);

  const handlePillClick=useCallback((name)=>{
    // Prefer the drug card that matches the current mode; fall back to whichever bank has it
    const loc=(mode==="peds"
      ? (DRUG_LOC_PEDS.get(name)||DRUG_LOC_ADULT.get(name))
      : (DRUG_LOC_ADULT.get(name)||DRUG_LOC_PEDS.get(name))
    );
    if(!loc) return;
    setScreen("drugs");
    setMode(loc.mode);
    if(loc.mode==="adult") setASys(loc.sys); else setPSys(loc.sys);
    setSysDdOpen(false);
    clearTimeout(highlightTimerRef.current);
    setHighlightDrug(name);
    highlightTimerRef.current=setTimeout(()=>setHighlightDrug(null), 3000);
  },[mode]);

  useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(id);},[]);
  useEffect(()=>setSearch(""),[mode,aSys,pSys]);


  const wakeLockRef=useRef(null);
  const soundedRef=useRef({});

  // ── Service worker registration ──────────────────────────────────────
  useEffect(()=>{
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
    }
  },[]);

  // ── Wake lock: keep screen on during active arrest ───────────────────
  useEffect(()=>{
    const active=arrestState.startTs&&!arrestState.endTs;
    if(active){
      if('wakeLock' in navigator){
        navigator.wakeLock.request('screen').then(l=>{wakeLockRef.current=l;}).catch(()=>{});
      }
    } else {
      wakeLockRef.current?.release().catch(()=>{});
      wakeLockRef.current=null;
    }
  },[arrestState.startTs,arrestState.endTs]);

  // Re-acquire wake lock when screen wakes back up (OS releases it on sleep)
  useEffect(()=>{
    const handler=()=>{
      if(document.visibilityState==='visible'&&arrestState.startTs&&!arrestState.endTs&&!wakeLockRef.current){
        if('wakeLock' in navigator){
          navigator.wakeLock.request('screen').then(l=>{wakeLockRef.current=l;}).catch(()=>{});
        }
      }
    };
    document.addEventListener('visibilitychange',handler);
    return()=>document.removeEventListener('visibilitychange',handler);
  },[arrestState.startTs,arrestState.endTs]);

  // ── Schedule CPR cycle background notification whenever cycle resets ──
  useEffect(()=>{
    if(!arrestState.cycleStartTs) return;
    swCancel('cpr-cycle');
    swNotify('CPR Cycle Complete','Switch compressor — check rhythm','cpr-cycle',120000,true);
  },[arrestState.cycleStartTs]);

  // ── Schedule epi background notification whenever epi is given ───────
  useEffect(()=>{
    if(!arrestState.lastEpiTs) return;
    swCancel('epi-due');
    swNotify('Epinephrine Due','Reassess rhythm — Epi 1 mg IV/IO if indicated','epi-due',180000,true);
  },[arrestState.lastEpiTs]);

  // ── In-app audio alerts (tick-based, fires sounds when app is visible)
  useEffect(()=>{
    const now=Date.now();
    // CPR cycle sound
    if(arrestState.startTs&&!arrestState.endTs&&arrestState.cycleStartTs){
      const elapsed=now-arrestState.cycleStartTs;
      const key=`cpr-${Math.floor(elapsed/120000)}`;
      if(elapsed>=120000&&!soundedRef.current[key]){soundedRef.current[key]=true;SOUNDS.cprCycle();}
    }
    // Epi due sound
    if(arrestState.startTs&&!arrestState.endTs&&arrestState.lastEpiTs){
      const elapsed=now-arrestState.lastEpiTs;
      const key=`epi-${Math.floor(elapsed/180000)}`;
      if(elapsed>=180000&&!soundedRef.current[key]){soundedRef.current[key]=true;SOUNDS.epiDue();}
    }
    // Drug redose sounds
    Object.entries(adminLog).forEach(([name,log])=>{
      const times=log?.times||[];if(!times.length)return;
      const lastAt=times[times.length-1];
      let redoseMins=null;
      for(const drugs of Object.values(ADULT)){const d=drugs.find(d=>d.name===name);if(d?.redoseMins){redoseMins=d.redoseMins;break;}}
      if(!redoseMins)return;
      const elapsed=now-lastAt;
      const key=`drug-${name}-${times.length}`;
      if(elapsed>=redoseMins*60000&&!soundedRef.current[key]){soundedRef.current[key]=true;SOUNDS.drugDue();}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tick]);


  const ARREST_INIT={startTs:null,endTs:null,endReason:null,rhythm:null,cycleStartTs:null,lastEpiTs:null,events:[],airway:null,hts:{},access:[],patientType:null};

  const handleNewCall=useCallback((intake={})=>{
    SOUNDS.callStart();
    soundedRef.current={};
    // Wipe all data from any previous call
    setAdminLog({});
    setInitChecks({});
    setReChecks({});
    setVitalsEntries([]);
    setArrestState(ARREST_INIT);
    setPatient({age:"",sex:"",cc:""});
    setPedsWkg(0);setPedsWlb(0);setAdultWkg(0);setAdultWlb(0);
    const ts=Date.now();
    setCallStartTs(ts);
    if(intake.age||intake.sex||intake.cc){
      const displayAge=intake.age?(intake.ageUnit==="mos"?`${intake.age} mos`:intake.age):"";
      setPatient(p=>({...p,age:displayAge,sex:intake.sex||"",cc:intake.cc||intake.hpi||""}));
    }
    // Auto-switch drug/protocol mode and pre-estimate peds weight
    if(intake.age!==undefined&&intake.age!==""){
      const ageNum=parseInt(intake.age,10);
      if(!isNaN(ageNum)){
        const isPeds=intake.ageUnit==="mos"||ageNum<18;
        setMode(isPeds?"peds":"adult");
        if(isPeds&&intake.weightKg>0){
          setPedsWkg(intake.weightKg);
          setPedsWlb(intake.weightLb||+(intake.weightKg*2.2046).toFixed(1));
        }
      }
    }
    setShowQuickIntake(false);
    const incomingCcList = intake.ccList || [];
    setCallCcList(incomingCcList);
    if(incomingCcList.length > 1){
      setScreen("call-overview");
    } else if(intake.cc&&CC_DRUG_MAP[intake.cc]){
      setProtocolInitSys(CC_DRUG_MAP[intake.cc].sys);
      setScreen("protocols");
    } else {
      setScreen("drugs");
    }
  },[setMode,setProtocolInitSys,setPedsWkg,setPedsWlb]);

  const handleGive=useCallback((name)=>{
    const ts=Date.now();
    setAdminLog(p=>{const e=p[name]||{times:[]};return{...p,[name]:{times:[...e.times,ts]}};});
    const PRE_CHECK_VITALS=['sbp','dbp','hr','rr','spo2','bgl'];
    const drugChecks=initChecks[name]||{};
    const captured={};
    PRE_CHECK_VITALS.forEach(k=>{if(drugChecks[k]&&drugChecks[k]!=='') captured[k]=drugChecks[k];});
    if(Object.keys(captured).length>0){
      setVitalsEntries(p=>[...p,{...EMPTY_VITALS,...captured,gcsTotal:null,ts,autoCapture:true,drugName:name}]);
    }
    // Schedule background redose notification via service worker
    let redoseMins=null;
    for(const drugs of Object.values(ADULT)){const d=drugs.find(d=>d.name===name);if(d?.redoseMins){redoseMins=d.redoseMins;break;}}
    if(redoseMins){
      swCancel(`drug-bg-${name}`);
      swNotify(`${name} Due`,`Reassess and re-administer if indicated`,`drug-bg-${name}`,redoseMins*60000,false);
    }
  },[initChecks]);

  const handleReset=useCallback(name=>{setAdminLog(p=>{const n={...p};delete n[name];return n;});setInitChecks(p=>{const n={...p};delete n[name];return n;});setReChecks(p=>{const n={...p};delete n[name];return n;});},[]);
  const handleInitUpdate=useCallback((dn,id,v)=>setInitChecks(p=>({...p,[dn]:{...(p[dn]||{}),[id]:v}})),[]);
  const handleReUpdate=useCallback((dn,id,v)=>setReChecks(p=>({...p,[dn]:{...(p[dn]||{}),[id]:v}})),[]);
  const handleClearRe=useCallback(dn=>setReChecks(p=>{const n={...p};delete n[dn];return n;}),[]);

  const systems=mode==="adult"?A_SYS:P_SYS;
  const activeSys=mode==="adult"?aSys:pSys;
  const setSys=mode==="adult"?setASys:setPSys;
  const bank=mode==="adult"?ADULT:PEDS;
  const wkg=mode==="adult"?adultWkg:pedsWkg;
  const wlb=mode==="adult"?adultWlb:pedsWlb;
  const setWkg=mode==="adult"?setAdultWkg:setPedsWkg;
  const setWlb=mode==="adult"?setAdultWlb:setPedsWlb;
  const sysInfo=systems.find(s=>s.k===activeSys)||systems[0];
  const color=isDarkMode?sysInfo.c:sysInfo.lc;
  const activeCount=Object.keys(adminLog).length;

  const colors=useMemo(()=>({
    bg:isDarkMode?"#060a15":"#f4efe7",
    surface:isDarkMode?"var(--c-surface)":"#eee7dd",
    surfaceAlt:isDarkMode?"var(--c-nav)":"#e7edf3",
    border:isDarkMode?"var(--c-border)":"#8f9aad",
    text:isDarkMode?"var(--c-text)":"#111827",
    textSecondary:isDarkMode?"var(--c-text4)":"#374151",
    textTertiary:isDarkMode?"var(--c-text-ghost)":"#4b5563",
  }),[isDarkMode]);

  const CERT_SCOPE_MAP_DRUG={EMT:"EMT",AEMT:"AEMT",Paramedic:"Medic"};
  const certScopeKey=authUser?.certLevel ? CERT_SCOPE_MAP_DRUG[authUser.certLevel] : null;

  const list=useMemo(()=>{
    const raw=bank[activeSys]||[];
    const q=search.trim().toLowerCase();
    const scopeRank={EMT:1,AEMT:2,Medic:3};
    const certRank=certScopeKey ? scopeRank[certScopeKey] : 3;
    return raw.filter(d=>{
      const dRank=scopeRank[d.scope]||1;
      const selRank=scope==="all" ? certRank : Math.min(scopeRank[scope]||3, certRank);
      const scopeOk=dRank<=selRank;
      return (!q||d.name.toLowerCase().includes(q)||(d.sub||"").toLowerCase().includes(q))&&scopeOk;
    });
  },[bank,activeSys,search,scope,certScopeKey]);

  const numInp=useCallback((v,fn,ph,max,step)=>({type:"number",value:v||"",onChange:e=>fn(Math.max(0,parseFloat(e.target.value)||0)),placeholder:ph,min:0,max,step,style:{width:58,padding:"5px 7px",background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:6,color:colors.text,fontSize:13,fontFamily:"'IBM Plex Mono',monospace",textAlign:"right",outline:"none"}}),[colors]);
  const activeDrugs=useMemo(()=>Object.entries(adminLog).map(([name,log])=>({name,count:log.times.length,lastAt:log.times[log.times.length-1]})),[adminLog]);
  const totalDoses=useMemo(()=>activeDrugs.reduce((sum,d)=>sum+d.count,0),[activeDrugs]);

  const guestSessionNum = useMemo(()=> showGuestAck ? getGuestCount() + 1 : 0, [showGuestAck]);

  if(appView==="guestBlocked"){
    return <GuestBlockedScreen isDarkMode={isDarkMode} onLogin={handleHomeLogin} onSignup={handleShowSignup} onStudentCode={handleStudentCode} on24hr={handle24hr} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  const guestAckModal = showGuestAck && (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:"16px",backdropFilter:"blur(4px)"}}>
      <div style={{width:"100%",maxWidth:440,background:"#060f1e",border:"1px solid #1e3a5f",borderRadius:14,padding:"28px 24px",display:"grid",gap:20,boxShadow:"0 32px 80px rgba(0,0,0,.6)"}}>

        <div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.4,color:"#14b8a6",marginBottom:10}}>Guest Access — Demo Mode</div>
          <h2 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",margin:"0 0 4px",lineHeight:1.2}}>Temporary Access Acknowledgment</h2>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#475569",marginTop:6}}>Session {guestSessionNum} of 2</div>
        </div>

        <div style={{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:8,padding:"16px 18px",display:"grid",gap:12}}>
          <p style={{fontSize:13.5,color:"#94a3b8",lineHeight:1.65,margin:0}}>
            You are accessing <strong style={{color:"#e2e8f0"}}>R.O.M.A.N.</strong> as a guest in <strong style={{color:"#e2e8f0"}}>Demo Mode</strong>. This provides temporary, limited access to the application's core features for evaluation purposes only.
          </p>
          <div style={{borderTop:"1px solid #1e3a5f",paddingTop:12,display:"grid",gap:8}}>
            {[
              ["2-Patient Limit","Guest access is capped at 2 patient sessions total. You are currently using session "+guestSessionNum+" of 2."],
              ["EMT-Scope Only","Drugs, protocols, and clinical tools are limited to EMT-level scope. AEMT and Paramedic content is locked. Create a free account and set your cert level to unlock your full scope."],
              ["No Data Persistence","Medication logs, vitals, and ePCR records entered during a guest session are not saved and will be lost when you exit."],
              ["Full Access Lockout","Once both guest sessions are exhausted, all features will be inaccessible until a free account is created."],
            ].map(([title,body])=>(
              <div key={title} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{color:"#14b8a6",fontSize:14,marginTop:1,flexShrink:0}}>›</span>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#cbd5e1",marginBottom:2}}>{title}</div>
                  <div style={{fontSize:12,color:"#64748b",lineHeight:1.55}}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p style={{fontSize:12,color:"#475569",lineHeight:1.6,margin:0,textAlign:"center"}}>
          By continuing, you acknowledge and accept these access limitations. To unlock unlimited access and full documentation features, create a free R.O.M.A.N. account at any time.
        </p>

        <div style={{display:"grid",gap:10}}>
          <button onClick={handleGuestAckConfirm} style={{height:50,borderRadius:9,border:"1px solid rgba(125,249,255,.5)",background:"linear-gradient(135deg,#0f766e,#0284c7)",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.01em"}}>
            I Acknowledge — Continue as Guest
          </button>
          <button onClick={()=>setShowGuestAck(false)} style={{height:44,borderRadius:9,border:"1px solid #1e3a5f",background:"transparent",color:"#64748b",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Cancel
          </button>
        </div>

      </div>
    </div>
  );

  if(appView==="permissions"){
    return <PermissionScreen isDarkMode={isDarkMode} onDone={()=>{ localStorage.setItem("roman-perms-asked","1"); setAppView("home"); }} />;
  }

  if(appView==="home"){
    return <>{guestAckModal}<HomeScreen isDarkMode={isDarkMode} onLogin={handleHomeLogin} onSignup={handleShowSignup} onGuest={handleGuest} onStudentCode={handleStudentCode} on24hr={handle24hr} onToggleTheme={()=>setIsDarkMode(v=>!v)} /></>;
  }

  if(appView==="login"){
    return <>{guestAckModal}<LoginScreen isDarkMode={isDarkMode} values={loginForm} onChange={handleLoginChange} onSubmit={handleLoginSubmit} onBack={()=>setAppView("home")} onSignup={handleShowSignup} onGuest={handleGuest} onStudentCode={handleStudentCode} on24hr={handle24hr} error={loginError} onToggleTheme={()=>setIsDarkMode(v=>!v)} /></>;
  }

  if(appView==="studentcode"){
    return <StudentCodeScreen isDarkMode={isDarkMode} onBack={()=>setAppView("home")} onEnter={handleStudentEnter} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  if(appView==="purchase24hr"){
    return <Purchase24hrScreen isDarkMode={isDarkMode} onBack={()=>setAppView("home")} onSuccess={handle24hrSuccess} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  if(appView==="signup"){
    return <SignupScreen isDarkMode={isDarkMode} values={signupForm} onChange={handleSignupChange} onSubmit={handleSignupSubmit} onBack={()=>setAppView("home")} onLogin={handleHomeLogin} error={signupError} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  if(appView==="welcome"){
    return <WelcomeScreen isDarkMode={isDarkMode} authUser={authUser} onContinue={()=>{logTCAcceptance(authUser);setScreen("home");setAppView("app");if(!localStorage.getItem("roman-tour-done")){setTimeout(()=>{setTourStep(0);setShowTour(true);},400);}}} />;
  }

  if(appView==="profilesetup"){
    const handleProfileSave=(certLevel, profile)=>{
      if(!certSetupUser) return;
      const users=getStoredUsers();
      const updated=users.map(u=>u.email===certSetupUser.email ? { ...u, certLevel, profile } : u);
      saveStoredUsers(updated);
      setCertSetupUser(null);
      enterApp({ ...certSetupUser, certLevel, profile });
    };
    return <ProfileSetupScreen isDarkMode={isDarkMode} providerName={certSetupUser?.name||""} onSave={handleProfileSave} onSkip={()=>{ setCertSetupUser(null); enterApp({ ...certSetupUser }); }} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  return(
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}input[type=number]{-moz-appearance:textfield}::-webkit-scrollbar{width:0;height:0}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}@keyframes flash{0%,100%{background:#2a0808}50%{background:#7f1d1d}}:root{--c-surface:#0d1120;--c-surface-open:#141c2e;--c-nav:#0a0f1c;--c-input:#090e1c;--c-deep:#080c18;--c-deep2:#0d1525;--c-border:#1a2338;--c-border-sub:#141e30;--c-text-sub:#8a9dc0;--c-text:#e2e8f0;--c-text2:#c0cfe8;--c-text3:#a0b4d0;--c-text4:#6b82a8;--c-text5:#7a90b0;--c-text-ghost:#1a2638}[data-theme="light"]{--c-surface:#e6edf4;--c-surface-open:#d8e2ec;--c-nav:#dce4ec;--c-input:#eef3f7;--c-deep:#dce6ef;--c-deep2:#e7eef5;--c-border:#8796aa;--c-border-sub:#98a8bb;--c-text-sub:#26364c;--c-text:#0f172a;--c-text2:#172033;--c-text3:#25354d;--c-text4:#36455c;--c-text5:#1f2f46;--c-text-ghost:#53637a}`}</style>

      <div style={{minHeight:"100vh",background:isDarkMode?"#060a15":"#f4efe7",fontFamily:"'DM Sans',sans-serif",maxWidth:480,margin:"0 auto",padding:"14px 11px 60px",transition:"background-color 0.3s",zoom:{sm:0.9,md:1,lg:1.15,xl:1.3}[fontSize]||1}}>

        {/* HEADER */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:19,fontWeight:700,color:isDarkMode?"var(--c-text)":"#0f0f0f",letterSpacing:"-0.02em"}}>R.O.M.A.N.</span>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",background:isDarkMode?"#0d1d3a":"#d5bee2",color:isDarkMode?"#60a5fa":"#4c1d95",border:isDarkMode?"1px solid #1a3060":"1px solid #8b5fb0",borderRadius:4,padding:"2px 7px"}}>Drug Calc</span>
            </div>
            <div style={{color:isDarkMode?"var(--c-text-ghost)":"#374151",fontSize:9,marginTop:2,letterSpacing:"0.03em",fontFamily:"'IBM Plex Mono',monospace"}}>GA SOP-2024 · NASEMSO v3 · AHA/AAP 2025 PALS</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
            <button
              onClick={()=>setShowSettings(true)}
              style={{width:36,height:36,borderRadius:8,border:isDarkMode?"1px solid var(--c-border)":"1px solid #9a9286",background:isDarkMode?"var(--c-surface)":"#eee7dd",color:isDarkMode?"#94a3b8":"#374151",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.3s"}}
              title="Settings"
            >⚙️</button>
            {(()=>{
              const NAV=[
                ["home","🏠 Home",isDarkMode?"#0a1628":"#e2e8f0",isDarkMode?"#e2e8f0":"#0f172a"],
                ["drugs","💊 Drugs",isDarkMode?"#0d1f3a":"#9fbce2",isDarkMode?"#93c5fd":"#172554"],
                ["protocols","Protocols",isDarkMode?"#1a0e28":"#c7a4e6",isDarkMode?"#c084fc":"#4c1d95"],
                ["arrest","❤ Arrest",isDarkMode?"#2a0808":"#e5a2a2",isDarkMode?"#fca5a5":"#7f1d1d"],
                ["medlog","⏱ Log",isDarkMode?"#1a0a18":"#e4b07e",isDarkMode?"#fb923c":"#7c2d12"],
                ["epcr","✨ Narrative",isDarkMode?"#1a0e28":"#c7a4e6",isDarkMode?"#c084fc":"#4c1d95"],
                ["profile","👤 Profile",isDarkMode?"#0a1a28":"#c4d4e0",isDarkMode?"#7dd3fc":"#075985"],
                ["assessments","🩺 Assess",isDarkMode?"#071a1a":"#cff9fd",isDarkMode?"#22d3ee":"#0e7490"],
                ["ref","📚 Reference",isDarkMode?"#0a1628":"#dbeafe",isDarkMode?"#38bdf8":"#075985"],
                ["__logout","⬅ Sign Out",isDarkMode?"var(--c-surface)":"#eee7dd",isDarkMode?"#8aa0c2":"#374151"],
              ];
              const cur=NAV.find(([s])=>s===screen)||NAV[0];
              const [,curL,curBg,curFg]=cur;
              const isArrestActive=arrestState.startTs&&!arrestState.endTs;
              return(
                <div style={{position:"relative"}}>
                  {navOpen&&<div onClick={()=>setNavOpen(false)} style={{position:"fixed",inset:0,zIndex:98}}/>}
                  <button
                    onClick={()=>setNavOpen(v=>!v)}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,border:`1px solid var(--c-border-sub)`,background:curBg,color:curFg,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"}}
                  >
                    <span style={{display:"flex",alignItems:"center",gap:5}}>
                      {curL}
                      {isArrestActive&&screen!=="arrest"&&<span style={{width:6,height:6,borderRadius:"50%",background:"#ef4444",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>}
                    </span>
                    <span style={{fontSize:9,opacity:0.6}}>{navOpen?"▲":"▼"}</span>
                  </button>
                  {navOpen&&(
                    <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,left:"auto",zIndex:99,background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:4,display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",minWidth:210}}>
                      {NAV.map(([s,l,bg,fg])=>{
                        let cnt=0;
                        if(s==="medlog") cnt=totalDoses;
                        else if(s==="arrest"&&arrestState.startTs) cnt=arrestState.events.length;
                        const active=screen===s;
                        const arrAct=s==="arrest"&&isArrestActive;
                        return(
                          <button key={s} onClick={()=>{
                            if(s==="__logout"){handleLogout();}
                            else if(s==="__tour"){setTourStep(0);setShowTour(true);}
                            else if(s==="assessments"){setProtocolInitSys("assess");setScreen("protocols");}
                            else{setScreen(s);}
                            setNavOpen(false);
                          }} style={{padding:"10px 6px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:10.5,fontWeight:700,letterSpacing:"0.02em",background:active?bg:arrAct?"#2a0808":"transparent",color:active?fg:arrAct?"#fca5a5":"var(--c-text4)",transition:"all 0.12s",position:"relative",textAlign:"center"}}>
                            {l}{cnt>0?` (${cnt})`:""}
                            {arrAct&&!active&&<span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:"#ef4444",animation:"pulse 1.5s ease-in-out infinite"}}/>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {callCcList.length > 1 && callStartTs && (
              <button onClick={()=>setScreen("call-overview")}
                style={{padding:"5px 10px",borderRadius:7,border:"1px solid #d97706",background:isDarkMode?"#1a0c04":"#fffbeb",color:"#f59e0b",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,cursor:"pointer",letterSpacing:"0.05em",textTransform:"uppercase",whiteSpace:"nowrap"}}>
                📋 Overview
              </button>
            )}
            <div style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>
              {authUser&&<div style={{color:isDarkMode?"#14b8a6":"#0f766e",fontSize:10,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{authUser.name}</div>}
              {authUser&&(()=>{
                if(authUser.role==="Student")   return <div style={{display:"inline-block",marginTop:2,background:"#100a1f",border:"1px solid #7c3aed",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:800,color:"#d8b4fe",letterSpacing:"0.06em"}}>🎓 STUDENT</div>;
                if(authUser.role==="PaidGuest") return <div style={{display:"inline-block",marginTop:2,background:"#120d00",border:"1px solid #d97706",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:800,color:"#fde68a",letterSpacing:"0.06em"}}>⚡ 24HR PASS</div>;
                if(authUser.role==="Guest")     return <div style={{display:"inline-block",marginTop:2,background:"#111827",border:"1px solid #374151",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:800,color:"#6b7280",letterSpacing:"0.06em"}}>GUEST · EMT-SCOPE</div>;
                if(!authUser.certLevel) return null;
                const CERT_COLORS={EMT:{bg:"#071a0e",fg:"#86efac",bd:"#14532d"},AEMT:{bg:"#060f1e",fg:"#93c5fd",bd:"#1e3a8a"},Paramedic:{bg:"#1a0c04",fg:"#fdba74",bd:"#9a3412"}};
                const cc=CERT_COLORS[authUser.certLevel]||CERT_COLORS.EMT;
                return <div style={{display:"inline-block",marginTop:2,background:cc.bg,border:`1px solid ${cc.bd}`,borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:800,color:cc.fg,letterSpacing:"0.06em"}}>{authUser.certLevel==="Paramedic"?"MEDIC":authUser.certLevel}</div>;
              })()}
              <div style={{color:isDarkMode?"var(--c-text-ghost)":"#374151",fontSize:10}}>{list.length} drugs</div>
              {wkg>0&&<div style={{color:"#4ade80",fontSize:11,marginTop:1}}>{wkg} kg</div>}
              {activeCount>0&&<div style={{color:"#f97316",fontSize:10,marginTop:1}}>⏱ {activeCount} active</div>}
            </div>
          </div>
        </div>

        {/* MULTI-CC RETURN BANNER */}
        {callCcList.length > 1 && callStartTs && screen !== "call-overview" && (
          <button onClick={()=>setScreen("call-overview")}
            style={{width:"100%",marginBottom:10,padding:"9px 14px",borderRadius:9,border:"1px solid #d97706",background:isDarkMode?"#1a0c04":"#fffbeb",color:"#f59e0b",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:8,letterSpacing:"0.04em"}}>
            <span style={{fontSize:14}}>📋</span>
            <span style={{flex:1}}>Return to Call Overview</span>
            <span style={{opacity:0.7}}>{callCcList.length} CCs ←</span>
          </button>
        )}

        {/* CERT EXPIRATION WARNINGS */}
        {(()=>{
          const warnings = getCertWarnings(authUser);
          if(!warnings.length) return null;
          return(
            <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:10 }}>
              {warnings.map((w,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 11px", background:w.bg, border:`1px solid ${w.bd}`, borderRadius:7 }}>
                  <span style={{ fontSize:13 }}>{w.urgent ? "⚠️" : "🔔"}</span>
                  <div style={{ flex:1 }}>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:800, color:w.color }}>{w.label}: </span>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:w.color }}>{w.msg}</span>
                  </div>
                  <button onClick={()=>setScreen("profile")} style={{ background:"transparent", border:`1px solid ${w.bd}`, borderRadius:5, color:w.color, fontSize:9, fontWeight:700, cursor:"pointer", padding:"2px 7px", fontFamily:"'IBM Plex Mono',monospace", whiteSpace:"nowrap" }}>
                    Renew →
                  </button>
                </div>
              ))}
            </div>
          );
        })()}


        {/* HOME SCREEN */}
        {screen==="home"&&(
          <ShiftHomeScreen
            authUser={authUser}
            isDarkMode={isDarkMode}
            onNewPatient={()=>{ if(callStartTs) setShowNewCallWarning(true); else setShowQuickIntake(true); }}
            onNavigate={s=>{
              if(s==="assessments"){setProtocolInitSys("assess");setScreen("protocols");}
              else if(s.startsWith("protocols:")){setProtocolInitSys(s.split(":")[1]);setScreen("protocols");}
              else if(s==="__tour"){setTourStep(0);setShowTour(true);}
              else setScreen(s);
            }}
            callStartTs={callStartTs}
            patient={patient}
            tick={tick}
            totalDoses={totalDoses}
            onJumpDrug={handlePillClick}
          />
        )}

        {/* QUICK INTAKE MODAL */}
        {showQuickIntake&&(
          <QuickIntakeModal
            isDarkMode={isDarkMode}
            onStart={intake=>handleNewCall(intake)}
            onCancel={()=>setShowQuickIntake(false)}
            defaultAgeUnit={defaultAgeUnit}
          />
        )}

        {/* NEW CALL WARNING — active call already in progress */}
        {showNewCallWarning&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:9999}}>
            <div style={{width:"100%",maxWidth:480,background:isDarkMode?"#0d1120":"#ffffff",borderRadius:"18px 18px 0 0",padding:"26px 20px 40px",boxShadow:"0 -16px 48px rgba(0,0,0,.6)"}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#f97316",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Call In Progress</div>
              <div style={{fontSize:19,fontWeight:800,color:isDarkMode?"#e2e8f0":"#0f172a",marginBottom:10}}>Start a new patient?</div>
              <div style={{fontSize:13,color:isDarkMode?"#8aa0c2":"#4b5563",lineHeight:1.6,marginBottom:20}}>
                A call is already active. Starting a new intake will <strong style={{color:"#ef4444"}}>clear all current call data</strong> — medications, vitals, and the active patient — with no way to recover it.<br/><br/>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#f97316",fontWeight:700}}>⚠ End the current call and build your narrative first if you need that data.</span>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowNewCallWarning(false)}
                  style={{flex:1,height:48,borderRadius:11,border:`1px solid ${isDarkMode?"#1a2338":"#d1d5db"}`,background:"transparent",color:isDarkMode?"#8aa0c2":"#4b5563",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                  Cancel
                </button>
                <button onClick={()=>{setShowNewCallWarning(false);setShowQuickIntake(true);}}
                  style={{flex:2,height:48,borderRadius:11,border:"none",background:"linear-gradient(135deg,#c2410c,#f97316)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:800,cursor:"pointer"}}>
                  Replace & Start New
                </button>
              </div>
            </div>
          </div>
        )}

        {/* END CALL MODAL */}
        {showEndCallModal&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:9999}}>
            <div style={{width:"100%",maxWidth:480,background:isDarkMode?"#0d1120":"#ffffff",borderRadius:"18px 18px 0 0",padding:"26px 20px 40px",boxShadow:"0 -16px 48px rgba(0,0,0,.6)"}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:"#ef4444",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>End Call</div>
              <div style={{fontSize:19,fontWeight:800,color:isDarkMode?"#e2e8f0":"#0f172a",marginBottom:10}}>Ready to close this call?</div>
              <div style={{fontSize:13,color:isDarkMode?"#8aa0c2":"#4b5563",lineHeight:1.6,marginBottom:20}}>
                You'll be taken to the <strong style={{color:isDarkMode?"#a78bfa":"#6d28d9"}}>AI Narrative builder</strong> to generate your PCR narrative. Review and copy it into your agency ePCR before clearing.<br /><br />
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#ef4444",fontWeight:700}}>⚠ This app does not submit your ePCR. Always document in your agency system.</span>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowEndCallModal(false)}
                  style={{flex:1,height:48,borderRadius:11,border:`1px solid ${isDarkMode?"#1a2338":"#d1d5db"}`,background:"transparent",color:isDarkMode?"#8aa0c2":"#4b5563",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                  Cancel
                </button>
                <button onClick={()=>{
                  setShowEndCallModal(false);
                  setCallStartTs(null);
                  setCallCcList([]);
                  setArrestState({startTs:null,endTs:null,endReason:null,rhythm:null,cycleStartTs:null,lastEpiTs:null,events:[],airway:null,hts:{},access:[],patientType:null});
                  setScreen("epcr");
                }}
                  style={{flex:2,height:48,borderRadius:11,border:"none",background:"linear-gradient(135deg,#6d28d9,#a78bfa)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:800,cursor:"pointer",letterSpacing:"0.02em"}}>
                  ✨ Build Narrative
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CALL STATUS BANNER — hidden on home and profile screens */}
        {screen!=="home"&&screen!=="profile"&&(()=>{
          // ── ACTIVE: call in progress ───────────────────────────────────
          if(callStartTs){
            const elapsed=Date.now()-callStartTs;
            const eh=Math.floor(elapsed/3600000);
            const em=Math.floor((elapsed%3600000)/60000);
            const es=Math.floor((elapsed%60000)/1000);
            const fmtE=eh>0?`${eh}h ${em}m`:`${em}m ${es}s`;
            return(
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 11px",marginBottom:8,background:"#071a0e",border:"1px solid #14532d",borderRadius:7}}>
                <span style={{fontSize:13,animation:"pulse 1.5s ease-in-out infinite",display:"inline-block"}}>🟢</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:"#4ade80"}}>Call Active · {fmtE}</div>
                  <div style={{fontSize:9,color:"#166534",fontFamily:"'IBM Plex Mono',monospace",marginTop:1}}>{patient.cc||"No CC"}</div>
                </div>
                <button onClick={()=>setShowEndCallModal(true)} style={{flexShrink:0,height:28,padding:"0 10px",borderRadius:6,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
                  End Call
                </button>
              </div>
            );
          }
          // ── IDLE: no banner on clinical screens ───────────────────────
          return null;
        })()}

        {/* ACTIVE SUMMARY */}
        {activeDrugs.length>0&&(
          <div style={{background:isDarkMode?"#120e05":"#f1d8cf",border:isDarkMode?"1px solid #f9731630":"1px solid #c2410c",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <span style={{color:"#f97316",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>⏱ Active Drugs This Call</span>
              <button onClick={()=>{setAdminLog({});setInitChecks({});setReChecks({});setVitalsEntries([]);}} style={{marginLeft:"auto",background:"transparent",border:isDarkMode?"1px solid #7a5a30":"1px solid #d97706",color:isDarkMode?"#c08040":"#b45309",borderRadius:4,padding:"2px 7px",fontSize:9,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>Clear All</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {activeDrugs.map(d=>{const el=Math.floor((Date.now()-d.lastAt)/1000);return(
                <div key={d.name} onClick={()=>handlePillClick(d.name)} style={{background:isDarkMode?"#1a1208":"#e9c8bb",border:isDarkMode?"1px solid #f9731640":"1px solid #c2410c",borderRadius:5,padding:"3px 8px",display:"flex",alignItems:"center",gap:5,cursor:"pointer",transition:"border-color 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=isDarkMode?"#f97316":"#f97316"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=isDarkMode?"#f9731640":"#c2410c"}>
                  <span style={{color:isDarkMode?"var(--c-text)":"#0f0f0f",fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>{d.name}</span>
                  <span style={{color:"#f97316",fontSize:9,fontFamily:"'IBM Plex Mono',monospace"}}>×{d.count}</span>
                  <span style={{color:isDarkMode?"#a07040":"#b45309",fontSize:9}}>{fmtE(el)}</span>
                  <span style={{color:isDarkMode?"#f9731680":"#f97316",fontSize:9}}>↗</span>
                </div>
              );})}
            </div>
          </div>
        )}

        {/* CALL OVERVIEW SCREEN — multi-CC triage hub */}
        {screen==="call-overview"&&(
          <CallOverviewScreen
            ccList={callCcList}
            patient={patient}
            isDarkMode={isDarkMode}
            onOpenProtocol={(sys)=>{ setProtocolInitSys(sys); setScreen("protocols"); }}
            onOpenDrugs={()=>setScreen("drugs")}
          />
        )}

        {/* PROTOCOLS SCREEN */}
        {screen==="protocols"&&(
          <ProtocolsScreen mode={mode} setMode={setMode} isDarkMode={isDarkMode} burnMaps={burnMaps} setBurnMaps={setBurnMaps} onJumpDrug={handlePillClick} findDrugLocation={findDrugLocation} wkg={wkg} wlb={wlb} setWkg={setWkg} setWlb={setWlb} authUser={authUser} initialSystem={protocolInitSys}/>
        )}

        {/* ARREST SCREEN + VITALS */}
        {screen==="arrest"&&(
          <>
            <ArrestTracker arrestState={arrestState} setArrestState={setArrestState} tick={tick} onLogMed={handleGive} wkg={wkg} setWkg={setWkg} setWlb={setWlb} mode={mode} isDarkMode={isDarkMode} patient={patient}/>
            <VitalsLog initChecks={initChecks} reChecks={reChecks} entries={vitalsEntries} setEntries={setVitalsEntries} onClearCall={()=>{
              setAdminLog({});setInitChecks({});setReChecks({});setVitalsEntries([]);
              setPatient({age:"",sex:"",cc:""});
              setCallCcList([]);
              setCallStartTs(null);
            }}/>
          </>
        )}

        {/* MED LOG SCREEN */}
        {screen==="medlog"&&(
          <MedLog adminLog={adminLog} findDrugLocation={findDrugLocation} onJump={handlePillClick} onClearAll={()=>{setAdminLog({});setInitChecks({});setReChecks({});}} onResetDrug={handleReset} wkg={wkg}/>
        )}

        {/* NARRATIVE SCREEN */}
        {screen==="epcr"&&(
          <NarrativeScreen patient={patient} setPatient={setPatient} adminLog={adminLog} vitalsEntries={vitalsEntries} wkg={wkg} wlb={wlb} mode={mode} isDarkMode={isDarkMode}
            onClearCall={()=>{
              setAdminLog({});setInitChecks({});setReChecks({});setVitalsEntries([]);
              setPatient({age:"",sex:"",cc:""});
              setCallCcList([]);
              setCallStartTs(null);
              setPedsWkg(0);setPedsWlb(0);setAdultWkg(0);setAdultWlb(0);
              setArrestState({startTs:null,endTs:null,endReason:null,rhythm:null,cycleStartTs:null,lastEpiTs:null,events:[],airway:null,hts:{},access:[],patientType:null});
              setMode("adult");
              setScreen("home");
            }}
          />
        )}


        {/* PRICING SCREEN */}
        {screen==="pricing"&&(
          <PricingScreen
            isDarkMode={isDarkMode}
            authUser={authUser}
            onSelectPlan={(planKey, billing) => {
              setCheckoutPlan({ planKey, billing: billing || "monthly" });
              setScreen(planKey === "agency" ? "agency-quote" : "checkout");
            }}
          />
        )}

        {/* CHECKOUT SCREEN */}
        {screen==="checkout"&&(
          <CheckoutScreen
            isDarkMode={isDarkMode}
            authUser={authUser}
            planKey={checkoutPlan.planKey}
            billing={checkoutPlan.billing}
            onBack={()=>setScreen("pricing")}
            onChangeBilling={b=>setCheckoutPlan(p=>({...p,billing:b}))}
          />
        )}

        {/* AGENCY QUOTE SCREEN */}
        {screen==="agency-quote"&&(
          <AgencyQuoteScreen
            isDarkMode={isDarkMode}
            authUser={authUser}
            onBack={()=>setScreen("pricing")}
          />
        )}

        {/* PROFILE SCREEN */}
        {screen==="profile"&&authUser&&authUser.role!=="Guest"&&(
          <ProfileSetupScreen
            isDarkMode={isDarkMode}
            providerName={authUser.name}
            initialData={{ certLevel: authUser.certLevel, ...(authUser.profile||{}) }}
            onSave={(certLevel, profile)=>{
              const CERT_SCOPE_MAP3={EMT:"EMT",AEMT:"AEMT",Paramedic:"Medic"};
              if(authUser.role==="PaidGuest"){
                updatePaidAccessCertLevel(certLevel);
              } else {
                const users=getStoredUsers();
                const updated=users.map(u=>u.email===authUser.email ? { ...u, certLevel, profile } : u);
                saveStoredUsers(updated);
                localStorage.setItem("medic-ai-user", JSON.stringify({ ...authUser, certLevel, profile }));
              }
              const next={ ...authUser, certLevel, profile };
              setAuthUser(next);
              setScope(CERT_SCOPE_MAP3[certLevel]||"all");
              setScreen("drugs");
            }}
            onSkip={()=>setScreen("drugs")}
            onToggleTheme={()=>setIsDarkMode(v=>!v)}
          />
        )}


        {/* REFERENCE SCREEN */}
        {screen==="ref"&&(
          <ReferenceScreen isDarkMode={isDarkMode} authUser={authUser} onUpgrade={()=>setScreen("pricing")}/>
        )}

        {/* DRUG CALC SCREEN */}
        {screen==="drugs"&&(<>

        {/* MODE TOGGLE */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:3,gap:3,marginBottom:11}}>
          {[["adult","🧑 ADULT",isDarkMode?"#0d1f3a":"#9fbce2",isDarkMode?"#93c5fd":"#172554"],["peds","👶 PEDS",isDarkMode?"#0a2318":"#99c7ae",isDarkMode?"#86efac":"#064e3b"]].map(([m,l,bg,fg])=>(
            <button key={m} onClick={()=>setMode(m)} style={{padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11.5,fontWeight:700,letterSpacing:"0.08em",background:mode===m?bg:"transparent",color:mode===m?fg:"var(--c-text4)",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>

        {/* WEIGHT */}
        <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:"9px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{color:"var(--c-text4)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:"'IBM Plex Mono',monospace"}}>{mode==="adult"?"ADULT WEIGHT":"PEDS WEIGHT"}</span>
          {mode==="adult" ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:5}}><input {...numInp(adultWlb,v=>{setAdultWlb(v);setAdultWkg(v?+(v/2.2046).toFixed(1):0);},"lbs",660,1)}/><span style={{color:"var(--c-text4)",fontSize:11}}>lbs</span></div>
              <span style={{color:adultWkg>0?"#4ade80":"var(--c-text4)",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>{adultWkg>0?`${adultWkg} kg`:"kg auto"}</span>
            </>
          ) : (
            <>
              <div style={{display:"flex",alignItems:"center",gap:5}}><input {...numInp(pedsWlb,v=>{setPedsWlb(v);setPedsWkg(v?+(v/2.2046).toFixed(1):0);},"lbs",220,0.1)}/><span style={{color:"var(--c-text4)",fontSize:11}}>lbs</span></div>
              <span style={{color:pedsWkg>0?"#4ade80":"var(--c-text4)",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>{pedsWkg>0?`${pedsWkg} kg`:"kg auto"}</span>
            </>
          )}
          {wkg>0&&<span style={{marginLeft:"auto",color:"#4ade80",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>{wkg} kg ✓</span>}
        </div>

        {/* SYSTEM DROPDOWN */}
        {(()=>{
          const light=LIGHT_TABS[sysInfo.k]||{bg:sysInfo.lc+"22",fg:sysInfo.lc,bd:sysInfo.lc};
          const sc=isDarkMode?sysInfo.c:light.fg;
          return(
            <div style={{position:"relative",marginBottom:9}}>
              <button
                onClick={()=>setSysDdOpen(v=>!v)}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:10,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,background:isDarkMode?sc+"18":light.bg,color:sc,border:`1px solid ${isDarkMode?sc+"50":light.bd}`,transition:"all 0.12s"}}
              >
                <span>{sysInfo.e} {sysInfo.l}</span>
                <span style={{fontSize:10,opacity:0.7,marginLeft:8}}>{sysDdOpen?"▲":"▼"} {systems.length} systems</span>
              </button>
              {sysDdOpen&&(
                <>
                  <div onClick={()=>setSysDdOpen(false)} style={{position:"fixed",inset:0,zIndex:40}}/>
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:50,background:isDarkMode?"#0d1120":"#f0f4f8",border:`1px solid ${isDarkMode?"#1a2338":"#9aa6b4"}`,borderRadius:10,padding:8,boxShadow:"0 12px 32px rgba(0,0,0,.35)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                    {systems.map(s=>{
                      const sl=LIGHT_TABS[s.k]||{bg:s.lc+"22",fg:s.lc,bd:s.lc};
                      const sc2=isDarkMode?s.c:sl.fg;
                      const isActive=activeSys===s.k;
                      return(
                        <button key={s.k} onClick={()=>{setSys(s.k);setSysDdOpen(false);}}
                          style={{display:"flex",alignItems:"center",gap:7,padding:"8px 10px",borderRadius:8,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,background:isActive?(isDarkMode?sc2+"25":sl.bg):"transparent",color:isActive?sc2:isDarkMode?"var(--c-text4)":"#374151",border:isActive?`1px solid ${isDarkMode?sc2+"55":sl.bd}`:"1px solid transparent",textAlign:"left"}}
                        >
                          <span style={{fontSize:15}}>{s.e}</span>
                          <span>{s.l}</span>
                          {isActive&&<span style={{marginLeft:"auto",fontSize:9,opacity:0.6}}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* SCOPE FILTER */}
        {(()=>{
          const scopeRankMap={EMT:1,AEMT:2,Medic:3};
          const maxRank=certScopeKey ? scopeRankMap[certScopeKey] : 3;
          const totalInSys=(bank[activeSys]||[]).length;
          const hiddenCount=certScopeKey ? (bank[activeSys]||[]).filter(d=>(scopeRankMap[d.scope]||1)>maxRank).length : 0;
          return(
            <div>
              <div style={{display:"flex",gap:5,marginBottom:hiddenCount?4:10,flexWrap:"wrap"}}>
                {[["all","All Scopes",null],["EMT","EMT+","EMT"],["AEMT","AEMT+","AEMT"],["Medic","Paramedic","Medic"]].map(([k,l,sk])=>{
                  const sd=sk?SS[sk]:null;
                  const bg=sd?(isDarkMode?sd.bg:sd.lbg):(isDarkMode?"#1a2030":"#dde5f0");
                  const fg=sd?(isDarkMode?sd.fg:sd.lfg):(isDarkMode?"#7090b8":"#3a5070");
                  const bd=sd?(isDarkMode?sd.bd:sd.lbd):(isDarkMode?"#2a3f60":"#8fa0b6");
                  const blocked=sk ? (certScopeKey ? (scopeRankMap[sk]||1)!==(scopeRankMap[certScopeKey]||1) : false) : false;
                  return(
                    <button key={k} disabled={blocked} onClick={()=>!blocked&&setScope(k)}
                      title={blocked?`Locked to your ${authUser.certLevel} cert level`:undefined}
                      style={{padding:"4px 10px",borderRadius:16,cursor:blocked?"not-allowed":"pointer",fontSize:11,fontWeight:600,fontFamily:"'DM Sans',sans-serif",background:scope===k&&!blocked?bg:"transparent",color:blocked?"var(--c-text-ghost)":scope===k?fg:"var(--c-text4)",border:scope===k&&!blocked?`1px solid ${bd}`:"1px solid transparent",transition:"all 0.12s",opacity:blocked?0.35:1}}>
                      {l}{blocked?" 🔒":""}
                    </button>
                  );
                })}
              </div>
              {hiddenCount>0&&(
                <div style={{marginBottom:10,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"var(--c-text-ghost)"}}>
                  {hiddenCount} drug{hiddenCount!==1?"s":""} outside your {authUser.certLevel} scope
                </div>
              )}
            </div>
          );
        })()}

        {/* SECTION HEADER */}
        <div style={{display:"flex",alignItems:"center",gap:7,paddingBottom:8,borderBottom:`1px solid #0e1525`,marginBottom:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>{mode==="adult"?"Adult":"Pediatric"} — {sysInfo.l}</span>
          <span style={{color:"var(--c-text-ghost)",fontSize:10,marginLeft:"auto"}}>{list.length} drug{list.length!==1?"s":""}</span>
        </div>

        {/* DRUG LIST */}
        {list.length===0
          ?<div style={{textAlign:"center",marginTop:48,color:"var(--c-text-ghost)",fontSize:13}}>No drugs match</div>
          :list.map((d)=><DrugCard key={d.name} drug={d} wt={wkg} color={color} tick={adminLog[d.name]?tick:0} adminLog={adminLog} onGive={handleGive} onReset={handleReset} initVals={initChecks[d.name]||EMPTY_OBJ} onInitUpdate={handleInitUpdate} reVals={reChecks[d.name]||EMPTY_OBJ} onReUpdate={handleReUpdate} onClearRe={handleClearRe} highlighted={highlightDrug===d.name} isDarkMode={isDarkMode} scopeFilter={scope}/>)
        }

        <div style={{marginTop:30,textAlign:"center",color:"#0e1525",fontSize:9.5,lineHeight:1.8,fontFamily:"'IBM Plex Mono',monospace"}}>Clinical reference only — follow local protocols &amp; medical direction</div>
        </>)}
      </div>

      {/* SETTINGS PANEL */}
      {showSettings&&(()=>{
        const bd2=isDarkMode?"var(--c-border)":"#c5b9a8";
        const deep=isDarkMode?"var(--c-deep)":"#ede7dc";
        const tx=isDarkMode?"var(--c-text)":"#0f172a";
        const tx4=isDarkMode?"var(--c-text4)":"#6b7280";
        const tx3=isDarkMode?"var(--c-text3)":"#374151";
        const ST=(on,fn)=>(
          <div onClick={fn} style={{width:44,height:24,borderRadius:12,background:on?"#22c55e":isDarkMode?"#1a2338":"#c5b9a8",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:on?22:3,width:18,height:18,borderRadius:9,background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}} />
          </div>
        );
        const SRow=({label,sub,right})=>(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 0",borderBottom:`1px solid ${isDarkMode?"#0e1525":"#d5c9be"}`}}>
            <div style={{flex:1,marginRight:10}}>
              <div style={{fontSize:13,fontWeight:600,color:tx}}>{label}</div>
              {sub&&<div style={{fontSize:10,color:tx4,marginTop:2}}>{sub}</div>}
            </div>
            {right}
          </div>
        );
        const SHead=({title})=>(
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:800,color:isDarkMode?"#f97316":"#9a3412",letterSpacing:"0.12em",textTransform:"uppercase",paddingBottom:6,borderBottom:`1px solid ${bd2}`}}>{title}</div>
        );
        const FBtn=({k,l})=>(
          <button onClick={()=>{setFontSize(k);localStorage.setItem("roman-font-size",k);}}
            style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${fontSize===k?"#f97316":bd2}`,background:fontSize===k?"#f97316":deep,color:fontSize===k?"#fff":tx3,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,cursor:"pointer"}}>
            {l}
          </button>
        );
        const NavBtn=({icon,lbl,action})=>(
          <button onClick={action}
            style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:9,border:`1px solid ${bd2}`,background:deep,color:tx,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,marginBottom:7}}>
            <span style={{fontSize:18}}>{icon}</span><span style={{flex:1}}>{lbl}</span><span style={{opacity:0.35,fontSize:14}}>→</span>
          </button>
        );
        return(
          <>
            <div onClick={()=>setShowSettings(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:299,backdropFilter:"blur(2px)"}} />
            <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(340px,100vw)",zIndex:300,background:isDarkMode?"var(--c-surface)":"#f4efe7",display:"flex",flexDirection:"column",boxShadow:"-4px 0 32px rgba(0,0,0,0.5)"}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 16px 14px",borderBottom:`1px solid ${bd2}`,flexShrink:0,background:isDarkMode?"var(--c-nav)":"#e8e0d4"}}>
                <div>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:800,color:tx,letterSpacing:"0.04em"}}>⚙️ SETTINGS</div>
                  <div style={{fontSize:10,color:tx4,marginTop:2}}>R.O.M.A.N. Drug Calc</div>
                </div>
                <button onClick={()=>setShowSettings(false)} style={{width:32,height:32,borderRadius:8,border:`1px solid ${bd2}`,background:"transparent",color:tx4,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              {/* Body */}
              <div style={{flex:1,overflowY:"auto",padding:"18px 16px 36px",display:"flex",flexDirection:"column",gap:20}}>

                {/* DISPLAY */}
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  <SHead title="Display" />
                  <SRow label="Dark Mode" sub="Interface theme" right={ST(isDarkMode,()=>setIsDarkMode(v=>!v))} />
                  <SRow label="Font Size" right={
                    <div style={{display:"flex",gap:5}}>
                      <FBtn k="sm" l="SM" /><FBtn k="md" l="MD" /><FBtn k="lg" l="LG" /><FBtn k="xl" l="XL" />
                    </div>
                  } />
                </div>

                {/* ALERTS & SOUNDS */}
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  <SHead title="Alerts & Sounds" />
                  <SRow label="Push Notifications"
                    sub={typeof Notification!=="undefined"&&Notification.permission==="denied"?"Blocked — enable in browser settings":notifyOn?"Active":"Tap to enable"}
                    right={ST(notifyOn,()=>{
                      const n=!notifyOn;
                      if(n&&typeof Notification!=="undefined"&&Notification.permission==="default") Notification.requestPermission();
                      setNotifyOn(n); localStorage.setItem("roman-notify",n?"1":"0");
                    })}
                  />
                  <SRow label="Sounds" sub="Timer, dose, and alert tones" right={ST(soundOn,()=>{const n=!soundOn;setSoundOn(n);localStorage.setItem("roman-sound",n?"1":"0");})} />
                  {soundOn&&(
                    <div style={{display:"flex",gap:6,paddingBottom:10,paddingTop:2}}>
                      {[["click","Click"],["alert","Alert"],["success","OK"],["warn","Warn"]].map(([t,l])=>(
                        <button key={t} onClick={()=>playSound(t)}
                          style={{flex:1,padding:"6px 2px",borderRadius:7,border:`1px solid ${bd2}`,background:deep,color:tx3,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                          ▶ {l}
                        </button>
                      ))}
                    </div>
                  )}
                  <SRow label="Vibration" sub="Haptic feedback"
                    right={ST(vibrationOn,()=>{const n=!vibrationOn;setVibrationOn(n);localStorage.setItem("roman-vibrate",n?"1":"0");if(n&&navigator.vibrate)navigator.vibrate([40,20,40]);})}
                  />
                  <SRow label="Cert Expiry Reminders" sub="30-day and 7-day alerts" right={ST(notifyOn,()=>{})} />
                </div>

                {/* CALL DEFAULTS */}
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  <SHead title="Call Defaults" />
                  <SRow label="Default Age Unit" right={
                    <div style={{display:"flex",gap:5}}>
                      {[["yrs","Yrs"],["mos","Mos"]].map(([k,l])=>(
                        <button key={k} onClick={()=>{setDefaultAgeUnit(k);localStorage.setItem("roman-age-unit",k);}}
                          style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${defaultAgeUnit===k?"#3b82f6":bd2}`,background:defaultAgeUnit===k?"#1d4ed8":deep,color:defaultAgeUnit===k?"#fff":tx3,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                          {l}
                        </button>
                      ))}
                    </div>
                  } />
                  <SRow label="Default Weight Unit" right={
                    <div style={{display:"flex",gap:5}}>
                      {[["lbs","lbs"],["kg","kg"]].map(([k,l])=>(
                        <button key={k} onClick={()=>{setDefaultWeightUnit(k);localStorage.setItem("roman-wt-unit",k);}}
                          style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${defaultWeightUnit===k?"#3b82f6":bd2}`,background:defaultWeightUnit===k?"#1d4ed8":deep,color:defaultWeightUnit===k?"#fff":tx3,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                          {l}
                        </button>
                      ))}
                    </div>
                  } />
                </div>

                {/* NAVIGATE */}
                <div>
                  <SHead title="Navigate" />
                  <div style={{marginTop:10}}>
                    <NavBtn icon="💳" lbl="Plans & Pricing" action={()=>{setShowSettings(false);setScreen("pricing");}} />
                    <NavBtn icon="🗺" lbl="App Tour" action={()=>{setShowSettings(false);setTourStep(0);setShowTour(true);}} />
                  </div>
                </div>

                {/* ACCOUNT */}
                <div>
                  <SHead title="Account" />
                  {authUser&&(
                    <div style={{padding:"11px 14px",borderRadius:9,border:`1px solid ${bd2}`,background:deep,marginTop:10,marginBottom:8}}>
                      <div style={{fontSize:14,fontWeight:700,color:tx}}>{authUser.name||"Provider"}</div>
                      <div style={{fontSize:11,color:tx4,marginTop:3}}>{authUser.certLevel||authUser.role||"Guest"}</div>
                    </div>
                  )}
                  <button onClick={()=>{setShowSettings(false);handleLogout();}}
                    style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:9,border:"1px solid #ef4444",background:isDarkMode?"#1a0a0a":"#fef2f2",color:"#ef4444",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                    <span style={{fontSize:16}}>⬅</span><span style={{flex:1}}>Sign Out</span>
                  </button>
                </div>

                {/* ABOUT */}
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  <SHead title="About" />
                  <SRow label="App Version" right={<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:tx4}}>v1.0.0</span>} />
                  <SRow label="Protocol Set" right={<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:tx4}}>2025–2026</span>} />
                  <SRow label="Reference Base" sub="GA SOP-2024 · NASEMSO v3 · AHA/AAP 2025" right={<span style={{fontSize:13}}>📚</span>} />
                  <SRow label="Clinical Reference Only" sub="Follow local protocols and medical direction" right={<span style={{fontSize:13}}>⚕️</span>} />
                </div>

              </div>
            </div>
          </>
        );
      })()}

      {/* APP TOUR OVERLAY */}
      {showTour&&(()=>{
        const certScope=authUser?.certLevel==="Paramedic"?"Medic":(authUser?.certLevel||(authUser?.role==="Guest"?"Guest":"EMT"));
        const steps=TOUR_STEPS.filter(s=>s.levels.includes(certScope));
        const finishTour=()=>{setShowTour(false);setTourStep(0);localStorage.setItem("roman-tour-done","1");};
        return(
          <TourOverlay
            steps={steps}
            stepIdx={Math.min(tourStep,steps.length-1)}
            onNext={()=>setTourStep(i=>Math.min(i+1,steps.length-1))}
            onBack={()=>setTourStep(i=>Math.max(i-1,0))}
            onFinish={finishTour}
            isDarkMode={isDarkMode}
          />
        );
      })()}
    </>
  );
}

