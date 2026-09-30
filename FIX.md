# CampusFlow — Fix Log

**Last updated:** 2026-09-30

> Every real bug found, with root cause, fix, and the evidence that it is fixed.
> **Rule R19: a fix ships with a regression test.** A bug fixed without one is not
> fixed, it is hidden.
>
> Count: **10 bugs** — 3 shipped to production, 2 self-inflicted during this
> work, 1 test defect, 1 caught while preparing a public push, 3 found by testing
> before release.

---

## Summary

| # | Severity | Area | Status | Found by |
| --- | --- | --- | --- | --- |
| 1 | 🔴 Critical | Auth | Fixed | Production symptom |
| 2 | 🔴 Critical | Deployment | Fixed | Production symptom |
| 3 | 🟠 High | Seating | Fixed | Testing |
| 4 | 🟠 High | Queue | Fixed | Code review against spec |
| 5 | 🟠 High | Queue / abuse | Fixed | Spec gap analysis |
| 6 | 🟠 High | Security | Fixed | Spec gap analysis |
| 7 | 🔴 Critical | Security | **Fixed — self-inflicted** | Live browser testing |
| 8 | 🟡 Low | Test quality | Fixed | Test suite at 19:00 IST |
| 9 | 🟠 High | Tooling / docs | **Fixed — self-inflicted** | Reading files back after editing |
| 10 | 🔴 Critical | Repo hygiene | Fixed | Preparing the first public push |

---

## #10 · The public repo was one commit away from leaking the session key

**Severity** 🔴 Critical · **Area** Repository hygiene · **Status** Fixed

**Symptom** The target repository `github.com/mouris999/Campusflow` already
existed and was **public**. `.gitignore` covered `.env*`, `node_modules/` and
`dist/`, but **not** `data/`.

**Why that mattered** `data/` contained:

| File | Contents |
| --- | --- |
| `.session-secret` | the 64-char hex HMAC key that signs session **and CSRF** tokens |
| `campusflow.json` | the database, including `user_credentials` — scrypt password hashes for every seeded account |
| `campusflow-traffic.json` | 1 MB of traffic / peak demand data |

Committing that to a public repository would have exposed the signing key used by
the live deployment. Anyone could then mint a valid session cookie for any user,
including an admin. Password hashes would also be world-readable, and the demo
credentials in this repository are published in `README.md` by design — so those
hashes correspond to passwords that are already known.

**Fix** Added `data/` and `*.session-secret` to `.gitignore` with a comment
explaining what each file holds and why the loss is recoverable but the leak is
not. Then, before committing:

1. `git check-ignore -q` on every sensitive path — all four confirmed ignored.
2. Scanned all 100 files destined for the commit for the **actual** secret value,
   a Google API key pattern, and a GitHub token pattern — clean.
3. After pushing, verified from the public internet that `data/` returns 404, and
   that both raw secret paths return 404.
4. Cloned the public repo fresh and confirmed 100 files, no `data/`.

**Prevention** `MEMORY.md` §1 records the gitignore requirement and the
`git check-ignore` one-liner to run before any commit.

**Lesson** `.env*` being ignored creates a false sense of safety. The signing key
was not in `.env` — it was generated into `data/` at first run, so it sat
outside the pattern that a reviewer would think to check. Secrets are wherever
the code writes them, not where the ignore file expects them.

---

## #1 · Logins failed intermittently across serverless instances

**Severity** 🔴 Critical · **Area** Auth · **Status** Fixed

**Symptom** Signing in worked, then failed on refresh; sometimes the session
appeared valid and sometimes not, with no pattern from the user's side.

**Root cause** Sessions were stored server-side. Vercel runs many function
instances that do not share memory, so a login written to instance A could not
be read back by instance B.

**Fix** Replaced with **stateless HMAC-signed session cookies** carrying
`{u, iat, exp, r}`. Verification is pure signature checking, so any instance can
validate any session. `r` carries the user's revocation floor so revoke-all still
works without a session table.

**Consequence to manage** `CAMPUSFLOW_SESSION_SECRET` must be identical across
all instances, or tokens signed by one are rejected by another. Set in Vercel
production env. Without it a random per-process secret is generated and logins
break again — documented in `ARCHITECTURE.md` §9.

**Evidence** `tests/auth.test.ts` (23 tests) — session issue/verify/expiry, and
tampered-signature rejection.

---

## #2 · Every API call returned 404 in production

**Severity** 🔴 Critical · **Area** Deployment · **Status** Fixed

**Symptom** The static site loaded perfectly but every `/api/*` request 404'd.
The app was a shell with no backend.

**Root cause** Vercel was serving the Vite `dist/` output only. There was no
function and no rewrite, so nothing handled `/api/...`.

**Fix** Added `api/index.ts` delegating to the shared Express factory in
`server/app.ts`, plus `vercel.json` with `functions` and two rewrites:

