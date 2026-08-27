# R.O.M.A.N. / Medic AI — Functional Acceptance Checklist

Use this checklist on the public production app and on at least one iPhone and one Android device when available.

Production URL: https://medic-ai-three.vercel.app  
GitHub: https://github.com/dayvonbyers-tech/Medic-Ai  
Build/commit tested: ____________________  
Tester: ____________________  
Device/browser: ____________________  
Date: ____________________

Result key: check the box only after the expected result is observed. Record failures in the issue log at the bottom.

## 1. Public access and installation

- [ ] App opens from the production HTTPS URL with the laptop turned off.
- [ ] App opens on cellular data with Wi-Fi disabled.
- [ ] App opens on workplace Wi-Fi.
- [ ] No blank screen appears after a hard refresh.
- [ ] Home-screen shortcut uses the public URL, not localhost or `192.168.x.x`.
- [ ] iPhone: Add to Home Screen launches the app successfully.
- [ ] Android: Add/Install to Home Screen launches the app successfully.
- [ ] App icon and favicon display correctly.
- [ ] Returning after the browser was closed restores a usable app state.
- [ ] A newly deployed GitHub build appears at the same production URL.

## 2. Launch, authentication, and access

- [ ] Landing screen renders in light mode.
- [ ] Landing screen renders in dark mode.
- [ ] Theme toggle remains readable and usable.
- [ ] Login form accepts valid credentials.
- [ ] Invalid login shows a useful error without crashing.
- [ ] Signup form validates password and confirmation.
- [ ] Certification selection supports EMT, AEMT, and Paramedic.
- [ ] Provider profile can be completed.
- [ ] Provider profile can be skipped where allowed.
- [ ] Existing profile information can be edited.
- [ ] Student access-code route opens and returns correctly.
- [ ] Guest/24-hour access route opens and returns correctly.
- [ ] Guest restrictions show a clear upgrade or login route.
- [ ] Permission screen can be completed without trapping the user.
- [ ] Welcome/terms screen can be accepted.
- [ ] App tour advances, goes back, skips, and finishes.
- [ ] Completed tour does not unexpectedly reopen every launch.

## 3. Home screen

- [ ] Greeting, date, readiness state, and certification level are correct.
- [ ] Active-call status changes from READY to ON CALL.
- [ ] Tools appear before Protocol Spotlight.
- [ ] Protocol Spotlight opens the expected protocol system.
- [ ] Spotlight medication chips open the correct drug card.
- [ ] New Patient button appears below Tools and Protocol Spotlight.
- [ ] Tools row scrolls horizontally on a narrow phone.
- [ ] Drugs opens the drug screen.
- [ ] Protocols opens the protocol library when no call is active.
- [ ] Assess opens assessment protocols.
- [ ] Arrest opens the CPR/arrest tracker.
- [ ] Med Log opens the medication log.
- [ ] Drug Ref opens Drug Reference.
- [ ] AI Narrative is absent from Home and navigation.
- [ ] Active patient card displays current complaint/demographics.

## 4. Start-call intake

- [ ] New Patient opens the call-intake sheet.
- [ ] Call can start with no age, sex, complaint, or weight.
- [ ] Age accepts years.
- [ ] Age accepts months.
- [ ] Sex supports Male, Female, and Unknown.
- [ ] Pediatric age automatically selects pediatric mode.
- [ ] Pediatric weight converts pounds to kilograms correctly.
- [ ] Chief-complaint search accepts typed text.
- [ ] Complaint suggestions open for every complaint input.
- [ ] First complaint can be added.
- [ ] Additional complaints can be added one at a time.
- [ ] Duplicate complaints are prevented.
- [ ] A complaint can be removed.
- [ ] Dropdown remains usable when multiple complaints exist.
- [ ] Start En Route starts the call without required fields.
- [ ] Start On Scene starts the call without required fields.
- [ ] Cancel closes intake without starting a call.

## 5. Active-call phase and context

