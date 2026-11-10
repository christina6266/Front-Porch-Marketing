# Trimlight Control ("the Lights app"): notes for Claude

> The owner calls this the **Lights app**. It is NOT the FrontPorch app (the repo root),
> and NOT the lowercase `frontporch-marketing` repository. See `../CLAUDE.md` for the naming table.

A phone-friendly web app that controls the owner's **Trimlight Edge** permanent house
lights through Trimlight's official API. It replaces the Trimlight Edge phone app,
which the owner finds frustrating. The app is entirely separate from FrontPorch
Marketing: it shares this repository only. Never add Trimlight code to FrontPorch
files (`../server.js`, `../*.html`), and never put FrontPorch code here.

## Working with the owner
- Not a developer, and works from an iPhone, often sending screenshots. Give short,
  numbered, tap-by-tap steps, and name the exact buttons they will see.
- Workflow for every change:
  1. Develop on a branch.
  2. Push and open a PR.
  3. Send the PR link and ask them to tap **Merge pull request → Confirm merge**.
  4. Railway redeploys automatically in 1–2 minutes.
  5. They reload the page and report back.
- After a PR is merged, restart the branch from `origin/main` before the next change.
- Test every change against the fake Trimlight server with Playwright (see Testing),
  and send a screenshot preview. Say plainly what was not verified on the real lights.
- Never commit or echo credentials. The owner once pasted a screenshot of their
  Client ID/secret; treat those values as secret.

## Deployment (Railway)
- Railway project **creative-presence**, one service, deployed from GitHub repo
  `christina6266/Front-Porch-Marketing`, branch `main`, **Root Directory `trimlight-control`**.
  The service is still named "Front-Porch-Marketing", so the URL is
  https://front-porch-marketing-production-c68a45d6.up.railway.app (port 8080).
- FrontPorch is a different Railway project (`radiant-emotion`). Don't touch it.
- Service variables. Set the values in Railway; never put them in code:
  - `TRIMLIGHT_CLIENT_ID`, `TRIMLIGHT_CLIENT_SECRET` (from trimlight.ledhue.com → Get API credentials)
  - `APP_PASSWORD`: the page's sign-in password
  - `DATA_DIR=/data` with a Railway **Volume** mounted at `/data`. This keeps timers and saved
    patterns across redeploys. The owner was given these steps; **confirm it is set up**
    (the page shows a yellow warning on the Timers card when `DATA_DIR` is missing).
  - Optional: `HOME_LAT`, `HOME_LON`, `HOME_NAME`, `HOME_TIMEZONE` (defaults: Austin, TX / America/Chicago).

## Architecture
No npm dependencies. Node 18+, built-in `http`/`https`/`crypto` only.
- `server.js`:
  - static files from `public/`
  - password login: in-memory session tokens, so a redeploy logs users out
  - JSON API under `/api/*`
  - Trimlight client
  - timer scheduler: `tick()` runs every 30 s. A due timer may run up to 5 min late,
    once per day, tracked in `lastRuns`.
  - saved patterns
  - NOAA sunrise/sunset
- `public/shared.js`: `GROUPS` and `HOLIDAYS` (the theme lists). Used by both the page (`window.TL`)
  and the server (`require`). Add new themes or holiday tabs here.
- `public/index.html`: the whole UI. Cards, top to bottom:
  - Controller: dropdown, plus On / Off / Schedule
  - Themes: holiday tabs, plus a Moving/Still switch
  - Timers
  - Pattern Builder: 30 zones, color picker pop-up, My patterns
  - Built-in animations (0–179)
  - Patterns on this controller
- Data files in `DATA_DIR`: `timers.json`, `patterns.json`.

## Trimlight API facts learned the hard way
- Base URL: `https://trimlight.ledhue.com/trimlight`.
- Every request needs three headers:
  - `authorization`: base64 HMAC-SHA256 of `Trimlight|<clientId>|<timestampMs>`, keyed with the client secret
  - `S-ClientId`
  - `S-Timestamp`
- Success responses look like `{ code: 0, desc, payload }`.
- **The device list is `GET /v1/oauth/resources/devices` with a JSON body `{page:0}`.**
  Node's `fetch()` refuses a GET with a body, so all calls go through the `https` module (`httpsRequest`).
- `POST /v1/oauth/resources/device/get` returns full details: `switchState`, saved `effects`, …
  It needs `{deviceId, currentDate}`.
- `POST .../device/update` with `{deviceId, payload:{switchState}}`: 0 = off, 1 = manual on, 2 = follow schedule.
- **Don't use `POST .../device/effect/preview`.** It is broken on current firmware (1.17.x):
  colors show but the animation is ignored. The owner reported "movements not working",
  and the open-source trimlight-edge-ha integration dropped it for the same reason.
