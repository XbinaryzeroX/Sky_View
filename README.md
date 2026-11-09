# Atlas Watch

**See what is happening around the places you care about.**

Atlas Watch is a Windows desktop geospatial monitoring app. It started as a tool for small businesses and property
managers who look after several locations. It shows active U.S. National Weather Service alerts and recent USGS
earthquakes, and reports which saved locations fall inside an alert or near an epicenter. On a detailed 3D globe it
also shows live public data layers: aircraft, vessels, satellites, fires, airspace, radar, weather observations,
cyclones, cameras, and transit. Every record links to its source and timestamp, and briefings can be exported.

See [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) for a feature-by-feature comparison with the reference
application (God's Eye View, commit `027c961`), including what is not implemented and why.

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
| Globe and map detail | CesiumJS globe with **progressive tile detail**. NASA GIBS Blue Marble covers the world to zoom 8 (about 500 m per pixel). **USGS National Map orthoimagery** covers the lower 48, Alaska, Hawaii, and Puerto Rico to zoom 16 (about 2.4 m per pixel, neighborhood detail). Other surfaces: NASA VIIRS daily satellite imagery (previous UTC day, dated), USGS imagery with labels, USGS topo, bundled offline relief, and neutral. **3D terrain** comes from the keyless Terrain Tiles on AWS. A **diagnostics panel** (`Diag`, Ctrl+Shift+D) shows providers, tile levels, pending and failed requests, and when a provider's maximum detail is reached. The globe has U.S. / Lower 48 / Alaska / Hawaii views, north-up, reset, and keyboard navigation. |
| Data layers | Aircraft (adsb.lol, ODbL), military-flagged aircraft, vessels (Fintraffic AIS keyless; AISStream with your key), satellites (CelesTrak elements, positions **calculated** by SGP4), NASA FIRMS fire detections, NIFC wildfire perimeters, FAA prohibited/restricted airspace, NOAA nowCOAST radar, METAR observations, NHC cyclones, Caltrans and Fintraffic cameras, and MBTA transit. Each layer is labeled live / delayed / periodic / calculated / static and shows freshness, record count, fetch time, coverage notes, and errors. Layers poll only while switched on. |
| Tools | Search (coordinates, `geo:` URIs, 7,342 bundled places, U.S. Census address lookup), click-to-track with recorded trail, nearby contacts (250 km), predicted satellite orbit, geodesic distance and area measurement, pins / routes / areas annotations, saved views, last-view restore, scene file export/import (no credentials), playback of recorded movement, a HUD, and display styles (night vision / thermal-style / CRT / noir, all labeled as visual effects only). |
| Provider settings | Every provider's purpose, terms status (free / restricted / metered), limits, docs and sign-up links, and a live connection test. Customer keys are encrypted with the Windows credential store (DPAPI via Electron `safeStorage`) and never shown, exported, or logged. |
| Weather alerts | Pulls active alerts from `api.weather.gov` with severity, urgency, certainty, event, headline, description, instructions, onset, ends, expires, sender, area, zones, and identifier. Polygons are drawn when supplied. Zone-based alerts without a polygon are listed and still evaluated, never drawn as a made-up shape. |
| Earthquakes | Pulls USGS GeoJSON summary feeds with a configurable window (hour/day/week/month) and minimum magnitude. Markers encode magnitude by size, color, and an `M5.2` label. Details show magnitude, depth, time, epicenter, review status, and the USGS event page. |
| Saved locations | Add by typing latitude and longitude or by clicking the globe. Each has a name, category, notes, and monitoring radius, and can be edited or deleted. Locations are stored in SQLite. CSV import has column mapping, a preview, validation errors, and duplicate handling. CSV export is included. |
| Monitoring | Weather alerts are checked with a point-in-polygon test. Zone-based alerts are matched against the NWS forecast, county, and fire-weather zones for the location. Earthquakes are checked by geodesic (WGS84) distance to the epicenter. Each result is labeled **inside**, **confirmed not inside**, or **cannot determine**, with coverage notes and the evaluation time. Superseded, cancelled, and expired alerts are not counted. |
| Event history | A bounded local history of records seen while the app was running, with search, filters, first-observed and last-observed times, source-updated time, configurable retention, and a clear button. |
| Briefing | Deterministic HTML briefing with selected locations, matched alerts and earthquakes, feed freshness, source links and IDs, generation time, and coverage limitations. PDF export uses Electron's print-to-PDF. No AI is involved. |
| Optional local AI | If you run **Ollama** yourself, Atlas Watch can ask a local model to explain results it has already calculated. It connects only to loopback (127.0.0.1) and never downloads models. Answers are labeled as AI-generated. The app is fully usable without it. |
| Reliability | The last-known data is cached and shown with its original timestamps. Requests have timeouts, polling is provider-aware, failures back off exponentially, and Retry-After / 429 limits are respected. Stale and unavailable states are visible. Remote data is validated, and a feed failure never crashes the app. |

---

## Quick start (development)

Requirements: Windows 10/11 x64, Node.js 22.12+ (tested with Node 24.22), npm 11.

```bash
npm install
```

npm 11 blocks install scripts by default. Approve the two build tools that need one:

```bash
npm install-scripts approve esbuild electron-winstaller
```

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

## Packaging a Windows installer

```bash
npm run dist
```

This runs type checking, builds, regenerates `THIRD_PARTY_NOTICES.md`, and writes
`release/Atlas-Watch-Setup-<version>.exe`, a per-user NSIS installer. For an unpacked folder you can run
directly, use `npm run dist:dir` (the output is `release/win-unpacked/Atlas Watch.exe`).

The installer is **not code-signed**, so Windows SmartScreen will warn on first run. Signing with a
code-signing certificate is a later step. Configure `win.certificateFile` or Azure Trusted Signing in
`electron-builder.yml`.

End users need nothing else installed: no Node, Python, Docker, or terminal.

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
5. **Export.** Use **Briefing** to export HTML or PDF for all locations or a selected few.
6. **History.** Open **Event history** at the bottom to search records seen while the app was running.
7. **Data layers.** Switch layers on in the left panel. Hover a layer for its source, terms, coverage, and
   data type. Aircraft and METAR load for the current view, so zoom in. Click any marker for details, **Track**,
   nearby contacts, the camera still, or a satellite's predicted orbit.
8. **Tools.** Use the **Tools** button on the globe for measuring, drawing, saved views, scene files, display
   styles, and playback. Use **Diag** for map diagnostics.
9. **Providers.** Use the **Providers** button for connection tests and optional credentials.

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
SQLite, evaluates every saved location, and pushes a snapshot to the renderer. The renderer cannot reach
the network at all. Its session blocks every request except the app's own `app://` origin, and the CSP
has `connect-src 'self'`.

**Future server-side cache.** `AlertSource` and `QuakeSource` are the seam. A cache adapter that calls your
local server instead of NWS/USGS can implement the same interfaces and be passed to `AppCore` in `main.ts`.
The UI, monitoring, and storage stay unchanged. Add the server host to `ALLOWED_HOSTS` in
`feeds/http.ts` when you do.

**Extension points kept clean for later:** licensing, billing, accounts, and auto-update would all live
in the main process behind new IPC channels. None are implemented, and nothing phones home.

### Security measures

* `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (plus `app.enableSandbox()`), `webSecurity: true`.
* The renderer is served from a custom `app://atlas` origin with a restrictive CSP: no inline scripts and no
  remote origins. `'wasm-unsafe-eval'` is allowed only because CesiumJS compiles bundled WebAssembly; JavaScript
  `eval` remains blocked.
* Every IPC request is validated against a zod schema. Requests from any frame other than the app's main
  frame are rejected.
* Outbound network from the main process goes only to `api.weather.gov`, `earthquake.usgs.gov` (HTTPS,
  default port), and `127.0.0.1` for Ollama. Redirects are re-checked. There is no URL-proxy feature.
* External links open in the system browser only for `https` URLs on an allow-list (weather.gov, noaa.gov,
  usgs.gov, and a few attribution sites).
* Remote text is length-limited, stripped of control characters, and rendered as text, never as HTML.
  Briefings escape all content and carry their own `default-src 'none'` CSP.
* CSV export neutralizes spreadsheet formula injection.
* PDF rendering happens in a hidden window with JavaScript disabled and the network blocked.
* Coordinates and notes are not written to logs.
* All permission requests (camera, geolocation, notifications, and so on) are denied.

---

### Map detail: what was wrong and what changed

The original globe used CesiumJS's bundled **Natural Earth II** texture. Its tile pyramid stops at **level 2
(about 20 km per pixel)**, so Cesium could only stretch it as you zoomed. That is why the map looked blurry. It
was a source-resolution limit, not a rendering bug. The globe now uses real multiresolution tile pyramids:

- **Global:** NASA GIBS Blue Marble, zoom 0–8 (about 500 m per pixel).
- **United States:** USGS The National Map orthoimagery, zoom 0–16 (about 2.4 m per pixel). Levels 17 and up
  return 404 from the service, so Cesium stops there and keeps the level-16 tiles on screen.
- **Terrain:** Terrain Tiles on AWS (terrarium), real elevation to zoom 15. Deeper levels resample level 15
  rather than inventing detail.

Cesium requests only visible tiles, keeps parent tiles on screen while children load, and cancels requests
for tiles that leave the view. Tiles are cached by Chromium's HTTP cache according to each provider's headers.
Outside the United States the keyless imagery stops at Blue Marble zoom 8, and the diagnostics panel says
so. Where USGS has no imagery (open ocean), it returns transparent tiles and the darker Blue Marble ocean
shows through. That edge is a coverage boundary, not a rendering defect. Imagery resolution is not imagery
recency: USGS orthoimagery is from various years, and Blue Marble is a 2004 composite.

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

- **Coastal water patchwork.** USGS orthoimagery stops a few kilometres offshore in ragged, tile-shaped
  patches with smeared edge pixels. That water is now faded out where it lies more than 1.5 km from land
  (by OSM ocean polygons), so the open sea uses one consistent source. Harbors, rivers, bays and beaches
  keep their real imagery.
- **Low-resolution ocean.** No free global source has open-ocean imagery finer than about 500 m. Google
  Earth also shows only bathymetry shading there. Beyond Blue Marble's native zoom 8, tiles are now
  bicubic-resampled, and ocean pixels are smoothed from nearby water pixels only. This removes blocky
  squares and dark coastline halos. No detail is invented.
- **Black discs over both poles.** The terrain used the Web Mercator tiling scheme, which stops at
  ±85.05°, so the globe had no surface over the poles. Terrain is now resampled into Cesium's geographic
  scheme, which reaches ±90°. Beyond 85.05° the last source row is extended. The same NASA imagery is
  draped there in geographic projection (GIBS WMS).
- **Sea surface.** The terrain used to draw ocean-floor depths, so tilted views showed blurry imagery draped
  over underwater ridges. The sea is now flat at sea level, using OSM ocean outlines, and Cesium's animated
  water surface is drawn on it. That surface is a rendering effect, not observed waves.
- **Camera.** You can zoom in to 100 m above the ground; the old 2 km limit made the camera snap back.
  Tilting stops at 80° from straight down instead of swinging back to a top view.
- **Stylized window façades** (Settings, on by default). OSM building walls get a window grid generated from
  each wall's size: about 3.2 m bays and 3.4 m floors, with a solid ground floor. The grid fades to a plain
  tone with distance. It is decoration only, not the real building's windows or floor count. Real façades
  need Google Photoreal 3D.
- **Even ocean on customer imagery** (Settings, on by default). Google, Esri and Mapbox show detailed dark
  water near coasts and coarse water further out. The app draws its smoothed sea on top, more than 1.5 km
  offshore. The provider's imagery itself is not changed.
- **Outside the U.S. without a key.** Over the ~500 m base, the street overlay now also draws OSM lakes,
  rivers and canals, parks, built-up areas and building footprints. Inside USGS coverage it stays a plain
  overlay, so real imagery is never covered. Sharp worldwide imagery needs a key (Google Satellite, Esri
  or Mapbox).
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
| Global base imagery | NASA Blue Marble, about 500 m per pixel, everywhere | — |
| High-resolution imagery | U.S. only (USGS, about 2.4 m per pixel) | Worldwide: Esri World Imagery or Mapbox Satellite (metered), EOX Sentinel-2 cloudless 10 m (license) |
| Streets, place names, boundaries | Worldwide (OpenStreetMap via OpenFreeMap) | — |
| 3D buildings | Worldwide where mapped in OSM (extruded; heights from tags or estimated) | Google Photorealistic 3D Tiles (metered) |
| Terrain | Worldwide (Terrain Tiles on AWS) | — |

### Provider setup (optional integrations)

Open **Providers** in the top bar. Every provider shows its terms status and a live connection test. Keys are
encrypted with the Windows credential store. Atlas Watch never uses its own keys for these services.

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
   attributions are shown. Google's terms allow only the Google geocoder with these tiles. For that reason,
   place and address search switches to **Google Geocoding** with your key: one request per search you
   start, never per keystroke. Coordinates and loaded aircraft, vessels and airports still work offline.
   Both APIs are metered and billed to your Google account. Check Google's current pricing page.
6. **Local ADS-B receiver.** Enter your readsb/tar1090 `aircraft.json` URL. Only literal private IP
   addresses are accepted.

## Data sources, licensing, and attribution

Code licenses and data terms were reviewed separately. All are compatible with commercial distribution as
far as their published terms go. The details are below; confirm with your own counsel before selling.

| Component | License / terms | Notes |
|---|---|---|
| NWS API (`api.weather.gov`) | U.S. government data; NWS documentation says it is "free to use for any purpose" | No key. A User-Agent is required, and an email or website in it is optional. Rate limits are unpublished but "generous", and the app polls at most once per minute. Credit is shown as "NWS/NOAA". |
| USGS earthquake feeds | U.S. government work, public domain | Feeds update every minute. Credit: U.S. Geological Survey. |
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
| NIFC WFIGS, FAA SUA, NOAA AWC, NHC, nowCOAST, U.S. Census Geocoder | U.S. public domain | Perimeters, airspace, METAR, cyclones, radar, address search |
| Caltrans CCTV | Published openly by Caltrans; review Caltrans terms before redistribution | California cameras |
| MBTA V3 API | MassDOT/MBTA developer license (review before commercial use) | Boston transit |
| Natural Earth populated places | Public domain | Bundled offline place search |
| satellite.js | MIT | SGP4 propagation |
| Google Photorealistic 3D Tiles (optional) | Google Maps Platform terms, **metered**, customer key | 3D cities |

**Excluded from the reference's source list for commercial or terms reasons:** OpenSky (non-commercial license),
Esri World Imagery (Esri Master Agreement), public OSM tiles, Photon/Nominatim and FOSSGIS OSRM (fair-use
community servers), TeleGeography cables (CC BY-NC-SA), Google News RSS (personal use only), and ALPR camera
mapping (privacy).

`THIRD_PARTY_NOTICES.md` (regenerated by `npm run notices`) is copied into the installer's `resources`
folder. Electron's packager also places `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the
executable.

**Not included because of cost or terms:** satellite or aerial imagery, terrain, Cesium ion, Google, Mapbox,
and hosted geocoders. Free tiers of those services are metered, restricted, or require accounts.
Address lookup is therefore not included; enter coordinates, click the globe, or import CSV.

---

## Known limitations

* **Not full parity with the reference.** Cockpit view, 3D aircraft models, street-level imagery, wind
  animation, lightning, satellite passes, GNSS integrity, radio, wildlife, space missions, voice control, and an
  MCP agent are not implemented. See [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).
* **Keyless vessel coverage is regional** (Finland and the northern Baltic). Worldwide view-area AIS needs the
  customer's AISStream key, and AISStream's terms are unclear for commercial use.
* **Camera and transit coverage is limited** to Caltrans, Fintraffic, and MBTA. Each further publisher needs
  its terms reviewed.
* **Keyless imagery outside the U.S. stops at about 500 m per pixel.** Worldwide streets, place names, and OSM building extrusions are keyless. Worldwide high-resolution imagery needs Esri or Mapbox (metered) or an EOX license.
* **Satellite positions are calculated predictions** from orbital elements, not observations.
* **Playback only shows positions recorded while the app was running.** Nothing is reconstructed.
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
* **History covers only what the app saw while running,** within the retention limits. It is not an archive.
* **The globe surface is low resolution** (Natural Earth II). Close zoom is blurry. Outlines stay sharp.
* **The installer is not code-signed,** so SmartScreen warns.
* **Large earthquake feeds** (past 30 days, all magnitudes, about 10k events) work but are slower to draw.
* **The NWS API covers the U.S. and its territories only.** Locations elsewhere show "outside NWS coverage".
* **Local AI quality depends on the model** and the hardware. It is optional and off by default.