- [ ] En Route phase is visible in the header.
- [ ] Arrived changes En Route to On Scene.
- [ ] Call timer starts and advances.
- [ ] Update Call Context opens from Call Overview.
- [ ] Age, sex, weight, and complaints can be added later.
- [ ] Existing context can be corrected without resetting treatment data.
- [ ] Missing information never blocks Drugs, Protocols, Assessments, or Arrest.
- [ ] Return to Call Overview banner appears away from the overview.
- [ ] Navigation remains available during the call.

## 6. Call Overview

- [ ] Age and sex display in a demographics badge.
- [ ] Every selected complaint displays in its own badge.
- [ ] Complaint badges wrap correctly on a narrow screen.
- [ ] Each complaint has a matching overview card.
- [ ] Each complaint card shows only relevant medications.
- [ ] Each complaint card opens only relevant protocols.
- [ ] Multiple complaints merge relevant drugs without duplicates.
- [ ] Multiple complaints merge relevant protocols without duplicates.
- [ ] Free-text/unmatched complaint remains usable and does not crash.
- [ ] Medication administrations appear under Interventions Given.
- [ ] Non-medication interventions appear under Interventions Given.
- [ ] Medication dose number is displayed correctly.
- [ ] Non-medication intervention is labeled LOGGED, not as a dose.
- [ ] Full medication log opens from the overview when medications exist.

## 7. Drug screen and active-call filtering

- [ ] Adult/pediatric drug mode matches patient context.
- [ ] Outside a call, all drug body systems remain available.
- [ ] During a call, only systems containing relevant call drugs are shown.
- [ ] An unrelated previously selected system automatically changes to a relevant system.
- [ ] Burns does not appear while an Airway/Respiratory call is focused unless relevant.
- [ ] System dropdown count matches visible call systems.
- [ ] Search filters by drug name and indication.
- [ ] Scope filters work for All, EMT, AEMT, and Paramedic.
- [ ] Drugs above the signed-in certification level are locked or hidden as designed.
- [ ] Light-mode drug-system colors and text remain readable.
- [ ] Empty filtered results show a useful message.

## 8. Every live drug card

Repeat this block for every drug card in every adult and pediatric body system.

- [ ] Card name, indication, concentration, route, and dose render.
- [ ] Brand/generic aliases are consistent.
- [ ] Contraindications render.
- [ ] Scope badge is correct.
- [ ] Adult dose is correct for the intended protocol.
- [ ] Pediatric dose is weight based where required.
- [ ] Weight calculation and maximum dose behave correctly.
- [ ] Draw volume is mathematically correct.
- [ ] Pre-check opens.
- [ ] Relevant shared vitals auto-populate.
- [ ] Required safety questions appear.
- [ ] Hard contraindication blocks administration.
- [ ] Warning permits deliberate review without silently administering.
- [ ] Administer records exactly one dose and timestamp.
- [ ] Accidental double tap does not create an unintended duplicate.
- [ ] Re-dose limit is enforced.
- [ ] Reassessment opens at the correct time.
- [ ] Latest vitals auto-populate into reassessment.
- [ ] Reset affects only the intended medication.

Adult systems to test:

- [ ] Cardiac
- [ ] Respiratory
- [ ] Neurological
- [ ] Metabolic
- [ ] Anaphylaxis
- [ ] Pain/Sedation
- [ ] Toxicology
- [ ] OB/GYN
- [ ] Trauma
- [ ] Burns

Pediatric systems to test:

- [ ] Cardiac
- [ ] Respiratory
- [ ] Airway/RSI
- [ ] Seizures
- [ ] Anaphylaxis
- [ ] Pain/Sedation
- [ ] Toxicology
- [ ] Glucose/Metabolic
- [ ] Trauma
- [ ] Burns

## 9. Medication timing and reassessment

- [ ] Administered medication appears in the active-drug strip.
- [ ] Active timer starts at administration.
- [ ] Timer continues while navigating between screens.
- [ ] Warning state appears before a scheduled reassessment/re-dose.
- [ ] Due state appears at the configured interval.
- [ ] Reassessment fields match the medication.
- [ ] Updated reassessment values become shared vitals.
- [ ] Repeat dose creates the next dose number.
- [ ] Maximum-dose rule prevents excess dosing.
- [ ] Clear one removes only the selected drug history.
- [ ] Clear All requires deliberate action and clears medication history.
- [ ] Closing the call stops every medication and reassessment timer.

