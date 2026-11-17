# Atlas Watch (Sky_View): working guide

This file tells you how to work in this repository. `AGENTS.md` holds the same core rules in short form; keep the two consistent. Where this file and the code disagree, the code is right: fix this file.

## 1. What this project is

Atlas Watch is a Windows desktop app (Electron) for geospatial monitoring. The package name is `atlas-watch`, version 0.7.0; the folder and GitHub repository are called `Sky_View`.

It shows a detailed 3D globe (CesiumJS) with saved locations, U.S. weather alerts (NWS), earthquakes (USGS), German warnings (DWD), and optional live layers: aircraft, vessels, satellites, fires, fire perimeters, airspace, METAR, cyclones, cameras, transit. Around that sit workspaces: event history and replay, scenes, briefings (HTML/PDF), camera boards, markets, a Lemmy community client, an optional local Ollama assistant, and a protective-planning workspace (viewshed, building lookup, routes, briefing).

Three properties define the product, and most rules below follow from them:

1. **It runs entirely on the user's computer.** No server, no accounts, no telemetry. Core features need no keys. Optional paid services use the customer's own credentials.
2. **It tells the truth about its data.** Every value is an observation, a prediction, a report, an estimate, a simulation, or unknown, and the UI says which. The app is not an official warning service.
3. **The renderer is untrusted.** The main process owns network, disk, timers and credentials. The renderer gets a narrow, validated bridge and a fixed list of tile and media hosts.

## 2. How it is built

Three bundles from one TypeScript codebase:

| Part | Source | Built by | Output |
|---|---|---|---|
| Main process | `src/main/main.ts` | esbuild (`scripts/build-main.mjs`), CJS, `electron` external | `dist/main/main.cjs` |
| Preload | `src/preload/preload.ts` | esbuild, CJS | `dist/preload/preload.cjs` |
| Renderer | `index.html` → `src/renderer/main.tsx` | Vite 8 + React 19 | `dist/renderer/` (Cesium assets copied to `dist/renderer/cesium/`) |

The installer is built by electron-builder (`electron-builder.yml`): it packs `dist/**` and `package.json` only. `node_modules` is not shipped, so every runtime dependency must bundle cleanly. Persistence is Node's built-in `node:sqlite`; there are no native add-ons and `npmRebuild` is off.

**Data flow.** The main process fetches from fixed URLs, normalizes and validates, stores a cache and history in SQLite, evaluates saved locations, and pushes snapshots to the renderer (`state:changed`, `layers:update`). The renderer calls `window.atlas.*`, which the preload maps to `ipcRenderer.invoke`. The renderer loads only local assets (`app://atlas/…`) and allow-listed tile, image and video prefixes.

**The four allow-lists.** Know which one a change touches:

| List | File | Governs |
|---|---|---|
| `ALLOWED_HOSTS`, `ALLOWED_PREFIXES`, `assertAllowedUrl` | `src/main/feeds/http.ts` | Every main-process HTTP request |
| `RENDERER_REMOTES` | `src/shared/remoteHosts.ts` | Renderer requests and the CSP (prefix match) |
| `EXTERNAL_LINK_HOSTS`, `isAllowedExternalUrl` | `src/shared/sanitize.ts` | Links opened in the system browser |
| `ipcArgSchemas` | `src/shared/ipc.ts` | Every IPC request (zod, positional tuple) |

**Key modules.**

- `src/main/core.ts` (`AppCore`): NWS/USGS polling, backoff, cache, evaluation, zone lookups. No Electron imports; sources and clock are injected.
- `src/main/handlers.ts`: one validated handler per IPC channel. No Electron imports; platform services are injected so handlers are unit-tested through `dispatch`.
- `src/main/store.ts` (`AtlasStore`): SQLite. JSON-document tables (`annotations`, `saved_views`, `boards`, `people`, `plans`) plus typed tables. Migrations are additive.
- `src/main/layers/manager.ts` and `fetchers.ts`: optional layers. One timer per layer; polls only while enabled.
- `src/main/security.ts`: `app://` protocol, CSP header, session lock-down, navigation and permission denial.
- `src/main/secrets.ts`, `credentials.ts`: customer keys encrypted with Electron `safeStorage`; optional build-time keys, obfuscated only.
- `src/renderer/App.tsx`: top-level state and layout. `components/Globe.tsx`: the Cesium widget. `map/`: imagery providers, terrain, vector tiles, vehicle rendering, overlays, workers.
- `src/shared/`: pure logic and types used by both processes. This is where most tested behaviour lives.

