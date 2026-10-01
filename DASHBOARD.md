# CampusFlow — Project Dashboard

**Last updated:** 2026-10-01 · **Deployment:** `https://campus-flow-sigma-six.vercel.app`
**Repository:** `https://github.com/mouris999/Campusflow` (public, `main`)
**Campus:** Galgotias University, Greater Noida (28.365858, 77.542225) — real OpenStreetMap geometry
**Health:** `{"status":"ok","storage":"ephemeral"}`

> The single page to look at to know where the project stands. Updated in the same
> change as any status change. See `TASKS.md` for the detailed register and
> `FIX.md` for the bug history.

---

## Overall status

| | |
| --- | --- |
| **Build** | ✅ green — typecheck clean, production build clean |
| **Tests** | ✅ **202 / 202 passing** across 13 suites |
| **Deployed** | ✅ production, verified live in a browser |
| **Campus geometry** | ✅ real — 336 building footprints, 178 roads, 5 sports pitches from OpenStreetMap |
| **Satellite imagery** | ✅ live — Esri World Imagery, 1.19 m/px, attribution displayed |
| **Documentation** | ✅ 11 documents, all current |
| **Blocking issue** | ⛔ **1** — no durable database on Vercel |
| **Open work items** | 8 (see `TASKS.md` §3) |
| **Known partial areas** | 4 — real-time hardening, display board, PWA/i18n, security CI |

## Health checks

| Check | Command | Result |
| --- | --- | --- |
| Types | `node node_modules\typescript\bin\tsc --noEmit` | ✅ 0 errors |
| Tests | `node --import tsx --test tests/*.test.ts` | ✅ 202/202 |
| Build | `node node_modules\vite\bin\vite.js build` | ✅ `dist/` in ~0.6 s |
| API health | `GET /api/health` | ✅ `status: ok` |
| Initial bundle | — | 468 kB JS / **126 kB gzip** (3D and geometry are code-split out) |
| 3D chunk | — | loaded on demand, never blocks first paint |

## Campus: what is real and what is not

| Element | Status | Source |
| --- | --- | --- |
| Building footprints | ✅ real | OpenStreetMap, captured 2026-09-30, 336 ways/relations |
| Roads and paths | ✅ real | OpenStreetMap, 178 ways |
| Sports, green, water, parking | ✅ real | OpenStreetMap land-use polygons |
| Satellite imagery | ✅ real | Esri World Imagery, live tiles |
| Walking routes | ✅ measured | Dijkstra over the real walkable network |
| Queue, wait, traffic, peaks | ✅ live | CampusFlow API |
| Building **heights** | ⚠️ partial | Surveyed where OSM records one; otherwise one documented default, labelled "assumed" |
| CampusFlow service **positions** | ⚠️ projected | Real only once an administrator confirms a building; otherwise shown as "Projected from the 2D layout" |
| Block A, School of Computing, E-Cell, Library, Canteen, Lawn tennis | ❌ absent | **Not present in OpenStreetMap.** Not invented. See below |

### Why some campus features are missing

OpenStreetMap names only **six** features on this campus: `B-Block`,
`C-Block`, `School of Hospitality`, `Sports Ground`, `BasketBall Ground` and
`Galgotias University` itself. There is no OSM entry for Block A, the School of
Computing, E-Cell, a library, a canteen or a lawn tennis court.

Those are real places, so putting them at invented coordinates on a satellite
image of a real university would be fabricating the location of a real building.
They are therefore **not** added. To place them, an administrator picks the real
footprint from the admin tool in the Campus view, which stores a verified link.
A block comment in the 3D view and the plan attribution say the same thing.

## Test coverage by area

| Suite | Tests | Covers |
| --- | --- | --- |
| `seating.test.ts` | 28 | allocation, expiry, windows, concurrency |
| `auth.test.ts` | 23 | login, hashing, RBAC, IDOR, rate limiting |
| `api.test.ts` | 22 | endpoint contracts, alternatives, peaks |
| `campus3d.test.ts` | 23 | real OSM geometry, measured routes, no invented values |
| `security.test.ts` | 20 | CSRF, sign-in lockout, revocation, ticket codes, grace, 50-way races |
| `prediction.test.ts` | 11 | estimator, confidence, MAE |
| `token.test.ts` | 11 | virtual token issuance and views |
| `docs.test.ts` | 11 | documentation stays present and true |
| `campus-links.test.ts` | 14 | admin-only building links, audited |
| `alternatives.test.ts` | 12 | ranking, hard filters, thresholds |
| `intent.test.ts` | 10 | natural-language service resolution |
| `explain.test.ts` | 10 | "why is it long?" grounded in computed factors |
| `csrf-coverage.test.ts` | 7 | every client write carries a CSRF token |

Trend: 87 → 126 → 161 → **202** tests over the project's life.

## Five capabilities — acceptance