## 10. Shared vitals

- [ ] Vitals can be logged independently of a protocol.
- [ ] BP supports systolic and diastolic values.
- [ ] HR, RR, SpO2, ETCO2, temperature, BGL, pain, and GCS save correctly.
- [ ] GCS calculation is correct.
- [ ] Pupil controls save correctly.
- [ ] Latest vital set appears first/last according to the intended order.
- [ ] Vital trends compare against the previous set.
- [ ] Vitals entered in the main log populate medication pre-checks.
- [ ] Vitals entered in a protocol populate medication pre-checks.
- [ ] Vitals entered in a pre-check become available across the app.
- [ ] Vitals entered in reassessment become available across the app.
- [ ] A newer value replaces an older shared value.
- [ ] Blank values do not overwrite valid existing vitals.
- [ ] Vitals remain attached to the current call only.

## 11. Selected-call protocol navigation

- [ ] Outside a call, full protocol body-system navigation is available.
- [ ] During a call, the global system browser is hidden.
- [ ] Only protocols tied to selected complaints are shown.
- [ ] Selected Call Protocols displays the correct count.
- [ ] Switcher changes directly between selected protocols.
- [ ] Switcher remains visible while a protocol is open.
- [ ] A stale unrelated protocol cannot appear during the call.
- [ ] No-match state shows a clear message.
- [ ] Back returns to the selected-call protocol switcher.
- [ ] Adult/pediatric protocol selection follows patient mode.
- [ ] Scope locks behave correctly.

## 12. Guided protocol behavior

For every protocol below:

- [ ] Title and summary are correct.
- [ ] Decision points appear in logical order.
- [ ] Yes/No answers save while switching protocols.
- [ ] Shared answers auto-populate where designed.
- [ ] High-priority findings are clearly visible.
- [ ] Stop/hold rules appear when triggered.
- [ ] Treatment steps can be marked complete.
- [ ] Medication shortcuts include every medication declared by the protocol.
- [ ] Medication shortcut opens the correct card.
- [ ] Intervention shortcuts appear when clinically relevant.
- [ ] Protocol vitals log and synchronize.
- [ ] Protocol events remain in the current-call timeline.

Cardiac:

- [ ] Chest Pain / ACS
- [ ] Symptomatic Bradycardia — Adult
- [ ] Tachycardia / SVT — Adult
- [ ] Acute Heart Failure / Pulmonary Edema
- [ ] Pediatric Tachycardia / SVT
- [ ] Pediatric Symptomatic Bradycardia
- [ ] Pediatric Chest Pain

Respiratory/Airway:

- [ ] Respiratory Distress — Adult
- [ ] Pediatric Respiratory Distress
- [ ] Pediatric RSI / Advanced Airway

Neurological/Behavioral/Toxicology:

- [ ] Suspected Stroke — Adult
- [ ] Pediatric Stroke
- [ ] Seizure — Adult
- [ ] Febrile Seizure
- [ ] Altered Mental Status — Adult
- [ ] Pediatric Altered Mental Status
- [ ] Opioid / Toxicological Overdose — Adult
- [ ] Pediatric Overdose / Accidental Ingestion
- [ ] Behavioral / Psychiatric Emergency — Adult
- [ ] Pediatric Behavioral Emergency
- [ ] Organophosphate / Nerve Agent Poisoning

Metabolic/Infectious:

- [ ] Hypoglycemia — Adult
- [ ] Pediatric Hypoglycemia
- [ ] Hyperglycemia / DKA — Adult
- [ ] Pediatric Hyperglycemia / DKA
- [ ] Fever / Sepsis — Adult
- [ ] Pediatric Fever / Sepsis
- [ ] Hyperkalemia — Adult
- [ ] Pediatric Hyperkalemia

Trauma/Burns:

- [ ] Trauma / Shock — Adult
- [ ] Pediatric Trauma
- [ ] Burn Protocol — Adult
- [ ] Burn Protocol — Pediatric

