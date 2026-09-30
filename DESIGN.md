# CampusFlow — Design System

**Last updated:** 2026-09-30

> The visual and interaction language. Any new component, token or state must
> follow this document, and any change here must be recorded in this file.
> See `RULES.md` §5 for the accessibility rules these choices enforce.

---

## 1. Design intent

Calm, factual, fast. A student checking a wait on a phone between classes should
read the number in one second and trust it. Nothing pulses, nothing shouts, no
colour carries meaning alone. When the data is weak, the interface says so
plainly rather than looking confident.

## 2. Colour tokens

Defined in `src/index.css`. Dark base, warm off-white text, one lime accent.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` / page background | `#121315` | Near-black, app and marketing shell |
| `--fg` / primary text | `#f2efe7` | Warm off-white. **Never pure white** — it glares on dark |
| `--accent` | `#d9f65b` | Primary action, active state, focus ring |
| `--accent-strong` | `#bdf34a` | Hover, glow for live indicators |
| `--accent-soft` | `#e4fa78` | Filled chips on dark |
| `--muted` | `#aaa9a2` | Secondary text, captions |
| `--muted-2` | `#b8bdab` | Tertiary emphasis |
| `--muted-3` | `#88867d` | Disabled, de-emphasised |
| `--muted-4` | `#6e6d67` | Dividers, borders on dark |
| `--surface-light` | `#e8e4d9` | Light-mode card surface |
| `--surface-light-2` | `#151616` | Light-mode background |
| `--on-light` | `#171818` | Text on light surfaces |
| `--on-light-accent` | `#73851d` | Accent text on light surfaces (AA on `#e8e4d9`) |
| `--ink` | `#151616` | Text on an accent-filled button |
| `--on-accent` | `#121315` | Text on an accent-filled button |

Derived gradients in use: `radial-gradient(circle at 78% 42%, #38422e, #161a17 31%, #111214 63%)`
for the hero glow; a lime sweep for the loading bar.

**Rules**
- Accent is used for *one* primary action per view. Two lime buttons compete.
- Accent text on light surfaces uses `--on-light-accent`, not `--accent` — the
  pure lime fails contrast on `#e8e4d9`.
- No colour-only meaning. Every status carries an icon and a word.

## 3. Status language

Calm and factual. Never alarmist, never blame the student.

| State | Label | Never say |
| --- | --- | --- |
| Normal | **Quiet** | "Great!" |
| Elevated | **Busy** | "Warning" |
| High | **Very busy** | "Overloaded!", "Chaos" |
| Shut | **Closed** | "Unavailable" |
| Unknown | **Not enough history yet** | any estimate |

Traffic bands: `Quiet ≤ 8 min · Normal ≤ 17 · Busy ≤ 27 · Very busy > 27`.

Data-freshness labels: `LIVE` · `CACHED` · `STALE` · `OFFLINE` (`FreshnessBadge`).
Insight provenance: `LIVE` · `HISTORICAL` · `FORECAST` · `ESTIMATE`.
Simulation output always carries **MODEL ESTIMATE — not campus data**.

## 4. Typography & spacing

- Base 16 px; system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …`).
- Letter-spacing `-0.01em` on body; `-0.04em` on the brand for weight.
- Brand 19 px / 800. Section headings 800 weight. Body 400, labels 500–600.
- Spacing scale 4 / 8, via Tailwind. Touch targets ≥ 44 px.

## 5. Motion

- 150–250 ms, `ease-out`. Nothing decorative animates.
- `prefers-reduced-motion` is respected throughout.
- Live indicators use a soft glow (`box-shadow: 0 0 15px #bdf34a`), not a pulse,
  so motion is not the only signal.

## 6. Component inventory

**Shell & navigation**
`Navbar` (sticky, blurs, wraps so the mobile strip drops below) · `SignInScreen`
· `StorageNotice` (ephemeral-storage banner) · `OfflineBanner` · `FreshnessBadge`

**Student**
`PlanVisit` (Plan tab) · `MyPass` (My pass tab) · `ServiceDiscovery` ·
`ServiceDetailModal` · `JoinQueueModal` · `VirtualTokenCard` · `SeatMap` ·
`AppointmentModal` · `CampusMap` · `MyActivity` · `NotificationDrawer` ·
`GeminiChatbot` (AI Concierge)

**Traffic intelligence**
`TrafficPeakPanel` · `SmartTraffic` · `ServiceIntelligenceExtras` · and in
`components/traffic/`: `TrafficBits` · `ServiceTrafficPanel` ·
`PeakIntelligencePanel` · `ItemAvailabilityEditor` · `DemandChart` ·
`AlternativeCard`

**Staff & admin**
`StaffOperations` (operator console) · `AdminAnalytics` (KPIs, simulation, audit)

**Marketing**
`HiggsfieldCampusFlowHome` · `VeoVideoAnimator`

## 7. The six states every view must design

Loading (skeleton) · Empty · Error with retry · Offline · Stale · Success.

An empty state explains *why* it is empty ("Not enough history yet to draw a
traffic profile"), never shows a bare zero. An error state offers a retry. An
offline state distinguishes "we know this but it may be stale" from "this action
needs a connection", and says which.

## 8. Interaction patterns

- **Join in ≤ 2 taps** from Home. The primary action is sticky on mobile.
- **Optimistic UI only for reversible actions**, with rollback and a clear error.
- **Alternative suggestions always show the arithmetic** — "9 min wait + 6 min
  walk", never a bare score.
- **Blocked candidates are shown as unusable with the reason**, not hidden. A
  silent omission reads as "there is nowhere else to go".
- **Sticky "your turn" banner** while a student is being called.

## 9. Accessibility implementation

- Semantic HTML first; ARIA only where semantics fall short.
- `aria-live="polite"` for position/ETA changes; `"assertive"` for a turn call.
- Every chart: `role="img"` with a text description, plus a real table fallback.
  `describeTimeline()` in the traffic components.
- Visible focus rings using the accent; focus is moved on route change.
- The mobile section strip is a real `role="tablist"` with `aria-label="Sections"`.
- Verified at 375 / 768 / 1280 px.

## 10. Offline presentation

| Situation | What the user sees |
| --- | --- |
| Cached read, fresh | `LIVE` |
| Cached read, old | `STALE` + "Last updated hh:mm" |
| No connection | `OFFLINE` + banner |
| Deferred action | "Queued — not confirmed yet" |
| Action needing a connection | Blocked, with the reason and a walk-in alternative offered |

The service worker is intentionally disabled in development, so offline behaviour
must be verified against a **production build**.