- Instead, the app saves the effect, then plays it (`saveAndPlay()` in `server.js`):
  - `POST .../device/effect/save` with
    `{deviceId, payload:{id, name, category, mode, speed, brightness, …}}`.
    Use `id: -1` to create; the response is `payload.id`.
    - `category 0` = built-in effect: `mode` 0–179, `pixelLen` 1–90, `reverse`.
      The cloud rejects a built-in save without `pixelLen`.
    - `category 1` = custom effect: `mode` 0–16, `pixels` = 30 entries `{index, count 0–60, color:int, disable}`.
      Unused entries have count 0, and the lit entries repeat along the strip.
  - Then `POST .../device/effect/view` with `{payload:{id}}`.
  - Each controller has one reusable slot per category: **"Lights App"** (custom) and
    **"Lights App FX"** (built-in). Slot ids are looked up by name through `device/get` and cached.
  - The app never creates a slot unless the effect list loaded, to avoid duplicates.
  - Calls run one at a time per controller (`withDeviceLock`).
  - These slots appear in Trimlight's own app, and our page hides them from "Patterns on this controller".
- Requests are spaced ~300 ms apart (`throttle()`), because the cloud returns error 20000 on bursts.
- Custom mode numbers, confirmed against a copy of the official API docs:
  - 0 Static
  - 1 Chase forward · 2 Chase backward · 3 Chase middle→out · 4 Chase out→middle
  - 5 Stars · 6 Breath
  - 7 Comet forward · 8 Comet backward · 9 Comet middle→out · 10 Comet out→middle
  - 11 Wave forward · 12 Wave backward · 13 Wave middle→out · 14 Wave out→middle
  - 15 Strobe · 16 Solid fade
- `speed` runs 0 (slowest) to 255 (fastest).
- Reference copy of the API docs: `docs/trimlight-api.md` in github.com/klieber/trimlight.
- Hand-typed credentials once contained a Cyrillic "с" lookalike. `cleanCredential()` now
  normalizes lookalikes and whitespace.

## The owner's setup
- Controllers on the account:
  - Trimlight Back
  - Trimlight
  - Trimlight Landscape
  - Pergola
  - moms house (offline)
  - a second "Trimlight" (offline)
- Groups (in `shared.js`, matched by controller name):
  - ★ All lights: every online controller
  - ★ Backyard: Trimlight Back + Pergola + Trimlight Landscape
- Home: Austin, TX, Central Time.

## Features so far (merged PRs #1–#11 on `main`, plus the save-and-play fix for animations)
- **Control:** on/off/schedule for a controller or group, with per-controller error reporting.
- **Themes:**
  - 34 Christmas
  - 20 Thanksgiving
  - 16 Patriotic (Fourth of July plus Veterans Day ones: Honor & Remember, Salute to Service, Yellow Ribbon, Purple Heart)
  - 9 "More": Warm White, Halloween, Spooky, USA, Fireworks, St. Patrick's, Valentine's, Easter, New Year's Eve
  - a Moving/Still switch that applies the same colors with mode 0
  - tapping a theme loads it into the Pattern Builder
- **Timers:**
  - unlimited
  - clock time, or sunset/sunrise ± offset (Austin, with daylight saving)
  - chosen days
  - target: a group or a controller
  - action: on, off, a theme, or a saved pattern (moving or still)
  - can be edited, switched on/off, deleted, or run now (▶)
- **Pattern Builder:**
  - 30 zones, each with a color and an LED count (0 = skipped)
  - Trimlight palette: R G B Y PU O W WW PI C OFF
  - custom colors through a pop-up (45 shades, RGB sliders and numbers, hex)
  - house preview strip
  - save to My patterns (Show / Edit / Delete)

## Ideas the owner liked but hasn't asked for yet
- "Hey Siri" control through iPhone Shortcuts calling the API
- Saving patterns onto the controllers themselves, so they appear in the Trimlight app
- A separate page and password for "moms house"
- Theme shuffle (rotate themes every N minutes)
- A master brightness slider and late-night dimming
- Game-day team colors
- Holiday autopilot by date range (timers currently use weekdays only)

## Testing
- Use `dev/fake-trimlight.js`. Its header has the commands to run it alongside `server.js`.
- Then drive `http://localhost:3997` with Playwright. Chromium is preinstalled.
- Tips:
  - Use `button:has-text("Sign in")`. A bare `text=Sign in` matches the heading.
  - `<option>` elements are never "visible", so wait for them with `state: 'attached'`.
  - Use `devices['iPhone 13']` with `tap()` for touch checks.
  - Set `timezoneId: 'America/Chicago'` for timer tests.
- The fake server stores saved effects, so `fake-log.txt` shows `SAVE … "Lights App" … mode=…`
  followed by `VIEW`. A `PREVIEW` line means something is still using the broken endpoint.
- To test the scheduler, create a timer for the current Chicago minute, then watch
  `dev/fake-log.txt` and the server log line `⏰ Timer … → N controller(s)`.
