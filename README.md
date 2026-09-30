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
| Student | `alex.rivera@metrouni.edu` | `student123` |
| Staff | `sarah.chen@metrouni.edu` | `staff123` |
| Admin | `m.vance@metrouni.edu` | `admin123` |

Also seeded and usable for testing, though not listed on the sign-in screen:
`maya.lin@metrouni.edu` and `david.okafor@metrouni.edu` (both `student123`).

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

161 tests across 11 suites, all passing.

| Suite | Tests | Covers |
| --- | --- | --- |
| `seating.test.ts` | 28 | allocation, expiry, windows, concurrency |
| `auth.test.ts` | 23 | login, hashing, RBAC, IDOR, rate limiting |
| `api.test.ts` | 22 | endpoint contracts, alternatives, peaks |
| `security.test.ts` | 16 | CSRF, revocation, ticket codes, grace, 50-way races |
| `docs.test.ts` | 11 | documentation stays present and true |
| `alternatives.test.ts` | 12 | ranking, hard filters, thresholds |
| `prediction.test.ts` | 11 | estimator, confidence, MAE |
| `token.test.ts` | 11 | virtual token issuance and views |
| `intent.test.ts` | 10 | natural-language service resolution |
| `explain.test.ts` | 10 | "why is it long?" grounded in computed factors |
| `csrf-coverage.test.ts` | 7 | every client write carries a CSRF token |

Two suites are unusual on purpose:

- `csrf-coverage.test.ts` scans the client source for writes that would be
  rejected at runtime with **no build error**. It exists because of a real
  shipped regression (`FIX.md` #7).
- `docs.test.ts` fails when a document goes missing, when a documented number
  stops matching the code, or when a bug lands without a `FIX.md` entry.
