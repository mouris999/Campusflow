# CampusFlow — Feature Verification Matrix

**Last updated:** 2026-09-30

Every row was verified by running the real application against the real backend
and the real database. "Evidence" names the test or the manual check that proves it.

Legend: ✅ implemented + connected + tested + verified · ⚠️ partial (limitation stated)

---

## 0. Security & Data Integrity (added 2026-09-30)

| Requirement | Status | Evidence |
| --- | :---: | --- |
| CSRF protection on every state change | ✅ | `csrfGuard` in `server/auth.ts`, mounted on the API router; live: write without token → `403`, forged token → `403`, valid token → `201` |
| Token bound to its own session | ✅ | test *"the CSRF token is bound to its own session"* — another session's token is refused |
| Cross-origin writes refused | ✅ | test *"a cross-origin write is refused even with a valid token"* (`Origin` mismatch → 403) |
| Reads are never blocked | ✅ | test *"reads are never blocked by the CSRF guard"* |
| Session revocation (sign out everywhere) | ✅ | `POST /api/auth/revoke-all`; test *"revoke-all invalidates sessions issued before it"* — old cookie → `401` |
| **Ticket codes never collide** | ✅ | Was a real bug: `Math.floor(100 + random*900)` gave only 800 values per service, so two students could hold the same code. Now a per-service daily sequence (`issueTicketCode`), recovered from existing tickets if the counter is lost. Live: `CAN-361`, `CAN-362` |
| A code is never reused on the same day | ✅ | test *"ticket codes are a per-service daily sequence, never reused"* (40 codes, contiguous, no repeats) |
| Missed-turn protection | ✅ | `POST /api/queue/:id/extend-grace`; grace extends **once**, the student is told, and **no penalty is recorded** — a flaky connection is not treated as a no-show |
| No-show rate excludes unreachable students | ✅ | `no_show_penalty` flag; excused cases reported separately as `no_show_excused_count` so abuse stats stay honest |
| A student cannot extend their own grace | ✅ | test *"a student cannot extend their own grace window"* → `403` |
| 50-way concurrency (§11 target) | ✅ | *"50 parallel seat requests for one seat"* → exactly 1 winner, 49 refused, 1 live holder. *"50 parallel joins with one idempotency key"* → 1 ticket |
| Every client write carries the token | ✅ | `tests/csrf-coverage.test.ts` scans all 60+ client source files for a `fetch()` write without a CSRF path. **This caught a shipped regression** — 4 components plus the offline outbox were returning `403` in production |
| Offline outbox replays with the token | ✅ | test *"the offline outbox replays writes with the CSRF token"* — a queued action is not rejected on reconnect |
| Security headers | ✅ | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on every response |
| KPI formulas documented | ✅ | `docs/KPIS.md` — every displayed figure traced to its formula, including what is deliberately *not* a KPI |

### Regression found and fixed during this work

Enabling CSRF initially broke five write paths that the first pass had missed
(`TrafficContext` ×4, `PeakIntelligencePanel`, `VeoVideoAnimator` ×2, logout, and
the offline outbox replay). They returned `403` in production with no build-time
error. All are fixed, verified live in the browser, and now guarded by a
source-scanning test so the class of bug cannot recur.

A pre-existing test, *"alternatives are returned with the reasons that produced
them"*, was also found to be wall-clock dependent: it assumed a second canteen
was open, so it failed at 19:00 IST. The product was correct — the closed branch
was properly reported `blocked: outside_operating_hours`. The test now asserts
the API contract, and the engine's filtering rules remain covered by 12
time-independent tests in `alternatives.test.ts`.

---

## 1. Traffic + Peak-Time Intelligence

| Requirement | Status | Evidence |
| --- | :---: | --- |
| Live traffic from real queue/demand/capacity | ✅ | `effectiveTrafficState()` — existing engine reused, not duplicated |
| Traffic trend (rising / stable / falling) | ✅ | `server/intelligence/trend.ts`; `GET /api/intelligence/services/:id/trend`; live check → `unknown / Traffic trend unavailable` |
| Trend refuses to guess without data | ✅ | `too_few_recent_samples`, `no_recent_samples`, `no_baseline` reasons; test *"the traffic trend endpoint answers for a real service"* |
| Peak window | ✅ | `computePeakForecast` (pre-existing) surfaced in `TrafficTimeline` |
| Forecast labelled as forecast | ✅ | `FORECAST · {confidence} confidence ({pct}%)`; `HISTORICAL PATTERN` badge; `ESTIMATE` badge on best-time |
| Insufficient history handled honestly | ✅ | "Not enough history yet to draw a traffic profile" — verified live |
| Visual timeline | ✅ | `TrafficTimeline` — bar height + glyph + text label, never colour alone |
| Text equivalent of the chart | ✅ | `role="img"` with `describeTimeline()`; `aria-label` per bar |
| Best time to visit, labelled as estimate | ✅ | `BestTimeCard` with `ESTIMATE` badge + "does not guarantee" |
| Peak alerts with working actions | ✅ | Pre-existing `getAlerts`; actions route to real alternatives / join queue |