Assessment/OB/Neonatal:

- [ ] Cincinnati Prehospital Stroke Scale
- [ ] BE-FAST + LVO Screen
- [ ] Sepsis Screening — qSOFA + SIRS
- [ ] Pediatric Assessment Triangle
- [ ] APGAR at 1 and 5 minutes
- [ ] OB Emergency / Eclampsia
- [ ] Neonatal Resuscitation
- [ ] Pain Management — Adult
- [ ] Pediatric Pain Management
- [ ] Revised Trauma Score
- [ ] START Triage / MCI

## 13. Intervention shortcuts

- [ ] Intervention Shortcuts are visually separate from medications.
- [ ] Supplemental O2 requires delivery method.
- [ ] Supplemental O2 requires flow rate.
- [ ] O2 logs method and flow to call events.
- [ ] BVM logs ventilation rate and oxygen flow.
- [ ] CPAP logs pressure and oxygen/FiO2 setting.
- [ ] Suction logs route and duration.
- [ ] Airway adjunct logs type and size.
- [ ] Intervention never creates a medication dose or timer.
- [ ] Intervention appears in Call Overview.
- [ ] Intervention persists while switching selected protocols.
- [ ] Duplicate intervention entries are intentional and timestamped.

## 14. Burns tool

- [ ] Adult burn map opens.
- [ ] Pediatric burn map opens.
- [ ] Front and back body regions can be selected.
- [ ] Burn depth cycles correctly.
- [ ] TBSA totals update correctly.
- [ ] Superficial burns are excluded from treatment TBSA as designed.
- [ ] Adult and pediatric maps retain separate values.
- [ ] Clear resets only the current map.
- [ ] Burn medication shortcuts open correct cards.
- [ ] Pediatric burn medication calculations require weight.

## 15. Cardiac arrest / CPR — adult

- [ ] Adult arrest starts deliberately.
- [ ] Total arrest timer starts.
- [ ] Two-minute CPR cycle starts.
- [ ] Rhythm-check warning and due state occur.
- [ ] Rhythm modal pauses CPR tracking.
- [ ] Closing rhythm modal resumes pause tracking correctly.
- [ ] VF/pVT and non-shockable paths show correct next actions.
- [ ] Shock energy and shock count record correctly.
- [ ] Epinephrine timer and dose count work.
- [ ] Antiarrhythmic prompts occur according to the arrest path.
- [ ] Access attempts and successful access record.
- [ ] Airway placement records.
- [ ] Hs and Ts can be reviewed and marked.
- [ ] Arrest drugs record in event history.
- [ ] Manual CPR pause/resume works.
- [ ] Compression fraction is calculated.
- [ ] Longest pause is calculated.
- [ ] ETCO2 values log and trend.
- [ ] Low ETCO2 warning does not advise termination by ETCO2 alone.
- [ ] Sudden ETCO2 rise prompts ROSC assessment.
- [ ] Advanced airway enables adult ventilation pacing.
- [ ] ROSC stops active arrest timers.
- [ ] Post-ROSC checklist works.
- [ ] Re-arrest restarts CPR workflow.
- [ ] Termination ends the arrest workflow.
- [ ] Arrest summary and event log are accurate.

## 16. Cardiac arrest / CPR — infant and child

- [ ] Infant mode is labeled correctly.
- [ ] Child mode is labeled correctly.
- [ ] Infant depth guidance displays.
- [ ] Child depth guidance displays.
- [ ] Solo and two-rescuer ratios display.
- [ ] Pediatric weight is required for weight-based arrest medication.
- [ ] Pounds-to-kilograms conversion is correct.
- [ ] Pediatric epinephrine dose and maximum calculate correctly.
- [ ] Pediatric shock energy calculates correctly.
- [ ] Pediatric antiarrhythmic doses calculate correctly.
- [ ] Infant CPR Quality label displays.
- [ ] Child CPR Quality label displays.
- [ ] Pause and compression-fraction tracking work for both.
- [ ] ETCO2 tracking works for both.
- [ ] Advanced airway enables pediatric ventilation pacing.
- [ ] Post-ROSC checklist works for both.
- [ ] Re-arrest works for both.

