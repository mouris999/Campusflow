# CampusFlow — Task Register

**Last updated:** 2026-09-30

> Every work item, its state, and its evidence. Update in the same change as the
> work. Legend: ✅ done + verified · 🔄 in progress · ⏳ not started ·
> ⛔ blocked · ➖ deliberately out of scope
>
> Status summary: **✅ 16 phases complete · ⚠️ 4 partial · ⛔ 1 blocked · ➖ 5 out of scope**

---

## 1. Build order (from the specification)

| # | Phase | Status | Evidence |
| --- | --- | --- | --- |
| 0 | Intake and decisions | ✅ | Stack recorded in `ARCHITECTURE.md` §1 with rejected alternatives; campus timezone, product type and publish target decided |
| 1 | Inspect project; write architecture docs | ✅ | `ARCHITECTURE.md`, `PRD.md`, `RULES.md`, `DESIGN.md`, `TASKS.md`, `DASHBOARD.md`, `MEMORY.md`, `FIX.md`, `VERIFICATION.md`, `README.md`, `docs/KPIS.md` |
| 2 | Design brief, tokens, landing page | ➖ | Existing marketing page preserved by directive; tokens documented in `DESIGN.md` §2 rather than redesigned |
| 3 | Walking skeleton: login → seed → join → call → live update | ✅ | End-to-end verified live in production |
| 4 | Complete schema, labelled seed | ✅ | `DatabaseSchema` in `server/db.ts` — 19 collections; seed is explicit and resettable |
| 5 | Auth hardening, RBAC, audit log | ✅ | `server/auth.ts`; scrypt, stateless signed sessions, CSRF, revocation, `requireRole`/`requireSelfOrRole`; `audit_logs` on every operational action |
| 6 | Service catalogue, discovery, search | ✅ | `ServiceDiscovery.tsx`; intent resolution in `intelligence/intent.ts` — only returns services that exist in the database |
| 7 | Full queue engine and estimator | ✅ | State machine, idempotency keys, one-active-ticket, grace; `intelligence/prediction.ts`; formulas in `docs/KPIS.md` |
| 8 | Appointments and resources, concurrency | ✅ | 28 seating tests; 50-way race → exactly one winner |
| 9 | Real-time hardening and notification outbox | ⚠️ | SSE with `stale_after_secs` and versioned snapshots. **Outbox with retry/dead-letter and email/push adapters not built** — §3 |
| 10 | Staff console | ✅ | `StaffOperations.tsx` — call/serve/skip/complete, open/close, capacity with reason, incident delay tags |
| 11 | Demand/capacity, "why", peaks, alternatives | ✅ | `prediction.ts`, `trend.ts`, `alternatives.ts`, `explain.ts` |
| 12 | Admin analytics, impact, best-time, simulation | ✅ | `AdminAnalytics.tsx`; simulation permanently labelled MODEL ESTIMATE and never written to KPI tables |
| 13 | Map and display board | ⚠️ | `CampusMap.tsx` built from real building rows with a list fallback. **Public display board not built** — §3 |
| 14 | PWA, i18n, accessibility, mobile pass | ⚠️ | PWA + offline + accessibility + 375/768/1280 verified. **i18n catalogue not built** — §3 |
| 15 | Security hardening, performance, load tests | ⚠️ | CSRF, revocation, rate limiting, headers, 50-way concurrency. **k6 / Lighthouse CI / axe not wired** — §3 |
| 16 | Cover, metadata, deploy, acceptance run, audit | ✅ | Deployed to Vercel; acceptance run in `VERIFICATION.md` |

## 2. Feature work completed 2026-09-30