## 2. Real Virtual Token / Virtual Queue

| Requirement | Status | Evidence |
| --- | :---: | --- |
| Server-created token | ✅ | `POST /api/queue/join` → `LIB-759` live in production |
| Token tied to the real queue | ✅ | `buildTokenView()` derives from the stored `QueueEntry` |
| Position / ETA / leave-by | ✅ | Live: `pos=1 phase=approaching eta=0m leave_by=09:37` |
| Full state machine | ✅ | `waiting → approaching → called → check_in_required → checked_in → serving → completed`, exits `cancelled/expired/no_show/skipped` |
| Backend is authoritative | ✅ | Test *"the token endpoint reflects live server state, not browser memory"* |
| Token survives refresh / new tab | ✅ | `GET /api/queue/my-token`; verified after full page reload |
| Real-time updates | ✅ | SSE (pre-existing) + 20s poll; `stale_after_secs` exposed |
| Notifications | ✅ | Pre-existing notification engine on queue events |
| Duplicate protection — repeat request | ✅ | Test *"a repeated join with the same idempotency key does not create two tickets"* |
| Duplicate protection — double click | ✅ | Test *"parallel joins with the same key still produce a single ticket"* (5 concurrent → 1 ticket) |
| Duplicate protection — refresh | ✅ | Re-join refused with "already hold an active ticket" |
| **No stale idempotency cache** | ✅ | Bug found and fixed: cache only engages with an explicit key. Test *"re-joining after finishing a previous visit creates a new ticket"* |
| Cancellation + check-in | ✅ | Verified live and by test *"cancelling a token removes it from the active set"* |
| No identity leak in token | ✅ | Test *"the token never exposes another student identity"* |

## 3. Library Seating Allocation

| Requirement | Status | Evidence |
| --- | :---: | --- |
| Real capacity, not hardcoded | ✅ | 88 seats generated into the DB; live: `total=88 available=85` |
| Unique seat IDs | ✅ | `A-001…`, `B-001…`, `C-001…`; uniqueness asserted in test |
| Seat states | ✅ | `available / held / reserved / occupied / maintenance / unavailable` |
| Server-authoritative allocation | ✅ | `POST /services/:id/seats/:seatId/reserve` |
| **No double booking (concurrent)** | ✅ | Test fires two simultaneous requests for one seat → exactly 1 wins, 1 gets 409. Verified live (409) |
| One hold per student per location | ✅ | Test *"a student cannot reserve a second seat while already holding one"* |
| Maintenance seat refused | ✅ | Test *"a maintenance seat cannot be reserved"* |
| Opening-hours enforcement | ✅ | Test *"reservations outside opening hours are refused"* |
| Check-in deadline | ✅ | `check_in_deadline` = start + 10 min; `check_in_required` exposed |
| Expiration releases the seat | ✅ | `expireStaleReservations()`; tests for expiry and for not-expiring-before-start |
| **Timezone correctness** | ✅ | Bug found: expiry compared campus wall-clock against server-local. Fixed with `campusTimeToUtc()`; tested across UTC / Kolkata / Los Angeles |
| **Completed stay frees the seat** | ✅ | Bug found: `completed` reservations blocked the seat forever. Fixed + tested |
| Seat map | ✅ | Zone-grouped grid, verified live with 88 seats |
| List/table fallback | ✅ | Verified live: 88 rows, headers `Seat│Zone│Floor│Status`, `<caption>` present |
| Non-colour state encoding | ✅ | Glyph (`○ ◐ ◑ ● ✕ ⊘`) **and** word in every seat button, chip and table cell |
| Keyboard / screen-reader | ✅ | `aria-label` on every seat; `<table>` with caption and `<th scope>` |
| Traffic + seating together | ✅ | Seating panel and trend panel render in the same service view |