## 17. Medication log

- [ ] Every administered medication appears once per dose.
- [ ] Timestamp is accurate.
- [ ] Dose number and total are accurate.
- [ ] Clicking a medication returns to the correct card.
- [ ] Individual drug history can be reset.
- [ ] Clear All clears only current-call medication data.
- [ ] Weight-dependent dose display uses the current weight.
- [ ] Closing the call prevents old medications from carrying into a new call.

## 18. Drug Reference

- [ ] Home and navigation labels say Drug Reference.
- [ ] Drug Reference opens successfully.
- [ ] Active Treatment and Reference Only groups switch correctly.
- [ ] Active Treatment contains only drugs linked to live dosing cards.
- [ ] Active cards display detailed pharmacology.
- [ ] Adult/pediatric dosage sections match the live drug bank.
- [ ] Reference Only entries have no administer button.
- [ ] Reference Only entries have no timer or dose calculator.
- [ ] Imported DOCX medication names are normalized.
- [ ] Reference entries are grouped by category.
- [ ] Search finds generic names and brand names.
- [ ] Category chips filter correctly.
- [ ] Duplicate medication entries are not shown unnecessarily.
- [ ] Medical Terms tab searches and expands correctly.
- [ ] Oxygen is not presented as a medication card.
- [ ] Guest access restrictions behave as designed.

## 19. Theme, readability, and phone usability

- [ ] Every screen is readable in light mode outdoors.
- [ ] Every screen is readable in dark mode.
- [ ] No light text disappears on a light background.
- [ ] Status colors are not the only indicator of meaning.
- [ ] Buttons meet a usable touch-target size.
- [ ] No horizontal page overflow occurs at 320–430 px widths.
- [ ] Dropdowns remain inside the viewport.
- [ ] Bottom sheets can scroll to every control.
- [ ] Keyboard does not hide the active input or submit button.
- [ ] Long drug/protocol names wrap or truncate without covering controls.
- [ ] Timers remain readable at large elapsed values.
- [ ] Orientation change does not produce a blank or unusable screen.

## 20. End-call and new-call isolation

- [ ] End Call requires confirmation.
- [ ] End Call stops call timer.
- [ ] End Call stops medication timers.
- [ ] End Call stops reassessment reminders.
- [ ] End Call stops CPR cycle and epinephrine timers.
- [ ] End Call stops ventilation pacing.
- [ ] End Call cancels scheduled notifications.
- [ ] End Call clears active complaints.
- [ ] End Call clears selected protocol state.
- [ ] End Call clears shared facts and vitals as designed.
- [ ] End Call clears interventions and protocol events.
- [ ] New call starts with no previous patient information.
- [ ] Closing a call with missing information still succeeds.
- [ ] AI Narrative remains hidden before, during, and after call closure.

## 21. Resilience and failure handling

- [ ] App remains usable when internet is briefly lost after loading.
- [ ] Reconnecting does not duplicate medication or event entries.
- [ ] Refresh during an active call has an intentional, documented result.
- [ ] Browser back button does not unexpectedly destroy the call.
- [ ] Rapid repeated taps do not create duplicate calls or doses.
- [ ] Invalid numeric input is rejected or safely normalized.
- [ ] Extremely high/low values do not break layout or calculations.
- [ ] Empty searches and unmatched complaints do not crash.
- [ ] Notification permission denied does not block the app.
- [ ] Firebase unavailable/unconfigured does not break local clinical tools.
- [ ] Vercel/API failure shows a useful error where applicable.

## 22. Privacy, security, and account review

- [ ] No patient name field is collected.
- [ ] No protected information appears in URLs.
- [ ] No secrets or API keys are exposed in client source.
- [ ] Login/session behavior is appropriate on a shared device.
- [ ] Logout removes access to account-only screens.
- [ ] Guest limitations cannot be bypassed through navigation.
- [ ] Archived/cloud data behavior matches displayed privacy claims.
- [ ] Clear-call behavior matches displayed retention claims.
- [ ] Pricing and role gates match actual enabled features.
- [ ] Terms, privacy, and clinical-reference disclaimers are current.

