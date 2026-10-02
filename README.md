# CampusFlow

**Last updated:** 2026-09-30

**Skip the line. Know when to go.**

A production campus services platform: one place to see live wait times, join a
virtual queue instead of standing in it, hold a server-issued token, book a
library seat, and see *when*, *where* and *why* waits are long.

Every figure, queue, seat, token and recommendation is computed from stored
records. There are no mock buttons, no fake availability and no invented
statistics.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [PRD.md](PRD.md) | What the product is, who it serves, the five problems, acceptance criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack decisions and rejected alternatives, request flow, auth, storage, deployment |
| [RULES.md](RULES.md) | The operating rules — no fakes, evidence-based done, security and accessibility rules |
| [DESIGN.md](DESIGN.md) | Colour tokens, status language, component inventory, the six view states |
| [TASKS.md](TASKS.md) | Build order, work register, open work, next actions |
| [DASHBOARD.md](DASHBOARD.md) | Live status, test coverage, blockers, risk register |
| [MEMORY.md](MEMORY.md) | Environment quirks, codebase gotchas, decisions and their reasoning |
| [FIX.md](FIX.md) | Every bug found, root cause, fix, and its regression test |
| [VERIFICATION.md](VERIFICATION.md) | Requirement → evidence matrix |
| [docs/KPIS.md](docs/KPIS.md) | The formula behind every displayed figure |

**Rule R31: a change updates the docs it affects, in the same change.** See the
table in `RULES.md` §6 for which document to touch, and `tests/docs.test.ts` for
the check that enforces it.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

On Windows the repository path contains `&`, which breaks npm's shims — invoke the
tools directly (see `MEMORY.md` §1):

```powershell
node node_modules\tsx\dist\cli.mjs server.ts      # dev
node node_modules\typescript\bin\tsc --noEmit     # typecheck
node --import tsx --test tests/*.test.ts          # tests
node node_modules\vite\bin\vite.js build         # build
```

### Demo accounts

Shown on the sign-in screen by `GET /api/auth/demo-accounts`:

| Role | Email | Password |
| --- | --- | --- |
| Student | `alex.rivera@galgotiasuniversity.invalid` | `student123` |
| Staff | `sarah.chen@galgotiasuniversity.invalid` | `staff123` |
| Admin | `m.vance@galgotiasuniversity.invalid` | `admin123` |

Also seeded and usable for testing, though not listed on the sign-in screen:
`maya.lin@galgotiasuniversity.invalid` and `david.okafor@galgotiasuniversity.invalid` (both `student123`).

Set `CAMPUSFLOW_DEMO_AUTH=false` to disable demo sign-in entirely.

---

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `CAMPUSFLOW_SESSION_SECRET` | **in production** | HMAC key for sessions and CSRF. Must be identical across instances |
| `CAMPUSFLOW_DATA_DIR` | no | Explicit storage path (used by the test harness) |
| `CAMPUSFLOW_DEMO_AUTH` | no | `false` disables demo sign-in |
| `CAMPUSFLOW_DATABASE_URL` | no (planned) | Postgres connection string |
| `GEMINI_API_KEY` | no | AI Concierge. Unset → a clear "not configured" error, by design |

See `.env.example`. No secret is stored in source.

---

## Deployment

Vercel. `vercel.json` builds `dist/`, runs `api/index.ts` as a function, and
rewrites `/api/(.*)` to it.

> **Storage caveat.** Vercel functions have a read-only bundle, so the app falls
> back to temporary storage: state is per-instance and is lost on recycle. The
> app detects and discloses this (`GET /api/health`, and a banner for staff and
> admins) rather than reporting partial numbers as campus-wide truth. Attaching a
> real database is the top open item — see `DASHBOARD.md` blocker B1.

To self-host with durable storage instead:

```bash
NODE_ENV=production CAMPUSFLOW_DATA_DIR=/var/lib/campusflow npm start
```

---

## Roles

- **student** — discover services, compare waits, join a virtual queue, hold a
  token, book a library seat or an appointment, see own activity
- **staff** — call, serve, skip, complete, open and close services, change
  capacity with a reason, record incidents and delay reasons
- **admin** — service configuration, analytics, capacity simulation, audit log,
  seed reset, revoke-all sessions

Access is deny by default and enforced server-side. A student sees other students
only as ticket codes — names and IDs are redacted in the data layer, not hidden
with CSS.

---

## Testing

216 tests across 15 suites, all passing.