## 3. Folder map

```
src/
  shared/     Pure, tested logic and types (no Electron, no DOM). ipc.ts, types.ts, layers.ts,
              providers.ts, remoteHosts.ts, sanitize.ts, monitoring.ts, geo.ts, briefing.ts, …
  main/       Electron main process: main.ts, security.ts, core.ts, handlers.ts, store.ts,
              feeds/ (http.ts, sources.ts, timing.ts, rss.ts), layers/ (manager, fetchers, DWD, AIS),
              markets.ts, lemmy.ts, ollama.ts, osmSite.ts, providerService.ts, secrets.ts
  preload/    preload.ts: the only bridge. Channel names are duplicated here on purpose.
  renderer/   App.tsx, main.tsx, styles.css
    components/  React UI (some with a small co-located .css)
    map/         Cesium code, tile providers, workers
    lib/         api.ts (typed bridge), hooks, formatting, search worker
    data/        Generated catalogs (airports, places, routes, GIBS). Regenerate; do not hand-edit.
tests/        Vitest suites (*.test.ts), fixtures/, helpers.ts, *-benchmark.mjs
scripts/      build-main.mjs, dev.mjs, smoke.mjs, builtin-keys.mjs, third-party-notices.mjs,
              build-*.mjs|py (asset generators), check-*.mjs (desktop/packaged checks),
              qa-*.js (scenarios injected into the running renderer)
public/       Bundled offline assets: basemap overview, optical water, terrain, geoid, star sky,
              vehicle and interior models. Each has ATTRIBUTION or SOURCES files.
docs/         PROGRESS.md (running record), REQUIREMENTS_AUDIT.md, FEATURES-v0.4.md,
              FEATURE_MATRIX.md (historical), PERFORMANCE.md, *.log evidence, screenshots/<topic>/
samples/      Sample CSV shipped in the installer
build/        icon.png for the installer
start.bat     Launches the newest packaged build under release/
dist/, release/, node_modules/, tmp/, .qa/   Generated or scratch. Never edit, never commit.
```

## 4. Commands

Tested on Windows x64 with Node 24.22.1 and npm 11.19.1. In PowerShell use `npm.cmd` if scripts are blocked.

| Task | Command | Notes |
|---|---|---|
| Install | `npm ci` | Install-script approvals are already in `package.json` |
| Develop | `npm run dev` | Builds main/preload in watch mode, starts Vite on 127.0.0.1:5173, then Electron. Refuses to start if 5173 is taken |
| Type check | `npm run typecheck` | Covers `src`, `tests`, `scripts/*.d.ts`, `vite.config.ts` |
| Unit tests | `npm test` | Vitest, node environment, `tests/**/*.test.ts` |
| One test file | `npx vitest run tests/<name>.test.ts` | |
| Watch tests | `npm run test:watch` | |
| Production build | `npm run build` | typecheck, then main, then renderer |
| Run the build | `npm start` | Needs `npm run build` first |
| Desktop smoke | `npm run smoke` | Needs a build and network. Uses a temporary database and profile |
| Installer | `npm run dist` | Build, notices, NSIS installer in `release/` |
| Unpacked app | `npm run dist:dir` | `release/win-unpacked/Atlas Watch.exe` |
| Notices | `npm run notices` | Regenerates `THIRD_PARTY_NOTICES.md` |
| Package audit | `node scripts/check-package.mjs` | Read-only; compares `dist` to the packed payload |

State on 2026-11-13: typecheck passes, the production build passes, and the suite had 79 test files and 1,172 tests (the count grows with ongoing work). Vite warns that some chunks exceed 6,000 kB; that warning is expected. One test in `tests/passenger-routes.test.ts` can exceed its 5 s timeout when the whole suite runs in parallel and passes when run alone. If it fails, rerun that file or the suite with `--maxWorkers=4`. Do not raise the timeout or skip it.

