# CampusFlow — Architecture

**Last updated:** 2026-09-30

> Records the stack decisions and their reasons. Any change to structure,
> storage, auth or deployment must be recorded here in the same change.
> See `PRD.md` for what the product is, `RULES.md` for the operating rules.

---

## 1. Stack

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Frontend | React + Vite + TypeScript | 19 / 8 / 7 | Existing app; Vite gives a static `dist/` that Vercel serves directly |
| Styling | Tailwind CSS + a hand-written design layer | 4.3 | Existing design system; utility classes plus `index.css` scene styles |
| Server | Express (Node) | 4.21 | Existing; the same factory runs locally and as a Vercel function |
| Language | TypeScript, run through `tsx` | 7.0 | One language across client, server and tests |
| Storage | JSON document store | — | See §7. **Interim**; a database adapter is the agreed next step |
| Real-time | Server-Sent Events | — | One-way server→client push; no proxy/upgrade complexity |
| Icons | lucide-react | 0.546 | Consistent stroke weight, tree-shakeable |
| 3D | three.js | 0.186 | WebGL campus scene; code-split so it never blocks first paint |
| Campus geometry | OpenStreetMap (ODbL) | captured 2026-09-30 | Real footprints, roads and land use; committed, not fetched at runtime |
| Campus places | Galgotias University published pages | committed | Real schools, centres and facilities; each entry carries its source URL and **no coordinate field at all** |
| Satellite imagery | Esri World Imagery | runtime tiles | Real aerial imagery, no API key; attribution displayed |

### Deliberately rejected
- **Higgsfield / Cloudflare Workers + D1 + Durable Objects** — a different
  runtime and a different data model. Adopting it would have meant rewriting
  working code, which contradicts the standing instruction to preserve the app.
- **Fastify + PostgreSQL + Redis + BullMQ** — a large operational surface for a
  single-campus product with no proven need for horizontal scale yet.
- **A state-management library (Redux/Zustand)** — two contexts
  (`AppContext`, `TrafficContext`) cover the actual state.

## 2. Repository layout

```
server.ts                  dev + production entry point (Express)
api/index.ts               Vercel function entry; delegates to server/app.ts
vercel.json                build, output, functions, rewrites
src/                       client
  App.tsx                  routing + role gating
  context/AppContext.tsx   session, data, request() helper (attaches CSRF)
  context/TrafficContext.tsx  traffic/peak/alternatives state
  components/              33 components (see DESIGN.md §6)
  lib/                     api, offline, pendingActions, telemetry, firebaseAuth
  types/                   shared domain types
server/
  app.ts                   shared Express factory (dev + Vercel)
  api.ts                   all REST routes, auth guards, health
  auth.ts                  scrypt, signed sessions, CSRF, RBAC
  firebase-auth.ts         Firebase ID token verification + role mapping
  jwks.ts                  JWKS fetch, JWT header/claims parsing, signature check
  db.ts                    schema, seed, queries, audit, analytics
  paths.ts                 writable data-dir resolution, ephemeral detection
  intelligence-api.ts      traffic/peak/alternatives/intent routes
  intelligence/            12 framework-free engine modules
tests/                     17 suites, 249 tests
docs/KPIS.md               formula for every displayed figure
```

The `/core`-style separation from the spec is implemented as
`server/intelligence/*`: **framework-free, pure, fully unit-testable**. Engines
never import Express or the database. `guard.ts` and `explain.ts` are the
AI-boundary guards (see §6).

## 3. Request flow

```
Browser
  │  credentials: same-origin, x-csrf-token on writes
  ▼
Express (server/app.ts)
  │  1. security headers
  │  2. express.json
  ▼
API router (server/api.ts)
  │  3. attachUser        — resolve session cookie → req.user
  │  4. csrfGuard         — refuse cross-origin / tokenless writes
  ▼
Route handler
  │  5. requireAuth / requireRole / requireSelfOrRole  ← deny by default
  ▼
Engine or db method
  │  6. persist, audit, broadcast SSE
  ▼
Response
```

Step 4 runs **before** any handler, so an unauthorised write never reaches
business logic. Steps 5 are per-route and explicit: a route with no guard is
public by deliberate decision, visible in the source.

## 4. Authentication & authorisation

- **Password hashing** — `scrypt` with a per-user random salt, compared with
  `crypto.timingSafeEqual`.
