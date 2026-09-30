# CampusFlow — Project Dashboard

**Last updated:** 2026-09-30 · **Deployment:** `https://campus-flow-sigma-six.vercel.app`
**Health:** `{"status":"ok","storage":"ephemeral"}`

> The single page to look at to know where the project stands. Updated in the same
> change as any status change. See `TASKS.md` for the detailed register and
> `FIX.md` for the bug history.

---

## Overall status

| | |
| --- | --- |
| **Build** | ✅ green — typecheck clean, production build clean |
| **Tests** | ✅ **161 / 161 passing** across 11 suites |
| **Deployed** | ✅ production, verified live in a browser |
| **Documentation** | ✅ 10 documents, all current |
| **Blocking issue** | ⛔ **1** — no durable database on Vercel |
| **Open work items** | 8 (see `TASKS.md` §3) |
| **Known partial areas** | 4 — real-time hardening, display board, PWA/i18n, security CI |

## Health checks

| Check | Command | Result |
| --- | --- | --- |
| Types | `node node_modules\typescript\bin\tsc --noEmit` | ✅ 0 errors |
| Tests | `node --import tsx --test tests/*.test.ts` | ✅ 161/161 |
| Build | `node node_modules\vite\bin\vite.js build` | ✅ `dist/` in ~0.9 s |
| API health | `GET /api/health` | ✅ `status: ok` |
| Bundle | — | 496 kB JS / **134 kB gzip**, 95 kB CSS / 16 kB gzip |

## Test coverage by area

| Suite | Tests | Status |
| --- | --- | --- |
| `seating.test.ts` | 28 | ✅ |
| `auth.test.ts` | 23 | ✅ |
| `api.test.ts` | 22 | ✅ |
| `security.test.ts` | 16 | ✅ |
| `alternatives.test.ts` | 12 | ✅ |
| `prediction.test.ts` | 11 | ✅ |
| `token.test.ts` | 11 | ✅ |
| `intent.test.ts` | 10 | ✅ |
| `explain.test.ts` | 10 | ✅ |
| `csrf-coverage.test.ts` | 7 | ✅ |
| `docs.test.ts` | 10 | ✅ documentation stays present and true |

Trend: 87 → 126 → 150 → **161** tests over the project's life.

## Five capabilities — acceptance

| Capability | Implemented | Connected | Usable | Tested | Verified | Evidence |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| Traffic + peak intelligence | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/trend.ts`, `TrafficPeakPanel.tsx` |
| Real virtual token | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/token.ts`; live `CAN-361` |
| Library seat allocation | ✅ | ✅ | ✅ | ✅ | ⚠️ | 28 tests pass; **production persistence broken by ephemeral storage** |
| AI ordering alternatives | ✅ | ✅ | ✅ | ✅ | ✅ | `intelligence/alternatives.ts`; 12 deterministic tests |
| Reliable offline | ✅ | ✅ | ✅ | ✅ | ⚠️ | shell/outbox verified; queue position not persisted across instances |

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
3. Tell me to continue — I then run `npx vercel integration add neon` and
   implement the adapter in `server/db.ts` (the single read/write seam, so no
   caller changes)

**Mitigation in place:** `IS_EPHEMERAL_STORAGE` is surfaced via `/api/health` and
a staff/admin banner (`StorageNotice.tsx`), so partial numbers are never
presented as campus-wide truth. `docs/KPIS.md` §"Known reporting bias" documents it.

**Alternative if declined:** self-host with a persistent volume —
`NODE_ENV=production CAMPUSFLOW_DATA_DIR=/var/lib/campusflow npm start`.
Would be verified and documented before being called production-ready.

### ℹ️ B2 — `GEMINI_API_KEY` not configured

The AI Concierge returns a clear "not configured" error by design. Not a defect;
recorded so it is not mistaken for one.

## Recently changed

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-09-30 | Ticket codes → per-service daily sequence (was random, could collide) | `FIX.md` #4; live `CAN-361`, `CAN-362` |
| 2026-09-30 | CSRF protection + session revocation | `FIX.md` #6; 16 security tests |
| 2026-09-30 | Missed-turn protection — no strike for an unreachable student | `FIX.md` #5 |
| 2026-09-30 | **Regression fixed:** 5 client write paths returned 403 in production | `FIX.md` #7; found by browser testing, not by the build |
| 2026-09-30 | Wall-clock-dependent test replaced with a contract assertion | `FIX.md` #8 |
| 2026-09-30 | 50-way concurrency tests (spec §11 target) | 1 winner / 49 refused |
| 2026-09-30 | Full documentation set created | 10 documents |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Ephemeral storage loses queue/seat data | **Certain** on Vercel | High | B1; disclosed in-product |
| JSON write is O(document) | Medium at scale | Medium | Single-seam DB adapter is the fix; fine at single-campus scale |
| New client writes missing CSRF | Was **high**, now low | High | `csrf-coverage.test.ts` fails the build |
| Model drift in the wait estimator | Low | Medium | MAE / MAPE / bias published, not hidden |
| No automated accessibility CI | Medium | Medium | Manual review at 3 widths; axe/Lighthouse queued |

## Next step

**Waiting on the owner** to accept the Neon marketplace terms (B1). Everything
else is buildable now; the queue is: notification outbox → display board →
security CI → i18n.
