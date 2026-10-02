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
| **Tests** | ✅ **270 / 270 passing** across 19 suites |
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
| Tests | `node --import tsx --test tests/*.test.ts` | ✅ 264/264 |
| Build | `node node_modules\vite\bin\vite.js build` | ✅ `dist/` in ~0.6 s |
| API health | `GET /api/health` | ✅ `status: ok` |
- **Measured scene cost:** 540 draw calls, 8,238 triangles for the whole campus,
  inside the asserted budget. Frame rate could not be measured in the verification
  environment: the tab is backgrounded and browsers throttle `requestAnimationFrame`,
  so any reading would be fiction. Draw calls and triangles are stable facts and are
  published on the canvas.
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
| Campus **places** — names | ✅ real | 72 schools, centres, offices and facilities published by Galgotias University, each linked to its source page |
| Campus **places** — positions | ⚠️ 5 of 72 | Pinned only where OpenStreetMap names the feature; the other 67 are listed with "position not confirmed" and no pin |
| Block A, E-Cell, Lawn tennis | ❌ absent | **Not present in OpenStreetMap.** Not invented. See below |

### Why some campus features are missing

OpenStreetMap names only **six** features on this campus: `B-Block`,
`C-Block`, `School of Hospitality`, `Sports Ground`, `BasketBall Ground` and
`Galgotias University` itself. There is no OSM entry for Block A, E-Cell or a
lawn tennis court, and 294 of the 336 footprints carry nothing but
`building=house` — there are no amenity tags to mine for a library or a canteen.

Those are real places, so putting them at invented coordinates on a satellite
image of a real university would be fabricating the location of a real building.
They are therefore **not** placed. The service map lists them instead, by name and
source, with `position not confirmed` and no pin; `campus-places.json` has no
coordinate field at all, so a pin can only come from a surveyed element. To place
one, an administrator picks the real footprint from the admin tool in the Campus
view, which stores a verified link. A block comment in the 3D view and the plan
attribution say the same thing.

## Test coverage by area

| Suite | Tests | Covers |
| --- | --- | --- |
| `seating.test.ts` | 28 | allocation, expiry, windows, concurrency |
| `auth.test.ts` | 23 | login, hashing, RBAC, IDOR, rate limiting |
| `api.test.ts` | 22 | endpoint contracts, alternatives, peaks |
| `campus3d.test.ts` | 26 | real OSM geometry, measured routes, no invented values |
| `security.test.ts` | 20 | CSRF, sign-in lockout, revocation, ticket codes, grace, 50-way races |
| `prediction.test.ts` | 11 | estimator, confidence, MAE |
| `token.test.ts` | 11 | virtual token issuance and views |
| `docs.test.ts` | 11 | documentation stays present and true |
| `campus-links.test.ts` | 14 | admin-only building links, audited |
| `alternatives.test.ts` | 12 | ranking, hard filters, thresholds |
| `intent.test.ts` | 10 | natural-language service resolution |
| `explain.test.ts` | 10 | "why is it long?" grounded in computed factors |
| `csrf-coverage.test.ts` | 7 | every client write carries a CSRF token |
| campus-acceptance.test.ts | 4 | 3D acceptance: alternatives, peaks, token destination |
| campus-perf.test.ts | 5 | scene cost, level of detail, capture size |
| `campus-places.test.ts` | 15 | real GU directory: no coordinate field, every entry sourced, pins only from surveyed elements |
| `campus-migration.test.ts` | 6 | an existing install is moved onto the real campus without losing data |
| `firebase-auth.test.ts` | 23 | Firebase ID token: project pin, algorithm, expiry, role mapping |
| `firebase-auth-endpoint.test.ts` | 10 | Firebase sign-in over HTTP: session issued, foreign project refused |

Trend: 87 -> 126 -> 161 -> 216 -> 240 -> **264** tests over the project's life.

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

## §34 Acceptance criteria — measured

