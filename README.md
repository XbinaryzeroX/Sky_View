# Atlas Watch

**See what is happening around the places you care about.**

Atlas Watch is a Windows desktop geospatial monitoring app. It started as a tool for small businesses and property
managers who look after several locations. It shows active U.S. National Weather Service alerts and recent USGS
earthquakes, and reports which saved locations fall inside an alert or near an epicenter. On a detailed 3D globe it
also shows live public data layers: aircraft, vessels, satellites, fires, airspace, radar, weather observations,
cyclones, cameras, and transit. Details show source links and observation times when supplied. Briefings can be exported.

Double-click [start.bat](start.bat) to open the newest packaged copy in this project.
Atlas opens with offline satellite imagery and terrain. Where detailed coastal imagery ends, the water shows observed ocean colour from ESA and NASA. The land layer leaves ocean and mapped lake pixels visible. Atlas uses finer Sentinel-2 or U.S. aerial imagery where available. With **Photoreal 3D** selected, coastal views switch to photographic imagery to show the water. [Water and sky verification](docs/PROGRESS.md#satellite-water-imagery-years-and-night-viewing).

Use **Imagery year** in the top bar to select a satellite archive year. Most years show a NASA observation near July 1, with other observations from the same year filling missing orbital swaths. Clouds and seasonal differences can be visible between observations. The map shows source dates. **Auto** returns to your usual basemap.

Open **Day/night** beside **Layers**, then select **Current sunlight** to see the dark hemisphere and its city lights. **Choose time** lets you move the sunlight with a UTC date and time slider. **Daylight** restores even illumination. The lights come from NASA’s 2016 Black Marble composite. The offline star background uses 9,096 measured star positions from the Yale Bright Star Catalog.

**Markets** opens with the ten most actively traded U.S. stocks by reported share volume. Select a stock to read publisher previews and then open an article. The saved watchlist and charts are in **Watchlist**. [Markets verification](docs/PROGRESS.md#trending-markets-and-article-previews).

In **Layers → Live data**,
turn on **Aircraft (ADS-B)** and click a plane. Its card shows the aircraft identity, available build year and
type specifications. Drag the 3D preview or use its arrow buttons to rotate it. **View route on map** fits the
published airport route to the globe. Choose **Follow** under a passenger flight’s heading to keep the plane
centered as it moves. With **Smooth aircraft motion** on in Display settings, the plane moves between reports
using its last reported speed and ground track. The estimate pauses after 45 seconds without a new report.
For dated status, add your own **AeroDataBox** direct API key in
**Providers**, then choose **Check dated flight status** on a passenger flight. That action uses your plan.
The usual airline routes and bundled models work without a key. [Coverage, sources and screenshots](docs/PROGRESS.md#aircraft-selection).

Select a plane, helicopter or ship on the globe to rotate its model. The app includes credited Sketchfab models for
45 aircraft types and nine vessel categories, including cargo ships and tankers. Other types use a labeled
representative shape based on the available aircraft designator, broadcast category or AIS ship type.
When a feed omits the type, the card identifies the shape as generic. [Model coverage](docs/PROGRESS.md#vehicle-model-coverage).

Open **Events → Conflict updates** for dated humanitarian reports by country or territory. Choose
**CFR assessments** to see the Council on Foreign Relations’ assessments by region and open an individual
situation’s overview. Where recent reports cover the same country, the assessment links to those reports.
Each feed shows its last successful check. [Conflict sources and coverage](docs/PROGRESS.md#conflict-updates).

For Germany, open **Layers → Live Data → Weather → Weather warnings (Germany · DWD)**.
Open a German bulletin from **Events → DWD warnings (Germany)** or select its published polygon on the globe.
Warnings with only a named area are available in Events and Official bulletins. Selecting one opens its original
German text and validity times. A saved place's details show any intersections with the published horizontal polygons.
Historical Replay and exported location briefings cover their existing NWS/USGS datasets.
The packaged app matched a live DWD snapshot of 21 bulletins, including five with named areas only, and revalidated it with DWD after restart. [Verification and screenshots](docs/PROGRESS.md#german-weather-warnings).

Use the top search box to find a place offline by its published name or a local spelling. Try `東京`,
`Sao Paulo` or `London, Ontario, Canada`. All three use the bundled Natural Earth catalog. Decimal
coordinate pairs and WGS84 `geo:` links go straight to the map. [Search verification](docs/PROGRESS.md#worldwide-place-search).

For U.S. fire boundaries, open **Layers → Live Data → Hazards → Wildfire perimeters**. Select any filled part
of a published perimeter to see its incident, capture and edit times. The details distinguish mapped acreage
from reported incident size. Discover ranks loaded perimeters with published mapped acreage. NIFC includes
wildfires and prescribed fires where a perimeter is available. [Verification and screenshots](docs/PROGRESS.md#us-fire-perimeters).

Before adding a feature, find its status in the [requirements audit](docs/REQUIREMENTS_AUDIT.md), then check its
source, tests and normal entry point in the running app. The [progress record](docs/PROGRESS.md) links to
screenshots and verification logs. The [feature comparison](docs/FEATURE_MATRIX.md) opens with current updates.
Its historical tables predate features documented in the [v0.5–v0.7 implementation notes](docs/FEATURES-v0.4.md).
The [reference review](docs/REFERENCE_RESEARCH-2026-11-11.md) identifies the exact upstream revisions inspected.

It runs entirely on the user's computer. **Core features need no accounts, API keys, paid map service, or paid
data service, and no server.** Optional integrations (AISStream, Google Photorealistic 3D, a local ADS-B
receiver, Ollama) stay off until the customer configures them with their own account.

> Atlas Watch is a public-data monitoring tool. It is **not** an official warning service, a live satellite
> feed, or a people-tracking tool. Data may be delayed, revised, or incomplete. In an emergency, follow official
> NWS and local alerts.

---

## Features

| Area | What it does |
|---|---|
| Globe and map detail | CesiumJS globe with **progressive tile detail**. The NASA Blue Marble land reference reaches zoom 8 (about 500 m per pixel). The global water image comes from ESA Ocean Colour CCI and NASA Terra/MODIS observations. The ESA WorldCover 2021 Sentinel-2 composite adds 10 m imagery where available over land and coastal waters. **USGS National Map orthoimagery** covers the lower 48, Alaska, Hawaii, and Puerto Rico to zoom 16 (about 2.4 m per pixel, neighborhood detail). Other surfaces: NASA VIIRS daily satellite imagery (previous UTC day, dated), USGS imagery with labels, USGS topo, bundled offline relief, and neutral. **3D terrain** comes from the keyless Terrain Tiles on AWS. A **diagnostics panel** (`Diag`, Ctrl+Shift+D) shows providers, tile levels, pending and failed requests, and when a provider's maximum detail is reached. The globe has U.S. / Lower 48 / Alaska / Hawaii views, north-up, reset, and keyboard navigation. |
| Data layers | Aircraft (adsb.lol, ODbL), military-flagged aircraft, vessels (Fintraffic AIS keyless; AISStream with your key), satellites (CelesTrak elements, positions **calculated** by SGP4), NASA FIRMS fire detections, NIFC wildfire perimeters, FAA prohibited/restricted airspace, NOAA nowCOAST radar, METAR observations, NHC cyclones, Caltrans and Fintraffic cameras, and MBTA transit. Each layer is labeled live / delayed / periodic / calculated / static and shows freshness, record count, fetch time, coverage notes, and errors. Layers poll only while switched on. |
| Tools | Search (coordinates, `geo:` URIs, 7,342 bundled places, U.S. Census address lookup), click-to-track with recorded trail, nearby contacts (250 km), predicted satellite orbit, geodesic distance and area measurement, pins / routes / areas annotations, saved views, last-view restore, scene file export/import (no credentials), playback of recorded movement, a HUD, and display styles (night vision / thermal-style / CRT / noir, all labeled as visual effects only). |
| Later map and tracking additions | Screen-space place and road labels with collision handling, local scripts and independent vehicle label controls; type/category-specific aircraft and vessel symbols, app-built 3D vehicles and optional attributed model packs; watchlists, airports and overhead search. Follow works across batched/entity rendering; fresh airborne observations support a simulated cockpit perspective aligned to reported track/heading, with fixed pitch/roll and stale-data exit. Optional identification photos and reported-route lookup distinguish a usual callsign route from an observed track or today's flight plan. |
| Camera workspace | Existing HLS player, refreshed stills and official viewer links; search, country/region and media filters, favorites and map navigation. Existing local boards now group up to 32 camera references, four cards per page and at most two video streams; background players disconnect while a board is open, and hidden/paused players release media. Open-data adapters include Caltrans, NYC DOT, Fintraffic, TfL, Hong Kong, DriveBC and Québec; 22 optional systems require customer credentials and their publisher's terms. A listed camera is not a guarantee of availability. |
| Dated imagery and weather satellite | 23 NASA GIBS products with source-checked dates, gap-aware playback/navigation, two-date swipe comparison and per-date raster-request health; a listed date may still have missing raster tiles. Separate GOES/Himawari weather satellite frames retain their own coverage and acquisition times. Normal, CRT, NVG, FLIR, Anime, Noir and Snow styles are visual effects. |
| Satellite passes | Select a satellite, enter worldwide observer coordinates/elevation or choose an existing saved place, then calculate the next 24 hours of rise/peak/set events. Uses loaded orbital elements locally in a bounded worker; stale-element warnings, UTC/local times and no-pass/unavailable states are explicit. Geometric passes do not establish optical visibility. |
| GeoJSON annotations | Tools → Import GeoJSON previews local points, lines and simple exterior polygons, reports rejected/duplicate features, and requires acknowledgement before importing valid features only. Atomic import adds new annotation IDs; export shares geometry/name/color/visibility without saved places, notes or credentials. The supported subset and limits are described below. |
| External Street View | Tools → Street View in Google Maps sends the current screen-center coordinates to the default browser on click. This is a partial street-level workflow: Google chooses an available historical panorama; Atlas Watch does not embed, capture or verify imagery availability. See [source/terms and verification limits](docs/STREET_VIEW.md). |
| Existing workspaces | Incident register, trends, country summaries and source monitor; local boards and team directory; optional Markets adapters and Lemmy Community. Market-data plans and redistribution rights must be checked separately; credentialed and authenticated workflows have separate verification limits. |
| Provider settings | Shows source coverage, terms, setup instructions and available connection or configuration checks. Customer-entered credentials are encrypted in local storage using Electron `safeStorage` (Windows DPAPI). Google, Esri and Mapbox client keys are available to the map renderer for the enabled service. |
| Weather alerts | Pulls active alerts from `api.weather.gov` with severity, urgency, certainty, event, headline, description, instructions, onset, ends, expires, sender, area, zones, and identifier. Polygons are drawn when supplied. Zone-based alerts without a polygon are listed and still evaluated, never drawn as a made-up shape. |
| Earthquakes | Pulls USGS GeoJSON summary feeds with a configurable window (hour/day/week/month) and minimum magnitude. Markers encode magnitude by size, color, and an `M5.2` label. Details show magnitude, depth, time, epicenter, review status, and the USGS event page. |
| Earthquake area watches | Set a magnitude threshold on an existing drawn or imported area in Map tools. New qualifying USGS epicenters create local matches in the existing bell. Each match retains its source ID, reported origin time, coordinates, magnitude and local detection time. Opening a match marks it read. |
| Saved locations | Add by typing latitude and longitude or by clicking the globe. Each has a name, category, notes, and monitoring radius, and can be edited or deleted. Locations are stored in SQLite. CSV import has column mapping, a preview, validation errors, and duplicate handling. CSV export is included. |
| Monitoring | Saved places use supplied alert polygons, typed NWS zone IDs and geodesic distance to earthquake epicenters. A complete reply supports an exact count. Partial replies show confirmed matches with their limits. Offline or failed refreshes show the last observation and its time, with the current total marked unknown. Open **Data → Briefing** for the same evidence in HTML or PDF. |
| Event history and replay | Search local alert and earthquake history, then choose **Replay at last observation**. The existing timeline shows recorded NWS alert polygons, USGS epicenters and movement fixes at one cursor. Open **Data** for the recorded details, including zone alerts without polygons. |
| Saved investigations | In **Scenes**, name and save the current view. Restore its camera, 2D/3D mode, display filters, imagery configuration and selected alert or earthquake. A recorded view opens at its saved UTC time. A live view uses the current provider data. |
| Briefing | Preview and export a location report or a **Since last visit** report as HTML or PDF. Location reports cover your selected places. Visit reports compare recorded NWS and USGS replies across two app launches, with source IDs, links, observation times and any gaps in coverage. |
| Optional local AI | If you run **Ollama** yourself, Atlas Watch can ask a local model to explain results it has already calculated. It connects only to loopback (127.0.0.1) and never downloads models. Answers are labeled as AI-generated. The app is fully usable without it. |
| Reliability | Last-known data retains original timestamps. Main-process HTTP shares publisher pauses across callers, preserves long Retry-After waits and delayed redirects, and schedules long deadlines through bounded timer hops. Polling, timeouts, backoff and stale/unavailable states remain provider-aware. These paths have regression coverage; outages and live quotas still depend on each source. |

---

## Quick start (development)

The development build was tested on Windows x64 with Node.js 24.22.1 and npm 11.19.1.
For Node 22, the locked Cesium packages require at least 22.17.0.

```bash
npm ci
```

The checked-in `package.json` already approves the install scripts for the locked esbuild and electron-winstaller versions.

Electron downloads its binary on first launch. To download it ahead of time:

```bash
node node_modules/electron/install.js
```

Run in development mode (Vite dev server + Electron, with hot reload for the UI):

```bash
npm run dev
```

Build and run the production bundle without packaging:

```bash
npm run build
```

```bash
npm start
```

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run smoke
```

`npm run smoke` launches the built app with a temporary database. It waits for live feeds, prints the
renderer and feed status, and saves a screenshot. It needs network access.

The November 11 monitoring build passed typecheck, **795 tests across 51 suites**, and the production build.
The [monitoring verification record](docs/PROGRESS.md#saved-location-monitoring-evidence) covers saved places and source outages.
The [visit briefing check](docs/PROGRESS.md#since-last-visit-briefings) includes the [two-visit screenshot](docs/screenshots/visit/audit-visit-second-ready.png).
The earlier desktop Scenes check saved a real NWS alert and a USGS earthquake, reopened them after an offline
restart, and checked what the user sees when the local observations are missing. Its results and before/after
screenshots are in the [Scenes verification record](docs/PROGRESS.md#saved-investigations-in-scenes).

In the earlier desktop replay check, all 414 recorded NWS alert identifiers and issue times, and all 199 USGS
earthquake identifiers, magnitudes, coordinates and update times matched the actual provider responses.
Earlier-revision and gap checks used controlled historical fixtures. [Timeline check and screenshots](docs/PROGRESS.md#shared-historical-timeline).
Desktop checks used real USGS observations for earthquake area watches. The NOAA adapter returned stations
from both sides of the date line. An isolated upgrade-copy check preserved the prior release's SQLite records.
Earlier GeoJSON and Street View checks used temporary native-dialog and shell adapters. Native file-picker input,
default-browser behavior, and installer installation/upgrade remain open. See the [progress record](docs/PROGRESS.md).

## Packaging a Windows installer

```bash
npm run dist
```

This runs type checking, builds, regenerates `THIRD_PARTY_NOTICES.md`, and writes
`release/Atlas-Watch-Setup-<version>.exe`, a per-user NSIS installer. For an unpacked folder you can run
directly, use `npm run dist:dir` (the output is `release/win-unpacked/Atlas Watch.exe`).

To reproduce the handoff installer with customer-supplied credentials, open a fresh PowerShell session in the
project and point the existing build setting at an empty JSON object. The build should print
`Built-in credential providers: none`.

```powershell
$customerKeyConfig = New-TemporaryFile
Set-Content -LiteralPath $customerKeyConfig.FullName -Value '{}' -Encoding ascii
$env:ATLAS_WATCH_BUILTIN_KEYS = $customerKeyConfig.FullName
npm.cmd run dist
```

The installer is **not code-signed**, so Windows SmartScreen will warn on first run. Signing with a
code-signing certificate is a later step. Configure `win.certificateFile` or Azure Trusted Signing in
`electron-builder.yml`.

End users need nothing else installed: no Node, Python, Docker, or terminal.

The current flight-card installer is [release/flight-card/Atlas-Watch-Setup-0.7.0.exe](release/flight-card/Atlas-Watch-Setup-0.7.0.exe).
It is unsigned and its SHA-256 is `932D440E35C1290D5E149D872F7A39131EF7A318C62B9A5F5E2957A95D880203`.
This side-by-side release lets an earlier Atlas Watch session finish normally. Close the older window and double-click
[start.bat](start.bat) to open the newer package. [Flight-card installer audit](docs/flight-card-package.log).

The preceding November 11 worldwide place-search installer, `release/Atlas-Watch-Setup-0.7.0.exe`, is **128,122,660 bytes**, unsigned.
Its SHA-256 is `FD97F4112DF00A5206AB5A283018B5323EC8366BCBE88DA6B3183622BFD3B948`.
The installer contains the same ASAR archive as the unpacked application. All 351 production files, the notices
and both sample files matched their build inputs. The packaged app completed 19 offline map selections and
opened a live U.S. Census address match. [Package audit](docs/place-search-package.log) · [Desktop search checks](docs/PROGRESS.md#worldwide-place-search).
The preceding saved-location build matched 541 NWS alerts and 209 USGS earthquakes to the live replies on each of two launches.
Saved-place matches opened the original source details, survived the restart and appeared in exported reports.
Windows installation and installer-driven upgrade remain untested. [Packaged window check](docs/location-evidence-packaged.log) and [location screenshot](docs/screenshots/location-evidence/audit-location-packaged-live-summary.png).

---

## Running it (Windows PowerShell)

If PowerShell reports that running scripts is disabled, use `npm.cmd` instead of `npm` (or use Command Prompt):

```powershell
cd "C:\Users\infob\Documents\Claude\Sky_View"
npm.cmd run dev
```

## Using it

1. **Add locations.** Use **+ Add** (type coordinates or click **Pick point on globe**), or **Import CSV**. See
   [`samples/sample-locations.csv`](samples/sample-locations.csv) and [`samples/README.md`](samples/README.md)
   for the format.
2. **Review.** The list shows each location's confirmed alert count with its top severity, plus `?` for alerts
   that could not be determined and `◎` for earthquakes within the radius. Select a location for details.
3. **Check sources.** Select any alert or earthquake to see the full record and open the NWS or USGS source.
4. **Filter.** Use alert severity, "only alerts affecting saved locations", the earthquake window and minimum
   magnitude, and "only earthquakes within a location radius".
5. **Briefings.** Open **Data → Briefing**. Choose **Location briefing** for your saved places, or **Since last visit** to compare the previous app run with this one. The visit report works without saved places. It lists newly returned, updated and no-longer-returned source IDs. A changed query, an incomplete reply, or a missing observation can prevent comparison. Export the reviewed report as HTML or PDF. For a location report larger than 8 MiB, the dialog offers **Export current HTML** and **Export current PDF**, which regenerate the full report at export time.
6. **History.** Open **Event history** to search records, or choose **Replays → Open playback timeline**. Each feed shows its recording time and query scope. A successful empty reply, an incomplete reply, a gap and a time before the first retained observation have distinct labels. Older databases keep their event summaries and movement tracks. Recording of full alert and earthquake replies starts with the first successful refresh on this version.
7. **Data layers.** Switch layers on in the left panel. Hover a layer for its source, terms, coverage, and
   data type. Aircraft and METAR load for the current view, so zoom in. Click any marker for details, **Track**,
   nearby contacts, the camera still, or a satellite's predicted orbit.
8. **Tools and Scenes.** Use **Tools** for measuring, drawing and display styles. Use **Scenes** to save a
   named view or import/export a scene file. You can open Scenes beside the Data panel during Replay.
   Use **Diag** for map diagnostics.
9. **Providers.** Use the **Providers** button for connection tests and optional credentials.

**GeoJSON in Tools.** Choose **Import GeoJSON…**, review names/geometry and every rejection/duplicate, then
acknowledge any skips before importing valid features. Cancel saves nothing. Existing annotations are not
overwritten, and repeated geometry/name matches are skipped against both stored and same-file annotations.
**Export annotations…** writes the same annotation collection through the save dialog.

Supported geometry is 2D WGS84 `[longitude, latitude]` Point, LineString and a simple Polygon with one closed
exterior ring. Holes, Multi geometries, GeometryCollection, altitude, CRS declarations, degenerate/self-crossing
and globe-wrapping rings are rejected. Limits: 2 MiB UTF-8, 2,000 features/stored annotations, 5,000 positions
per geometry including polygon closure and 20,000 positions per file, with bounded intersection checks.
Only name, color and visibility are retained from properties; source IDs and foreign fields are discarded.
Lines and polygon edges use the globe's shortest geodesic paths, which can differ from GeoJSON's straight
longitude/latitude segments; add vertices for the intended shape. Imported areas can be used for a watch after you save them.

**Watch an area for earthquakes.** In **Map tools**, expand **Watch USGS epicenters…** beneath a saved area.
Choose the minimum magnitude and select **Add watch**. The area can stay hidden on the map. Matching includes
the boundary and follows straight longitude/latitude segments across the shorter date-line crossing. Widely spaced
vertices can produce a different boundary from the arcs drawn on the globe. Pole-touching and self-intersecting
areas cannot be watched.

An enabled watch checks the configured USGS feed on successful refreshes while Atlas Watch runs. It accepts
earthquakes with known magnitude and an origin time after the watch was armed. Re-enabling a watch or changing
its geometry or threshold starts a new period. The editor shows the source's actual window and minimum magnitude,
the last local check, and any limits on evaluation. A smaller rule threshold cannot recover observations absent
from the selected feed. The watch uses the existing keyless connection and polling schedule.

The app skips cached responses and waits if the USGS generation timestamp is missing, more than 15 minutes old,
or more than two minutes ahead of the local clock. Up to 100 rules can share 20,000 enabled vertices. The bell
retains the newest 500 matches across all areas. If a processing limit prevents a full check, Map tools shows
the incomplete status and keeps the time of the last complete check.

Open **Notifications → Saved area matches** to inspect the recorded evidence or focus the map on the reported
epicenter. A publisher revision or app restart does not by itself create another notification for the same event.
Reading a match preserves the evidence. Pausing preserves the rule and its matches. Removing a watch or deleting
its area removes that watch's local matches. USGS event history follows its own retention settings.

**Street View in Tools.** Move the globe to the location, then click **Street View in Google Maps ↗**. The action
uses the center of the screen at click time and refuses a missing globe intersection or a view morph. The
external Google viewer handles imagery/attribution; the link requires no Atlas Watch API key or billing setup.
Availability, capture dates and actual default-browser handoff are not established by the fixture tests.

Data is stored in `%APPDATA%\Atlas Watch\atlas-watch.sqlite` (locations, settings, feed cache, history).

### Settings

* **NWS contact (optional):** a website or email added to the User-Agent sent to `api.weather.gov`, as NWS
  requests. Leave it blank to send a generic app identifier.
* **Refresh intervals:** NWS defaults to 180 s and USGS to 300 s, with a 60 s minimum.
* **NWS zone lookup:** on by default. Each location's coordinates are sent to `api.weather.gov/points` about
  once every 30 days to learn its zones. Turning it off makes alerts without a polygon show as "cannot determine".
* **History retention:** 30 days / 5,000 records by default.
* **Globe surface** and **reduce motion**.
* **Local AI:** enable, set the port (host is always 127.0.0.1), choose an installed model.

---

## Architecture

```
src/
  shared/      Pure, tested logic used by both processes
    types.ts       Domain types (UTC ISO timestamps everywhere)
    normalize.ts   Validates and normalizes NWS/USGS payloads; malformed records are counted and skipped
    geo.ts         Geodesic distance (geographiclib, WGS84), point-in-polygon (Turf), antimeridian handling
    monitoring.ts  Location × alert/quake evaluation, freshness rules
    dedupe.ts      Superseded-alert detection, cross-network quake merge, refresh diffs
    csv.ts         Parse, map, validate, de-duplicate, plan import, injection-safe export
    briefing.ts    Deterministic HTML briefing (no scripts, no remote resources)
    ai.ts          Grounded prompt builder (computed results + untrusted-data framing)
    ipc.ts         IPC channel names and zod schemas for every request
  main/        Electron main process (owns network, disk, and timers)
    main.ts        Window, menu, IPC wiring, PDF export
    security.ts    app:// protocol, CSP, renderer request allow-list, navigation/permission lockdown
    core.ts        AppCore: polling, backoff, rate-limit cool-down, cache, evaluation, zone lookup queue
    store.ts       SQLite persistence via Node's built-in node:sqlite (no native add-ons)
    handlers.ts    Validated IPC handlers (no Electron imports, so they are testable)
    feeds/http.ts  Allow-listed fetch with timeout, manual redirect checks, and size cap
    feeds/sources.ts  NWS and USGS adapters behind AlertSource / QuakeSource interfaces
    ollama.ts      Optional loopback-only Ollama client
  preload/     Narrow contextBridge API (no generic invoke)
  renderer/    React + TypeScript UI, CesiumJS globe
tests/         Vitest suites with separate fixtures in tests/fixtures/
```

**Data flow.** The main process fetches feeds from fixed URLs, normalizes them, stores a cache plus history in
SQLite, evaluates every saved location, and pushes a snapshot to the renderer. JSON feed adapters run in the main
process. The renderer loads local assets and explicitly allow-listed map tiles, camera media and identification
images. Optional imagery destinations are enabled only when configured. `src/shared/remoteHosts.ts` is the
renderer allow-list and CSP source; `src/main/feeds/http.ts` defines the core JSON-feed destinations.

**Future server-side cache.** `AlertSource` and `QuakeSource` are the seam. A cache adapter that calls your
local server instead of NWS/USGS can implement the same interfaces and be passed to `AppCore` in `main.ts`.
The UI, monitoring, and storage stay unchanged. Add the server host to `ALLOWED_HOSTS` in
`feeds/http.ts` when you do.

**Extension points kept clean for later:** licensing, billing, accounts, and auto-update would all live
in the main process behind new IPC channels. None are implemented, and nothing phones home.

### Security measures

* `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (plus `app.enableSandbox()`), `webSecurity: true`.
* The renderer is served from a custom `app://atlas` origin with a restrictive CSP: no inline scripts and only
  explicit remote tile/media/image prefixes. `'wasm-unsafe-eval'` is allowed only because CesiumJS compiles bundled WebAssembly; JavaScript
  `eval` remains blocked.
* Every IPC request is validated against a zod schema. Requests from any frame other than the app's main
  frame are rejected.
* Main-process data adapters use validated provider destinations, including NWS, USGS and the configured layer,
  camera, market and community services. Redirects are checked; keyed cameras restrict credential delivery to
  their publisher. Ollama stays on loopback; the optional ADS-B receiver accepts literal private IP addresses.
  There is no unrestricted URL proxy.
* External links open in the system browser only for `https` URLs on an allow-list (weather.gov, noaa.gov,
  usgs.gov, and a few attribution sites).
* Remote text is length-limited, stripped of control characters, and rendered as text, never as HTML.
  Briefings escape all content and carry their own `default-src 'none'` CSP.
* CSV export neutralizes spreadsheet formula injection.
* PDF rendering happens in a hidden window with JavaScript disabled and the network blocked.
* Coordinates and notes are not written to logs.
* Permission requests are denied except HTML fullscreen for the app's own page (the camera Fullscreen control).

---

### Map detail: what was wrong and what changed

The original globe used CesiumJS's bundled **Natural Earth II** texture. Its tile pyramid stops at **level 2
(about 20 km per pixel)**, so Cesium could only stretch it as you zoomed. That is why the map looked blurry. It
was a source-resolution limit, not a rendering bug. The globe now uses real multiresolution tile pyramids:

- **Global overview:** ESA Ocean Colour CCI and NASA Terra/MODIS provide water observations. The NASA GIBS Blue Marble land reference reaches zoom 8 (about 500 m per pixel).
- **Land and coastal waters:** ESA WorldCover Sentinel-2 true colour, 2021 annual median, 10 m per pixel, zooms 8–14 between 60° S and 83° N where available. [Publisher and attribution](https://esa-worldcover.org/en/data-access).
- **United States:** USGS The National Map orthoimagery, zoom 0–16 (about 2.4 m per pixel). Levels 17 and up
  return 404 from the service, so Cesium stops there and keeps the level-16 tiles on screen.
- **Terrain:** Terrain Tiles on AWS (terrarium), real elevation to zoom 15. Deeper levels resample level 15
  rather than inventing detail.

Cesium requests only visible tiles, keeps parent tiles on screen while children load, and cancels requests
for tiles that leave the view. Tiles are cached by Chromium's HTTP cache according to each provider's headers.
The bundled optical composite supplies offshore water while finer layers load and outside their coverage.
USGS orthoimagery spans various acquisition years. NASA Blue Marble is a 2004 composite.


### Ocean and white-area defects (v0.3): root cause and fix

Isolation testing at the reported locations (Baja California, and the Gulf of California at 318 km) showed
that terrain, boundaries, weather polygons, and shaders were not involved. All of the artifacts came from the
USGS imagery layer and the global base:

- **White sheets.** Outside U.S. coverage, USGS returns *opaque white* no-data tiles instead of 404 or
  transparent tiles. Two kinds were seen: PNG tiles that are about 96% white, and uniform white JPEGs of
  about 2.4 KB. The app's U.S. rectangle included Mexico and open ocean, so these were drawn there.
- **Black wedges.** The transparent parts of those same PNG tiles let the old global layer (Blue Marble
  Next Generation, with a near-black ocean) show through.
- **Rectangular cutoffs.** These were the edges of the U.S. rectangle, where USGS low-zoom imagery (bright,
  bathymetry-shaded ocean) met the dark global layer.

**Fix:**

- `UsgsImageryProvider` makes no-data white pixels transparent: PNG tiles always, and JPEG tiles only when
  they are smaller than 4 KB and more than 99.5% white. Real imagery tiles are 20–40 KB.
- The global base is now NASA *Blue Marble Shaded Relief + Bathymetry*, whose ocean matches the USGS tiles.
- USGS is used from zoom level 9 down.

A second bug made custom-drawn tiles render upside down. Cesium expects imagery bitmaps created with
`imageOrientation: 'flipY'`, and Chromium ignores the WebGL upload flip for `ImageBitmap`. All custom
providers now create flipped bitmaps.

A third defect showed up during worldwide checks: a **black vertical stripe at 180°** (east of Fiji). This is a
source defect in NASA GIBS. The easternmost tile column (x = 2^z − 1) ends in a 2–9 pixel band of near-black
pixels, plus JPEG noise. `GibsBaseProvider` detects the band in those tiles only, by comparing column
averages, and fills it from the nearest valid column in each row. It adds no new detail. A slight brightness
step remains at 180°, because the source imagery on the two sides differs.

**Follow-up fixes (v0.3.1):**

- **Coastal imagery.** The earlier offshore fade has been retired. Valid USGS and configured satellite imagery stay visible through their coverage edges. The 10 m Sentinel-2 composite covers additional coasts.
- **Open ocean.** The current Atlas stack uses observed satellite water colour from ESA and NASA. The older bathymetry background and simulated ripples have been removed from water views.
- **Black discs over both poles.** The terrain used the Web Mercator tiling scheme, which stops at
  ±85.05°, so the globe had no surface over the poles. Terrain is now resampled into Cesium's geographic
  scheme, which reaches ±90°. Beyond 85.05° the last source row is extended. The same NASA imagery is
  draped there in geographic projection (GIBS WMS).
- **Sea surface.** The terrain used to draw ocean-floor depths, so tilted views showed blurry imagery draped
  over underwater ridges. The sea is now flat at sea level, using OSM ocean outlines. The November 11 audit
  disables Cesium's decorative wave highlights because they obscure the underlying imagery; sea-level geometry
  and the source imagery remain in use.
- **Camera.** You can zoom in to 100 m above the ground; the old 2 km limit made the camera snap back.
  Tilting stops at 80° from straight down instead of swinging back to a top view.
- **Stylized window façades** (Settings, on by default). OSM building walls get a window grid generated from
  each wall's size: about 3.2 m bays and 3.4 m floors, with a solid ground floor. The grid fades to a plain
  tone with distance. It is decoration only, not the real building's windows or floor count. Real façades
  need Google Photoreal 3D.
- **Outside the U.S. without a key.** Atlas displays the Sentinel-2 composite where covered and retains the NASA base underneath. Streets and labels can be shown over either.
- **3D buildings.** OSM extrusions are now lit (roofs and walls shaded differently) and use OSM building
  colors where they are tagged. Real façade textures need Google Photorealistic 3D Tiles (Provider setup,
  step 5).

Before and after screenshots are in `docs/screenshots/v0.3/`: `before-*` and `after-*` cover the defects,
`f*` the worldwide views, and `e*` the tracking and analyst features.

### Worldwide coverage

Navigation, search, saved locations, and calculations work worldwide. Each layer is labeled with its real
coverage; the NWS weather alerts, for example, remain U.S.-only. Map detail by source:

| Capability | Keyless (free) | With your credentials |
|---|---|---|
| Global base imagery | ESA and NASA optical water observations plus the NASA Blue Marble land reference | — |
| Official weather warnings | NWS in its U.S. service area, DWD in Germany and its published marine areas | No credentials required |
| High-resolution imagery | ESA WorldCover Sentinel-2, 10 m over land and coastal waters where available. USGS, about 2.4 m where covered in the U.S. | Worldwide: Esri World Imagery or Mapbox Satellite (metered), EOX Sentinel-2 cloudless 10 m (license) |
| Streets, place names, boundaries | Worldwide (OpenStreetMap via OpenFreeMap) | — |
| 3D buildings | Worldwide where mapped in OSM (extruded; heights from tags or estimated) | Google Photorealistic 3D Tiles (metered) |
| Terrain | Worldwide (Terrain Tiles on AWS) | — |

### Provider setup (optional integrations)

Open **Providers** in the top bar to see the setup path, terms status and available check for each service.
The saved-location monitoring installer uses customer-supplied credentials for optional services.
Earlier publisher-configured builds included Twelve Data and Alpha Vantage keys. The existing publisher build
option supports included keys, which can be recovered from a distributed desktop copy. A customer's saved key
takes precedence. Included-key daily allowances apply per installation. Provider accounts control account-wide limits.

1. **Esri World Imagery.** Create an ArcGIS Location Platform account
   (location.arcgis.com/sign-up). Create an API key with *basemap* privileges and restrict it to your
   application. Paste it into **Esri World Imagery** and press *Test connection*. Then choose
   *Esri World Imagery* under Settings → Globe surface. Usage beyond Esri's free tier is billed to your account.
2. **Mapbox Satellite.** Create a Mapbox account and copy a *public* token (`pk.…`), restricted to your
   use. Paste it into **Mapbox Satellite**, test it, then choose *Mapbox Satellite* as the surface. This is
   metered after Mapbox's free tier.
3. **EOX Sentinel-2 cloudless.** Only if your organization holds an EOX commercial license, tick the
   confirmation in **EOX Sentinel-2 cloudless**, then choose that surface. Without a license, the imagery is
   for non-commercial use only.
4. **AISStream (worldwide vessels in your view area).** Sign in at aisstream.io, create an API key, and
   paste it into **AISStream.io**. The key is used only by the app's background process; the map view never
   connects to AISStream directly. AISStream has no formal terms of service, so review it before
   commercial use.
5. **Google Photorealistic 3D Tiles (textured 3D buildings).** This is the licensed way to get Google
   Earth–style textured cities. Atlas Watch never scrapes Google Earth.
   1. In Google Cloud Console, create a project and attach a billing account. Google requires billing
      even within its free monthly allowance.
   2. Under **APIs & Services → Library**, enable **Map Tiles API**. Also enable **Geocoding API** so
      place search keeps working (see below).
   3. Under **Credentials**, create an API key. Restrict it to those two APIs, and set a daily quota cap
      to limit spending.
   4. In Atlas Watch, open **Providers → Google Maps Platform**, paste the key, and press **Save**, then
      **Test**. Saving reloads the window once, because the map may only contact Google after the key
      exists.
   5. Use the top-bar buttons. **Satellite** gives Google satellite imagery worldwide (2D tiles, billed per
      tile). **Photoreal 3D** gives textured 3D cities (billed per session).

   If Google refuses the key (API not enabled, no billing, quota reached), a message says so. The app
   then keeps the keyless globe and OSM buildings instead of showing an empty scene.

   While it is on, the globe's own imagery and the OSM block buildings are hidden, and Google's logo and
   attributions are shown. Selecting Google imagery enables the **Google Geocoding** search action if
   you have supplied your own key. Each explicit search sends one request. On other basemaps, typing
   a place name uses the bundled catalog even when your key is saved. Coordinates and loaded records
   remain available offline. [Google's geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies).
   Both APIs are metered and billed to your Google account. Check Google's current pricing page.
6. **Local ADS-B receiver.** Enter your readsb/tar1090 `aircraft.json` URL. Only literal private IP
   addresses are accepted.

## Data sources, licensing, and attribution

Code licenses and data terms are reviewed separately. The rows below record known conditions; optional
providers, account entitlements and imported data have their own rights and redistribution limits.

| Component | License / terms | Notes |
|---|---|---|
| NWS API (`api.weather.gov`) | U.S. government data; NWS documentation says it is "free to use for any purpose" | No key. A User-Agent is required, and an email or website in it is optional. Rate limits are unpublished but "generous", and the app polls at most once per minute. Credit is shown as "NWS/NOAA". |
| USGS earthquake feeds | U.S. government work, public domain | Feeds update every minute. Credit: U.S. Geological Survey. |
| DWD German weather warnings | © Deutscher Wetterdienst, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Atlas Watch converts CAP polygons and exclusions to GeoJSON. | Keyless. The optional layer checks the complete German STATUS archive every five minutes. Provider settings shares that connection and cache. [Publisher access and attribution](docs/REGIONAL_WARNING_RESEARCH.md). |
| Natural Earth II imagery (in CesiumJS) | Public domain | Static, low resolution. Labeled "static, not live imagery". |
| `world-atlas` (Natural Earth) / `us-atlas` (U.S. Census) | ISC package; public-domain data | Boundaries |
| CesiumJS 1.147 | Apache-2.0 | Bundled locally. Cesium ion is **not** used, and no token or account exists. |
| Electron 45, React 19, Vite 8, TypeScript 7, zod 4, Turf 7, geographiclib-geodesic 2, PapaParse 5, topojson-client 3 | MIT / Apache-2.0 / ISC | — |
| Transitive packages | MIT, ISC, Apache-2.0, BSD, (MIT AND Zlib), Unlicense, (MPL-2.0 OR Apache-2.0) | All permissive. See `THIRD_PARTY_NOTICES.md`. |
| Ollama (optional, not bundled) | MIT; models have their own licenses | Users install Ollama and choose models themselves. Check each model's license for commercial use. |
| NASA GIBS (Blue Marble, VIIRS) | NASA open data, no restrictions; attribution requested | Imagery tiles |
| USGS The National Map basemaps | U.S. public domain | Imagery and topo tiles (U.S.) |
| Terrain Tiles on AWS (Mapzen/Tilezen) | Open data; per-source attribution required (USGS 3DEP, SRTM, GMTED2010, ETOPO1, Copernicus EU-DEM, and others; see registry.opendata.aws/terrain-tiles) | 3D terrain |
| adsb.lol | **ODbL 1.0**: attribution, and share-alike for derived databases | Aircraft and military-flagged aircraft. Rate limits unpublished. |
| Fintraffic Digitraffic (AIS, weather cameras) | **CC BY 4.0**: "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" | Vessels and Finnish cameras |
| AISStream.io (optional, customer key) | Free beta, **no formal terms** (marked restricted) | Vessels in the view area |
| CelesTrak | U.S. government-origin data, no published license; usage policy: at most one download per 2 hours per dataset | Satellite elements |
| NASA FIRMS | NASA open data; citation requested | Fire detections |
| NIFC WFIGS | Public U.S. interagency perimeter data. The publisher lists contributors and disclaims guarantees of accuracy and completeness. [Dataset and terms](https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824) | Keyless. The enabled layer checks every 15 minutes and requests generalized geometry. |
| FAA SUA, NOAA AWC, NHC, nowCOAST, U.S. Census Geocoder | U.S. public domain | Airspace, METAR, cyclones, radar, address search |
| Caltrans CCTV | Published openly by Caltrans; review Caltrans terms before redistribution | California cameras |
| MBTA V3 API | MassDOT/MBTA developer license (review before commercial use) | Boston transit |
| Natural Earth 1:10m populated places v5.1.2 | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) | 7,342 existing places with 97,615 publisher name variants, indexed locally on first use. [Source and regeneration information](scripts/places-source-manifest.json). |
| satellite.js | MIT | SGP4 propagation |
| Google Photorealistic 3D Tiles (optional) | Google Maps Platform terms, **metered**, customer key | 3D cities |
| Google Maps Street View external link | Google Maps viewer terms and imagery attribution remain in Google's viewer | User-clicked browser handoff only; no embedded/static API, imagery download or reuse license. See [Street View notes](docs/STREET_VIEW.md). |

**Optional sources with restrictions:** OpenSky worldwide snapshots are opt-in and require a separate
commercial-use agreement before selling; Esri World Imagery uses the customer's ArcGIS credentials and terms.
The reference's unrestricted classic Esri endpoint is not used.

**Excluded for terms, cost or privacy reasons:** public OSM tiles, Photon/Nominatim and FOSSGIS OSRM (fair-use
community servers), TeleGeography cables (CC BY-NC-SA), Google News RSS (personal use only), and ALPR camera
mapping (privacy).

`THIRD_PARTY_NOTICES.md` (regenerated by `npm run notices`) is copied into the installer's `resources`
folder. Electron's packager also places `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the
executable.

**Provider choices:** NASA, ESA WorldCover and USGS imagery and AWS terrain are included without keys. Cesium ion is not used.
Google, Esri and Mapbox are optional credentialed integrations with provider-specific billing and terms.
U.S. address lookup uses Census. Worldwide offline place and coordinate search is included. Google place
lookup uses your key when you select Google imagery and explicitly start a search. Public OSM tile servers and community geocoding/routing
instances are not used as an unrestricted commercial backend.

---

## Known limitations

* **Not full parity with the reference.** Embedded street-level imagery, wind animation, lightning, GNSS integrity,
  radio, wildlife, space missions, voice control and an MCP agent remain unimplemented. Cockpit perspective,
  satellite passes, camera boards and 3D vehicle rendering already exist; external model assets have separate licenses.
  Street View opens externally. Saved areas support a USGS epicenter and magnitude rule. The timeline and saved investigations cover recorded NWS/USGS replies. The timeline also shows retained movement fixes. Additional rule types and historical datasets remain open.
* **Keyless vessel coverage is regional** (Finland and the northern Baltic). Worldwide view-area AIS needs the
  customer's AISStream key, and AISStream's terms are unclear for commercial use.
* **Cameras and transit are regional.** Camera adapters cover the publishers listed above, with additional
  systems available through customer keys. Transit uses MBTA (Boston). An adapter does not establish complete
  national coverage or a working image at every catalog position.
* **Keyless water imagery varies by coverage.** Sentinel-2 supplies 10 m imagery near covered coasts. The offshore overview uses annual ESA ocean-colour observations and same-year Terra/MODIS imagery. Its coarser resolution cannot resolve individual waves.
* **Satellite positions are calculated predictions** from orbital elements, not observations.
* **Playback coverage depends on local recording and retention.** The map uses retained replies within each feed's freshness window. Movement uses the latest recorded fix within five minutes of the cursor. The basemap, saved places and drawings provide current geographic context. Dated imagery has its own acquisition-date controls.
* **Unverified integrations:** AISStream with a valid key, Google 3D Tiles with a valid key, and a local
  readsb receiver are implemented but were not tested with real credentials or hardware. Invalid-key
  rejection was verified.

* **Alerts without polygons are not drawn.** Most NWS alerts (often 90%+) are zone-based. They are evaluated
  for saved locations through zone matching but not drawn on the globe. Drawing them would require fetching
  and caching zone geometry.
* **Zone matching needs one `/points` lookup per location.** Until it finishes, or if it fails, or if the
  point is outside NWS coverage, zone-based alerts show as "cannot determine" for that location. They are
  never shown as "not affected".
* **Weather alerts are checked at the location point.** The monitoring radius applies to earthquakes only.
* **Earthquake distance is to the epicenter.** It is not shaking intensity, damage, or risk.
* **History covers observations this installation received while running.** Retention limits determine how far back you can replay them. Periods before recording began and gaps between usable observations can show as unavailable.
* **The installer is not code-signed,** so SmartScreen warns.
* **Large earthquake feeds** (past 30 days, all magnitudes, about 10k events) work but are slower to draw.
* **The NWS API covers the U.S. and its territories only.** Locations elsewhere show "outside NWS coverage".
* **Local AI quality depends on the model** and the hardware. It is optional and off by default.
