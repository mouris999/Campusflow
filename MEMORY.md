# CampusFlow — Memory

**Last updated:** 2026-09-30

> Non-obvious knowledge that is expensive to rediscover: environment quirks,
> codebase gotchas, and decisions with their reasoning. Kept so a future session
> does not repeat the same investigation or the same mistake.
>
> This is **not** a spec — see `PRD.md`, `ARCHITECTURE.md`, `RULES.md` for that.

---

## 1. Environment quirks

### The path contains `&`
`...&campusflow---unified-campus-services-&-virtual-queue-platform`

This breaks npm and PowerShell `cd` shims, which silently misparse. Consequences:

| Broken | Use instead |
| --- | --- |
| `npm run build` | `node node_modules\vite\bin\vite.js build` |
| `npm test` | `node --import tsx --test tests/*.test.ts` |
| `npm run dev` | `node node_modules\tsx\dist\cli.mjs server.ts` |
| `npm run lint` | `node node_modules\typescript\bin\tsc --noEmit` |
| `cd <repo>` | pass `workdir` to the tool instead |

`npx vercel` does work.

### Ports
3000 and 3001 are usually occupied. Dev uses **3010**, production preview **3011**.
Set with `$env:PORT=3010`.

### Git
The project **is** a git repository, tracking
`https://github.com/mouris999/Campusflow.git` (branch `main`). The public repo
carries two commits: `197360a Initial commit` and `aa79129`.

**`data/` is gitignored and must stay that way.** It holds `.session-secret`
(the HMAC key that signs session and CSRF tokens) and `campusflow.json` (which
contains `user_credentials`, i.e. scrypt password hashes). The repository is
**public**, so a leak is not something to fix quietly afterwards. Before any
commit, confirm with `git check-ignore -q -- data/.session-secret`.

Committing is possible without the `gh` CLI: Git Credential Manager is
configured at system level and already holds credentials for this account, so
`git push` succeeds even with `GIT_TERMINAL_PROMPT=0`.

The **global** git identity on this machine is `Test <test@test.com>`, which is
not this account. A local identity is set to
`mouris999 <mouris999@users.noreply.github.com>`; repair a bad author with
`git commit --amend --reset-author --no-edit`.

## 2. Commands that work

```powershell
# typecheck
node node_modules\typescript\bin\tsc --noEmit

# tests
node --import tsx --test tests/*.test.ts

# single suite
node --import tsx --test tests/security.test.ts

# build
node node_modules\vite\bin\vite.js build

# dev server (background)
$env:PORT=3010
Start-Process node -ArgumentList "node_modules\tsx\dist\cli.mjs","server.ts" `
  -WorkingDirectory $PWD.Path -RedirectStandardOutput "$env:TEMP\cf-dev.log" `
  -RedirectStandardError "$env:TEMP\cf-dev.err" -NoNewWindow

# deploy
npx vercel --prod --yes
```

**Restart the dev server after backend edits** — it does not hot-reload
`server/*.ts` changes. Symptom: a fix appears not to work, and it did.

## 3. Codebase gotchas

- **`vercel.json` rewrites are load-bearing.** Without `{ "source": "/api/(.*)",
  "destination": "/api/index" }` every API call 404s. The API rewrite must come
  **before** the SPA catch-all.
- **`/api/services` returns `{ success, services }`,** not a bare array. A
  PowerShell probe doing `ConvertFrom-Json | Where-Object category -eq canteen`
  returns nothing and looks like a server bug.
- **The service worker is disabled in development** (`import.meta.env.DEV`).
  Offline behaviour can only be verified against a production build.
- **Test helper** `signIn()` resolves a CSRF token and caches it per cookie, so
  `authedFetch(cookie, url, init)` works unchanged in existing call sites.
- **PowerShell `&&` is unavailable**; use `;` and check `$LASTEXITCODE`.
- **Path 3010 may already have a stale server.** Kill by matching the command
  line, not by port, to avoid killing unrelated Node processes.

## 4. Decisions and their reasoning