## 4. AI-Powered Smart Ordering Alternatives

| Requirement | Status | Evidence |
| --- | :---: | --- |
| Item verified, never hallucinated | ✅ | Pre-existing `resolveIntent` refuses unknown items; test *"does not fabricate a match for an unknown request"* |
| Store verified open + in stock | ✅ | `isServiceOpenNow()` + catalogue availability gate |
| Total time = walk + queue + preparation | ✅ | Pre-existing scoring; `time_saved_mins` from real numbers |
| Walking time included | ✅ | `walk_mins` per alternative; capped by `MAX_PROMOTED_WALK_MINS` |
| Approximate saving wording | ✅ | "may save about N minutes" |
| Explanation of why | ✅ | Per-alternative `reasons[]` |
| **No forced recommendation** | ✅ | `MIN_NET_SAVED_MINS` threshold; blocked candidates returned as `not_usable` |
| AI failure fallback | ✅ | Pre-existing guarded explainer falls back to a deterministic narrative; test *"falls back when the provider fails"* |
| **AI cannot invent numbers** | ✅ | Pre-existing `guard.ts`; test *"rejects a narrative that invents a number"* |
| One-click transfer | ✅ | `redirected_from_service_id` + `recommendation_id` recorded on join |

## 5. Offline / No-Network Operation

| Requirement | Status | Evidence |
| --- | :---: | --- |
| Offline detected from a real failure | ✅ | `reportNetworkFailure()` on a genuine request error, not `navigator.onLine` alone |
| Cached data remains usable | ✅ | Verified with the server stopped: app boots, 10 services served from cache |
| Stale data clearly labelled | ✅ | `LIVE / CACHED / STALE / OFFLINE` badge + `x-cf-offline` / `x-cached-at` headers |
| **App shell precached with hashed assets** | ✅ | Bug found: `index.html` was cached but not the hashed JS/CSS, so the app booted to a blank page. Fixed by parsing `index.html` at install. Verified: `["/","/index.html","/manifest.webmanifest","/icon.svg","/assets/index-*.js","/assets/index-*.css"]` |
| **Navigation falls back on 5xx** | ✅ | Bug found: `fetch()` resolves on 5xx, so a 502 error page was shown instead of the app. Fixed to require `response.ok` |
| Live-only data never faked | ✅ | `/api/queue`, `/api/queue/user`, `/api/seats/mine`, `/api/auth/session` are network-only |
| Tokens never fabricated | ✅ | Offline write → 502; UI shows the offline guard, never a token |
| Seats never fabricated | ✅ | Offline reserve attempt → 502, not a confirmation |
| Orders never falsely confirmed | ✅ | No offline order path exists; writes always require a server response |
| Pending actions explicit | ✅ | `pendingActions.ts` — queued, labelled `PENDING — not confirmed`, user can discard |
| Reconnect syncs from server | ✅ | Replays pending actions, refreshes live state, shows "Connection restored" |
| Retry with backoff | ✅ | `withRetry()` — exponential, bounded, cancellable |
| Idempotent retries | ✅ | Every pending action carries an `idempotency_key` replayed to the server |
| Network-first for live data | ✅ | Bug found: stale-while-revalidate served cached data while online. Fixed to network-first with labelled cache fallback |

---

## Known limitations (stated, not hidden)

1. **Serverless storage is ephemeral.** `/api/health` reports
   `"storage":"ephemeral"`. Queue, seat and notification state is real and
   works, but resets when the instance recycles. Fix: point `server/db.ts` at a
   real database, or run with a persistent volume. Provisioning Neon/Upstash
   needs marketplace terms accepted in a browser.
2. **Traffic trend needs recent samples.** With only historical daily/hourly
   demand and few live samples, the endpoint correctly returns `unknown`. The
   engine needs a few hours of live traffic before it can say "rising".
3. **Seat map size.** 88 seats render directly; a campus with thousands would
   need virtualisation (noted in code, not required at this scale).

## Regression safety

- 124 automated tests pass (was 87 before this work; +37 covering the new features)
- `tsc --noEmit` clean
- Production build succeeds
- Pre-existing capabilities untouched: authentication, RBAC, privacy redaction,
  queue engine, SSE, peak prediction, alternatives, analytics, staff and admin
  tools all still pass their original tests