| Item | Status | Evidence |
| --- | --- | --- |
| P0 — Vercel had no backend, all `/api/*` 404 | ✅ | `vercel.json` rewrites + `api/index.ts`; `FIX.md` #2 |
| P0 — no authentication at all | ✅ | `server/auth.ts`, `SignInScreen`, role-gated Navbar |
| P1 — student could see other students' PII | ✅ | `getQueueEntriesForViewer()` redacts server-side |
| Library seat allocation | ✅ | `intelligence/seating.ts`, `SeatMap.tsx`; 28 tests |
| Virtual token | ✅ | `intelligence/token.ts`, `VirtualTokenCard.tsx`; 11 tests |
| Traffic trend + peak panel | ✅ | `intelligence/trend.ts`, `TrafficPeakPanel.tsx` |
| Offline / PWA | ✅ | `public/sw.js`, `manifest.webmanifest`, outbox, `OfflineBanner` |
| Discoverability (Plan tab, My pass tab, mobile strip) | ✅ | `PlanVisit.tsx`, `MyPass.tsx`, Navbar tab strip |
| Ephemeral-storage disclosure | ✅ | `paths.ts` → `/api/health` → `StorageNotice.tsx` |
| Ticket codes could collide | ✅ | `issueTicketCode()` daily sequence; `FIX.md` #4 |
| Missed-turn protection | ✅ | `extendGraceForMissedTurn()`; `no_show_penalty` |
| CSRF protection + session revocation | ✅ | `csrfGuard`, `POST /auth/revoke-all`; 16 security tests |
| Client write coverage guard | ✅ | `tests/csrf-coverage.test.ts`; `FIX.md` #7 |
| KPI formula documentation | ✅ | `docs/KPIS.md` |
| Full documentation set | ✅ | 11 documents; `tests/docs.test.ts` keeps them present and true |
| Published to GitHub | ✅ | `github.com/mouris999/Campusflow`, `main`; `data/` excluded, verified 404 from the public internet |
| Interactive 3D campus on real geometry | ✅ | `src/three/*`, real OSM footprints (336 buildings, 178 roads, 5 pitches), Esri satellite, live traffic beacons |
| Service map redrawn from real survey data | ✅ | `RealCampusPlan.tsx` replaced a decorative SVG that was not a map of anything |
| Admin building-position confirmation | ✅ | `campus_links` table + `CampusLinkAdmin.tsx`; live figures only appear where confirmed |

## 3. Open work

| Item | State | Detail |
| --- | --- | --- |
| **Durable database** | ⛔ | `server/db.ts` is a single seam ready for a real adapter. Blocked on provisioning a Postgres instance — `vercel integration add neon` returns `integration_terms_acceptance_required`. See `DASHBOARD.md` B1 |
| **Notification outbox + retry/dead-letter** | ⏳ | In-app delivery works. Transactional outbox, exponential backoff with jitter, dead-letter visibility and email/push adapters are not built |
| **Public display board** | ⏳ | A large-format board showing ticket codes only. Not built |
| **Transport fallback chain** | ⏳ | Spec wants WebSocket → SSE → polling with a connection indicator. SSE only |
| **k6 / Lighthouse CI / axe** | ⏳ | Manual verification done; no CI budget enforcement wired |
| **i18n string catalogue** | ⏳ | English only; no catalogue, no Hindi. Dates are campus-timezone aware |
| **Self-service data export / delete** | ⏳ | Pseudonymous IDs are used and the API is structured for it, but no user-facing surface exists |
| **Staff console hotkeys N / R / S** | ⏳ | Spacebar-to-call-next exists; the full set does not |
| **Enable Google sign-in in production** | ⛔ | Code and tests are complete (249/249 green), but `CAMPUSFLOW_FIREBASE_PROJECT_ID` is a **server process env var** and nothing in the server loads `.env`. Until it is set on Vercel, `POST /api/auth/firebase` answers **503** and the endpoint is inert. The `VITE_FIREBASE_*` values in `.env` are already real and must match |
| **Firebase authorised domains** | ⏳ | The Firebase project must list `campus-flow-sigma-six.vercel.app` and `localhost` as authorised domains, and have the Google provider enabled. Until then the popup fails with `unauthorized-domain`, which the UI reports honestly |

## 4. Deliberately not doing

| Item | Reason |
| --- | --- |
| 3D / scroll-scrub marketing hero | Directive: preserve the existing UI. Decoration carrying no data was explicitly out of scope |
| Predictive ML for wait times | Transparency beats accuracy nobody can explain. Error is measured and published |
| Payments / billing | Canteen ordering is tracked for queue purposes only |
| Native mobile apps | One responsive web app serves both roles |
| Rewriting the stack for Cloudflare/Higgsfield | Would discard working code against a standing instruction to preserve the app |

## 5. Next actions

1. **Owner action required:** accept the Neon/Postgres marketplace terms at
   `https://vercel.com/mouris-projects-05929adc/~/integrations/accept-terms/neon`,
   then `npx vercel integration add neon`.
2. Implement the Postgres adapter in `server/db.ts` behind the existing seam; wire
   `CAMPUSFLOW_DATABASE_URL`.
3. Re-verify seat and token persistence in production with the database attached.
4. Re-run the full suite and redeploy.
5. Then take the open work in §3, highest user value first: notification outbox,
   then display board.