Environment variables:

- Honoured only in unpackaged runs (dev hooks): `ATLAS_WATCH_SMOKE=1`, `ATLAS_WATCH_SMOKE_MS`, `ATLAS_WATCH_SMOKE_SHOT`, `ATLAS_WATCH_SMOKE_JS` (absolute path to a `scripts/qa-*.js` scenario), `ATLAS_WATCH_SMOKE_VIEWS` + `ATLAS_WATCH_SMOKE_OUT` (view route), `ATLAS_WATCH_SMOKE_BRIEFING`, `ATLAS_WATCH_SMOKE_TRACE`, `ATLAS_WATCH_SMOKE_CPUPROFILE`, `ATLAS_WATCH_SIMULATE_OFFLINE=1`, `ATLAS_WATCH_USER_DATA`.
- Honoured in packaged builds too: `ATLAS_WATCH_DB` (database path) and `ATLAS_WATCH_WINDOW_DISPLAY` (`secondary` or a monitor name; the window then opens without taking focus).
- Build time only: `ATLAS_WATCH_BUILTIN_KEYS` (see mistake 23).

To isolate the packaged executable, pass `--user-data-dir=<temp folder>` and set `ATLAS_WATCH_DB`, as the `check-*-packaged.mjs` scripts do. Those desktop scripts need `playwright-core`, which is deliberately not a project dependency; point `ATLAS_QA_NODE_MODULES` at an external `node_modules` that has it.

## 5. How to work here

1. **Search before you build.** Before adding or proposing a feature, search the source and tests for its workflow, adapters, persistence and UI. The app is large and most requests touch something that already exists. Improve the existing implementation in place.
2. **Read the record.** `docs/PROGRESS.md` and the v0.5–v0.7 sections of `docs/FEATURES-v0.4.md` are current. `docs/FEATURE_MATRIX.md` is historical: a "missing" row there is not evidence.
3. **Preserve what works.** Do not break working features, user settings, saved locations, watchlists or recorded history. The working tree often holds uncommitted work; leave it alone.
4. **Verify the workflow you changed**, at the level you claim. Fixture tests show the logic holds. They do not show that a live source, a credentialed service, the packaged app or the installer works.
5. **Record it.** Add a dated section at the end of `docs/PROGRESS.md`: what changed, source links, what was verified and how, what was not verified, remaining work. Put logs in `docs/` and screenshots in `docs/screenshots/<topic>/`.
6. **Ask before spending or publishing.** Do not activate billing, create accounts, send paid API requests, publish, push, or send messages without explicit authorization.

## 6. Coding rules

**TypeScript and style**

- `strict` is on, with `noUnusedLocals` and `noUnusedParameters`. There is no ESLint or Prettier; match the surrounding file: two spaces, single quotes, semicolons, a short header comment saying what the file is for.
- Comments explain why (a source defect, a measured number, a platform quirk). Do not narrate what the code does.
- No `any`. Parse unknown input with zod or a normalizer that counts and skips malformed records.
- ES modules in source. `scripts/` are `.mjs` run with plain Node.

**Process boundaries**

- `src/shared` imports no code from `main` or `renderer`, and no Electron, Node or DOM APIs. The one existing cross-import is data: `shared/investigation.ts` reads `renderer/data/gibsCatalog.json`. Do not add others.
- `src/renderer` imports from `shared` only. It reaches the main process through `api` in `src/renderer/lib/api.ts`.
- `handlers.ts` and `core.ts` stay free of Electron imports. Inject platform services, fetchers and `now`.
- The preload stays dependency-free. It never exposes `ipcRenderer` or a generic `invoke`.

**Adding an IPC channel** (all five, or the build or tests fail):

1. Name in `IPC` and a strict tuple schema in `ipcArgSchemas` (`src/shared/ipc.ts`). Bound every string, number and array.
2. Handler in `createHandlers` (`src/main/handlers.ts`) that calls `validateIpcArgs` first.
3. The same name in `C` and a method in `api` (`src/preload/preload.ts`).
4. The method on `AtlasApi` (`src/renderer/lib/api.ts`).
5. Rejection cases in `tests/ipc-security.test.ts` and a behaviour test.