| Suite | Tests | Covers |
| --- | --- | --- |
| `seating.test.ts` | 28 | allocation, expiry, windows, concurrency |
| `auth.test.ts` | 23 | login, hashing, RBAC, IDOR, rate limiting |
| `api.test.ts` | 22 | endpoint contracts, alternatives, peaks |
| `campus3d.test.ts` | 26 | real OSM geometry, measured routes, no invented values |
| `security.test.ts` | 20 | CSRF, sign-in lockout, revocation, ticket codes, grace, 50-way races |
| `campus-links.test.ts` | 14 | admin-only building links, audited |
| `alternatives.test.ts` | 12 | ranking, hard filters, thresholds |
| `prediction.test.ts` | 11 | estimator, confidence, MAE |
| `token.test.ts` | 11 | virtual token issuance and views |
| `docs.test.ts` | 11 | documentation stays present and true |
| `intent.test.ts` | 10 | natural-language service resolution |
| `explain.test.ts` | 10 | "why is it long?" grounded in computed factors |
| `csrf-coverage.test.ts` | 7 | every client write carries a CSRF token |
| campus-acceptance.test.ts | 4 | 3D acceptance: alternatives, peaks, token destination |
| campus-perf.test.ts | 5 | scene cost, level of detail, capture size |

Three suites are unusual on purpose:

- `csrf-coverage.test.ts` scans the client source for writes that would be
  rejected at runtime with **no build error**. It exists because of a real
  shipped regression (`FIX.md` #7).
- `campus3d.test.ts` greps the map for the invented walking-distance factor that
  used to be there, so it cannot return (`FIX.md` #12).
- `docs.test.ts` fails when a document goes missing, when a documented number
  stops matching the code, or when a bug lands without a `FIX.md` entry.

---

## The campus

The Campus view has two modes over the **same real place**:

- **3D campus** — a WebGL scene of the real campus with live satellite imagery.
  Buildings, roads, paths, sports pitches, green space and parking come from
  OpenStreetMap; imagery is Esri World Imagery. CampusFlow service beacons sit on
  top carrying live queue, wait and traffic data.
- **Service map** — the 2D plan, redrawn from the same survey geometry, with the
  existing service pins, filters, building list and route panel unchanged.

Geometry: 336 real building footprints, 178 roads and paths, 5 sports pitches,
captured from OpenStreetMap on 2026-09-30. Walking routes are measured with
Dijkstra over the real walkable network; when no real path exists the app says so
rather than drawing a straight line. Walking *times* assume 1.35 m/s and are
labelled as estimates.

### What is real, and what is not

| Element | Status |
| --- | --- |
| Building footprints, roads, land use, sports | Real OpenStreetMap survey data |
| Satellite imagery | Real Esri World Imagery |
| Queue, wait, traffic, peak figures | Live CampusFlow API |
| Building **heights** | Surveyed where OSM records one; otherwise one documented default, labelled "assumed" |
| CampusFlow service **positions** | Projected from the 2D layout until an administrator confirms a real building, then labelled "verified" |
| Campus **places** — schools, centres, facilities | Named by Galgotias University, each with a link to the page it came from |

### The campus directory

Geometry says where the buildings are. It cannot say what the university *is*.
OpenStreetMap names five features on this campus out of 336 footprints — the rest
are tagged with nothing but `building=house` — so a plan drawn from the survey
alone cannot name the School of Law, the Central Library or the Cisco Centre of
Excellence.

The service map therefore carries a directory of **72 real places** from the
university's own published pages in `src/data/campus-places.json`: 27 schools, 8
industry-integrated academic centres, 4 research units, and the registrar,
examination cell, councils, NCC and NSS, the Central Library, Galgotias Dining,
the health centre, the sports grounds, the hostel, the shops, the bank and the bus
services.

Five of those are pinned, because the survey names them. The other 67 are listed
with a source link and an explicit `position not confirmed`, and are given no pin.
The schema has no coordinate field at all, so a pin can only ever come from a
surveyed OpenStreetMap element — an invented position is not representable rather
than merely discouraged. `campus-places.test.ts` enforces all three properties.

### What the survey does not cover

OpenStreetMap names only six features on this campus - `B-Block`, `C-Block`,
`School of Hospitality`, `Sports Ground`, `BasketBall Ground` and
`Galgotias University`. **Block A, E-Cell, lawn tennis and most of the university's
buildings are not in the source data**, so they are not placed at invented
coordinates. An administrator picks the real footprint from the Campus view,
which stores a verified, audited link. The other ~330 real footprints are drawn
and available to link.

A building with no linked service shows **no** wait or queue figure at all,
because that would be an invented number.

### Accessibility

The 3D scene is never the only way in. The canvas carries a `role="img"` label
naming the real counts, a visually hidden list of live services sits in the DOM,
and `List` swaps the scene for a real table with a "Position basis" column. If
WebGL cannot start, the same table is shown with a plain-language reason.