```json
{ "source": "/api/(.*)",    "destination": "/api/index" },
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

**Ordering is load-bearing** — the API rule must precede the SPA catch-all.

**Evidence** `GET /api/health` returns `{"success":true,"status":"ok"}` in
production; all 150 tests run through the same factory.

---

## #3 · A `completed` seat reservation was never released

**Severity** 🟠 High · **Area** Library seating · **Status** Fixed

**Symptom** Seats showed as permanently occupied after use, so availability
collapsed over a day and the map lied about how many seats were free.

**Root cause** Auto-release only handled `held` reservations that passed their
check-in deadline. A reservation that reached `completed` was never transitioned
back to available.

**Fix** Completed reservations release their seat. Availability is computed from
live reservations after the release sweep runs.

**Evidence** `tests/seating.test.ts` — cancelling and completing a reservation
both return the seat to the pool.

---

## #4 · Two students could be issued the same ticket code

**Severity** 🟠 High · **Area** Queue · **Status** Fixed

**Symptom** Two students at the same counter could hold an identical code, and
staff had no way to tell them apart.

**Root cause**
```ts
const randomTicketNum = Math.floor(100 + Math.random() * 900);
const ticket_number = `${codePrefix}-${randomTicketNum}`;
```
Only 800 possible values per service prefix, chosen at random. Collisions were
likely at any queue depth, and codes recurred throughout the day.

**Fix** `db.issueTicketCode()` issues a **per-service daily sequence**
(`<PREFIX>-<n>`), keyed `"<PREFIX>|<YYYY-MM-DD>"`. It recovers the highest
sequence already issued that day from existing tickets, so a restored backup or
lost counter cannot reissue a code.

**Live evidence** `CAN-361`, `CAN-362` issued sequentially.

**Regression tests** `tests/security.test.ts` — 40 codes with no repeat and
contiguous numbering; a new day restarts at 1; recovery continues past existing
tickets.

---

## #5 · A student on a bad connection was silently penalised

**Severity** 🟠 High · **Area** Queue / abuse controls · **Status** Fixed

**Symptom** A student whose device was offline, or whose notification never
arrived, would miss the grace window and become a no-show — a strike they could
not see coming and could not avoid.

**Root cause** Grace expiry led directly to `no_show`, and every `no_show`
counted against the student in the abuse statistics. The system could not
distinguish "did not come" from "never knew".

**Fix**
- `db.extendGraceForMissedTurn()` — staff can extend a called student's window
  **once**, so it cannot be used to hold a counter open. The student is notified
  that their place is safe.
- `no_show_penalty: false` is recorded when a no-show follows an extension.
- The no-show **rate** excludes those cases, which are reported separately as
  `no_show_excused_count` so the abuse figure stays honest rather than merely
  flattering.

**Regression tests** `tests/security.test.ts` — extension granted once, a second
attempt refused, a student cannot extend their own window (403), and a no-show
after an extension carries no penalty.

---

## #6 · No CSRF protection and no way to revoke a session

**Severity** 🟠 High · **Area** Security · **Status** Fixed

**Symptom** A third-party page could drive a signed-in student's account by
submitting requests with the student's cookie. A stolen session token could not
be invalidated without changing the signing secret, which logs out everyone.

**Fix**
- `csrfGuard` on the API router, mounted **before** any handler, with two
  independent checks: `Origin`/`Referer` must match the host, **and** the
  `x-csrf-token` header must match a token derived by HMAC from the session
  token. Either check alone has a gap, so both are required.
  - Reads (`GET`/`HEAD`/`OPTIONS`) are never blocked.
  - Requests with **no** session cookie pass through — there is no ambient
    authority to abuse. This is why login needs no token.
- `POST /api/auth/revoke-all` sets a per-user revocation floor; sessions issued
  before it are refused. O(1), no session table.
- `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` on every response.

**Live evidence** Write without a token → `403`; forged token → `403`; valid
token → `201`.

**Regression tests** `tests/security.test.ts` (16 tests) including cross-origin
refusal, per-session binding, and revoke-all.

---

## #7 · Five client write paths returned 403 in production ⚠️ self-inflicted

**Severity** 🔴 Critical · **Area** Security / client · **Status** Fixed

**This regression was caused by fix #6.** Recorded in full because the failure
mode matters.

**Symptom** After CSRF was enabled, several parts of the app silently stopped
working: "Join queue there" failed, sign-out left the student apparently signed
in, traffic preference saves were dropped, and — worst — **queued offline actions
could never replay on reconnect**.

**Root cause** CSRF was applied to the server and to the first nine client write
sites I found. I missed others that used a bare `fetch()`:
`TrafficContext` (4), `PeakIntelligencePanel` (1), `VeoVideoAnimator` (2),
`AppContext` logout, and the offline outbox replay.

**Why it was not caught by tooling** TypeScript compiled cleanly, the build
succeeded, and the entire 142-test suite passed — because the tests all went
through the helper that *did* attach the header. **Nothing about this mistake
produces a build error.** I found it by clicking through the live app and reading
the on-screen error.

**Fix** All nine sites moved to `secureWrite()` / `request()` / an explicit
header. The outbox replay now resolves the token too, so a queued action is not
rejected on reconnect.

**Prevention — the important part**
`tests/csrf-coverage.test.ts` scans every client source file for a `fetch()`
write lacking a CSRF path and fails the build. It caught one further offender
immediately. This exists because of rule **R21**: when a mistake produces no
build error, add a test that scans for it.

**Verification** Live in the browser: "Join queue there" succeeds, ticket cancel
succeeds, sign-out returns to the sign-in screen, zero console errors.

---

## #8 · A test passed at 11:00 and failed at 19:00

**Severity** 🟡 Low · **Area** Test quality · **Status** Fixed

**Symptom** The suite went from 150/150 to 148/149 with no code change. The
failure was *"alternatives are returned with the reasons that produced them"* —
`the seeded campus should offer a quieter branch`.

**Diagnosis** Not a product bug. At 19:03 IST the only alternative canteen was
genuinely closed, so the engine correctly reported it
`blocked: outside_operating_hours` instead of recommending it. The **test** was
wrong: it encoded a premise about opening hours.

**Fix** The test now asserts the API contract unconditionally — every
recommendation carries a reason, a positive saving and verified availability;
every unusable candidate states why; the two lists never contradict. A second
test asserts the closed-branch invariant explicitly. The engine's filtering
rules remain covered by 12 **time-independent** tests in `alternatives.test.ts`
using controlled `is_open_now` fixtures.

**Why it matters** A test that depends on the wall clock will fail in CI at an
unpredictable hour and trains people to ignore red. Rule **R22** now forbids it.

---

## #9 · A PowerShell edit silently corrupted three documents ⚠️ self-inflicted

**Severity** 🟠 High · **Area** Tooling / documentation · **Status** Fixed

**Symptom** While updating test counts across several markdown files, a single
PowerShell loop corrupted three of them. `README.md` ended up with **zero `1`
characters** — every `1` had become `5`. `TASKS.md` had every `t` replaced with
`e` ("Task Regiseer"). `PRD.md` had every capital `T` replaced with `h`.

**Root cause** The script built a list of `{ file, pairs }` objects and iterated
them. For files with a **single** replacement pair, PowerShell flattened the
one-element inner array, so `$pair[0]` and `$pair[1]` resolved to the *first and
second characters of the pattern string* rather than to the pattern and its
replacement. `$content.Replace('1', '5')` then ran over the whole file. Files with
two or more pairs were unaffected, which made the damage look selective and
inconsistent.

**Why it was nearly missed** The command reported success. Nothing was thrown, and
`WriteAllText` wrote valid UTF-8 — just the wrong characters. Markdown still
renders; the documents merely read as nonsense.

**Fix** Rewrote all three files from their known-good source using the file-write
tool, which takes the whole content rather than doing a string substitution.
Verified by byte inspection: no stray `?` or replacement characters remain, and
the only `?` characters in the corpus are legitimate (the `(?!)` regex in the
Vercel rewrite, and "why is it long?").

**Prevention — the actual lesson**

1. **Read a file back after a bulk programmatic edit.** This is the whole fix. I
   had been writing files and trusting the exit code; the corruption was only
   visible because I printed a sample. That check costs nothing and would have
   caught it immediately.
2. **Never use `String.replace` for bulk edits across files with a dynamically
   built pattern list.** Write the file whole, or use an explicit two-element
   structure that cannot collapse.
3. `tests/docs.test.ts` would not have caught this one — it checks that documents
   *exist* and that specific facts are *present*, not that prose is uncorrupted.
   That is a known limit, recorded in `MEMORY.md`.

**Note on history** Entries #1–#8 above remain as written. The "150 tests" figures
in #2 and #8 were accurate when written and are left unedited, because rewriting
them would falsify the record of what was true at the time. Current counts live
in `DASHBOARD.md` and are enforced by `tests/docs.test.ts`.

---

## Not bugs — verified correct behaviour
Recorded so they are not "fixed" later by mistake.

| Observation | Why it is correct |
| --- | --- |
| Empty alternatives list at night | A closed service is reported unusable, not recommended. Suggesting it would violate `PRD.md` §5 |
| 403 on a raw `fetch()` from the console | The CSRF guard working. The app's own path attaches the token |
| `storage: ephemeral` on Vercel | `paths.ts` correctly detecting a read-only bundle, and disclosing it |
| Small production analytics numbers | The storage blocker, not a calculation error. Disclosed in `docs/KPIS.md` |
| "Not enough history yet" | The honest response required by rule R2 |
