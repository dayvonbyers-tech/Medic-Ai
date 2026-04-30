import { memo, useState, useMemo, useEffect, useCallback, useRef } from "react";
import heroImage from "./assets/hero.png";

/* ═══════════════════════════════════════════════════════
   CHECK BUILDING BLOCKS
═══════════════════════════════════════════════════════ */
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
  ams:        { id:"ams",      label:"Altered Mental Status present?",                             type:"yesno" },
  airwayprot: { id:"airprot",  label:"Protected airway in place?",                                 type:"yesno" },
  lungsounds:  { id:"lngsnd",  label:"Wheezing or diminished lung sounds present on auscultation?",    type:"yesno" },
  aspirinallergy:{ id:"aspalrg", label:"Known allergy to aspirin or NSAIDs?",                           type:"yesno" },
  aspirinprior:  { id:"aspprior",label:"Number of aspirin tablets taken prior to our arrival (1 tablet = 81 mg)",  type:"value", unit:"tablets", placeholder:"0 if none" },
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
  "Activated Charcoal": [
    mk("ams",{ required:true, warnIf:v=>v==="Yes", warnMsg:"AMS present — confirm protected airway before giving charcoal" }),
    mk("airwayprot",{ required:true, safeYes:true, visibleIf:vals=>vals.ams==="Yes", blockIf:v=>v==="No", blockMsg:"Unprotected airway with AMS — Activated Charcoal CONTRAINDICATED" }),
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

/* ═══ DRUG DATABASE ═══ */
const ADULT = {
  cardiac: [
    { name:"Aspirin", sub:"ACS / Chest Pain", dose:"324 mg PO (4 tablets, chewed)", route:"PO", conc:"81 mg/tablet", draw:"4 tablets — subtract any taken prior to arrival", notes:"Give early in suspected ACS. Must be chewed, not swallowed whole. Screen for allergy and prior dose before giving.", ci:["Aspirin/NSAID allergy","Active GI bleed","Hemorrhagic stroke"], scope:"EMT", redoseMins:null, maxDoses:1 },
    { name:"Nitroglycerin", sub:"ACS / Pulmonary Edema", dose:"0.4 mg SL q5min × 3", route:"SL", conc:"0.4 mg/tablet or spray", draw:"1 tablet or 1 spray SL", notes:"Hold if SBP <100, HR <50 or >100, suspected RVI, or PDE-5 use in past 24–48 h.", ci:["SBP <100","RVI","PDE-5 inhibitor <24–48h","HR <50"], scope:"EMT", redoseMins:5, maxDoses:3 },
    { name:"Epinephrine 1:10,000", sub:"Cardiac Arrest (all rhythms)", dose:"1 mg IV/IO q3–5 min", route:"IV/IO", conc:"0.1 mg/mL", draw:"10 mL", syringe:"10 mL syringe", notes:"Flush with 20 mL NS after each dose. Continue CPR without interruption. No established maximum dose per AHA/ACLS — continue every 3–5 min throughout arrest.", maxDoseNote:"No max — continue per arrest protocol (AHA/ACLS)", ci:[], scope:"AEMT", redoseMins:4, maxDoses:null },
    { name:"Amiodarone", sub:"VF / Pulseless VT", dose:"Dose 1: 300 mg IVP · Dose 2: 150 mg IVP", route:"IV/IO", conc:"50 mg/mL", draw:"Dose 1: 6 mL (300 mg) · Dose 2: 3 mL (150 mg)", notes:"Stable VT: 150 mg IV over 10 min. Avoid in iodine allergy. Do NOT mix with other drugs.", maxDoseNote:"Max 450 mg total (2 doses)", doseSteps:[{label:"Dose 1",dose:"300 mg IVP",draw:"6 mL",mg:300},{label:"Dose 2",dose:"150 mg IVP",draw:"3 mL",mg:150}], ci:["Iodine allergy (relative)","Cardiogenic shock"], scope:"Medic", redoseMins:null, maxDoses:2 },
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
    { name:"Epinephrine 1:10,000", sub:"Cardiac Arrest", dose:"0.01 mg/kg IV/IO q3–5 min", route:"IV/IO", conc:"0.1 mg/mL", draw:"0.1 mL/kg (max 10 mL)", notes:"Max 1 mg per dose. Flush 3–5 mL NS after each dose. No established maximum dose per AHA/ACLS — continue every 3–5 min throughout arrest.", maxDoseNote:"No max — continue per arrest protocol (AHA/ACLS)", ci:[], scope:"AEMT", wt:true, mpk:0.01, cmpml:0.1, maxd:1, redoseMins:4, maxDoses:null },
    { name:"Adenosine", sub:"SVT", dose:"0.1 mg/kg rapid IVP (max 6 mg)", route:"Rapid IV proximal + flush", conc:"3 mg/mL", draw:"Varies by weight (max 2 mL)", notes:"Push FAST + flush 10–20 mL NS. 2nd dose: 0.2 mg/kg (max 12 mg).", ci:["2nd/3rd degree AV block","Asthma (relative)"], scope:"Medic", wt:true, mpk:0.1, cmpml:3, maxd:6, redoseMins:2, maxDoses:3 },
    { name:"Amiodarone", sub:"VF / pVT (refractory)", dose:"5 mg/kg IV/IO (max 300 mg per dose)", route:"IV/IO", conc:"50 mg/mL", draw:"Varies by weight (max 6 mL per dose)", notes:"Max 300 mg per dose. Dilute in D5W. Both doses are equal weight-based amounts. Stable arrhythmia: give over 20–60 min.", maxDoseNote:"Max 300 mg/dose · Max 2 doses (600 mg total)", ci:[], scope:"Medic", wt:true, mpk:5, cmpml:50, maxd:300, redoseMins:null, maxDoses:2 },
    { name:"Atropine", sub:"Symptomatic Bradycardia", dose:"0.02 mg/kg IV/IO", route:"IV/IO", conc:"0.1 mg/mL", draw:"Varies by weight", notes:"Min 0.1 mg; max 0.5 mg (child), 1 mg (adolescent).", ci:[], scope:"AEMT", wt:true, mpk:0.02, cmpml:0.1, maxd:0.5, mind:0.1, redoseMins:4, maxDoses:2 },
  ],
  airway: [
    { name:"Succinylcholine", sub:"RSI Paralytic", dose:"1–2 mg/kg IV/IO", route:"IV/IO", conc:"20 mg/mL", draw:"Varies by weight (max 7.5 mL)", notes:"Onset 45–60 sec. Pre-treat with atropine. Contraindicated in hyperkalemia.", ci:["Hyperkalemia","Burns >24 h","Crush injury >24 h","Known myopathy"], scope:"Medic", wt:true, mpk:1.5, cmpml:20, maxd:150, redoseMins:null, maxDoses:1 },
    { name:"Rocuronium", sub:"RSI Paralytic (if succinylcholine CI)", dose:"1–1.2 mg/kg IV", route:"IV/IO", conc:"10 mg/mL", draw:"Varies by weight (max 10 mL)", notes:"Onset 60–90 sec. Reversal: Sugammadex 16 mg/kg.", ci:["Allergy"], scope:"Medic", wt:true, mpk:1.2, cmpml:10, maxd:100, redoseMins:null, maxDoses:1 },
    { name:"Ketamine", sub:"RSI Induction / Procedural Sedation", dose:"1–2 mg/kg IV · 4–6 mg/kg IM", route:"IV/IM", conc:"10 mg/mL", draw:"Varies by weight", notes:"Preserves airway reflexes and hemodynamics.", ci:["Age <3 months (relative)","Schizophrenia"], scope:"Medic", wt:true, mpk:2, cmpml:10, maxd:200, redoseMins:null, maxDoses:null },
    { name:"Midazolam (Versed)", sub:"RSI Pre-medication / Sedation", dose:"0.1–0.3 mg/kg IV/IM/IN", route:"IV/IM/IN", conc:"5 mg/mL", draw:"Varies by weight (max 1 mL)", notes:"IN: use MAD device, max 0.5 mL per nostril.", ci:[], scope:"Medic", wt:true, mpk:0.1, cmpml:5, maxd:5, redoseMins:10, maxDoses:2 },
    { name:"Atropine (RSI pre-tx)", sub:"RSI Pre-medication — under 1 yr", dose:"0.02 mg/kg IV (3 min before intubation)", route:"IV", conc:"0.1 mg/mL", draw:"Varies by weight", notes:"Prevents vagal bradycardia from laryngoscopy. Min 0.1 mg.", ci:[], scope:"Medic", wt:true, mpk:0.02, cmpml:0.1, maxd:0.5, mind:0.1, redoseMins:null, maxDoses:1 },
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

/* ═══ CONFIG ═══ */
const A_SYS=[{k:"cardiac",l:"Cardiac",c:"#f87171",lc:"#dc2626",e:"♥"},{k:"respiratory",l:"Respiratory",c:"#60a5fa",lc:"#1d4ed8",e:"🌬"},{k:"neurological",l:"Neuro",c:"#c084fc",lc:"#7e22ce",e:"⚡"},{k:"metabolic",l:"Metabolic",c:"#facc15",lc:"#a16207",e:"⚗"},{k:"anaphylaxis",l:"Anaphylaxis",c:"#fb923c",lc:"#c2410c",e:"⚠"},{k:"pain",l:"Pain/Sedation",c:"#4ade80",lc:"#15803d",e:"💊"},{k:"toxicology",l:"Tox",c:"#94a3b8",lc:"#475569",e:"☠"},{k:"obgyn",l:"OB/GYN",c:"#f472b6",lc:"#be185d",e:"♀"},{k:"trauma",l:"Trauma",c:"#f97316",lc:"#b45309",e:"🩹"},{k:"burns",l:"Burns",c:"#fb7185",lc:"#be123c",e:"🔥"}];
const P_SYS=[{k:"cardiac",l:"Cardiac",c:"#f87171",lc:"#dc2626",e:"♥"},{k:"airway",l:"Airway/RSI",c:"#60a5fa",lc:"#1d4ed8",e:"🌬"},{k:"seizure",l:"Seizures",c:"#c084fc",lc:"#7e22ce",e:"⚡"},{k:"anaphylaxis",l:"Anaphylaxis",c:"#fb923c",lc:"#c2410c",e:"⚠"},{k:"pain",l:"Pain/Sedation",c:"#4ade80",lc:"#15803d",e:"💊"},{k:"glucose",l:"Glucose",c:"#facc15",lc:"#a16207",e:"🩸"},{k:"trauma",l:"Trauma",c:"#f97316",lc:"#b45309",e:"🩹"},{k:"burns",l:"Burns",c:"#fb7185",lc:"#be123c",e:"🔥"}];
const SS={EMT:{bg:"#14532d",fg:"#86efac",lbl:"EMT+",lbg:"#dcfce7",lfg:"#166534",bd:"#166534",lbd:"#4ade80"},AEMT:{bg:"#1e3a8a",fg:"#93c5fd",lbl:"AEMT+",lbg:"#dbeafe",lfg:"#1e40af",bd:"#1e40af",lbd:"#60a5fa"},Medic:{bg:"#7c2d12",fg:"#fdba74",lbl:"Paramedic",lbg:"#ffedd5",lfg:"#9a3412",bd:"#9a3412",lbd:"#fb923c"}};
const LIGHT_TABS={cardiac:{bg:"#ffe1e1",fg:"#b91c1c",bd:"#f87171"},respiratory:{bg:"#dbeafe",fg:"#1d4ed8",bd:"#60a5fa"},neurological:{bg:"#f3e8ff",fg:"#7e22ce",bd:"#c084fc"},metabolic:{bg:"#fef3c7",fg:"#92400e",bd:"#facc15"},anaphylaxis:{bg:"#ffedd5",fg:"#c2410c",bd:"#fb923c"},airway:{bg:"#dbeafe",fg:"#1d4ed8",bd:"#60a5fa"},seizure:{bg:"#f3e8ff",fg:"#7e22ce",bd:"#c084fc"},glucose:{bg:"#fef3c7",fg:"#92400e",bd:"#facc15"}};

// Flat O(1) lookup built once at module load
const DRUG_LOCATION_MAP = new Map();
[["adult",ADULT],["peds",PEDS]].forEach(([mode,bank])=>{
  Object.entries(bank).forEach(([sys,drugs])=>{
    drugs.forEach(d=>{ if(!DRUG_LOCATION_MAP.has(d.name)) DRUG_LOCATION_MAP.set(d.name,{mode,sys}); });
  });
});

function calcDose(d,wt){if(!d.wt||!d.mpk||!wt||wt<=0)return null;let mg=d.mpk*wt;if(d.maxd!=null&&mg>d.maxd)mg=d.maxd;if(d.mind!=null&&mg<d.mind)mg=d.mind;const display=parseFloat(((d.dmult||1)*mg).toFixed(2));const mL=d.cmpml?parseFloat((mg/d.cmpml).toFixed(2)):null;return{display,unit:d.unit||"mg",mL};}

function inferDoseUnit(drug){
  if(drug.unit) return drug.unit;
  const text=`${drug.dose||""} ${drug.maxDoseNote||""}`.toLowerCase();
  if(/\bmcg\b/.test(text)) return "mcg";
  if(/\bmeq\b/.test(text)) return "mEq";
  if(/\bunits?\b/.test(text)) return "units";
  if(/\bml\b/.test(text)) return "mL";
  if(/\bg\b/.test(text)&&!/\bmg\b/.test(text)) return "g";
  if(/\bmg\b/.test(text)) return "mg";
  return "amount";
}

function getNumericMaxTotal(drug,wt){
  const unit=inferDoseUnit(drug);
  if(drug.doseSteps?.length){
    const total=drug.doseSteps.reduce((sum,step)=>sum+(Number(step.mg)||0),0);
    if(total>0) return { total, unit:"mg" };
  }
  if(drug.wt&&drug.maxd!=null&&drug.maxDoses){
    return { total:parseFloat((drug.maxd*(drug.dmult||1)*drug.maxDoses).toFixed(2)), unit };
  }
  const note=`${drug.maxDoseNote||""} ${drug.dose||""}`;
  const match=note.match(/max(?:\s+cumulative|\s+total)?\s+(\d+(?:\.\d+)?)\s*(mcg|mg|g|mEq|units?|mL)\b/i);
  if(match) return { total:Number(match[1]), unit:match[2] };
  if(drug.maxDoses===1){
    const fixed=(drug.dose||"").match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|mEq|units?|mL)\b/i);
    if(fixed) return { total:Number(fixed[1]), unit:fixed[2] };
  }
  return null;
}

function getPrecheckPtaInfo(drug,vals={}){
  if(drug.name==="Aspirin"){
    const tablets=Number(vals.aspprior);
    if(!Number.isNaN(tablets)&&tablets>0){
      const total=tablets*81;
      return { total, label:`${tablets} tablet${tablets===1?"":"s"} (${total} mg)` };
    }
  }
  const raw=Number(vals.ptaAmount??vals.ptaDose??vals.priorAmount);
  if(!Number.isNaN(raw)&&raw>0) return { total:raw, label:String(raw) };
  return { total:0, label:"0" };
}

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
  return checks.filter(c=>!c.visibleIf||c.visibleIf(vals)).map(c=>{
    const v=vals[c.id]??"";
    const filled=v!==""&&v!=null;
    const isBlock=filled&&c.blockIf?.(v,vals);
    const isWarn=filled&&!isBlock&&c.warnIf?.(v,vals);
    const isOk=filled&&!isBlock&&!isWarn;
    return{...c,v,filled,isBlock,isWarn,isOk};
  });
}