`main.ts` registers every key of `ipcArgSchemas` automatically and rejects any sender that is not the app's main frame.

**Network**

- Main-process requests go through `fetchJson`, `fetchText` or a dedicated fetcher in `feeds/http.ts`. The direct network paths in the main process are the Lemmy image loader in `lemmy.ts` and the radio relay in `radio.ts` (stations stream from thousands of hosts; it plays only station ids a directory search returned and refuses private addresses). The Lemmy loader first calls `assertAllowedUrl`, pins the origin, forbids redirects, and caps type and size. Prefer the shared fetchers for anything new.
- A new destination needs an entry in `ALLOWED_HOSTS` (single-tenant host) or `ALLOWED_PREFIXES` (multi-tenant host, exact path prefix), a comment saying what it is for, a test, and a row in the README sources table with its terms.
- The renderer may contact only `RENDERER_REMOTES`. Its `fetch` calls (all in `src/renderer/map/`) load bundled assets and map tiles or tile metadata, and each remote one carries `AbortSignal.timeout`. Data feeds (alerts, aircraft, lookups, anything with a key) never go through the renderer.
- Respect publisher pauses. `http.ts` keeps a per-origin cooldown from `Retry-After`, 429 and 503 that all callers share. Set `timeoutMs` and `maxBytes` on new calls.
- Send the app User-Agent (`buildUserAgent`). Never put a credential in a log, an error message, an export or a scene file; pass messages through `redactSecrets`.

**Storage**

- Schema changes are additive: `CREATE TABLE IF NOT EXISTS`, or `PRAGMA table_info` then `ALTER TABLE ADD COLUMN`. Existing databases at `%APPDATA%\Atlas Watch\atlas-watch.sqlite` must open unchanged.
- Validate documents on read as well as on write (see `plansList`): skip what does not parse.
- Multi-step writes use `tx`. Enforce a size or count limit on anything a user or file can grow.

**Data handling**

- Timestamps are UTC ISO strings in data. Keep distinct times distinct: source issue time, source update time, app retrieval time, local detection time.
- Remote text is length-limited, stripped of control characters and rendered as text. Generated HTML escapes every value with `escapeHtml` and carries no scripts or remote resources.
- A failed or partial refresh keeps the last complete result with its original timestamps and marks the current state unknown.
- Late replies must not overwrite newer state: bind each async result to the selection, query or plan that started it.
- Geometry: longitudes wrap at ±180° and Web Mercator ends at ±85.05°. Use `shared/geo.ts` (geodesic, WGS84) and test the date line and the poles.

**Cesium**

- Import `lib/cesiumBase` before `cesium`. Cesium ion is used only for the optional Bing surface and World Terrain, with the customer's own token passed per request; never set a default ion token.
- Custom imagery providers create bitmaps with `imageOrientation: 'flipY'`.
- Thousands of static features go into batched primitives, not entities. Pixel and decode work goes to the GPU or the worker pool. Transfer bitmaps to workers; do not copy them.
- Every remote tile fetch has a timeout. A source defect is repaired in the provider or the asset generator, with a regression test, and the repair is described as a visual repair.

**Tests**

- Logic tests target `src/shared` and the Electron-free main modules, with fixtures in `tests/fixtures/` taken from real publisher responses where possible.
- UI tests run in node: render with `renderToStaticMarkup` and `vi.mock('../src/renderer/lib/api')`. There is no jsdom.
- A bug fix comes with a test that fails before the fix. Never weaken, skip or delete a failing test to get green.
- Use `tempDbPath()` for databases. Tests never touch the network or the user's profile.

## 7. Design rules

**Truthful presentation**

- Label the kind of data: live, delayed, periodic, forecast, calculated, interpolated, simulated, static (`TEMPORAL_LABEL` in `shared/layers.ts`). Satellite positions are calculated. Smoothed aircraft motion is an estimate. Visual styles (NVG, thermal, CRT) are effects.
- Unknown is its own state. Never show unknown as zero, "none", "not affected", "clear" or "safe".
- Show the source, its terms, coverage and observation time for every record. Keep "reported" values (AIS destination, squawk, incident acreage) worded as reported.
- Never substitute demonstration data into a production provider. Never draw a shape, track, route or façade the source did not supply without labelling it as an illustration.
- State coverage honestly: NWS is U.S.-only, keyless AIS is regional, a listed camera may not play.
- No detection boxes, risk scores, or people-tracking features.

