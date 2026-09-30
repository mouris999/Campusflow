# CampusFlow — Product Requirements Document

**Status:** production-ready, deployed · **Last updated:** 2026-09-30

> The source of truth for *what CampusFlow is and why*. Any change to product
> scope, behaviour or acceptance criteria must be reflected here in the same
> change. See `RULES.md` for the operating rules and `DASHBOARD.md` for live status.

---

## 1. Problem

College students waste time standing in physical lines for services they could
have joined remotely, and nobody can tell them *when* or *where* to go instead.
Staff cannot see why a queue is long. Administrators cannot show who was affected.

CampusFlow is a single web platform that fixes all of that. It is **not a demo** —
every figure, queue, seat, token and recommendation is computed from stored records.

## 2. Users and roles

| Role | Can do | Cannot do |
| --- | --- | --- |
| **student** | Browse services, compare waits, join a virtual queue, hold a token, book a library seat, book appointments, see own activity | See any other student's identity, call the next student, change capacity, see analytics or audit logs |
| **staff** | Everything a student can, plus call/serve/skip/complete, open and close services, change capacity, record incidents and delay reasons | Change service configuration, edit capacity without a reason, run simulations, read the audit log |
| **admin** | Everything staff can, plus service configuration, analytics, simulation, audit log, seed reset, revoke-all sessions | — |

Access is **deny by default**. Every route declares its own guard; the client
hides what the server would refuse anyway — defence in depth, not the control.

## 3. The five problems, and how each is measured

| # | Problem | Capability | Measurable outcome |
| --- | --- | --- | --- |
| **P1** | Students cannot compare services before travelling | Discovery hub: status, hours, queue, wait range, congestion, appointments, documents, alternatives, closures | Student finds a service and joins in **≤ 2 taps** from Home |
| **P2** | Nobody knows *when/where/why* waits are long | Structured queue, demand, capacity and delay-reason records with dashboards | "Why is it long?" lists **only computed factors**, or says it cannot yet be determined |
| **P3** | Students must physically stand and wait | Server-backed virtual queue: live position, virtual token, "leave by" time, check-in, grace handling | Student leaves and is called back; position updates live |
| **P4** | Simultaneous demand overwhelms counters | Demand-vs-capacity engine with evidence-backed options; capacity changes only via authorised staff action | Overload shown with the **numbers behind it**, never auto-applied |
| **P5** | The people who lost time are invisible | Impact measurement from real records | Students affected, aggregate minutes lost, abandonment, no-shows, repeat visits |

## 4. Capability inventory

### 4.1 Core
- Service discovery with search, filters, and service detail
- Virtual queue: join, position, call, serve, complete, skip, cancel, check-in
- Server-issued **virtual tokens** — `<PREFIX>-<daily sequence>`, unique per service per day, never reused that day
- Appointments with no double-booking
- Notifications (in-app) and announcements
- Staff operations console
- Admin analytics, KPI dashboard, capacity simulation, audit log
- Campus map, live traffic view, AI Concierge (optional key)

### 4.2 Added 2026-09-30 (see `FIX.md` and `VERIFICATION.md` §0)
- **Traffic + peak intelligence** — hour×weekday heatmap, "now vs usual", best time to visit, each labelled Live / Historical / Forecast / Estimate
- **Library seat allocation** — zones, 88 seats, live map with a table fallback, atomic reservation (no double-booking), check-in grace, auto-release
- **Transparent alternatives** — ranked by total time, every suggestion states its arithmetic, blocked candidates reported as unusable rather than hidden
- **Offline operation** — service worker shell, cached reads, outbox with idempotency replay, blocked actions explained rather than faked
- **Security hardening** — CSRF protection, session revocation, collision-free ticket codes, missed-turn protection

## 5. Non-negotiable product rules

These are product requirements, not implementation details. See `RULES.md`.

1. **No fakes.** No dead buttons, invented statistics, simulated real-time, fake
   notifications, fake predictions or placeholder analytics presented as real.
2. **No invented numbers.** Insufficient history is stated as *"Not enough history yet"*,
   never estimated into existence.
3. **Offline never fabricates.** No optimistic fake tokens, seats, or orders.
4. **Privacy by default.** Students appear to each other only as ticket codes; names
   and IDs are redacted server-side, not hidden with CSS.
5. **Honest about its own limits.** Ephemeral storage, stale data, and low-confidence
   forecasts are surfaced to the user, not hidden.

## 6. Success metrics

| Metric | Target | Source |
| --- | --- | --- |
| Join-to-served abandonment | < 10% | `abandonment_rate_pct` |
| No-show rate (penalised only) | < 5% | `no_show_rate_pct` |
| Prediction MAE | < 5 min | `avg_prediction_error_mins` |
| Range coverage | 40–60% | `prediction_accuracy_pct` |
| Double-booking incidents | **0** | seat/appointment concurrency tests |
| Unauthenticated write acceptance | **0** | CSRF tests |
| Blocking accessibility defects | **0** | keyboard / screen-reader / contrast review |

Every formula is documented in `docs/KPIS.md`.

## 7. Out of scope

Deliberately **not** built, and why:

- **3D landing page / scroll-scrub marketing site** — the directive is to preserve
  the existing UI and not add decoration that carries no data.
- **Separate staff and student mobile apps** — one responsive web app covers both;
  a second app doubles the maintenance surface for no student benefit.
- **Predictive ML models** — the estimator is transparent and auditable. A model
  nobody can explain is worse than a stated formula with a measured error rate.
- **Payments** — canteen ordering is tracked for queue purposes, not billing.
- **Push/SMS notification providers** — in-app delivery always works; external
  providers are configured by the operator, never assumed.

## 8. Constraints

- **Deployment target is Vercel** (serverless). This is the single hardest
  constraint; it is why storage is currently ephemeral. See `DASHBOARD.md`
  blocker B1 and `ARCHITECTURE.md` §7.
- **No default credentials.** First admin requires an explicit bootstrap token.
- **Privacy law (GDPR-style)** — purpose limitation, retention, self-service
  export and delete. Pseudonymous internal IDs throughout.

## 9. Acceptance

A capability ships only when it is **implemented + connected + usable + tested +
verified with evidence**. "It compiles" and "the happy path works" are explicitly
not sufficient.

- Requirement → evidence matrix: `VERIFICATION.md`
- Formula for every displayed figure: `docs/KPIS.md`
- Work plan and open items: `TASKS.md`
- Bug history: `FIX.md`
- Live status and blockers: `DASHBOARD.md`