| Decision | Reasoning |
| --- | --- |
| Stateless signed session cookies instead of server-side session rows | Serverless instances do not share memory; stored sessions made logins fail intermittently |
| CSRF token derived by HMAC from the session token | Needs no extra storage and is bound to its own session |
| Per-user revocation **floor** timestamp instead of a session table | O(1) revocation, keeps sessions otherwise stateless |
| Per-service daily ticket sequence | Random codes had only 800 values per service; two students could hold the same code |
| Check-then-write made **synchronous** | Node's single-threaded execution is what makes concurrent seat booking safe; making it async would allow interleaving |
| Reused the existing peak/queue/alternatives engines | Duplicated logic guarantees the two copies drift and disagree |
| Reused the AI guard for alternatives | An LLM may phrase output, never invent it |
| Kept the existing Vercel topology | Preserves working deployment; the user directed no redesign |
| Added a mobile tab strip rather than restructuring navigation | Discoverability without changing the information architecture |
| Suggestion chips derived from the live catalogue | Hardcoded chips rot; the catalogue is the source of truth |
| No `is_demo` flag on seeded data | The seeded campus **is** the deployment's real data; a demo flag would make every live page read as a demo. Instead, forecasts are labelled and insufficient history is stated |

## 5. Things that look wrong but are correct

- **`NOI` / `NOK` statuses in tests** are transient, not broken.
- **A 403 from the API when writing without a token is the guard working.** When
  verifying in a browser, a raw `fetch()` from the console will 403 — that is
  expected. Use the app's own button to test the real path.
- **Analytics returning small numbers in production** is the ephemeral-storage
  blocker, not a calculation error.
- **`IS_EPHEMERAL_STORAGE` being true on Vercel** is correct behaviour.
- **An empty alternatives list at night** is correct: a closed canteen is
  reported `blocked: outside_operating_hours`, not recommended.

## 6. Testing pitfalls learned the hard way

- **A test that passes at 11:00 and fails at 19:00 is broken.** Use controlled
  fixtures (`is_open_now: true`) or assert the contract, never a data-dependent
  premise like "the seeded campus should offer a quieter branch".
- **Give synthetic fixtures unique keys** (`RCV${Date.now()}`). A fixed prefix
  shared across tests leaks counter state between them.
- **Clear prior state before a race test**, or a one-per-user rule can mask the
  exclusivity you meant to test. This made a 50-way test report 0 winners instead
  of 1.
- **Assert the invariant, not an absolute value**, when state may accumulate.
- **50 parallel sign-ins cost ~12 s.** Sign in once per user and reuse the cookie.

## 7. Browser verification recipe

```
1. Open the deployed URL, tab focused
2. browser.evaluate: sign in via the demo account button + form.requestSubmit()
3. Click real UI controls — do not call fetch() directly, or CSRF will 403
4. browser.console: assert zero errors
```

The demo accounts are listed by `GET /api/auth/demo-accounts`
(`alex.rivera@metrouni.edu` / `student123`, `sarah.chen@metrouni.edu` / `staff123`).

## 8. Living reminders

- The single read/write seam is `server/db.ts`. A real database drops in there.
- `docs/KPIS.md` documents every displayed figure. If you add a number to the UI,
  add its formula there.
- When adding a client write, use `secureWrite()` or `request()`.
  `tests/csrf-coverage.test.ts` will fail the build otherwise.
- `server/intelligence/*` must stay framework-free and pure.
- **Read a file back after any bulk programmatic edit.** A PowerShell
  `String.replace` loop silently corrupted three documents once (`FIX.md` #9).
  The command reported success; only printing a sample revealed it.
- Do not build a list of `{ file, pairs }` where `pairs` may contain a single
  element — PowerShell flattens the inner array and `$pair[0]` / `$pair[1]`
  silently become the first two *characters* of the pattern. Use
  `[System.IO.File]::WriteAllText` with whole content, or the file-write tool.

## 9. Known limits of the doc guard

`tests/docs.test.ts` checks that documents **exist**, are not stubs, carry a
"Last updated" marker, that quoted numbers (test counts, component inventory)
match the code, and that every bug has a `FIX.md` entry with a status.

It does **not** check that prose is uncorrupted or factually right. A
character-substitution corruption like `FIX.md` #9 would pass it. The mitigation
is manual: read a file back after any bulk programmatic edit.
