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
· `GoogleSignInButton` (secondary "Continue with Google"; renders nothing when
Firebase is unconfigured, so the password form stays the whole sign-in surface) ·
`StorageNotice` (ephemeral-storage banner) · `OfflineBanner` · `FreshnessBadge`

**Campus**
`CampusView` (hosts both campus views; code-splits the heavy ones) ·
`Campus3D` (3D scene, info panel, accessible list) · `RealCampusPlan` (2D plan
from real survey geometry) · `CampusMap` (existing 2D service map, preserved) ·
`CampusPlaces` (real Galgotias University directory: schools, centres and
facilities, each sourced, pinned only where the survey names it) ·
`CampusLinkAdmin` (admin-only building confirmation) · `SeatMap`

**Student**
`PlanVisit` (Plan tab) · `MyPass` (My pass tab) · `ServiceDiscovery` ·
`ServiceDetailModal` · `JoinQueueModal` · `VirtualTokenCard` ·
`AppointmentModal` · `MyActivity` · `NotificationDrawer` ·
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

## 10. Campus visualisation

Two views of the same real place. Both carry the same live CampusFlow data and
both have a text equivalent.

### Provenance is part of the design

Every campus view distinguishes three kinds of fact, and never blurs them:

| Kind | Shown as | Example |
| --- | --- | --- |
| **Surveyed** | Solid, named | `B-Block (Galgotias University)` from OSM |
| **Projected** | Dashed pin, explicit caption | "Projected from the 2D layout — not a surveyed location" |
| **Assumed** | Labelled, with the reason | "Not recorded — shown at a default height" |
| **Live** | Value plus source label | "6 min · Student Records & Registrar" |

A building with no linked service shows **no** wait, queue or count. Showing
`~0m` there would be an invented figure, so the pin reads `REAL` and
`no service linked` instead.

### 3D scene

- **Ground** — Esri World Imagery satellite tiles composited to one texture. The
  tile budget steps the zoom down automatically so the ground never needs more
  than 64 requests; the effective resolution is displayed.
- **Buildings** — real footprints extruded to their OSM height, or one documented
  default where none is recorded.
- **Surfaces** — roads and paths, sports pitches, green space, water, parking.
  Thin footpaths and trees are hidden when zoomed out, so a full-campus view stays
  legible instead of turning to mud.
- **Beacons** — one per CampusFlow service: a ground ring, a pillar and a cap,
  coloured by traffic state and paired with a glyph and a word.
- **Routes** — a measured path, drawn as a dark casing under a bright core. When
  no real path exists, nothing is drawn and the reason is shown.

### 2D plan

`RealCampusPlan` renders the same geometry into SVG in the plan's `0-100` space,
so the service pins and route line drop in unchanged. Road classes are drawn at
different widths, sports pitches are dashed so they are not read as buildings, and
the OSM and Esri attribution is always visible.

### The real campus directory

Geometry says where the buildings are. It does not say what a university *is*:
OpenStreetMap names five features on this campus out of 336 footprints and tags
the rest with nothing but `building=house`, so a plan drawn from the survey alone
cannot name the School of Law, the Central Library, or the Cisco Centre of
Excellence. `CampusPlaces` supplies that half, from the university's own published
pages, in `src/data/campus-places.json`.

The schema has a deliberate hole in it: a place may carry an `osm_element_id` and
nothing that describes a position. There is no `x`, `y`, `lat` or `lon` field,
so `placeAnchor()` can only resolve a pin by looking that identifier up in the
committed survey, and returns `null` when the survey has no such element. An
invented coordinate is not merely discouraged, it is unrepresentable.

That yields the split the UI renders:

| State | Count | Shown as |
| --- | --- | --- |
| Surveyed | 5 | `PINNED`, and `Show on plan` focuses the matching pin |
| Named, unpositioned | 67 | `NO PIN`, a link to the page it came from, and `position not confirmed` |

The 72 entries are 27 schools, 8 industry-integrated academic centres, 4 research
units, and the rest offices, services and amenities — the university's own
published list, not a selection made to flatter the map. The counts are computed,
never written into the copy, so the header cannot drift away from the data. An
administrator can attach a real footprint to any listed place from the Campus
view, at which point it becomes pinnable.

### Controls

Orbit by drag, pan by shift-drag or two fingers, zoom by wheel or pinch, plus
`Reset`, `Plan` (top-down), `Layers` and `List`. Keyboard: arrows orbit, `+`/`-`
zoom, `0` resets, `Escape` closes the panel. The canvas is focusable and
labelled.

### Accessibility

- The canvas has `role="img"` and an `aria-label` naming the real counts.
- A visually hidden list of services with their live state sits in the DOM.
- `List` swaps the scene for a real `<table>` with the same values and a
  "Position basis" column, so provenance is readable as text.
- No WebGL, or a context that fails to start, falls back to that same list with a
  plain-language reason.
- Touch targets are 44 px; the detail panel becomes a sheet below the stage on
  narrow screens.

## 11. Offline presentation

| Situation | What the user sees |
| --- | --- |
| Cached read, fresh | `LIVE` |
| Cached read, old | `STALE` + "Last updated hh:mm" |
| No connection | `OFFLINE` + banner |
| Deferred action | "Queued — not confirmed yet" |
| Action needing a connection | Blocked, with the reason and a walk-in alternative offered |

The service worker is intentionally disabled in development, so offline behaviour
must be verified against a **production build**.