/* ── Check Form ── */
function CheckForm({checks,vals,onUpdate,label,accentColor="#60a5fa",subtitle,isDarkMode=true}){
  const results=evalChecks(checks,vals);
  return(
    <div style={{textAlign:"left"}}>
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
          <div key={r.id} style={{background:rowBg,border:`1px solid ${bCol}`,borderRadius:7,padding:"9px 11px",marginBottom:6,textAlign:"left"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
              <div style={{width:17,height:17,borderRadius:"50%",flexShrink:0,marginTop:1,background:r.isBlock?"#ef4444":r.isWarn?"#f59e0b":r.isOk?"#22c55e":"var(--c-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#fff"}}>
                {r.isBlock?"✕":r.isWarn?"!":r.isOk?"✓":""}
              </div>
              <div style={{flex:1,textAlign:"left"}}>
                <div style={{color:"var(--c-text3)",fontSize:12,lineHeight:1.4,textAlign:"left"}}>{r.label}</div>
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
                  <button key={opt} onClick={e=>{e.stopPropagation();onUpdate(r.id,opt);}} style={{padding:"5px 16px",borderRadius:5,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,background:r.v===opt?(opt===(r.safeYes?"Yes":"No")?(isDarkMode?"#166534":"#dcfce7"):(isDarkMode?"#9a1f0f":"#fee2e2")):(isDarkMode?"#1e2f4a":"#e8eef8"),color:r.v===opt?(opt===(r.safeYes?"Yes":"No")?(isDarkMode?"#86efac":"#166534"):(isDarkMode?"#fca5a5":"#991b1b")):(isDarkMode?"#7090b8":"#3a5070"),border:r.v===opt?`1px solid ${opt===(r.safeYes?"Yes":"No")?(isDarkMode?"#22c55e40":"#86efac"):(isDarkMode?"#ef444440":"#fca5a5")}`:`1px solid ${isDarkMode?"#2a3f60":"#b8c8dc"}`,transition:"all 0.1s"}}>{opt}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══ DRUG CARD ═══ */
const DrugCard=memo(function DrugCard({drug,wt,color,tick,adminLog,onGive,onReset,initVals,onInitUpdate,reVals,onReUpdate,onClearRe,highlighted,isDarkMode=true,scopeFilter="all"}){
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState("info");
  const[warnAck,setWarnAck]=useState(false);
  const[reWarnAck,setReWarnAck]=useState(false);
  const[providerAmount,setProviderAmount]=useState("");
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
  const s=SS[scopeFilter!=="all"?scopeFilter:drug.scope]||SS.EMT;
  const initChecks=INIT_CHECKS[drug.name]||[];
  const reChecks=RE_CHECKS[drug.name]||[];
  const hasInitChecks=initChecks.length>0;
  const hasReChecks=reChecks.length>0;
  const log=adminLog[drug.name];
  const doseCount=log?log.times.length:0;
  const lastAt=log?log.times[log.times.length-1]:null;
  const doseUnit=calc?.unit||inferDoseUnit(drug);
  const isAspirin=drug.name==="Aspirin";
  const maxTotal=getNumericMaxTotal(drug,wt);
  const precheckPta=getPrecheckPtaInfo(drug,initVals);
  const ptaTotal=precheckPta.total;
  const providerRaw=Number(providerAmount);
  const providerDose=isAspirin?providerRaw*81:providerRaw;
  const providerAmountFilled=providerAmount!==""&&!Number.isNaN(providerRaw)&&providerRaw>0;
  const providerAmountLabel=isAspirin?`${providerRaw} tablet${providerRaw===1?"":"s"} (${providerDose} mg)`:`${providerDose} ${doseUnit}`;
  const providerInputUnit=isAspirin?"tabs":doseUnit;
  const projectedTotal=ptaTotal+(providerAmountFilled?providerDose:0);
  const amountOverMax=maxTotal&&providerAmountFilled&&projectedTotal>maxTotal.total;
  const amountGate=providerAmountFilled&&!amountOverMax;
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
  const initWarnSig=iR.filter(r=>r.isWarn).map(r=>`${r.id}:${r.v}`).join("|");

  /* reassessment check eval — vitals only */
  const needsRe=hasActivity&&isDue&&!maxReached&&hasReChecks&&isMultiDose;
  const rR=evalChecks(reChecks,reVals);
  const rBlocked=rR.some(r=>r.isBlock);
  const rAllFill=rR.every(r=>r.filled);
  const rWarn=rR.some(r=>r.isWarn);
  const rOk=rAllFill&&!rBlocked;
  const rMissing=rR.filter(r=>!r.filled).length;
  const reWarnSig=rR.filter(r=>r.isWarn).map(r=>`${r.id}:${r.v}`).join("|");

  useEffect(()=>{setWarnAck(false);},[drug.name,initWarnSig,doseCount]);
  useEffect(()=>{setReWarnAck(false);},[drug.name,reWarnSig,doseCount]);

  const timerReady=!hasActivity||remainSecs===null||isDue;
  const checkGate=!hasActivity?iOk:(needsRe?rOk:true);
  const needsInitWarnAck=!hasActivity&&iOk&&iWarn&&!warnAck;
  const needsReWarnAck=needsRe&&rOk&&rWarn&&!reWarnAck;
  const warningAckOk=!needsInitWarnAck&&!needsReWarnAck;
  const canGive=!maxReached&&timerReady&&checkGate&&warningAckOk&&amountGate&&(hasActivity?!rBlocked:!iBlocked);

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
            {hasInitChecks&&!open&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",background:iBlocked?"#fee2e2":iAllFill?"#dcfce7":"#f3e8ff",color:iBlocked?"#b91c1c":iAllFill?"#166534":"#7e22ce",border:`1px solid ${iBlocked?"#f87171":iAllFill?"#4ade80":"#c084fc"}`,borderRadius:3,padding:"2px 5px"}}>{iBlocked?"⛔ blocked":iAllFill?"✓ checked":`⚕ ${iMissing} checks`}</span>}
            {needsRe&&!open&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",background:isDarkMode?"#1a1000":"#fff7ed",color:isDarkMode?"#f97316":"#c2410c",border:`1px solid ${isDarkMode?"#f9731655":"#fb923c"}`,borderRadius:3,padding:"2px 5px"}}>📋 REASSESS</span>}
          </div>
          <div style={{color:isDarkMode?"var(--c-text-sub)":"#1e3a58",fontSize:11,marginTop:3,lineHeight:1.3}}>{drug.sub}</div>
        </div>
        {calc&&wt>0&&<div style={{background:"var(--c-deep)",border:`1px solid ${color}30`,borderRadius:6,padding:"5px 8px",textAlign:"center",flexShrink:0,minWidth:52}}><div style={{fontFamily:"'IBM Plex Mono',monospace",color,fontSize:14,fontWeight:700,lineHeight:1}}>{calc.display}</div><div style={{color:"var(--c-text-sub)",fontSize:8,textTransform:"uppercase",marginTop:1}}>{calc.unit}</div>{calc.mL!=null&&<div style={{color:"var(--c-text3)",fontSize:9,marginTop:1}}>{calc.mL} mL</div>}{calc.mL!=null&&<div style={{color:"var(--c-text4)",fontSize:8,marginTop:1}}>({getSyringeSize(calc.mL)})</div>}</div>}
        {hasActivity&&!open&&<div style={{background:timerCol+"18",border:`1px solid ${timerCol}55`,borderRadius:6,padding:"4px 7px",textAlign:"center",flexShrink:0}}>{maxReached?<div style={{color:"#ef4444",fontSize:9,fontWeight:700,textTransform:"uppercase"}}>MAX</div>:needsRe?<div style={{color:"#f97316",fontSize:9,fontWeight:700}}>📋</div>:remainSecs!=null?<><div style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:12,fontWeight:700,lineHeight:1}}>{fmt(remainSecs)}</div><div style={{color:timerCol,fontSize:8,marginTop:1,fontWeight:600}}>{isDue?"DUE NOW":isWarning?"PREP":"next"}</div></>:<div style={{fontFamily:"'IBM Plex Mono',monospace",color:timerCol,fontSize:9,fontWeight:700}}>×{doseCount}</div>}</div>}
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
                {drug.ci?.length>0&&<div><div style={{color:"var(--c-text5)",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>⚠ Contraindications</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{drug.ci.map((c,i)=><span key={i} style={{background:isDarkMode?"#3b0000":"#fee2e2",color:isDarkMode?"#fca5a5":"#b91c1c",border:`1px solid ${isDarkMode?"#5a1010":"#f87171"}`,borderRadius:4,padding:"2px 7px",fontSize:11}}>{c}</span>)}</div></div>}
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
                             <label onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:7,marginTop:8,color:"#fcd34d",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                               <input type="checkbox" checked={reWarnAck} onChange={e=>setReWarnAck(e.target.checked)} style={{width:14,height:14,accentColor:"#f59e0b"}}/>
                               <span>I reviewed these warnings and want to proceed.</span>
                             </label>
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
                {!hasActivity&&iOk&&iWarn&&<div onClick={e=>{e.stopPropagation();setTab("precheck");}} role="button" title="Open Pre-Check" style={{background:"#1a1000",border:"1px solid #f59e0b44",borderRadius:6,padding:"8px 12px",marginBottom:10,cursor:"pointer"}}><div style={{color:"#fcd34d",fontSize:11,fontWeight:600}}>⚠ Warnings — review before giving</div>{iR.filter(r=>r.isWarn).map((r,i)=><div key={i} style={{color:"#a07030",fontSize:11,marginTop:2}}>• {r.warnMsg}</div>)}<label onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:7,marginTop:8,color:"#fcd34d",fontSize:11,fontWeight:700,cursor:"pointer"}}><input type="checkbox" checked={warnAck} onChange={e=>setWarnAck(e.target.checked)} style={{width:14,height:14,accentColor:"#f59e0b"}}/><span>I reviewed these warnings and want to proceed.</span></label></div>}
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

                {/* PROVIDER DOSE AMOUNT */}
                <div style={{background:amountOverMax?"#2a0808":"var(--c-input)",border:`1px solid ${amountOverMax?"#7f1d1d":"var(--c-border-sub)"}`,borderRadius:7,padding:"8px 10px",marginBottom:10}}>
                  <div style={{color:amountOverMax?"#fca5a5":"var(--c-text3)",fontSize:10,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Provider dose amount</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:7,alignItems:"center"}}>
                    <input
                      type="number"
                      value={providerAmount}
                      onChange={e=>setProviderAmount(e.target.value)}
                      onClick={e=>e.stopPropagation()}
                      placeholder={isAspirin?"Tablets to give":calc&&wt>0?String(calc.display):"Amount to give"}
                      min="0"
                      step="any"
                      style={{minWidth:0,padding:"7px 8px",background:"var(--c-surface)",border:`1px solid ${amountOverMax?"#7f1d1d":"var(--c-border)"}`,borderRadius:6,color:"var(--c-text)",fontSize:12,fontFamily:"'IBM Plex Mono',monospace",outline:"none"}}
                    />
                    <span style={{color:"var(--c-text4)",fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{providerInputUnit}</span>
                  </div>
                  <div style={{color:amountOverMax?"#fca5a5":"var(--c-text4)",fontSize:10,marginTop:6,lineHeight:1.4}}>
                    Pre-check PTA total: {precheckPta.label} {drug.name==="Aspirin"?"":doseUnit}
                    {isAspirin?" · 1 tablet = 81 mg":""}
                    {maxTotal?` · After this: ${providerAmountFilled?projectedTotal:ptaTotal} / ${maxTotal.total} ${maxTotal.unit} max`:" · Enter amount before administering"}
                  </div>
                  {amountOverMax&&<div style={{color:"#fca5a5",fontSize:11,fontWeight:700,marginTop:4}}>Dose blocked: PTA + provider amount exceeds max dose.</div>}
                </div>

                {/* MAIN BUTTON */}
                <div style={{display:"flex",gap:7}}>
                  <button
                    onClick={e=>{e.stopPropagation();if(canGive){onGive(drug.name,{amount:providerAmountLabel,amountValue:providerDose,unit:isAspirin?"mg":doseUnit});setProviderAmount("");if(needsRe)onClearRe(drug.name);}}}
                    disabled={!canGive}
                    style={{
                      flex:1,padding:"10px 0",borderRadius:7,border:"none",
                      cursor:canGive?"pointer":"not-allowed",
                      fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:"0.05em",
                      background:maxReached?"#1a2030":iBlocked?"#2a0808":!iOk?"#0d1728":needsInitWarnAck||needsReWarnAck?"#1a1200":amountOverMax?"#2a0808":!providerAmountFilled?"#0d1728":needsRe&&rBlocked?"#2a0808":needsRe&&!rAllFill?"#1a1200":needsRe&&rOk?"#7a3500":hasActivity&&remainSecs!=null&&!isDue?"var(--c-nav)":hasActivity?"#7a3500":"#0f3a1f",
                      color:maxReached?"#2a3a55":iBlocked?"#6b1414":!iOk?"#1e3a8a":needsInitWarnAck||needsReWarnAck?"#f59e0b":amountOverMax?"#fca5a5":!providerAmountFilled?"#1e3a8a":needsRe&&rBlocked?"#6b1414":needsRe&&!rAllFill?"#7a5020":needsRe&&rOk?"#fff":hasActivity&&remainSecs!=null&&!isDue?"#2a3a55":hasActivity?"#fff":"#4ade80",
                      border:"1px solid "+(maxReached?"#1a2030":iBlocked?"#7f1d1d":!iOk?"#1e3a8a":needsInitWarnAck||needsReWarnAck?"#92400e":amountOverMax?"#7f1d1d":!providerAmountFilled?"#1e3a8a":needsRe&&(rBlocked||!rAllFill)?(rBlocked?"#7f1d1d":"#92400e"):hasActivity&&remainSecs!=null&&!isDue?"var(--c-border)":hasActivity?"#f9731660":"#1a5c2a"),
                      opacity:canGive?1:0.65,transition:"all 0.15s",
                    }}
                  >
                    {maxReached?"MAX DOSE REACHED":iBlocked?"⛔ BLOCKED — SEE PRE-CHECK TAB":!iOk?`⚕ COMPLETE PRE-CHECK (${iMissing} left)`:needsInitWarnAck?"☐ CONFIRM WARNING REVIEW":amountOverMax?"⛔ PTA + PROVIDER EXCEEDS MAX":!providerAmountFilled?"ENTER PROVIDER DOSE AMOUNT":needsRe&&rBlocked?"⛔ BLOCKED — CONTRAINDICATION IN VITALS":needsRe&&!rAllFill?`📋 ENTER VITALS FIRST (${rMissing} left)`:needsReWarnAck?"☐ CONFIRM WARNING REVIEW":needsRe&&rWarn?`⟹ RE-ADMINISTER DOSE ${doseCount+1} (warnings)`:needsRe&&rOk?`⟹ RE-ADMINISTER — DOSE ${doseCount+1}`:hasActivity&&remainSecs!=null&&!isDue?`TIMER ACTIVE — ${fmt(remainSecs)}`:hasActivity?"⟹ RE-ADMINISTER":`✓ MARK AS GIVEN — DOSE 1`}
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

/* ═══════════════════════════════════════════════════════
   VITALS LOG
═══════════════════════════════════════════════════════ */
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
    SR ? <button onClick={e=>{e.stopPropagation(); listening&&listenField===field?stopListen():startListen(field);}} style={{background:listening&&listenField===field?'#7c2d12':'var(--c-surface)',border:`1px solid ${listening&&listenField===field?'#ef4444':'var(--c-border)'}`,borderRadius:5,padding:small?'3px 7px':'5px 9px',cursor:'pointer',color:listening&&listenField===field?'#fca5a5':'var(--c-text4)',fontSize:small?10:11,fontFamily:"'IBM Plex Mono',monospace"}}>
      {listening&&listenField===field?'■ stop':'🎙'}
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
                <span>{listening&&!listenField?'■':'🎙'}</span>
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

/* ═══════════════════════════════════════════════════════
   ARREST TRACKER — AHA/ACLS 2020 Adult Cardiac Arrest Algorithm
   Tracks pulse checks, shocks, meds, airway, H's and T's
═══════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════
   PEDS ARREST DRUG MENU — PALS 2020
   All doses weight-based with explicit max caps.
   maxCumulative enforces hard stop across multiple doses.
═══════════════════════════════════════════════════════ */
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

function ArrestTracker({ arrestState, setArrestState, tick, onLogMed, wkg, setWkg, setWlb, mode, isDarkMode=true }) {
  const alarmRef = useRef({ epiWarn: false, epiDue: false, cycleEnd: false, lastCycleStart: null });
  const [showHT, setShowHT] = useState(false);
  const [showRhythmMenu, setShowRhythmMenu] = useState(false);
  const [showShockMenu, setShowShockMenu] = useState(false);
  const [showAirwayMenu, setShowAirwayMenu] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const { startTs, endTs, endReason, rhythm, cycleStartTs, lastEpiTs, events, airway, hts, access, patientType } = arrestState;
  const active = !!startTs && !endTs;
  const now = Date.now();

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
  const addEvent = (type, detail = "", extra = {}) => {
    const ev = { id: Date.now() + Math.random(), ts: Date.now(), type, detail, ...extra };
    setArrestState(s => ({ ...s, events: [ev, ...s.events] }));
    return ev;
  };

  const [showStartPicker, setShowStartPicker] = useState(false);

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
    setShowStartPicker(false);
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
  const recordAccess = ({ type, site, gauge, who, success }) => {
    const entry = {
      id: Date.now() + Math.random(),
      ts: Date.now(),
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
  };
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
    setArrestState(s => ({
      ...s, endTs: ts, endReason: reason,
      events: [{ id: ts, ts, type, detail: reason === "ROSC" ? "Return of spontaneous circulation" : "Resuscitation terminated" }, ...s.events]
    }));
    setConfirmEnd(false);
  };

  const resetArrest = () => {
    if (!confirm("Reset arrest? This will clear all arrest events from this tab (Med Log is NOT affected).")) return;
    setArrestState({
      startTs:null, endTs:null, endReason:null,
      rhythm:null, cycleStartTs:null, lastEpiTs:null,
      events:[], airway:null, hts:{}, access:[], patientType:null
    });
    alarmRef.current = { epiWarn: false, epiDue: false, cycleEnd: false, lastCycleStart: null };
  };

  const deleteEvent = (id) => {
    setArrestState(s => ({ ...s, events: s.events.filter(e => e.id !== id) }));
  };

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
          background: endReason === "ROSC" ? "#071a0e" : "#1a1208",
          border: `2px solid ${endReason === "ROSC" ? "#14532d" : "#5a4020"}`,
          borderRadius:10, padding:"16px 14px", marginBottom:10, textAlign:"center"
        }}>
          <div style={{ fontSize:36, marginBottom:6 }}>{endReason === "ROSC" ? "♥" : "✕"}</div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:15, fontWeight:700, color: endReason === "ROSC" ? "#4ade80" : "#c08040", marginBottom:4 }}>
            {endReason === "ROSC" ? "ROSC Achieved" : "Resuscitation Terminated"}
          </div>
          <div style={{ color:"var(--c-text-sub)", fontSize:11 }}>
            Total arrest time: <span style={{ color:"var(--c-text)", fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{fmtArrestTime(totalSecs)}</span>
          </div>
        </div>

        {/* Stat summary */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:10 }}>
          <SumStat label="Shocks" value={shockCount} color="#fca5a5" />
          <SumStat label="Epi Doses" value={epiCount} color="#fdba74" />
          <SumStat label="Access" value={access.filter(a => a.success).length} color="#93c5fd" />
          <SumStat label={airway ? "Airway" : "—"} value={airway || "—"} color="#86efac" />
        </div>

        <ArrestEventLog events={events} onDelete={deleteEvent} />

        <div style={{ display:"flex", gap:7, marginTop:10 }}>
          <button onClick={resetArrest} style={{
            flex:1, padding:"11px 0", borderRadius:7, border:"1px solid #1a2540",
            background:"transparent", color:"var(--c-text-sub)", cursor:"pointer",
            fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:"0.05em"
          }}>↺ Reset & Start New</button>
        </div>
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
          background:"#1a0a28", border:"1px solid #a855f7",
          borderRadius:7, padding:"7px 11px", marginBottom:8,
          display:"flex", alignItems:"center", gap:8
        }}>
          <span style={{ fontSize:16 }}>{patientType === "infant" ? "👶" : "🧒"}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#c084fc", fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>
              {patientType === "infant" ? "Infant (<1 yr) · PALS" : "Child (1–8 yr) · PALS"}
            </div>
            <div style={{ fontSize:10, color:"var(--c-text3)", marginTop:1 }}>
              CPR: {cprDepth} depth · {cprRatio}
              {wkg > 0 ? ` · ${wkg} kg` : " · ⚠ no weight"}
            </div>
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
      />

      {/* MASTER TIMERS */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
        <TimerCard
          label="Total Arrest"
          value={fmtArrestTime(totalSecs)}
          color="var(--c-text)"
          bg="var(--c-surface)"
        />
        <TimerCard
          label={cycleEnded ? "Rhythm Check DUE" : "CPR Cycle"}
          value={cycleEnded ? "NOW" : fmtArrestTime(cycleRemain)}
          color={cycleEnded ? "#f87171" : cycleRemain < 30 ? "#facc15" : "#4ade80"}
          bg={cycleEnded ? "#2a0808" : "#0a1a18"}
          pulse={cycleEnded}
        />
      </div>

      {/* Epi timer strip */}
      {epiCount > 0 && (
        <div style={{
          background: epiDue ? "#2a0808" : epiWarn ? "#1a1408" : "#0a1018",
          border: `1px solid ${epiDue ? "#7f1d1d" : epiWarn ? "#92400e" : "#1a2540"}`,
          borderRadius:7, padding:"7px 10px", marginBottom:8,
          display:"flex", alignItems:"center", gap:8
        }}>
          <span style={{ fontSize:14 }}>💉</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color: epiDue ? "#fca5a5" : epiWarn ? "#fcd34d" : "var(--c-text4)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>
              Epi #{epiCount} · {fmtClock(lastEpiTs)}
            </div>
            <div style={{ fontSize:10.5, color: epiDue ? "#fca5a5" : "var(--c-text-sub)", marginTop:1 }}>
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
          background: rhythm === "VF/pVT" ? "#1a0808" : "#0a1428",
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
        <div style={{ background:"#0a1a28", border:"1px solid #1e3a8a55", borderRadius:7, padding:"6px 10px", marginBottom:6, display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
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
          bg="#0d1f3a" bd="#1e3a8a" fg="#93c5fd" big
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
          bg="#2a0808" bd="#7f1d1d" fg="#fca5a5" big
          disabled={(rhythm && rhythm !== "VF/pVT") || (isPeds && wkg === 0)}
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
          bg={isPeds && wkg === 0 ? "#0a0e1a" : epiDue ? "#7f1d1d" : epiWarn ? "#7c2d12" : "#1a1208"}
          bd={isPeds && wkg === 0 ? "#1a1208" : epiDue ? "#ef4444" : epiWarn ? "#f97316" : "#7c2d12"}
          fg={isPeds && wkg === 0 ? "#fcd34d" : epiDue ? "#fff" : epiWarn ? "#fff" : "#fdba74"}
          big
          flash={epiDue && !(isPeds && wkg === 0)}
          disabled={isPeds && wkg === 0}
        />
        <ActionBtn
          icon="💧" label={successfulAccess.length > 0 ? `Access ×${successfulAccess.length}` : "Access"}
          sub={successfulAccess.length > 0 ? "Add / fail" : "IV or IO"}
          onClick={() => setShowAccessMenu(true)}
          bg="#0a1a28" bd="#1e3a8a" fg="#93c5fd" big
        />
        <ActionBtn
          icon="🫁" label={airway ? "Airway ✓" : "Airway"}
          sub={airway || "OPA / iGel / ET"}
          onClick={() => setShowAirwayMenu(true)}
          bg="#0a2318" bd="#14532d" fg="#86efac" big
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
              <div style={{ background:"#1a1208", border:"1px solid #92400e", borderRadius:6, padding:"7px 9px", marginBottom:8 }}>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#fcd34d", fontWeight:700, marginBottom:2 }}>
                  ⚠ NO WEIGHT ENTERED
                </div>
                <div style={{ color:"var(--c-text3)", fontSize:10.5, lineHeight:1.4 }}>
                  Weight-based drugs are disabled. Scroll to top of app and enter weight in kg to enable dosing.
                </div>
              </div>
            )}

            {/* Phase tabs */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4, marginBottom:10, background:"var(--c-deep)", border:"1px solid var(--c-border-sub)", borderRadius:7, padding:3 }}>
              {[
                ["arrest", "Arrest", "#fca5a5", "#2a0808"],
                ["peri", "Peri-arrest", "#fdba74", "#1a1208"],
                ["postROSC", "Post-ROSC", "#4ade80", "#071a0e"],
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

                return (
                  <div key={drug.k} style={{
                    background: maxReached ? "#0a0f18"
                              : count > 0 ? "#0a1420"
                              : needsWeight ? "#0a0e1a"
                              : "var(--c-input)",
                    border: `1px solid ${maxReached ? "#5a1010"
                                         : count > 0 ? "#14532d"
                                         : needsWeight ? "#1a1208"
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
                            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11.5, fontWeight:700, color:"var(--c-text)" }}>
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
                          <div style={{ color:"var(--c-text-sub)", fontSize:10, marginTop:1, lineHeight:1.3 }}>
                            {drug.sub}
                          </div>
                          <div style={{ fontFamily:"'IBM Plex Mono',monospace", color: needsWeight ? "#fcd34d" : maxReached ? "#fca5a5" : "#60a5fa", fontSize:10.5, marginTop:2, fontWeight:600 }}>
                            {displayDose}
                          </div>
                          {/* Cumulative progress bar */}
                          {cumInfo.maxCumulative && count > 0 && wkg > 0 && (
                            <div style={{ marginTop:4, fontSize:9, color:"var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
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
                            <div style={{ marginTop:3, fontSize:9, color:"var(--c-text4)", fontFamily:"'IBM Plex Mono',monospace" }}>
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
              bg="#0d1f3a" bd="#1e3a8a" fg="#93c5fd"
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
              bg="#0d1f3a" bd="#1e3a8a" fg="#93c5fd"
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
            background:"transparent", border:"1px solid #1a2540", color:"var(--c-text-sub)",
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
              icon="🫁" label={a}
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

function NextActionCard({ epiWarn, epiDue, epiWindowOpen, epiSecs, cycleRemain, cycleEnded, rhythm, shockCount, epiCount, showAntiarrhythmic, amioCount, isPeds, wkg, patientType }) {
  // Determine the most urgent "next action"
  let msg, sub, color, bg, bd, icon;

  if (!rhythm) {
    msg = "Set Rhythm";
    sub = "Tap rhythm check to select ACLS branch";
    color = "#93c5fd"; bg = "#0d1f3a"; bd = "#1e3a8a"; icon = "🔍";
  } else if (cycleEnded) {
    msg = "Rhythm Check NOW";
    sub = "2-min CPR cycle complete";
    color = "#f87171"; bg = "#2a0808"; bd = "#ef4444"; icon = "⚠";
  } else if (epiDue) {
    msg = "Epi Overdue";
    sub = isPeds && wkg > 0
      ? `${fmtArrestTime(epiSecs)} elapsed · give ${Math.min(0.01 * wkg, 1).toFixed(2)} mg IV/IO`
      : `${fmtArrestTime(epiSecs)} elapsed · give 1 mg IV/IO`;
    color = "#f87171"; bg = "#2a0808"; bd = "#ef4444"; icon = "💉";
  } else if (epiCount === 0 && rhythm === "PEA/Asystole") {
    msg = isPeds && wkg > 0
      ? `Give Epi ${Math.min(0.01 * wkg, 1).toFixed(2)} mg`
      : "Give Epi 1 mg IV/IO";
    sub = "PEA/Asystole — give epi ASAP";
    color = "#fdba74"; bg = "#1a1208"; bd = "#f97316"; icon = "💉";
  } else if (showAntiarrhythmic && amioCount === 0) {
    msg = "Antiarrhythmic Indicated";
    sub = isPeds && wkg > 0
      ? `Amiodarone ${Math.min(5 * wkg, 300).toFixed(0)} mg (5 mg/kg) IVP`
      : "Amiodarone 300 mg IVP after 2nd shock";
    color = "#93c5fd"; bg = "#0d1f3a"; bd = "#1e3a8a"; icon = "💉";
  } else if (epiWarn) {
    msg = "Epi Window Open";
    sub = `3–5 min interval · ${fmtArrestTime(epiSecs)} elapsed`;
    color = "#fcd34d"; bg = "#1a1408"; bd = "#f59e0b"; icon = "💉";
  } else if (rhythm === "VF/pVT" && shockCount === 0) {
    msg = "Deliver Shock";
    sub = isPeds && wkg > 0 ? `VF/pVT — shock 2 J/kg (${Math.round(2 * wkg)} J)` : "VF/pVT — shock 200J biphasic";
    color = "#fca5a5"; bg = "#2a0808"; bd = "#7f1d1d"; icon = "⚡";
  } else {
    msg = "CPR in Progress";
    sub = `Next rhythm check in ${fmtArrestTime(cycleRemain)}`;
    color = "#4ade80"; bg = "#071a0e"; bd = "#14532d"; icon = "↻";
  }

  return (
    <div style={{
      background: bg, border:`2px solid ${bd}`, borderRadius:10,
      padding:"12px 14px", marginBottom:8,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:24 }}>{icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"var(--c-text-sub)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em" }}>
            Next Action
          </div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:15, color, fontWeight:700, marginTop:2, letterSpacing:"-0.01em" }}>
            {msg}
          </div>
          <div style={{ color:"var(--c-text-sub)", fontSize:11, marginTop:2 }}>
            {sub}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimerCard({ label, value, color, bg, pulse }) {
  return (
    <div style={{
      background: bg, border:`1px solid ${color}30`, borderRadius:8,
      padding:"9px 11px", textAlign:"center",
      animation: pulse ? "flash 1s ease-in-out infinite" : "none"
    }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"var(--c-text4)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>
        {label}
      </div>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, color, fontWeight:700, lineHeight:1, letterSpacing:"-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, sub, onClick, bg, bd, fg, big, disabled, flash }) {
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
        <div style={{ color:"var(--c-text-sub)", fontSize: 10, marginTop:1, lineHeight:1.2 }}>
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
          return (
            <div key={e.id} style={{
              display:"flex", alignItems:"center", gap:9,
              padding:"8px 11px", borderBottom:"1px solid #0e1525"
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
              <button
                onClick={() => { if (confirm("Remove this event?")) onDelete(e.id); }}
                style={{
                  background:"transparent", border:"1px solid var(--c-border)", color:"#4a5a7a",
                  borderRadius:4, padding:"3px 6px", cursor:"pointer", fontSize:10,
                  fontFamily:"'IBM Plex Mono',monospace", flexShrink:0
                }}
              >✕</button>
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

/* ═══════════════════════════════════════════════════════
   MED LOG — chronological timestamp view of all given drugs
═══════════════════════════════════════════════════════ */
function MedLog({ adminLog, findDrugLocation, onJump, onClearAll, onResetDrug, wkg }) {
  // Flatten { drugName: { times: [t1,t2] } } into individual dose events
  const events = [];
  Object.entries(adminLog).forEach(([drugName, data]) => {
    data.times.forEach((ts, i) => {
      const pta=(data.pta||[]).find(x=>x.ts===ts);
      const given=(data.given||[]).find(x=>x.ts===ts);
      events.push({ drug: drugName, ts, doseNum: i + 1, total: data.times.length, pta, given });
    });
  });
  events.sort((a, b) => b.ts - a.ts); // newest first

  const fmtTimeLog = ts => fmtTime(ts, false);

  const copyLog = () => {
    const text = events.slice().reverse().map(e =>
      `${fmtTimeLog(e.ts)}  ${e.drug}  (dose ${e.doseNum}/${e.total}${e.pta?`, PTA ${e.pta.amount}`:e.given?`, provider ${e.given.amount}`:""})`
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
          <button onClick={() => { if (confirm("Clear all medication log entries?")) onClearAll(); }} style={{ padding:"5px 10px", background:"transparent", border:"1px solid #7a5a30", color:"#c08040", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>Clear All</button>
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
                {e.pta ? ` · PTA ${e.pta.amount}` : ""}
                {e.given ? ` · Provider ${e.given.amount}` : ""}
              </div>
            </div>
            <div style={{
              background:e.pta?"#2a1608":"#1a1208", border:e.pta?"1px solid #facc1555":"1px solid #f9731640",
              color:e.pta?"#facc15":"#fb923c", borderRadius:5, padding:"3px 7px",
              fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
              flexShrink:0
            }}>
              {e.pta?"PTA":`#${e.doseNum}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ePCR GENERATOR — patient demographics + auto-filled
   medication log + vitals trends → copyable narrative
═══════════════════════════════════════════════════════ */
function Epcr({ patient, setPatient, adminLog, vitalsEntries, wkg, wlb, mode, findDrugLocation }) {
  const [copied, setCopied] = useState(false);
  const upd = (k, v) => setPatient({ ...patient, [k]: v });

  const narrative = useMemo(
    () => buildNarrative(patient, adminLog, vitalsEntries, wkg, wlb, mode),
    [patient, adminLog, vitalsEntries, wkg, wlb, mode]
  );

  const [showQR, setShowQR] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {}
  };

  // ── Share sheet (iOS AirDrop / Android share / desktop fallback) ──
  const shareReport = async () => {
    const title = `ePCR — Run ${patient.run || "Unknown"}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: narrative });
        setShareStatus("✓ Shared");
        setTimeout(() => setShareStatus(""), 1800);
      } catch (e) {
        if (e.name !== "AbortError") {
          setShareStatus("Share unavailable");
          setTimeout(() => setShareStatus(""), 1800);
        }
      }
    } else {
      // Desktop fallback: download as .txt
      const blob = new Blob([narrative], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ePCR_${(patient.run || "run").replace(/[^a-z0-9-]/gi,"_")}_${new Date().toISOString().slice(0,10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShareStatus("✓ Downloaded");
      setTimeout(() => setShareStatus(""), 1800);
    }
  };

  // ── Email via mailto: ──
  const emailReport = () => {
    const subj = `ePCR — Run ${patient.run || "Unknown"} · ${patient.unit || ""}`.trim();
    // mailto: URLs have a ~2000 char limit in many clients; truncate safely
    const MAX = 1800;
    const body = narrative.length > MAX
      ? narrative.slice(0, MAX) + "\n\n[...truncated — see MedicAI app for full report]"
      : narrative;
    const mailto = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  const doseCount = Object.values(adminLog).reduce((s, l) => s + l.times.length, 0);

  return (
    <div style={{ paddingBottom:20 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700, color:"var(--c-text)" }}>ePCR Narrative</div>
          <div style={{ color:"var(--c-text4)", fontSize:10, marginTop:1 }}>
            {doseCount} med{doseCount!==1?"s":""} · {vitalsEntries.length} vital set{vitalsEntries.length!==1?"s":""} · auto-filled
          </div>
        </div>
      </div>

      {/* Form sections */}
      <EpcrSect title="INCIDENT" color="#c084fc">
        <EpcrRow>
          <EpcrFld label="Run #" v={patient.run} onC={v => upd("run", v)} ph="2026-0042" />
          <EpcrFld label="Unit" v={patient.unit} onC={v => upd("unit", v)} ph="Medic 12" />
        </EpcrRow>
        <EpcrFld label="Provider / Cert #" v={patient.provider} onC={v => upd("provider", v)} />
      </EpcrSect>

      <EpcrSect title="PATIENT" color="#60a5fa">
        <EpcrFld label="Name / Identifier" v={patient.name} onC={v => upd("name", v)} />
        <EpcrRow cols={3}>
          <EpcrFld label="Age" v={patient.age} onC={v => upd("age", v)} />
          <EpcrFld label="Sex" v={patient.sex} onC={v => upd("sex", v)} ph="M/F" />
          <EpcrFld label="Weight" v={wkg > 0 ? `${wkg} kg` : ""} onC={()=>{}} ro />
        </EpcrRow>
        <EpcrRow>
          <EpcrFld label="Allergies" v={patient.allergies} onC={v => upd("allergies", v)} ph="NKDA" />
          <EpcrFld label="Home Meds" v={patient.meds} onC={v => upd("meds", v)} ph="None" />
        </EpcrRow>
      </EpcrSect>

      <EpcrSect title="PRESENTATION" color="#fb923c">
        <EpcrFld label="Chief Complaint" v={patient.cc} onC={v => upd("cc", v)} ph="e.g. chest pain, difficulty breathing" />
        <EpcrFld label="HPI / Onset" v={patient.hpi} onC={v => upd("hpi", v)} area rows={3}
          ph="When / how / progression / associated symptoms" />
        <EpcrFld label="PMH / SAMPLE" v={patient.pmh} onC={v => upd("pmh", v)} area rows={2} />
      </EpcrSect>

      <EpcrSect title="TREATMENT & OUTCOME" color="#4ade80">
        <EpcrFld label="Interventions (beyond meds/vitals)" v={patient.interventions} onC={v => upd("interventions", v)} area rows={2}
          ph="O₂, IV, monitor, CPR, airway mgmt…" />
        <EpcrFld label="Response to Treatment" v={patient.response} onC={v => upd("response", v)} area rows={2} />
        <EpcrFld label="Disposition" v={patient.dispo} onC={v => upd("dispo", v)}
          ph="Transported to X · pt stable · c/o improved" />
      </EpcrSect>

      {/* Auto-filled preview of what's included */}
      <div style={{ background:"var(--c-deep)", border:"1px solid var(--c-border-sub)", borderRadius:7, padding:"8px 10px", marginBottom:10 }}>
        <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5, fontFamily:"'IBM Plex Mono',monospace" }}>Auto-included from other screens</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>
          <span style={{ background: doseCount>0 ? "#1a1208" : "var(--c-surface)", color: doseCount>0 ? "#fb923c" : "#3a4f70", border:`1px solid ${doseCount>0?"#f9731640":"var(--c-border)"}`, borderRadius:4, padding:"2px 7px" }}>
            💊 {doseCount} medication{doseCount!==1?"s":""}
          </span>
          <span style={{ background: vitalsEntries.length>0 ? "#071a0e" : "var(--c-surface)", color: vitalsEntries.length>0 ? "#4ade80" : "#3a4f70", border:`1px solid ${vitalsEntries.length>0?"#14532d":"var(--c-border)"}`, borderRadius:4, padding:"2px 7px" }}>
            📋 {vitalsEntries.length} vital set{vitalsEntries.length!==1?"s":""}
          </span>
          <span style={{ background: wkg>0 ? "#0d1f3a" : "var(--c-surface)", color: wkg>0 ? "#93c5fd" : "#3a4f70", border:`1px solid ${wkg>0?"#1e3a8a":"var(--c-border)"}`, borderRadius:4, padding:"2px 7px" }}>
            ⚖ {wkg>0 ? `${wkg} kg` : "no weight"}
          </span>
        </div>
      </div>

      {/* Transfer & Export panel */}
      <div style={{ background:"var(--c-surface)", border:"1px solid #1e3a8a55", borderRadius:8, padding:"10px 11px", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
          <span style={{ fontSize:12 }}>📡</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#93c5fd", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
            Transfer to ePCR Software
          </span>
        </div>

        {/* 2×2 action grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <TransferBtn
            icon="📤"
            label="Share"
            sub="AirDrop · Files · Messages"
            onClick={shareReport}
            bg="#0d1f3a" bd="#1e3a8a" fg="#93c5fd"
          />
          <TransferBtn
            icon="📧"
            label="Email"
            sub="Open in mail app"
            onClick={emailReport}
            bg="#1a0e28" bd="#4c1d7c" fg="#c084fc"
          />
          <TransferBtn
            icon="▦"
            label={showQR ? "Hide QR" : "Show QR"}
            sub="Scan from 2nd device"
            onClick={() => setShowQR(v => !v)}
            bg="#0a2318" bd="#14532d" fg="#86efac"
          />
          <TransferBtn
            icon={copied ? "✓" : "📋"}
            label={copied ? "Copied" : "Copy"}
            sub="To clipboard"
            onClick={copyReport}
            bg={copied ? "#071a0e" : "#1a1208"}
            bd={copied ? "#14532d" : "#7c2d12"}
            fg={copied ? "#4ade80" : "#fb923c"}
          />
        </div>

        {shareStatus && (
          <div style={{ marginTop:6, textAlign:"center", color:"#4ade80", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
            {shareStatus}
          </div>
        )}

        {/* QR code panel */}
        {showQR && (
          <div style={{ marginTop:10, background:"var(--c-deep)", border:"1px solid #14532d", borderRadius:7, padding:"12px 10px" }}>
            <div style={{ textAlign:"center", marginBottom:8 }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#86efac", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>
                Scan to Transfer
              </div>
              <div style={{ color:"#4a5a7a", fontSize:10, lineHeight:1.4 }}>
                Open camera on 2nd device — scan to open pre-filled email<br/>ready to send to ePCR-linked address
              </div>
            </div>
            <QRPanel narrative={narrative} patient={patient} />
          </div>
        )}

        {/* Honest capability note */}
        <div style={{ marginTop:8, padding:"6px 9px", background:"var(--c-deep)", border:"1px solid var(--c-border-sub)", borderRadius:5 }}>
          <div style={{ color:"var(--c-text4)", fontSize:9.5, lineHeight:1.5, fontFamily:"'DM Sans',sans-serif" }}>
            <span style={{ color:"#facc15", fontWeight:700 }}>ℹ</span>{" "}
            ESO doesn't accept direct Bluetooth/USB push from 3rd-party web apps.
            Use <span style={{ color:"#93c5fd" }}>Share</span> → AirDrop to your ESO-logged device,
            then paste into the narrative field. Or <span style={{ color:"#c084fc" }}>Email</span> to your agency inbox.
          </div>
        </div>
      </div>

      {/* Generated narrative preview */}
      <div style={{ background:"var(--c-input)", border:"1px solid var(--c-border-sub)", borderRadius:8, overflow:"hidden" }}>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"8px 10px", borderBottom:"1px solid var(--c-border-sub)"
        }}>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#c084fc", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
            Generated Narrative · Preview
          </span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4a5a7a" }}>
            {narrative.length} chars
          </span>
        </div>
        <pre style={{
          margin:0, padding:"10px 11px",
          fontFamily:"'IBM Plex Mono',monospace", fontSize:10.5,
          color:"var(--c-text3)", lineHeight:1.55,
          whiteSpace:"pre-wrap", wordBreak:"break-word",
          maxHeight:400, overflowY:"auto"
        }}>{narrative}</pre>
      </div>
    </div>
  );
}

/* ── Transfer button (reusable) ── */
function TransferBtn({ icon, label, sub, onClick, bg, bd, fg }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: bg, border: `1px solid ${bd}`, borderRadius: 7,
        padding: "10px 10px", cursor: "pointer", textAlign: "left",
        display: "flex", alignItems: "center", gap: 10,
        transition: "all 0.12s"
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, fontWeight: 700, color: fg, letterSpacing: "0.02em" }}>
          {label}
        </div>
        <div style={{ color: "var(--c-text4)", fontSize: 9.5, marginTop: 1, lineHeight: 1.2 }}>
          {sub}
        </div>
      </div>
    </button>
  );
}

/* ── QR panel: encodes mailto: link so scanning opens email app pre-filled ── */
function QRPanel({ narrative, patient }) {
  const [imgFailed, setImgFailed] = useState(false);
  const subj = `ePCR — Run ${patient.run || "Unknown"}`;
  const MAX_QR = 900;
  const body = narrative.length > MAX_QR
    ? narrative.slice(0, MAX_QR) + "\n\n[truncated — see MedicAI for full report]"
    : narrative;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  const qrSize = 240;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(mailtoUrl)}&margin=10&ecc=M&bgcolor=ffffff&color=000000`;
  const truncated = narrative.length > MAX_QR;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{
        background: "#fff", padding: 8, borderRadius: 8,
        boxShadow: "0 0 0 1px #1e3a8a inset"
      }}>
        {imgFailed
          ? <div style={{ color: "#000", fontSize: 11, textAlign: "center", padding: "40px 20px", fontFamily: "'IBM Plex Mono',monospace", width: qrSize }}>
              QR unavailable offline.<br/>Use Share or Email instead.
            </div>
          : <img
              src={qrUrl}
              alt="QR code to transfer ePCR via email"
              width={qrSize}
              height={qrSize}
              style={{ display: "block", width: qrSize, height: qrSize }}
              onError={() => setImgFailed(true)}
            />
        }
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#86efac", fontWeight: 700 }}>
          Opens email · pre-filled with report
        </div>
        {truncated && (
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#facc15", marginTop: 3 }}>
            ⚠ narrative truncated to fit QR — full version via Share/Email
          </div>
        )}
        <div style={{ fontSize: 9, color: "#4a5a7a", marginTop: 3 }}>
          Requires internet to generate QR image
        </div>
      </div>
    </div>
  );
}

function EpcrSect({ title, color, children }) {
  return (
    <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border-sub)", borderLeft:`3px solid ${color}`, borderRadius:8, padding:"10px 11px", marginBottom:8 }}>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, letterSpacing:"0.1em", color, marginBottom:7 }}>{title}</div>
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>{children}</div>
    </div>
  );
}
function EpcrRow({ cols=2, children }) { return <div style={{ display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:7 }}>{children}</div>; }
function EpcrFld({ label, v, onC, ph, ro, area, rows }) {
  const shared = {
    background:"var(--c-input)", border:"1px solid var(--c-border-sub)", borderRadius:5,
    color: ro ? "var(--c-text4)" : "var(--c-text2)", fontSize:12, fontFamily:"'DM Sans',sans-serif",
    outline:"none", padding:"6px 9px", width:"100%", boxSizing:"border-box"
  };
  return (
    <div>
      <div style={{ color:"var(--c-text4)", fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em",
        marginBottom:3, fontFamily:"'IBM Plex Mono',monospace" }}>{label}</div>
      {area
        ? <textarea value={v || ""} onChange={e => onC(e.target.value)} placeholder={ph}
            rows={rows || 2} style={{ ...shared, resize:"vertical", lineHeight:1.4 }} />
        : <input type="text" value={v || ""} onChange={e => onC(e.target.value)} placeholder={ph} readOnly={ro} style={shared} />
      }
    </div>
  );
}

function buildNarrative(p, adminLog, vitalsEntries, wkg, wlb, mode) {
  const line = "─".repeat(46);
  const now = new Date().toLocaleString('en-US', {
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  });
  const wt = wkg > 0 ? `${wkg} kg (${wlb} lbs)` : "—";

  // Flatten med log chronologically (oldest first for narrative)
  const medEvents = [];
  Object.entries(adminLog).forEach(([drugName, data]) => {
    data.times.forEach((ts, i) => {
      const pta=(data.pta||[]).find(x=>x.ts===ts);
      const given=(data.given||[]).find(x=>x.ts===ts);
      medEvents.push({ drug: drugName, ts, doseNum: i + 1, total: data.times.length, pta, given });
    });
  });
  medEvents.sort((a, b) => a.ts - b.ts);

  const fmtT = ts => {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 5);
  };

  const medsBlock = medEvents.length === 0
    ? "  No medications administered."
    : medEvents.map(e =>
        `  ${fmtT(e.ts)}  ${e.drug.padEnd(28).slice(0,28)}  (dose ${e.doseNum}/${e.total}${e.pta?`, PTA amount ${e.pta.amount}`:e.given?`, provider amount ${e.given.amount}`:""})`
      ).join("\n");

  // Vitals trend block
  const vitalsBlock = vitalsEntries.length === 0
    ? "  No vitals recorded."
    : vitalsEntries.map(v => {
        const t = fmtT(v.ts);
        const parts = [];
        if (v.sbp && v.dbp) parts.push(`BP ${v.sbp}/${v.dbp}`);
        else if (v.sbp) parts.push(`SBP ${v.sbp}`);
        if (v.hr) parts.push(`HR ${v.hr}`);
        if (v.rr) parts.push(`RR ${v.rr}`);
        if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
        if (v.etco2) parts.push(`EtCO₂ ${v.etco2}`);
        if (v.bgl) parts.push(`BGL ${v.bgl}`);
        if (v.temp) parts.push(`T ${v.temp}°F`);
        if (v.pain) parts.push(`Pain ${v.pain}/10`);
        if (v.gcsTotal) parts.push(`GCS ${v.gcsTotal}`);
        if (v.skin) parts.push(v.skin);
        let line = `  ${t}  ${parts.join(" · ")}`;
        if (v.notes) line += `\n           └─ ${v.notes}`;
        return line;
      }).join("\n");

  return `PATIENT CARE REPORT — NARRATIVE
${line}
Generated: ${now}
Run #: ${p.run || "—"}       Unit: ${p.unit || "—"}
Provider: ${p.provider || "—"}
Mode: ${mode === "adult" ? "ADULT" : "PEDIATRIC"}

PATIENT
  Name/ID:    ${p.name || "—"}
  Age/Sex:    ${p.age || "—"} / ${p.sex || "—"}
  Weight:     ${wt}
  Allergies:  ${p.allergies || "NKDA"}
  Home Meds:  ${p.meds || "None reported"}

CHIEF COMPLAINT
  ${p.cc || "—"}

HPI
  ${p.hpi || "—"}

PMH / SAMPLE
  ${p.pmh || "—"}

VITALS (chronological)
${vitalsBlock}

MEDICATIONS ADMINISTERED
${medsBlock}

INTERVENTIONS
  ${p.interventions || "—"}

RESPONSE TO TREATMENT
  ${p.response || "—"}

DISPOSITION
  ${p.dispo || "—"}

${line}
Reference: GA SOP-2024 · NASEMSO v3 · AHA/AAP 2025 PALS
Pre-checks and re-dose reassessments verified at time of
administration via MedicAI clinical decision support.

Provider signature: ${p.provider || "_________________"}
${line}`;
}

/* ═══ MAIN APP ═══ */
function HomeScreen({ isDarkMode, onLogin, onGuest, onToggleTheme }) {
  const bg = isDarkMode ? "#060a15" : "#f5f3f0";
  const panel = isDarkMode ? "var(--c-surface)" : "#ffffff";
  const text = isDarkMode ? "var(--c-text)" : "#141414";
  const muted = isDarkMode ? "#8aa0c2" : "#5f6673";
  const border = isDarkMode ? "var(--c-border)" : "#ddd7cf";
  const statBg = isDarkMode ? "#10192b" : "#eef6f7";

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${bg}}button,input{font:inherit}`}</style>
      <main style={{minHeight:"100vh",background:bg,color:text,fontFamily:"'DM Sans',sans-serif",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:480,minHeight:"100vh",padding:"18px 16px 28px",display:"flex",flexDirection:"column"}}>
          <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22}}>
            <div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:700,letterSpacing:0}}>MedicAI</div>
              <div style={{fontSize:11,color:muted,marginTop:2}}>Field medication support</div>
            </div>
            <button onClick={onToggleTheme} title="Switch theme" style={{width:38,height:38,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,cursor:"pointer",fontWeight:800}}>
              {isDarkMode ? "L" : "D"}
            </button>
          </header>

          <section style={{position:"relative",overflow:"hidden",borderRadius:8,border:`1px solid ${border}`,background:panel,minHeight:286,display:"flex",alignItems:"flex-end",boxShadow:isDarkMode?"0 24px 70px rgba(0,0,0,.28)":"0 24px 70px rgba(40,37,32,.12)"}}>
            <img src={heroImage} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:isDarkMode?0.36:0.42,filter:isDarkMode?"saturate(.9) contrast(1.08)":"saturate(.8)"}} />
            <div style={{position:"absolute",inset:0,background:isDarkMode?"linear-gradient(180deg, rgba(6,10,21,.18), rgba(6,10,21,.94))":"linear-gradient(180deg, rgba(245,243,240,.16), rgba(255,255,255,.96))"}} />
            <div style={{position:"relative",padding:"28px 22px 24px",textAlign:"left"}}>
              <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.4,color:"#14b8a6",fontFamily:"'IBM Plex Mono',monospace",marginBottom:10}}>Ready for shift</div>
              <h1 style={{fontSize:42,lineHeight:1.02,letterSpacing:0,fontWeight:800,color:text,margin:"0 0 12px"}}>Fast checks before every dose.</h1>
              <p style={{fontSize:15,lineHeight:1.55,color:muted,maxWidth:360}}>Start a call, calculate adult or pediatric doses, track vitals, and build a clean medication log from one focused screen.</p>
            </div>
          </section>

          <section style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,margin:"14px 0 18px"}}>
            {[["Adult","Protocols"],["Peds","Weight based"],["ePCR","Narrative"]].map(([top,bottom])=>(
              <div key={top} style={{background:statBg,border:`1px solid ${border}`,borderRadius:8,padding:"12px 8px",textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:800,color:text}}>{top}</div>
                <div style={{fontSize:10,color:muted,marginTop:3}}>{bottom}</div>
              </div>
            ))}
          </section>

          <div style={{display:"grid",gap:10,marginTop:"auto"}}>
            <button onClick={onLogin} style={{height:48,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer",boxShadow:"0 14px 35px rgba(20,184,166,.22)"}}>Log in</button>
            <button onClick={onGuest} style={{height:46,borderRadius:8,border:`1px solid ${border}`,background:panel,color:text,fontWeight:700,cursor:"pointer"}}>Continue as guest</button>
          </div>
        </div>
      </main>
    </>
  );
}

function LoginScreen({ isDarkMode, values, onChange, onSubmit, onBack, onGuest, error, onToggleTheme }) {
  const bg = isDarkMode ? "#060a15" : "#f5f3f0";
  const panel = isDarkMode ? "var(--c-surface)" : "#ffffff";
  const inputBg = isDarkMode ? "var(--c-input)" : "#f8fafc";
  const text = isDarkMode ? "var(--c-text)" : "#141414";
  const muted = isDarkMode ? "#8aa0c2" : "#5f6673";
  const border = isDarkMode ? "var(--c-border)" : "#ddd7cf";

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
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:1.2,color:"#14b8a6",marginBottom:10}}>MedicAI access</div>
            <h1 style={{fontSize:36,lineHeight:1.08,letterSpacing:0,fontWeight:800,color:text,margin:"0 0 10px"}}>Log in for your shift.</h1>
            <p style={{fontSize:15,lineHeight:1.55,color:muted}}>Use any email and password for now. This sets the provider name locally so the call log feels connected.</p>
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
            <button type="submit" style={{height:48,borderRadius:8,border:"1px solid #0f766e",background:"#14b8a6",color:"#042f2e",fontWeight:800,cursor:"pointer",marginTop:2}}>Enter MedicAI</button>
          </form>

          <button onClick={onGuest} style={{height:46,borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:muted,fontWeight:700,cursor:"pointer",marginTop:12}}>Continue as guest</button>
        </div>
      </main>
    </>
  );
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
    return localStorage.getItem("medic-ai-user") ? "app" : "home";
  });
  const[authUser,setAuthUser]=useState(()=>{
    if(typeof window==="undefined") return null;
    const saved=localStorage.getItem("medic-ai-user");
    try { return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });
  const[loginForm,setLoginForm]=useState({ email:"", password:"" });
  const[loginError,setLoginError]=useState("");

  const[mode,setMode]=useState("adult");
  const[aSys,setASys]=useState("cardiac");
  const[pSys,setPSys]=useState("cardiac");
  const[wkg,setWkg]=useState(0);
  const[wlb,setWlb]=useState(0);
  const[search,setSearch]=useState("");
  const[scope,setScope]=useState("all");
  const[adminLog,setAdminLog]=useState({});
  const[initChecks,setInitChecks]=useState({});
  const[reChecks,setReChecks]=useState({});
  const[tick,setTick]=useState(0);
  const[screen,setScreen]=useState("drugs");
  const[vitalsEntries,setVitalsEntries]=useState([]);
  const[highlightDrug,setHighlightDrug]=useState(null);
  const[arrestState,setArrestState]=useState({
    startTs:null, endTs:null, endReason:null,
    rhythm:null, cycleStartTs:null, lastEpiTs:null,
    events:[], airway:null, hts:{}, access:[],
    patientType:null  // "adult" | "infant" | "child"
  });
  const[patient,setPatient]=useState({
    run:"",unit:"",provider:"",
    name:"",age:"",sex:"",
    allergies:"",meds:"",
    cc:"",hpi:"",pmh:"",
    interventions:"",response:"",dispo:""
  });

  const enterApp=useCallback((user)=>{
    setAuthUser(user);
    if(typeof window!=="undefined") localStorage.setItem("medic-ai-user", JSON.stringify(user));
    setPatient(p=>p.provider ? p : { ...p, provider:user.name });
    setAppView("app");
  },[]);

  const handleLoginChange=useCallback((e)=>{
    const { name, value } = e.target;
    setLoginForm(p=>({ ...p, [name]:value }));
    if(loginError) setLoginError("");
  },[loginError]);

  const handleLoginSubmit=useCallback((e)=>{
    e.preventDefault();
    const email=loginForm.email.trim();
    const password=loginForm.password.trim();
    if(!email || !password){
      setLoginError("Enter an email and password to continue.");
      return;
    }
    const label=email.split("@")[0].replace(/[._-]+/g," ").trim() || "Provider";
    const name=label.replace(/\b\w/g,c=>c.toUpperCase());
    enterApp({ name, email, role:"Provider" });
  },[enterApp,loginForm.email,loginForm.password]);

  const handleGuest=useCallback(()=>{
    enterApp({ name:"Guest Provider", email:"guest@medic.ai", role:"Guest" });
  },[enterApp]);

  const handleLogout=useCallback(()=>{
    if(typeof window!=="undefined") localStorage.removeItem("medic-ai-user");
    setAuthUser(null);
    setLoginForm({ email:"", password:"" });
    setAppView("home");
  },[]);

  useEffect(()=>{
    const theme=isDarkMode?"dark":"light";
    document.documentElement.setAttribute("data-theme",theme);
    localStorage.setItem("medic-ai-theme",theme);
  },[isDarkMode]);

  const findDrugLocation=useCallback((name)=>DRUG_LOCATION_MAP.get(name)||null,[]);

  const handlePillClick=useCallback((name)=>{
    const loc=findDrugLocation(name);
    if(!loc) return;
    setScreen("drugs");
    setMode(loc.mode);
    if(loc.mode==="adult") setASys(loc.sys); else setPSys(loc.sys);
    setHighlightDrug(name);
    setTimeout(()=>setHighlightDrug(null), 3000);
  },[findDrugLocation]);

  useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(id);},[]);
  useEffect(()=>setSearch(""),[mode,aSys,pSys]);

  const handleGive=useCallback((name,doseInfo=null)=>{
    const ts=Date.now();
    setAdminLog(p=>{const e=p[name]||{times:[]};return{...p,[name]:{...e,times:[...e.times,ts],given:[...(e.given||[]),...(doseInfo?[{ts,...doseInfo}]:[])]}};});
  },[]);
  const handleReset=useCallback(name=>{setAdminLog(p=>{const n={...p};delete n[name];return n;});setInitChecks(p=>{const n={...p};delete n[name];return n;});setReChecks(p=>{const n={...p};delete n[name];return n;});},[]);
  const handleInitUpdate=useCallback((dn,id,v)=>setInitChecks(p=>({...p,[dn]:{...(p[dn]||{}),[id]:v}})),[]);
  const handleReUpdate=useCallback((dn,id,v)=>setReChecks(p=>({...p,[dn]:{...(p[dn]||{}),[id]:v}})),[]);
  const handleClearRe=useCallback(dn=>setReChecks(p=>{const n={...p};delete n[dn];return n;}),[]);

  const systems=mode==="adult"?A_SYS:P_SYS;
  const activeSys=mode==="adult"?aSys:pSys;
  const setSys=mode==="adult"?setASys:setPSys;
  const bank=mode==="adult"?ADULT:PEDS;
  const sysInfo=systems.find(s=>s.k===activeSys)||systems[0];
  const color=isDarkMode?sysInfo.c:sysInfo.lc;
  const activeCount=Object.keys(adminLog).length;

  const colors=useMemo(()=>({
    bg:isDarkMode?"#060a15":"#f5f3f0",
    surface:isDarkMode?"var(--c-surface)":"#ede9e4",
    surfaceAlt:isDarkMode?"var(--c-nav)":"#f5f3f0",
    border:isDarkMode?"var(--c-border)":"#d4cfc8",
    text:isDarkMode?"var(--c-text)":"#2d2d2d",
    textSecondary:isDarkMode?"var(--c-text4)":"#5a5a5a",
    textTertiary:isDarkMode?"var(--c-text-ghost)":"#7a7a7a",
  }),[isDarkMode]);

  const list=useMemo(()=>{
    const raw=bank[activeSys]||[];
    const q=search.trim().toLowerCase();
    const scopeRank={EMT:1,AEMT:2,Medic:3};
    return raw.filter(d=>(!q||d.name.toLowerCase().includes(q)||(d.sub||"").toLowerCase().includes(q))&&(scope==="all"||scopeRank[d.scope]<=scopeRank[scope]));
  },[bank,activeSys,search,scope]);

  const numInp=useCallback((v,fn,ph,max,step)=>({type:"number",value:v||"",onChange:e=>fn(parseFloat(e.target.value)||0),placeholder:ph,min:0,max,step,style:{width:58,padding:"5px 7px",background:colors.surface,border:`1px solid ${colors.border}`,borderRadius:6,color:colors.text,fontSize:13,fontFamily:"'IBM Plex Mono',monospace",textAlign:"right",outline:"none"}}),[colors]);
  const activeDrugs=useMemo(()=>Object.entries(adminLog).map(([name,log])=>({name,count:log.times.length,lastAt:log.times[log.times.length-1]})),[adminLog]);
  const totalDoses=useMemo(()=>activeDrugs.reduce((sum,d)=>sum+d.count,0),[activeDrugs]);

  if(appView==="home"){
    return <HomeScreen isDarkMode={isDarkMode} onLogin={()=>setAppView("login")} onGuest={handleGuest} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  if(appView==="login"){
    return <LoginScreen isDarkMode={isDarkMode} values={loginForm} onChange={handleLoginChange} onSubmit={handleLoginSubmit} onBack={()=>setAppView("home")} onGuest={handleGuest} error={loginError} onToggleTheme={()=>setIsDarkMode(v=>!v)} />;
  }

  return(
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}input[type=number]{-moz-appearance:textfield}::-webkit-scrollbar{width:0;height:0}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}@keyframes flash{0%,100%{background:#2a0808}50%{background:#7f1d1d}}:root{--c-surface:#0d1120;--c-surface-open:#141c2e;--c-nav:#0a0f1c;--c-input:#090e1c;--c-deep:#080c18;--c-deep2:#0d1525;--c-border:#1a2338;--c-border-sub:#141e30;--c-text-sub:#8a9dc0;--c-text:#e2e8f0;--c-text2:#c0cfe8;--c-text3:#a0b4d0;--c-text4:#6b82a8;--c-text5:#7a90b0;--c-text-ghost:#1a2638}[data-theme="light"]{--c-surface:#e8eef8;--c-surface-open:#dce5f5;--c-nav:#dde5f0;--c-input:#edf2fa;--c-deep:#d8e4f5;--c-deep2:#e2eaf8;--c-border:#b8c8dc;--c-border-sub:#c8d4e8;--c-text-sub:#3a5070;--c-text:#1a2338;--c-text2:#2a4060;--c-text3:#3a5070;--c-text4:#4a5e7a;--c-text5:#3a5070;--c-text-ghost:#9ab0c8}`}</style>

      <div style={{minHeight:"100vh",background:isDarkMode?"#060a15":"#f5f3f0",fontFamily:"'DM Sans',sans-serif",maxWidth:480,margin:"0 auto",padding:"14px 11px 60px",transition:"background-color 0.3s"}}>

        {/* HEADER */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:19,fontWeight:700,color:isDarkMode?"var(--c-text)":"#0f0f0f",letterSpacing:"-0.02em"}}>MedicAI</span>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",background:isDarkMode?"#0d1d3a":"#e8ddf0",color:isDarkMode?"#60a5fa":"#6b1fb4",border:isDarkMode?"1px solid #1a3060":"1px solid #c9a8d8",borderRadius:4,padding:"2px 7px"}}>Drug Calc</span>
            </div>
            <div style={{color:isDarkMode?"var(--c-text-ghost)":"#5a5a5a",fontSize:9,marginTop:2,letterSpacing:"0.03em",fontFamily:"'IBM Plex Mono',monospace"}}>GA SOP-2024 · NASEMSO v3 · AHA/AAP 2025 PALS</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
            <button 
              onClick={()=>setIsDarkMode(!isDarkMode)}
              style={{
                width:36,
                height:36,
                borderRadius:8,
                border:isDarkMode?"1px solid var(--c-border)":"1px solid #d4cfc8",
                background:isDarkMode?"var(--c-surface)":"#ede9e4",
                color:isDarkMode?"#f97316":"#2d2d2d",
                cursor:"pointer",
                fontSize:16,
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                transition:"all 0.3s",
              }}
              title={isDarkMode?"Switch to light mode":"Switch to dark mode"}
            >
              {isDarkMode?"☀️":"🌙"}
            </button>
            <button
              onClick={handleLogout}
              style={{
                border:isDarkMode?"1px solid var(--c-border)":"1px solid #d4cfc8",
                background:isDarkMode?"var(--c-surface)":"#ede9e4",
                color:isDarkMode?"#8aa0c2":"#5a5a5a",
                borderRadius:6,
                padding:"4px 8px",
                fontSize:9,
                fontWeight:700,
                cursor:"pointer",
                fontFamily:"'IBM Plex Mono',monospace",
              }}
              title={authUser ? `Signed in as ${authUser.name}` : "Back to home"}
            >
              Home
            </button>
            <div style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>
              {authUser&&<div style={{color:isDarkMode?"#14b8a6":"#0f766e",fontSize:10,maxWidth:88,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{authUser.name}</div>}
              <div style={{color:isDarkMode?"var(--c-text-ghost)":"#5a5a5a",fontSize:10}}>{list.length} drugs</div>
              {wkg>0&&<div style={{color:"#4ade80",fontSize:11,marginTop:1}}>{wkg} kg</div>}
              {activeCount>0&&<div style={{color:"#f97316",fontSize:10,marginTop:1}}>⏱ {activeCount} active</div>}
            </div>
          </div>
        </div>

        {/* ACTIVE SUMMARY */}
        {activeDrugs.length>0&&(
          <div style={{background:isDarkMode?"#120e05":"#7c2d12",border:isDarkMode?"1px solid #f9731630":"1px solid #431407",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <span style={{color:isDarkMode?"#f97316":"#ffedd5",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>⏱ Active Drugs This Call</span>
              <button onClick={()=>{setAdminLog({});setInitChecks({});setReChecks({});setVitalsEntries([]);}} style={{marginLeft:"auto",background:isDarkMode?"transparent":"#431407",border:isDarkMode?"1px solid #7a5a30":"1px solid #fed7aa",color:isDarkMode?"#c08040":"#ffedd5",borderRadius:4,padding:"2px 7px",fontSize:9,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>Clear All</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {activeDrugs.map(d=>{const el=Math.floor((Date.now()-d.lastAt)/1000);return(
                <div key={d.name} onClick={()=>handlePillClick(d.name)} style={{background:isDarkMode?"#1a1208":"#431407",border:isDarkMode?"1px solid #f9731640":"1px solid #fdba74",borderRadius:5,padding:"3px 8px",display:"flex",alignItems:"center",gap:5,cursor:"pointer",transition:"border-color 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=isDarkMode?"#f97316":"#ffedd5"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=isDarkMode?"#f9731640":"#fdba74"}>
                  <span style={{color:isDarkMode?"var(--c-text)":"#ffffff",fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>{d.name}</span>
                  <span style={{color:isDarkMode?"#f97316":"#fdba74",fontSize:9,fontFamily:"'IBM Plex Mono',monospace"}}>×{d.count}</span>
                  <span style={{color:isDarkMode?"#a07040":"#ffedd5",fontSize:9}}>{fmtE(el)}</span>
                  <span style={{color:isDarkMode?"#f9731680":"#fed7aa",fontSize:9}}>↗</span>
                </div>
              );})}
            </div>
          </div>
        )}

        {/* PRIMARY NAV */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5, 1fr)",background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:3,gap:3,marginBottom:14}}>
          {[
            ["drugs","💊 Drugs",isDarkMode?"#0d1f3a":"#cce0ff",isDarkMode?"#93c5fd":"#1e4a8a"],
            ["vitals","📋 Vitals",isDarkMode?"#0a2318":"#c0e8d4",isDarkMode?"#86efac":"#0a5c2e"],
            ["arrest","❤ Arrest",isDarkMode?"#2a0808":"#ffd5d5",isDarkMode?"#fca5a5":"#7f1d1d"],
            ["medlog","⏱ Log",isDarkMode?"#1a0a18":"#ffe4cc",isDarkMode?"#fb923c":"#7c2d12"],
            ["epcr","📝 ePCR",isDarkMode?"#1a0e28":"#ead5ff",isDarkMode?"#c084fc":"#5b21b6"],
          ].map(([s,l,bg,fg])=>{
            let cnt=0;
            if(s==="vitals") cnt=vitalsEntries.length;
            else if(s==="medlog") cnt=totalDoses;
            else if(s==="arrest" && arrestState.startTs) cnt=arrestState.events.length;
            const isArrestActive = s==="arrest" && arrestState.startTs && !arrestState.endTs;
            return(
              <button key={s} onClick={()=>setScreen(s)} style={{padding:"9px 2px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:9.5,fontWeight:700,letterSpacing:"0.02em",background:screen===s?bg:isArrestActive?"#2a0808":"transparent",color:screen===s?fg:isArrestActive?"#fca5a5":"var(--c-text4)",transition:"all 0.15s",position:"relative"}}>
                {l}{cnt>0?` ${cnt}`:""}
                {isArrestActive && screen !== s && <span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:"#ef4444",animation:"pulse 1.5s ease-in-out infinite"}}/>}
              </button>
            );
          })}
        </div>

        {/* VITALS LOG SCREEN */}
        {screen==="vitals"&&(
          <VitalsLog initChecks={initChecks} reChecks={reChecks} entries={vitalsEntries} setEntries={setVitalsEntries} onClearCall={()=>{setAdminLog({});setInitChecks({});setReChecks({});setVitalsEntries([]); }}/>
        )}

        {/* ARREST SCREEN */}
        {screen==="arrest"&&(
          <ArrestTracker arrestState={arrestState} setArrestState={setArrestState} tick={tick} onLogMed={handleGive} wkg={wkg} setWkg={setWkg} setWlb={setWlb} mode={mode} isDarkMode={isDarkMode}/>
        )}

        {/* MED LOG SCREEN */}
        {screen==="medlog"&&(
          <MedLog adminLog={adminLog} findDrugLocation={findDrugLocation} onJump={handlePillClick} onClearAll={()=>{setAdminLog({});setInitChecks({});setReChecks({});}} onResetDrug={handleReset} wkg={wkg}/>
        )}

        {/* ePCR SCREEN */}
        {screen==="epcr"&&(
          <Epcr patient={patient} setPatient={setPatient} adminLog={adminLog} vitalsEntries={vitalsEntries} wkg={wkg} wlb={wlb} mode={mode} findDrugLocation={findDrugLocation}/>
        )}

        {/* DRUG CALC SCREEN */}
        {screen==="drugs"&&(<>

        {/* MODE TOGGLE */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--c-nav)",border:"1px solid var(--c-border-sub)",borderRadius:10,padding:3,gap:3,marginBottom:11}}>
          {[["adult","🧑 ADULT",isDarkMode?"#0d1f3a":"#cce0ff",isDarkMode?"#93c5fd":"#1e4a8a"],["peds","👶 PEDS",isDarkMode?"#0a2318":"#c0e8d4",isDarkMode?"#86efac":"#0a5c2e"]].map(([m,l,bg,fg])=>(
            <button key={m} onClick={()=>setMode(m)} style={{padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:11.5,fontWeight:700,letterSpacing:"0.08em",background:mode===m?bg:"transparent",color:mode===m?fg:"var(--c-text4)",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>

        {/* WEIGHT */}
        <div style={{background:"var(--c-input)",border:"1px solid var(--c-border-sub)",borderRadius:8,padding:"9px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{color:"var(--c-text4)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:"'IBM Plex Mono',monospace"}}>WEIGHT</span>
          <div style={{display:"flex",alignItems:"center",gap:5}}><input {...numInp(wkg,v=>{setWkg(v);setWlb(v?+(v*2.2046).toFixed(1):0);},"—",300,0.5)}/><span style={{color:"var(--c-text4)",fontSize:11}}>kg</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><input {...numInp(wlb,v=>{setWlb(v);setWkg(v?+(v/2.2046).toFixed(1):0);},"—",660,1)}/><span style={{color:"var(--c-text4)",fontSize:11}}>lbs</span></div>
          {wkg>0&&<span style={{marginLeft:"auto",color:"#4ade80",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>{wkg} kg ✓</span>}
        </div>

        {/* SYSTEM TABS */}
        <div style={{display:"flex",overflowX:"auto",gap:5,marginBottom:9,paddingBottom:2,scrollbarWidth:"none"}}>
          {systems.map(s=>{
            const light=LIGHT_TABS[s.k]||{bg:s.lc+"22",fg:s.lc,bd:s.lc};
            const sc=isDarkMode?s.c:light.fg;
            const isActive=activeSys===s.k;
            return(<button key={s.k} onClick={()=>setSys(s.k)} style={{flexShrink:0,padding:"6px 11px",borderRadius:20,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,background:isDarkMode?(isActive?sc+"20":"transparent"):(isActive?light.bg:"#ffffff"),color:isDarkMode?(isActive?sc:"var(--c-text4)"):sc,border:isDarkMode?(isActive?`1px solid ${sc}45`:"1px solid transparent"):`1px solid ${isActive?light.bd:light.bg}`,boxShadow:!isDarkMode&&isActive?`0 5px 14px ${light.bd}40`:"none",transition:"all 0.12s",whiteSpace:"nowrap"}}>{s.e} {s.l}</button>);})}
        </div>

        {/* SCOPE FILTER */}
        <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
          {[["all","All Scopes",null],["EMT","EMT+","EMT"],["AEMT","AEMT+","AEMT"],["Medic","Paramedic","Medic"]].map(([k,l,sk])=>{
            const sd=sk?SS[sk]:null;
            const bg=sd?(isDarkMode?sd.bg:sd.lbg):(isDarkMode?"#1a2030":"#dde5f0");
            const fg=sd?(isDarkMode?sd.fg:sd.lfg):(isDarkMode?"#7090b8":"#3a5070");
            const bd=sd?(isDarkMode?sd.bd:sd.lbd):(isDarkMode?"#2a3f60":"#b8c8dc");
            return(
              <button key={k} onClick={()=>setScope(k)} style={{padding:"4px 10px",borderRadius:16,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'DM Sans',sans-serif",background:scope===k?bg:"transparent",color:scope===k?fg:"var(--c-text4)",border:scope===k?`1px solid ${bd}`:"1px solid transparent",transition:"all 0.12s"}}>{l}</button>
            );
          })}
        </div>

        {/* SECTION HEADER */}
        <div style={{display:"flex",alignItems:"center",gap:7,paddingBottom:8,borderBottom:`1px solid #0e1525`,marginBottom:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>{mode==="adult"?"Adult":"Pediatric"} — {sysInfo.l}</span>
          <span style={{color:"var(--c-text-ghost)",fontSize:10,marginLeft:"auto"}}>{list.length} drug{list.length!==1?"s":""}</span>
        </div>

        {/* DRUG LIST */}
        {list.length===0
          ?<div style={{textAlign:"center",marginTop:48,color:"var(--c-text-ghost)",fontSize:13}}>No drugs match</div>
          :list.map((d,i)=><DrugCard key={i} drug={d} wt={wkg} color={color} tick={adminLog[d.name]?tick:0} adminLog={adminLog} onGive={handleGive} onReset={handleReset} initVals={initChecks[d.name]||EMPTY_OBJ} onInitUpdate={handleInitUpdate} reVals={reChecks[d.name]||EMPTY_OBJ} onReUpdate={handleReUpdate} onClearRe={handleClearRe} highlighted={highlightDrug===d.name} isDarkMode={isDarkMode} scopeFilter={scope}/>)
        }

        <div style={{marginTop:30,textAlign:"center",color:"#0e1525",fontSize:9.5,lineHeight:1.8,fontFamily:"'IBM Plex Mono',monospace"}}>Clinical reference only — follow local protocols &amp; medical direction</div>
        </>)}
      </div>
    </>
  );
}