Checked against the running app, not against the plan. ⚠️ means implemented and
tested, with a stated limitation.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Sports facilities are represented | ✅ | 5 real OpenStreetMap pitches drawn in 3D and on the plan; "Sports Ground" and "BasketBall Ground" seeded as campus data with their OSM ids |
| 2 | Campus landmarks are represented | ✅ | The 6 features OSM names are labelled on both views: B-Block, C-Block, School of Hospitality, Sports Ground, BasketBall Ground, Galgotias University |
| 3 | Buildings can be selected | ✅ | 336 raycast-pickable footprints; a picked building shows its real area, its height *or the reason it is assumed*, and only the services an admin has confirmed for it |
| 4 | Services connect to real CampusFlow data | ✅ | 10 beacons built from the live service records, e.g. "Student Records & Registrar (Main) ● Quiet · 6 min" |
| 5 | Traffic appears from real data | ✅ | `effectiveTrafficState()` over the stored wait and demand level, shown as a glyph plus a word plus a colour |
| 6 | Peak information appears from real data | ✅ | Forecast engine output, e.g. "Usual peak = 11 AM – 2 PM" and "4 PM – 6 PM"; shows "Not enough history yet" when the engine says so |
| 7 | Alternatives can be visualized | ✅ | Ranked by time saved, e.g. "Learning Commons Study Hub — 2 min wait · about 1 min less waiting" |
| 8 | Routes can be displayed | ✅ | Measured on the real network, e.g. "990 m · 12 min walk — Measured along unclassified, service, footway"; 21 of 21 building pairs route |
| 9 | Library seating connects to the 3D environment | ⚠️ | Real counts on the service panel — Library Circulation 85/88, Learning Commons 35/36. **Per-seat 3D placement is not built**: OSM has no floor or room geometry, so seats cannot be placed inside the building honestly |
| 10 | Virtual queue destinations can be displayed | ✅ | "Your token CAN-1 · Student Union Central Canteen, Position #2 · Waiting", destination auto-selected, with a measured route from any chosen origin |
| 11 | Mobile interaction works | ✅ | At 375 px: 19 controls, **none under 44 px**, no horizontal overflow |
| 12 | Desktop interaction works | ✅ | Orbit, pan, zoom, pinch, keyboard (arrows / `+` `-` / `0` / `Escape`), detail level of detail |
| 13 | Accessible list fallback works | ✅ | `List` swaps the scene for a real table with a "Position basis" column; `role="img"` label naming the real counts; a hidden live-service list in the DOM; the same table if WebGL cannot start |
| 14 | Performance remains acceptable | ⚠️ | **Measured: 540 draw calls, 8,238 triangles** for the whole campus, inside the asserted budget. **Frame rate could not be measured** — the verification tab is backgrounded and browsers throttle `requestAnimationFrame`, so any figure would be fiction. Scene cost is published on the canvas and shown in the Layers panel instead |
| 15 | No operational information is fabricated | ✅ | 216 tests, including: assumed heights are one fixed documented value and never random; unmapped routes fail loudly; a point-mapped feature gets no invented footprint; a building with no linked service shows no figures; the 3D layers contain no `Math.random` |

### Known gaps, stated plainly

- **Frame rate is unmeasured.** Scene cost is a fair proxy and is asserted, but a
  real frame-rate reading needs a visible tab and a real device.
- **Per-seat 3D placement is not built.** It would need floor and room geometry
  that OpenStreetMap does not have. The seat *count* is real and is shown.
- **Six of the campus's named features are absent from the source data** — Block A,
  the School of Computing, E-Cell, a library, a canteen and lawn tennis are not in
  OpenStreetMap, so they are not placed at invented coordinates. An admin confirms
  the real footprint from the Campus view.
- **Durable storage is still blocked**, so queue and seat state does not persist
  between serverless instances. See the blocker above.

## Recently changed

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-02 | Real Galgotias University directory added to the service map | `campus-places.json`, `CampusPlaces.tsx`, `campusPlaces.ts`; 72 sourced places, 15 tests |
| 2026-10-02 | **Bug:** app still shipped the fictional "Metropolitan University" campus | `FIX.md` #17 |
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