## 23. Clinical content validation gate

Functional success does not equal clinical approval. Complete this review separately with qualified clinical oversight.

- [ ] Every active adult dose has a cited current source.
- [ ] Every active pediatric dose has a cited current source.
- [ ] Concentrations and draw volumes have independent calculation review.
- [ ] Maximum doses are verified.
- [ ] Contraindications and warnings are verified.
- [ ] Re-dose/reassessment intervals are verified.
- [ ] EMT/AEMT/Paramedic scope labels are verified for the intended jurisdiction.
- [ ] Adult cardiac arrest content is reviewed against current AHA guidance.
- [ ] Infant/child arrest content is reviewed against current AHA/AAP guidance.
- [ ] Protocol decision trees are reviewed by a medical director or designated clinical reviewer.
- [ ] Reference-only drugs cannot be administered from the app.
- [ ] Deprecated, withdrawn, or non-operational drugs are clearly handled.
- [ ] Oxygen targets and airway/ventilation defaults are reviewed.
- [ ] Clinical disclaimer is visible without obstructing urgent workflow.
- [ ] Final signed clinical approval is documented before production clinical use.

## 24. Deployment and source-control gate

- [ ] Local production build passes.
- [ ] No unexpected uncommitted files exist.
- [ ] Intended changes are committed with a clear message.
- [ ] Commit is pushed to GitHub `main` or an approved release branch.
- [ ] Vercel production deployment reaches READY.
- [ ] Production alias remains `https://medic-ai-three.vercel.app`.
- [ ] Production smoke test passes after deployment.
- [ ] Previous working deployment can be identified for rollback.
- [ ] Release commit hash is recorded at the top of this checklist.

## 25. Required end-to-end regression scenarios

- [ ] Adult anaphylaxis with multiple complaints, oxygen, epinephrine, albuterol, shared vitals, reassessment, and call closure.
- [ ] Adult chest pain with aspirin/nitroglycerin pre-checks, repeat BP, and medication log.
- [ ] Adult respiratory distress with O2 method/flow, BVM or CPAP, bronchodilator, and reassessment.
- [ ] Adult stroke with BGL, stroke scale, last-known-well workflow, and no irrelevant drugs.
- [ ] Adult trauma with hemorrhage control, TXA consideration, pain management, and repeat vitals.
- [ ] Adult cardiac arrest through shockable rhythm, medications, airway, ETCO2, ROSC, and re-arrest.
- [ ] Infant arrest with weight-based drugs and ventilation pacing.
- [ ] Child arrest with weight-based shock/medication calculations and ROSC.
- [ ] Pediatric fever/sepsis with weight, temperature, fluids, and reassessment.
- [ ] Pediatric respiratory distress/advanced-airway workflow.
- [ ] Call started with no information, details added later, treatment recorded, and call closed.
- [ ] Two-complaint call where protocol and drug switchers show only merged relevant content.

## Phase 2 readiness decision

All of the following must be true before moving to Phase 2:

- [ ] No unresolved critical functional defect.
- [ ] No medication-calculation defect.
- [ ] No timer that continues after call closure.
- [ ] No cross-call patient or treatment data leakage.
- [ ] Public mobile access is reliable away from the development computer.
- [ ] Core end-to-end regression scenarios pass.
- [ ] Clinical validation plan is assigned and documented.
- [ ] Known noncritical defects are listed with owners and target releases.
- [ ] Release commit and production deployment are recorded.

Decision: [ ] READY FOR PHASE 2  [ ] NOT READY  
Decision date: ____________________  
Approved by: ____________________

## Issue log

| ID | Section | Device/browser | Steps to reproduce | Expected | Actual | Severity | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| 001 | | | | | | | | |
| 002 | | | | | | | | |
| 003 | | | | | | | | |

Severity guide:

- Critical: unsafe dose/calculation, patient-data leak, app unavailable, or workflow cannot continue.
- High: major treatment/timer/protocol function is incorrect but workaround exists.
- Medium: feature works incorrectly without immediate safety impact.
- Low: visual, wording, or minor usability issue.
