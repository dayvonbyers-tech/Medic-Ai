# MedicAI — Launch Tracker (Target: December 2026)

Started 2026-08-09. ~17 weeks to target. Check items off as they're done — this file lives in the repo so it stays with the code.

Legend: 🔴 Blocker for launch · 🟡 Strongly recommended · ⚪ Nice-to-have / post-launch OK

---

## 1. Clinical Safety & Content (do this first — it's the whole product)

- [ ] 🔴 **Medical director / licensed EMS physician sign-off** on all dosing, contraindications, and protocol logic. Developer-verified is not the same as clinically-verified. This is the single highest-risk gap before real providers rely on it in the field.
- [ ] 🔴 Confirm licensing/permission to reproduce state EMS protocol content (app header currently cites "GA SOP-2024" — verify this is public domain or you have explicit permission to adapt it).
- [ ] 🟡 Version/changelog process for protocol & drug data updates (protocols change; you need a way to push corrections fast, ideally without an app-store review cycle blocking it).
- [ ] 🟡 Beta test with a real EMS crew/agency before public launch — dogfood the arrest tracker and protocol flows under realistic conditions.
- [ ] ⚪ Formal QA checklist re-run every time drug/dose data changes (a single typo in a decimal point is a real-harm bug in this app, not a cosmetic one).

## 2. Engineering / Product Readiness

- [ ] 🔴 Replace Stripe placeholder price IDs (`price_REPLACE_AEMT_MONTHLY` etc.) with real products; test full checkout for all 3 paid tiers, monthly + yearly, plus failure/decline paths.
- [ ] 🔴 **Server-side entitlement enforcement.** Right now tier-gating is a client-side `.filter()` — move premium drug/protocol content behind an authenticated API/Cloud Function so it isn't shipped to free users in the JS bundle. (See note in section 4 — this is also your #1 anti-copying lever.)
- [ ] 🔴 Firebase Firestore security rules audit — who can read/write saved calls, admin/agency data; make sure one user can't read another's data.
- [ ] 🟡 Error monitoring / crash reporting wired in (Sentry or similar) — you want to know about a broken dose calc before a user does.
- [ ] 🟡 Analytics on the pricing/checkout funnel — you're launching a paid product, you need to see where people drop off.
- [ ] 🟡 Cross-device QA pass, especially iOS Safari — EMS field use is mobile-first, often on older/locked-down agency phones.
- [ ] 🟡 PWA offline behavior test — service worker caching needs to hold up with poor/no signal in the field.
- [ ] 🟡 Backup/export strategy for Firestore data (saved calls, provider accounts).
- [ ] ⚪ Load test if you expect agency-tier bulk signups at launch.
- [ ] ⚪ Accessibility pass beyond font scaling (contrast, screen-reader on critical flows).

## 3. Business Formation

- [ ] 🔴 Form a business entity (LLC is the usual starting point) — separates your personal assets from business/app liability. Do this *before* you take a single paying customer, given the clinical nature of the app.
- [ ] 🔴 Get liability insurance — specifically ask about **Errors & Omissions (E&O)** or **Technology/Professional Liability** coverage for software that provides clinical dosing guidance. A generic business policy usually won't cover this.
- [ ] 🟡 Separate business bank account + bookkeeping (needed for the LLC to actually protect you — commingling funds undermines it).
- [ ] 🟡 EIN from the IRS (needed for the entity, Stripe payouts, etc.).

## 4. Legal Instruments — ⚠️ not legal advice, have an attorney draft or review every item below

- [ ] 🔴 **Terms of Service** — must include: "reference tool only, not a substitute for clinical judgment or agency protocol," no-warranty language on clinical accuracy, limitation of liability, arbitration/dispute clause.
- [ ] 🔴 **Privacy Policy** — required by law and by app stores. Must cover: account info, payment info (via Stripe), and any patient-adjacent data (vitals, demographics, chief complaint) synced to Firebase — even without a name attached, this can be sensitive.
- [ ] 🔴 **Clinical/Medical Disclaimer** — the app already has an AI-narrative disclaimer modal; extend that pattern into a formal, must-accept disclaimer covering the *entire app*, not just the narrative feature, gated on first launch.
- [ ] 🟡 Confirm whether any patient-adjacent data handling triggers HIPAA or state-level health-privacy law obligations — this depends on exactly how Firebase sync is used and who your customers are (individual providers vs. agencies). Attorney call, not a DIY answer.
- [ ] 🟡 **Copyright registration** for the app/source code with the U.S. Copyright Office. Copyright exists automatically at creation, but registration is what lets you sue for statutory damages and attorney's fees if someone copies it — much stronger leverage than relying on common-law copyright alone.
- [ ] 🟡 **Trademark search + registration** for the app name/brand. Decide on ONE final brand first — the app currently mixes "MedicAI" and an internal "R.O.M.A.N." mark; pick one before you spend money on a trademark filing.
- [ ] 🟡 NDA + IP-assignment agreement template for any future contractor/collaborator who touches the code — without an assignment clause, a contractor can legally retain rights to code they write for you.
- [ ] ⚪ EULA if you go beyond PWA into native App Store / Play Store distribution.

## 5. Anti-copying / "Theft" Protection — realistic version

Being direct about what's actually possible for a client-side web app:

- **What does NOT stop copying:** minification/obfuscation of the JS bundle. It raises the effort slightly, that's it — a determined competitor can still extract your drug database and protocol logic from what ships to the browser.
- **What DOES stop it:** don't ship the valuable data to the client in the first place. Moving the drug/protocol database behind an authenticated backend API (section 2, server-side entitlement item) is the only real *technical* fix, and it doubles as your monetization fix — same root cause, same solution.
- **What backs you up when the technical fix isn't 100%:** copyright registration + trademark + a ToS clause explicitly prohibiting scraping/reverse-engineering/redistribution. This is what gives you a DMCA takedown and a lawsuit basis if someone clones it — it doesn't prevent copying, it gives you recourse after the fact.
- [ ] 🔴 Decide: accept the current client-side exposure as a launch risk, or do the backend-gating work first. This is a real trade-off against your December timeline — flag it now, not in November.
- [ ] 🟡 Set a recurring reminder (monthly) to search app stores / the web for anything that looks like a clone once you're live.

## 6. Distribution

- [ ] 🔴 Decide: PWA-only launch (installable from browser, no app-store review) vs. native App Store/Play Store submission. Native medical/health apps get extra scrutiny from Apple specifically — factor real review-cycle time into the December date if you go that route.
- [ ] ⚪ App icons, screenshots, store listing copy (only if going native).

## 7. Support & Launch Ops

- [ ] 🟡 A support channel (email/helpdesk) for bug reports and billing issues before you take paying customers.
- [ ] ⚪ Launch announcement plan / beta tester recruitment among EMS contacts.

---

## Suggested rough timeline to December

| Window | Focus |
|---|---|
| Aug–Sep | Business entity + insurance quote in motion; clinical content review scheduled; decide client-side-data-exposure trade-off |
| Sep–Oct | Server-side entitlement work (if chosen); Firebase rules audit; Stripe live products; legal docs drafted |
| Oct–Nov | Beta test with real crew; QA pass; error monitoring/analytics wired; legal docs finalized |
| Nov | Buffer for whatever broke in beta; App Store submission if going native (review lag) |
| Dec | Launch |

*This file is a living checklist — update it as items close out or new gaps surface.*