**Layout and components**

- The globe fills the workspace and is never unmounted. Layers, Places, Scenes, Data, Tools and Diagnostics float above it; narrow pages use the 400 px floating panel; Markets and Community are wide pages. New navigation goes in `NAV` in `components/Pages.tsx`.
- Reuse `Modal`, `FloatingPanel`, `FreshnessChip`, `Time`, `ExternalLink`, `SeverityTag` and the `.btn`, `.icon-btn`, `.field`, `.tag`, `.chip` classes. Interface icons come from `lucide-react`. Severity and freshness marks are the text glyphs defined in `lib/format.ts` (`SEVERITY_META`, `FRESHNESS_META`); reuse those tables.
- External links open in the system browser, and only for allow-listed hosts. `ExternalLink` is preferred because it tells the user when a link is blocked. A plain `<a target="_blank" rel="noreferrer">` also works (the window-open handler in `security.ts` applies the same check) but fails silently for a host that is not listed.
- The top bar is the window title bar (`app-region: drag`). Interactive controls in it need `app-region: no-drag`, and the right 150 px is reserved for the system window buttons.

**Visual style**

- Dark theme only. Use the CSS variables in `styles.css` (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--amber`, `--red`, `--ok`, `--radius`, `--dur-*`, `--ease-*`, `--float-*`). Later `:root` blocks override earlier ones, so read the last definition. Literal hex is for data colours only (severity, magnitude, METAR, coverage legend).
- Fonts are the system stack (`--font`, `--mono`). Do not add web fonts or any remote asset.
- Never encode meaning in colour alone: pair it with an icon, shape or text, as severity and freshness do. Use colour-blind-safe palettes for new categorical data.
- Global styles live in `styles.css` under a section comment. A component-specific block may live in a small co-located `.css` imported by that component. No CSS-in-JS, no CSS framework.
- Honour reduced motion: the `reducedMotion` setting and `prefers-reduced-motion`. New animation needs a reduced-motion rule.
- Times display in local time with UTC in the tooltip (`Time`, `localTime`, `utcTime`). Distances follow the `units` setting.
- Every control is keyboard-reachable with a visible focus ring and an accessible name. Escape closes dialogs and cancels pick modes.

**Words**

- Plain sentences, sentence case. Say what happened and what the user can do: "Add your Google Maps API key in Providers first."
- Error text never contains a credential, a full URL with a key, or the user's coordinates or notes.
- Docs state numbers, dates and what was checked. They do not claim parity, completeness, or performance gains that were not measured.

## 8. The 56 mistakes, and how to avoid each

**Before writing code**

1. *Building a feature that already exists.* Grep source and tests for the workflow first; extend what is there.
2. *Trusting `FEATURE_MATRIX.md` or an old README line that says something is missing.* Check the current code and the later sections of `FEATURES-v0.4.md`.
3. *Working in the wrong place.* The app is "Atlas Watch", the package is `atlas-watch`, the folder is `Sky_View`. They are one project.
4. *Proposing an architecture rewrite.* The main/preload/renderer split is deliberate and tested. Change within it.
5. *Adding a server, account, telemetry or auto-update.* The app is local-only. These need the owner's decision.
6. *Adding a dependency casually.* It must bundle (no native add-on), have a permissive licence, and appear in `THIRD_PARTY_NOTICES.md` via `npm run notices`. Prefer what is already installed.

**Security boundary**

7. *Fetching a data feed or lookup from the renderer.* Renderer `fetch` is for bundled assets and map tiles only. Add a main-process handler and call it through `api`.
8. *Calling `fetch` directly in a main-process service.* Use `fetchJson` or `fetchText` so the allow-list, cooldowns, timeouts and size caps apply. The Lemmy image loader and the radio relay are the reviewed exceptions.
9. *Adding a host to the wrong allow-list.* Main requests: `http.ts`. Renderer tiles and media: `remoteHosts.ts`. Browser links: `sanitize.ts`.
10. *Allow-listing a whole multi-tenant host* (ArcGIS, Google, S3). Use an exact path prefix in `ALLOWED_PREFIXES` or `RENDERER_REMOTES`.
11. *Building a general URL proxy or accepting a URL from the renderer.* Handlers take validated parameters and build the fixed URL themselves.
12. *Adding an IPC channel in only some of the five places.* Follow the list in section 6; `tests/ipc-security.test.ts` checks the preload names.
13. *Importing `shared/ipc.ts` into the preload.* Channel names are duplicated there so the sandboxed bundle stays tiny.
14. *Writing a loose schema.* Use `.strict()`, bounded lengths, finite bounded numbers, and regexes for identifiers.
15. *Doing work before validation in a handler.* `validateIpcArgs` is the first statement.
16. *Relaxing `contextIsolation`, `sandbox`, `webSecurity`, the CSP, or adding `'unsafe-eval'`.* Do not. `'wasm-unsafe-eval'` exists only for Cesium.
17. *Rendering remote text as HTML.* Render as text; in generated HTML use `escapeHtml` for every value.
18. *Adding a link to a host that is not allow-listed, so the click does nothing.* Add the host to `EXTERNAL_LINK_HOSTS` with a test, and use `ExternalLink` so a blocked link is reported to the user.
19. *Expecting a new renderer host to work immediately.* The CSP is fixed at page load; the window must reload (see the credential handler in `main.ts`).
20. *Importing Electron in `handlers.ts` or `core.ts`.* Inject a platform service instead, so the module stays testable.

**Credentials and money**

21. *Logging or returning a key.* Pass text through `redactSecrets`; keys stay in the main process except the browser keys the user configured for tile services.
22. *Falling back to a built-in key when the user's key fails.* The user's key wins and is never silently replaced.
23. *Baking the publisher's keys into a handoff build.* Every build (`npm run build`, `dev`, `dist`) reads `%USERPROFILE%\.atlas-watch\builtin-keys.json` when it exists, and it does exist on the owner's machine. For a customer build point `ATLAS_WATCH_BUILTIN_KEYS` at a file containing `{}` and confirm the build prints `Built-in credential providers: none`. Never open, print or copy that keys file.
24. *Committing a keys file.* `builtin-keys*.json` stays outside the repository.
25. *Sending a paid or metered request to test something* (Google, AeroDataBox, Esri, Mapbox, market data). Intercept or use fixtures, and say the live path was not exercised.
26. *Restoring a scene or view onto a metered basemap without consent.* Keep the `allowMeteredBasemap` choice explicit.
27. *Putting credentials, notes or saved locations into scene or GeoJSON exports.* Export schemas are strict for this reason.

**Data truthfulness**

28. *Showing unknown as zero or "not affected".* Use the explicit unknown or "cannot determine" state.
29. *Substituting sample data when a provider fails.* Keep the last complete result with its timestamp and show the failure.
30. *Replacing the last good result with a partial or malformed reply.* Validate completeness before swapping.
31. *Collapsing different times into one.* Source issue, source update, retrieval and detection times stay separate.
32. *Presenting a calculated or estimated value as an observation.* Label it with the right temporal class.
33. *Drawing invented geometry* (zone alerts without polygons, routes, coastlines, building detail). Draw only what the source supplies, or label the illustration.
34. *Claiming worldwide or complete coverage.* State the real coverage per source.
35. *Writing extrapolated positions into history.* Stored fixes and trails keep the original coordinates and times.
36. *Treating a standing callsign route as today's flight.* It is a usual route; dated status comes only from the dated lookup.
37. *Ignoring provider terms.* Check licence and rate limits before adding a source. Public OSM tiles, Nominatim, Photon, public OSRM, Google News RSS (and Cesium ion without the customer's own token) are excluded on purpose.
38. *Polling too often or while a layer is off.* Layers poll only when enabled, at the interval in `LAYERS`, and obey shared cooldowns.

**Storage and state**

39. *A destructive migration.* Additive changes only; older databases must still open with their data.
40. *Running against the user's real profile.* Unpackaged: set `ATLAS_WATCH_DB` and `ATLAS_WATCH_USER_DATA`, or use `npm run smoke`, which sets temporary ones. Packaged: `ATLAS_WATCH_USER_DATA` is ignored, so pass `--user-data-dir=<temp folder>` and set `ATLAS_WATCH_DB`.
41. *Trusting stored JSON.* Parse documents with their schema on read and skip the invalid ones.
42. *Unbounded growth.* Give caches, maps, imports and histories a limit and an eviction rule.
43. *Letting a late async reply overwrite a newer selection.* Tie results to the request that started them and discard stale ones.

**Map and geometry**

44. *Forgetting the date line and the poles.* Unwrap longitudes, split boxes at ±180°, and remember Mercator stops at ±85.05°. Add tests there.
45. *Creating unflipped bitmaps in an imagery provider.* Use `imageOrientation: 'flipY'`.
46. *Creating one Cesium entity per static feature.* Batch into primitives; entities are re-evaluated every frame.
47. *Doing pixel loops or decoding on the main thread.* Use GPU compositing or the worker pool, and transfer bitmaps.
48. *Importing `cesium` before `lib/cesiumBase`, or loading Cesium assets remotely.* Assets are bundled under `/cesium/`.
49. *Hiding a source defect with an overlay.* Isolate the layer that causes it, repair it at the provider or generator, and record before/after evidence.
50. *Hand-editing generated assets or catalogs* (`public/**`, `src/renderer/data/**`). Change the generator in `scripts/` and regenerate; keep the attribution files accurate.

**Verification and repository hygiene**

51. *Calling fixture tests "verified".* Say exactly what ran: unit tests, dev smoke, packaged app, live source, or installer. Installation and upgrade are untested unless you ran them.
52. *Making tests pass by weakening them.* No skips, raised timeouts or deleted assertions. The known flaky timeout in `passenger-routes` is handled by rerunning.
53. *Claiming a performance gain without measurement.* Measure before and after on the same route, and report raw numbers with their limits.
54. *Running `npm run dev` or a build while another instance is open.* Port 5173 must be free, and a running packaged app locks `release/win-unpacked`. `start.bat` selects among a hard-coded list of release folders, so a new side-by-side folder needs an entry there.
55. *Committing generated output or reverting other work.* The root `.gitignore` is currently missing from the working tree (a copy sits in `samples/.gitignore`), so `git add -A` would stage `node_modules`, `dist` and `release`. Stage files by name. Other sessions may be editing this working tree at the same time, so re-run `git status` right before staging and expect files you did not touch to have changed. Never `reset`, `stash`, `checkout --` or delete uncommitted changes you did not make. Do not commit or push unless asked.
56. *Finishing without updating the record.* Add the dated `docs/PROGRESS.md` section, update README or `FEATURES-v0.4.md` if behaviour changed, and correct any doc line your change made false.

## 9. Checklist before saying a task is done

Run through this every time. If an item does not apply, say so in the report.

- [ ] I searched for an existing implementation and extended it where one existed.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes, or the only failure is the known `passenger-routes` timeout and it passes alone. I report the counts.
- [ ] New behaviour has tests; a bug fix has a test that failed before the fix. No test was weakened.
- [ ] `npm run build` passes if I touched anything that ships.
- [ ] I exercised the changed workflow in the running app (dev or smoke with a temporary profile), or I state that I did not.
- [ ] Every new IPC channel is in all five places with a strict schema.
- [ ] Every new destination is in the correct allow-list with a test and a README sources row including terms.
- [ ] No credential, coordinate or note reaches a log, error message or export. No paid request was sent.
- [ ] Existing databases, settings, saved locations, watchlists and history still load.
- [ ] Unknown, partial, stale and offline states are shown as such. Nothing estimated is presented as observed.
- [ ] Date line, poles and empty-result cases are handled where geometry or feeds are involved.
- [ ] UI changes use the existing tokens and components, work by keyboard, and respect reduced motion.
- [ ] `docs/PROGRESS.md` has a dated section: change, evidence, verified, not verified, remaining work.
- [ ] `git status` shows only files I meant to change. Nothing generated is staged. Nothing was committed or pushed without being asked.
- [ ] My final report separates what I verified from what I did not, and lists anything left open.