| Capability | Implemented | Connected | Usable | Tested | Verified | Evidence |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| Traffic + peak intelligence | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/trend.ts`, `TrafficPeakPanel.tsx` |
| Real virtual token | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/token.ts`; live `CAN-361` |
| Library seat allocation | ✅ | ✅ | ✅ | ✅ | ⚠️ | 28 tests pass; **production persistence broken by ephemeral storage** |
| AI ordering alternatives | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/alternatives.ts`; 12 deterministic tests |
| Reliable offline | ✅ | ✅ | ✅ | ✅ | ⚠️ | shell/outbox verified; queue position not persisted across instances |
| 3D campus on real geometry | ✅ | ✅ | ✅ | ✅ | ✅ | `src/three/*`; 336 real footprints, live beacons, list fallback |

⚠️ = implemented and tested, but production behaviour is limited by the storage
blocker below. Not hidden, and not claimed as fully working.

## Blockers

### ⛔ B1 — No durable database on Vercel (owner action required)

**What:** Vercel functions have a read-only bundle, so `server/paths.ts` falls
back to `os.tmpdir()`. State is therefore per-instance and is lost on recycle.

**Measured, not assumed:** reserve a seat → `GET /seats/mine` returns **0** in
production but **2** locally. Analytics undercount across instances.

**Why it is blocked:** `npx vercel integration add neon` and `... upstash` both
return `integration_terms_acceptance_required`. Accepting marketplace terms
requires a signed-in browser session and cannot be done from the CLI.

**Owner action:**
1. Open `https://vercel.com/mouris-projects-05929adc/~/integrations/accept-terms/neon`
2. Accept the terms
3. Say continue — the Postgres adapter is then implemented in `server/db.ts`
   (the single read/write seam, so no caller changes)

**Mitigation in place:** `IS_EPHEMERAL_STORAGE` is surfaced via `/api/health` and
a staff/admin banner (`StorageNotice.tsx`), so partial numbers are never
presented as campus-wide truth. `docs/KPIS.md` documents it.

**Alternative if declined:** self-host with a persistent volume —
`NODE_ENV=production CAMPUSFLOW_DATA_DIR=/var/lib/campusflow npm start`.

### ℹ️ B2 — `GEMINI_API_KEY` not configured

The AI Concierge returns a clear "not configured" error by design. Not a defect;
recorded so it is not mistaken for one.

### ℹ️ B3 — Campus building heights are mostly assumed

OpenStreetMap records a height for only a small share of the 336 footprints. The
rest are drawn at one documented default and the UI says "not recorded — shown at
a default height". This is a **data** gap in the source, not a modelling choice,
and it is never presented as surveyed.

## Recently changed

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-01 | 3D campus built on real OpenStreetMap geometry + Esri satellite | `src/three/*`; verified live: 336 footprints, 10 live beacons |
| 2026-10-01 | Service map redrawn from real survey data, replacing decorative fiction | `RealCampusPlan.tsx`; 540 real paths, real Galgotias labels |
| 2026-10-01 | Campus renamed to Galgotias University, timezone Asia/Kolkata | seed + `Campus` type |
| 2026-10-01 | 5 real Galgotias structures added as campus data | `bld-gu-*`, positions from OSM centroids |
| 2026-10-01 | **Bug:** sign-in locked out any browser holding a session cookie | `FIX.md` #11; 4 regression tests |
| 2026-10-01 | **Bug:** invented walking distance removed from the 2D map | `FIX.md` #12 |
| 2026-10-01 | Admin building-position confirmation | `campus_links` table, `CampusLinkAdmin.tsx` |
| 2026-09-30 | Ticket codes → per-service daily sequence | `FIX.md` #4 |
| 2026-09-30 | CSRF protection + session revocation | `FIX.md` #6; 20 security tests |
| 2026-09-30 | Client write coverage guard | `FIX.md` #7 |
| 2026-09-30 | Full documentation set created | 11 documents |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Ephemeral storage loses queue/seat data | **Certain** on Vercel | High | B1; disclosed in-product |
| A campus feature shown at a projected position could read as surveyed | Medium | High | Marked "Projected from the 2D layout" in the panel and the list; verified positions are admin-confirmed and audited |
| Building heights assumed rather than surveyed | **Certain** today | Low | Labelled per building; `geometryProvenance()` reports the split |
| Invented walking distances | Was **certain**, now fixed | High | Routes measured on the real network; regression test greps the old fudge factor out |
| New client writes missing CSRF | Was **high**, now low | High | `csrf-coverage.test.ts` fails the build |
| Sign-in lockout from an over-broad CSRF guard | **Fixed** | High | Exemption + 4 regression tests |
| JSON write is O(document) | Medium at scale | Medium | Single-seam DB adapter is the fix |
| No automated accessibility CI | Medium | Medium | Manual review at 3 widths; axe/Lighthouse queued |

## Next step

**Waiting on the owner** to accept the Neon marketplace terms (B1). Everything
else is buildable now. The queue after that: notification outbox → display board
→ security CI → i18n → confirm the remaining campus buildings with an admin.
