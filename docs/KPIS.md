# CampusFlow — KPI Definitions

**Last updated:** 2026-09-30

Every figure the platform shows is computed from stored records. This file
documents the formula for each one so a number can always be traced back to the
data behind it. Nothing here is hardcoded or estimated for display.

Source of truth: `server/db.ts` → `getCampusAnalytics()`, surfaced at
`GET /api/analytics` (staff and admin only).

---

## Queue KPIs

| KPI | Formula | Notes |
| --- | --- | --- |
| **Actual wait** (per ticket) | `service_start_time − queue_join_time`, in minutes, rounded, floored at 1 | Set when serving starts, not when the student is called |
| **Average wait** | `mean(actual_wait_mins)` over tickets that reached service | Excludes tickets never served |
| **Median wait** | P50 of the same population | Reported separately because the mean is skewed by long waits |
| **Longest wait** | `max(actual_wait_mins)` | |
| **Aggregate waiting time** | `Σ actual_wait_mins` over all served tickets | The "minutes lost" headline figure |
| **Students affected** | distinct `user_id` whose actual wait exceeded the policy threshold (default 20 min) | Counts people, not tickets |
| **Throughput** | completed tickets per hour, from `completed_at` bucketed by hour | |

## Rate KPIs

| KPI | Formula | Notes |
| --- | --- | --- |
| **Abandonment rate** | `(cancelled ÷ tickets joined) × 100` | A student who leaves before being served |
| **No-show rate** | `(no_show ÷ tickets called) × 100`, where the numerator **excludes** no-shows recorded after a missed-turn extension | A student who was unreachable is not student behaviour; these are reported separately as `no_show_excused_count` |
| **Capacity utilisation** | `busy server-minutes ÷ available server-minutes` | From `active_counters`, `total_counters` and service duration |

## Demand and congestion

| KPI | Formula |
| --- | --- |
| **Demand ratio (λ/μ)** | rolling 15-min arrivals ÷ (open counters × 1/service_time) |
| **Traffic state** | worst of the live wait band and the stored demand level: `Quiet ≤8 min · Normal ≤17 · Busy ≤27 · Very busy >27`, and `Closed` whenever the service is not open |
| **Peak period** | the `(weekday, hour)` cell with the highest mean arrivals, requiring at least `MIN_DISTINCT_DAYS` distinct recorded days |
| **Backlog growth** | `λ − c·μ`; positive means the queue is still growing |
| **Projected clear time** | `backlog ÷ (c·μ)` when `c·μ > λ`; otherwise reported as "queue is growing" |

## Prediction accuracy

| KPI | Formula |
| --- | --- |
| **MAE** | `mean(\|actual_wait − estimated_wait_at_join\|)` |
| **MAPE** | `mean(\|actual − estimated\| ÷ actual) × 100` |
| **Bias** | `mean(actual − estimated)`; positive means the platform **under**-estimates |
| **Range coverage** | % of completed tickets whose actual wait fell inside the published P25–P75 range. A well-calibrated range is near 50% |
| **Confidence** | `<5` samples → low, `5–29` → medium, `≥30` → high, from the recorded demand samples in the window |

## Seat KPIs

| KPI | Formula |
| --- | --- |
| **Total / available / reserved** | computed per requested window from `seat_reservations`, after releasing any hold whose check-in window has lapsed |
| **Expired holds** | reservations that passed their check-in deadline without a check-in; the seat returns to the pool automatically |
| **Seat no-show** | same rule as queue no-show, excluding any seat whose window was extended because the student was unreachable |

## Explicitly *not* KPIs

- **Simulation output.** `/api/analytics/simulate` is a **model estimate**, never written to a KPI table and never mixed into the figures above. It is labelled `MODEL ESTIMATE — not campus data` in the UI.
- **Forecasts.** Peak windows and "best time to visit" are estimates from recorded history. They are labelled `FORECAST` and show their sample size and confidence. They are never presented as current measured state.
- **Trend direction.** Only computed from recent samples; with too few it returns `unknown` and states the reason rather than guessing.

## Known reporting bias

When a deployment is running on **ephemeral storage** (see `GET /api/health`),
these figures only reflect one serverless instance and will undercount across
instances. The app surfaces this to staff and administrators rather than
presenting partial numbers as campus-wide truth.
