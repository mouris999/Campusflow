# CampusFlow — Working Rules

**Last updated:** 2026-09-30

> The rules I operate under. These are not aspirations; each one corresponds to a
> concrete failure mode that has already occurred in this project.
> Violating any rule is a defect, not a style preference.

---

## 1. Honesty rules — the non-negotiables

**R1. No fakes.** No dead buttons, no invented statistics, no simulated
real-time, no fake notifications, no fake predictions, no placeholder analytics
presented as real. Demo or seeded data must be identifiable as such.
*Why:* the entire value of the product is that a number means something.

**R2. Never invent a number.** If the history is insufficient, say
*"Not enough history yet"* and name the reason. Do not estimate into existence.
*Why:* a plausible wrong number is worse than no number.

**R3. Offline never fabricates a server action.** No optimistic fake tokens,
seats, orders or check-ins. A deferred action shows as *Queued*, never as done.
*Why:* a student who acts on a fake confirmation arrives to nothing.

**R4. Never claim success for a failed operation.** If a write failed, say so and
surface the real error.

**R5. Disclose the system's own limits.** Ephemeral storage, stale data,
low-confidence forecasts, and coverage gaps are shown to the user — staff,
admins and students alike. See `StorageNotice.tsx` and `FreshnessBadge.tsx`.

## 2. Change rules

**R6. Smallest safe change.** Inspect before editing. Preserve working features,
navigation, auth, queues, analytics and staff tools.

**R7. Reuse before building.** If an engine already exists — peak forecast, queue
engine, alternatives, AI guard — extend it. Duplicating logic guarantees the two
copies drift and produce contradictory answers.

**R8. Keep the engines pure.** `server/intelligence/*` never imports Express or
the database. That is what makes them unit-testable.

**R9. All persistence through one seam.** Reads and writes go through
`server/db.ts` so a real database can replace the JSON store without touching
callers.

**R10. Deny by default.** A new route declares its own guard. No guard means a
deliberate public decision, visible in the source.

## 3. Security rules

**R11. Every state change is CSRF-protected.** Both the `Origin` check and the
token check — except sign-in, which establishes a session rather than using
one and is exempted from the token check only. Any new client write goes
through `secureWrite()` or `request()`; a bare `fetch(..., {method:'POST'})`
is a bug.
*Why:* five such paths shipped broken before the guard test caught them,
and the over-broad guard then locked users out of signing in entirely.

**R12. Least privilege.** A student may act only on their own records
(`requireSelfOrRole`). Horizontal access (IDOR) and vertical access (role
escalation) are both tested.

**R13. Privacy is enforced server-side.** Redact in the data layer
(`getQueueEntriesForViewer`), not in the UI. Hiding with CSS is not privacy.

**R14. No default credentials.** First admin requires an explicit bootstrap
token. Demo sign-in is switchable off via `CAMPUSFLOW_DEMO_AUTH=false`.

**R15. Secrets only from the environment.** Never in source, never in a client
bundle, never in a log line.

**R15a. An external identity proves identity, never authority.** A Google or
Firebase token may only authenticate an account that already exists in
`server/db.ts`, and the role always comes from that database. No code path may
read a role, an email domain or an admin flag out of a provider's claims. An
unknown email is refused, never auto-provisioned, because auto-provisioning
turns "anyone with a Google account" into a registration flow nobody approved.

**R15b. A shared-key provider still needs a project pin.** Every Firebase project
signs with keys from one JWKS endpoint, so a valid signature proves only that
*some* Firebase project signed the token. `server/firebase-auth.ts` therefore
compares both `aud` and `iss` against `CAMPUSFLOW_FIREBASE_PROJECT_ID`, and
refuses every token when it is unset. Removing that comparison is an
authentication bypass, not a simplification: it would let an attacker sign in as
any address using their own free Firebase project.

**R16. Timings compared safely.** `crypto.timingSafeEqual` for secrets, tokens
and password hashes.

## 4. Testing rules

**R17. DONE = implemented + connected + usable + tested + verified with
evidence.** Compiling is not done. A happy path is not done.

**R18. Test failure, concurrency, offline and regression cases** — not just the
happy path. The spec's target is 50-way concurrency; it is met for seat
allocation and queue joins.

**R19. A fix ships with a regression test.** A bug fixed without a test that
fails before it and passes after is not fixed, it is hidden.

**R20. Verify against the real database**, not mocks, for anything touching
persistence or concurrency.

**R21. Guard against silent runtime failures.** If a mistake produces no build
error, add a test that scans for it. `csrf-coverage.test.ts` is the precedent.

**R22. Tests must not depend on the wall clock.** A test that passes at 11:00 and
fails at 19:00 is broken. Use controlled fixtures, or assert the contract
instead of a data-dependent premise.
*Why:* `api.test.ts` asserted a canteen branch was open and failed at 19:00 IST.

**R23. Failing tests block deploy.** No exceptions, no "it was only that one test".

## 5. Accessibility rules

**R24. Never signal by colour alone.** Always icon **and** text.
**R25. Every chart has a table or text equivalent** underneath it.
**R26. Keyboard operable**, with visible focus and managed focus on route change.
**R27. `aria-live="polite"`** for position changes, **`"assertive"`** only for a
student's turn.
**R28. Touch targets ≥ 44 px**; text scalable to 200%.
**R29. Respect `prefers-reduced-motion`.** Nothing decorative animates.
**R30. Verify at 375 / 768 / 1280 px.**

## 6. Documentation rules

**R31. Every change updates the docs it affects, in the same change:**

| Change type | Must update |
| --- | --- |
| Product scope, behaviour, acceptance | `PRD.md` |
| Stack, structure, storage, auth, deployment | `ARCHITECTURE.md` |
| A rule or a new operating constraint | `RULES.md` |
| Tokens, components, states, interaction | `DESIGN.md` |
| Work items, status, build order | `TASKS.md` |
| Status, metrics, blockers, next step | `DASHBOARD.md` |
| Non-obvious environment or codebase knowledge | `MEMORY.md` |
| Any bug found and fixed | `FIX.md` |
| A capability's evidence | `VERIFICATION.md` |
| A displayed figure's formula | `docs/KPIS.md` |
| Setup, commands, roles, doc index | `README.md` |

`tests/docs.test.ts` enforces this rule mechanically: it fails when a document is
missing or stubbed, when a documented number stops matching the code (test
counts, component inventory), when a bug lands without a `FIX.md` entry, or when
`DASHBOARD.md` overstates coverage. A rule nobody checks is a rule nobody
follows, so this one is checked.

**R32. Never document an aspiration as a fact.** If something is not built, mark
it ⚠️ or ❌ and say what is missing.

**R33. After three failed attempts on one issue, log it and move on.** Record it
in `DASHBOARD.md` blockers with the exact error, rather than burning effort.

## 7. Interaction rules

**R34. Batch independent tool calls**; write each file once, complete.
**R35. Don't do work the user did not ask for.** "Make it better" means fix real
defects — not redesign the UI, rename things, or add scope.
**R36. Don't narrate git or deploy internals** to the owner; speak in product terms.
**R37. Report honestly, including regressions I caused.** State the bug, the
impact, and the fix. Do not bury a self-inflicted break.