- **Sessions** — **stateless, HMAC-signed cookies**. Payload `{u, iat, exp, r}`;
  `r` is the user's revocation floor.
  - *Why stateless:* serverless instances do not share memory, so stored
    sessions made logins fail intermittently across instances. This was a real
    production bug (see `FIX.md` #1).
- **Revocation** — a per-user `revocation` timestamp in the database. A session
  issued before it is refused. O(1), no session table.
- **CSRF** — double-submit, derived by HMAC from the session token, so it needs
  no storage. Two independent checks: `Origin`/`Referer` must match the host,
  **and** the header must match. Either alone has a gap.
- **RBAC** — `requireRole(...)` and `requireSelfOrRole(...)`. The latter is what
  stops a student acting on someone else's ticket.
- **Privacy boundary** — `db.getQueueEntriesForViewer()` redacts other
  students' names and IDs **server-side**. The raw record is never serialised to
  a student caller.
- **Login rate limiting** — per account and per IP, with backoff.
- **Google sign-in (optional)** — `POST /api/auth/firebase`, verified in
  `server/firebase-auth.ts`. The browser runs the Firebase Auth popup
  (`src/lib/firebaseAuth.ts`) and posts the resulting **Firebase** ID token; the
  server verifies it and then issues the **same signed CampusFlow session** a
  password sign-in would, so every guard above applies unchanged.
  - A Firebase token is not a Google Identity Services token: its issuer is
    `https://securetoken.google.com/<projectId>`, not `accounts.google.com`, and
    its audience is the bare project id. It needs its own verifier.
  - **The project pin is load-bearing.** Every Firebase project shares one JWKS
    endpoint, so a valid signature alone proves only that *some* Firebase project
    signed the token. `aud` and `iss` are both compared against
    `CAMPUSFLOW_FIREBASE_PROJECT_ID`, which binds the token to exactly one
    project. Without it, an attacker could stand up their own free project, create
    a user called `admin@metrouni.edu`, and be handed an admin session.
  - Verification also checks RS256 (refusing `alg:none` and algorithm
    substitution), expiry, and `email_verified`, and **fails closed**: an
    unreachable key service rejects the token rather than admitting an
    unverified one. An unset project id disables the flow.
  - **Google proves identity, never authority.** The role is read from the
    campus database, never from the provider or the token's claims, and an address
    with no account is refused rather than auto-provisioned.
  - Password sign-in remains fully supported; Google is an alternative door into
    the same session, not a replacement for it. The button renders nothing when
    Firebase is unconfigured, so such a deployment keeps the password form only.
  - Sign-in routes are exempt from the CSRF *token* check only (they establish a
    session rather than using one); the `Origin` check still applies. The list
    lives in `SIGN_IN_ROUTES` in `auth.ts` and is asserted by tests.

## 5. Real-time

Server-Sent Events at `GET /api/realtime`, with `stale_after_secs` so the client
can show a stale badge rather than pretending to be live. `broadcastSSE()` is
called from the same methods that persist, so a push is never emitted for a
change that was not written.

Transport fallback (WebSocket → SSE → polling) is **not** implemented; SSE is the
single transport. This is recorded as a known gap in `DASHBOARD.md` rather than
claimed as done.

## 6. AI boundary

`server/intelligence/guard.ts` and `explain.ts` enforce one rule: **an LLM may
phrase output, never invent it.** Every alternative, wait estimate and
explanation is computed first; the model can only rewrite prose around a result
that already exists. With `GEMINI_API_KEY` unset, the concierge returns a clear
"not configured" error rather than a plausible-sounding fabrication.

## 7. Storage — the known weak point

`server/paths.ts` resolves a writable directory in this order:

1. `CAMPUSFLOW_DATA_DIR` (explicit; used by the test harness)
2. `<repo>/data` (normal local / single-server)
3. `os.tmpdir()/campusflow-data` (**read-only bundles — i.e. Vercel**)

`IS_EPHEMERAL_STORAGE` is exported and surfaced through `GET /api/health` and a
staff/admin banner, so the limitation is **disclosed, never hidden**.

**Consequence, measured not assumed:** on Vercel, state is per-instance and is
lost on recycle. Reserve a seat → `GET /seats/mine` returns 0 in production but 2
locally. The app tells operators this rather than reporting partial numbers as
campus-wide truth.

**The agreed fix** is a real database adapter behind the single read/write seam
(`server/db.ts`), wired via `CAMPUSFLOW_DATABASE_URL`. It is blocked on
provisioning, not on design — see `DASHBOARD.md`.

All reads and writes go through `server/db.ts` methods, so introducing a database
means implementing that one adapter and changing no caller.

## 8. Deployment

`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": { "api/index.ts": { "maxDuration": 300 } },
  "rewrites": [
    { "source": "/api/(.*)",     "destination": "/api/index" },
    { "source": "/((?!api/).*)",  "destination": "/index.html" }
  ]
}
```

The rewrites are **load-bearing**. Without them every `/api/*` request 404s
because the static build has no such file — this was production bug #2
(`FIX.md`). Order matters: the API rule must come first.

Static hosting for the SPA, one serverless function for the API, same origin, so
no CORS configuration and cookies are first-party.

## 9. Environment variables

| Variable | Required | Purpose | If unset |
| --- | --- | --- | --- |
| `CAMPUSFLOW_SESSION_SECRET` | **in production** | HMAC key for sessions and CSRF | A random per-process secret is generated — **logins break across instances** |
| `CAMPUSFLOW_DATA_DIR` | no | Explicit storage path | Falls back per §7 |
| `CAMPUSFLOW_DEMO_AUTH` | no | `false` disables demo sign-in | Demo accounts enabled |
| `CAMPUSFLOW_DATABASE_URL` | no (planned) | Postgres connection string | JSON store is used |
| `GEMINI_API_KEY` | no | AI Concierge + explanation phrasing | Clear "not configured" error |
| `PORT` | no | Listen port (dev) | 3000 |

Secrets are read from the environment only. **No secret is in source.**

## 10. Testing

`node --import tsx --test tests/*.test.ts` — 13 suites, **216 tests**.

| Suite | Tests | Covers |
| --- | --- | --- |
| `seating.test.ts` | 28 | allocation, expiry, windows, concurrency |
| `auth.test.ts` | 23 | login, hashing, RBAC, IDOR, rate limiting |
| `api.test.ts` | 22 | endpoint contracts, alternatives, peaks |
| `security.test.ts` | 16 | CSRF, revocation, ticket codes, grace, 50-way races |
| `alternatives.test.ts` | 12 | ranking, hard filters, thresholds (time-independent) |
| `prediction.test.ts` | 11 | estimator, confidence, MAE |
| `token.test.ts` | 11 | virtual token issuance and views |
| `intent.test.ts` | 10 | natural-language service resolution |
| `explain.test.ts` | 10 | "why is it long?" grounded in computed factors |
| `campus3d.test.ts` | 26 | real OSM geometry, measured routes, no invented values |
| `campus-links.test.ts` | 14 | admin-only building links, audited |
| campus-acceptance.test.ts | 4 | 3D acceptance: alternatives, peaks, token destination |
| campus-perf.test.ts | 5 | scene cost, level of detail, capture size |
| `csrf-coverage.test.ts` | 7 | **every client write carries the token** |
| `docs.test.ts` | 11 | **documentation stays present and true** |

Two suites guard against failures that produce **no build error**, which is
precisely why they exist:

- `csrf-coverage.test.ts` scans the client source for a `fetch()` write without a
  CSRF path. Such a bug yields a runtime 403 and a green build. It caught a
  shipped regression (`FIX.md` #7).
- `docs.test.ts` fails when a document is missing, when a documented number drifts
  from the code (test counts, component inventory), or when a bug lands without a
  `FIX.md` entry.

## 11. Performance

- Hashed assets precached by the service worker; 3D/animation work is lazy.
- One JSON document rewritten synchronously per mutation. Correct and simple,
  and **O(n) in document size** — acceptable at single-campus scale, and the
  reason a real database is the next step.
- Concurrency is handled in-process by making check-then-write **synchronous**,
  so two requests cannot interleave between the check and the write.

## 12. Accessibility as an architecture concern

Accessibility is enforced in structure, not in a review step: semantic elements,
`aria-live="polite"` for position changes and `"assertive"` for a student's turn,
a table fallback under every chart, icon **and** text for every status (never
colour alone), and a text/table alternative to every visualisation. Verified at
375 / 768 / 1280 px.
