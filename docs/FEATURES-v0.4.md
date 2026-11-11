# Atlas Watch v0.4 — feature, coverage and status matrix (2026-11-09)

**Status key:** ✅ working, verified in the running app with live data · 🟨 built, configured but not verified (needs your credential, or the service returned nothing during testing) · ⛔ blocked or not built (reason given)

Screenshots: `docs/screenshots/v0.4/`.

## 1. Map labels

| Feature | Before | Now | Provider | Coverage | Cost / license | Status |
|---|---|---|---|---|---|---|
| Place / water / street names | Drawn into raster tiles: overlapped across tiles, every village shown, squashed in tilted views | Screen-space labels with class + OSM-rank priority, zoom and camera-distance rules, collision (greedy, with a bonus for labels already shown), fade in/out, horizon occlusion, terrain-height placement | OpenFreeMap vector tiles (OSM) | Worldwide | Free; ODbL attribution kept | ✅ (Philadelphia tilted, Europe, London, Tokyo, Manhattan, Germany) |
| Label settings | — | Settings → Labels: place names off/minimal/standard/detailed, density, text size, English vs local script, street names, aircraft labels, vessel labels, reset defaults | — | — | — | ✅ |
| Unicode / local scripts | English-only fallback | "Local script" shows names such as 東京都 and 江東区 (verified in Tokyo) | OSM `name` | Worldwide | — | ✅ |
| Vehicle labels | Every aircraft labelled near the camera | Selected, plus hovered (default) or all; special squawks are always labelled | adsb.lol / AIS | — | — | ✅ |
| Operator logos | — | Not built: no licensed airline logo set is available | — | — | Logos are trademarks | ⛔ |

## 2. Public cameras

| Feature | Now | Provider | Coverage | Status |
|---|---|---|---|---|
| Catalog | 5,217 cameras: Caltrans (485 list a live HLS stream), NYC DOT (stills), Fintraffic (stills, CC BY 4.0) | Public agency feeds | California, New York City, Finland | ✅ |
| Map markers | Camera icons, clustered when zoomed out; clicking one opens that camera | — | — | ✅ |
| Live video | hls.js player: starts muted, play/pause, mute, fullscreen, retry, publisher link, live/still badge, and automatic reconnect at the live edge when the stream has damaged frames | Caltrans `wzmedia.dot.ca.gov` | California | ✅ Measured 44 s of live video in a 47 s window on I-680 / N Main St (352×264), with about 1 s reconnects every ~10 s caused by the publisher's stream |
| Offline / 404 streams | Falls back to the latest still image and explains why | — | — | ✅ |
| Directory | Search by city, road, area or name; filters for country, video vs still, favorites and in map view; prev/next; show on map; favorites saved | — | — | ✅ |
| Multi-camera board | Not built | — | — | ⛔ (the player is one-at-a-time, which also limits bandwidth) |
| Other countries | Ontario 511 needs an API key; no other authorized catalog is connected | — | — | ⛔ |

## 3–6. Aircraft and vessels

| Feature | Now | Status |
|---|---|---|
| Aircraft symbols | Top-down silhouettes for wide-body, narrow-body, regional, turboprop, business jet, light aircraft, helicopter, glider, balloon, drone and unknown. Fallback order: ICAO type family → ADS-B emitter category → unknown. Colour = altitude; selection ring; hover enlargement | ✅ |
| Vessel symbols | By AIS ship type: cargo, tanker, passenger/ferry, high-speed, fishing, tug, sailing, pleasure, service, military, unknown. AIS cannot tell container ships from bulk carriers, so they are not split | ✅ |
| Symbol explanation | Details panel line, e.g. "Light aircraft (from ICAO type P28B)" | ✅ |
| Hidden behind the earth | Aircraft and vessels are depth-tested and culled below the horizon | ✅ |
| Aircraft photos and exact model | Opt-in (Settings). Exact model, operator and registration from adsbdb.com by ICAO address; model family from a built-in ICAO type table when the registry has no record. Photo of the same airframe: Wikimedia Commons (registration in the file title; author, license and year shown), else airport-data.com (photographer credited). Planespotters.net is no longer used (it refused requests without a contact User-Agent) | ✅ (UAL2364: Boeing 757-224/W, United Airlines, photo of N17126 on Commons) |
| Vessel photos | Opt-in. Photo of the same ship from Wikimedia Commons, matched by IMO number (author and license shown). Ships without an IMO number get no photo. AIS gives category and size, not make or class | ✅ (STAV VIKING, IMO 9401556, CC0 photo) |
| Observed track | Positions recorded while the app runs (Track button), drawn as a solid line | ✅ (existing) |
| Reported route | "Look up reported route" calls the adsb.lol route database and draws a dashed line between airports. Labelled as the usual route for that callsign, not today's flight plan | 🟨 The service returned an empty answer for every callsign tried during testing, so the panel shows "Not provided by connected sources" |
| Times | UTC plus relative age on records; incidents show UTC | ✅ |
| Diversions / cancellations | Not shown: no suitable source is connected | ⛔ |

## 7–9. Layers panel, imagery and styles

| Feature | Now | Provider | Status |
|---|---|---|---|
| Tabs | Live data · Imagery · Style | — | ✅ |
| Live data | Search, active-layer chips with counts, Turn all off, collapsible groups, source and coverage per layer, freshness, errors | — | ✅ |
| Dated imagery | 23 products in 14 categories (true color, false color, nighttime, temperature, vegetation, atmosphere, fire, water/ice, precipitation, land, ocean, gravity, air quality), generated from GIBS' own capabilities document. Date picker, Latest, ±1 d, −7 d, −30 d, −1 y, 14-day animation, opacity, SVG legend, available dates, resolution, valid-time note | NASA GIBS (free, no key) | ✅ |
| Compare two dates | Swipe divider (drag or arrow keys), labelled with both dates | NASA GIBS | ✅ (SST, Aug vs Feb 2026) |
| Styles | Normal, CRT, NVG, FLIR, Anime, Noir, Snow, each with a note that it is a display effect only. The status bar shows "visual effect" | — | ✅ |
| News cards | Not built: no licensed news source | — | ⛔ |
| Weather: wind animation, lightning, storm reports, severe outlooks, satellite clouds, METAR colour overlay, DWD warnings | Not built in this pass. Existing: NWS alerts (U.S.), NOAA radar (U.S.), METAR, tropical cyclones (NHC), plus satellite cloud and precipitation products in Imagery | — | ⛔ / partial |
| Trains, traffic, bikeshare, airport delays, FLARM | Not built. Existing: Boston transit (MBTA) | — | ⛔ |

## 10. Operations center

| Feature | Now | Provider | Status |
|---|---|---|---|
| Incidents layer | GDACS events (with GDACS' own Green/Orange/Red level) and NASA EONET open events, merged when they describe the same event | GDACS, NASA EONET | ✅ (138 reports: 100 GDACS + 38 EONET) |
| Summary | Incidents in window, highest and second source levels, updated in the last hour, countries named, reported by two sources | + NWS Severe/Extreme, USGS M5+ | ✅ |
| Register | Search, type, country, time-window and sort filters; expandable details; source report link; show on map; UTC times | — | ✅ |
| Trends | Incidents per interval over the chosen window, split by source level, plus counts by type | — | ✅ |
| Countries | Counts and types per country as named by the sources, explicitly not a risk rating. No travel advisories connected | — | ✅ / ⛔ (advisories) |
| Source monitor | Every feed: on/off, freshness, record count, last success, error, coverage | — | ✅ |
| Watch areas on the ops map | Not built (saved places and the watchlist exist elsewhere) | — | ⛔ |

## Worldwide coverage (honest)

| Data | Coverage |
|---|---|
| Labels, streets, buildings, terrain, global imagery, GIBS products, incidents (GDACS/EONET), USGS quakes | Worldwide |
| Aircraft (adsb.lol) | Worldwide where volunteer receivers exist. Tested: Frankfurt 24, Singapore 6, Sydney 7, São Paulo 9, Dubai 0, Cape Town 0 (thin receiver coverage, not an app error) |
| Vessels | Finland and northern Baltic without a key; worldwide with your AISStream key (not verified) |
| Cameras | California, New York City, Finland |
| Weather alerts | U.S. only (NWS); no other national warning service is connected |
| High-resolution imagery | U.S. keyless (USGS); worldwide with your Google, Esri or Mapbox key (not verified) |

## Security and cost notes

- New renderer hosts are allow-listed by exact prefix: `wzmedia.dot.ca.gov` (video), NYC DOT stills, GIBS legends, Planespotters (used only when opted in). New main-process hosts: `webcams.nyctmc.org`, `www.gdacs.org`, `eonet.gsfc.nasa.gov`.
- The CSP adds `media-src blob:` plus the allow-listed hosts for HLS. Web security is unchanged.
- Video is decoded in software (Chromium's GPU decoder rejected Caltrans streams). Cost: low CPU at 352×264.
- No new paid services. Everything added in v0.4 is keyless.

## v0.4.2 additions

| Feature | Now | Status |
|---|---|---|
| Built-in title bar | No separate OS title strip or File/Edit/View row. The app's top bar is the window title bar (drag to move), and Windows draws minimize / maximize / close over its right end. Menu keyboard shortcuts still work | ✅ |
| Camera markers | Fixed: markers turned into plane icons after a catalog refresh | ✅ |
| Rendering quality (Settings → Display) | Maximum: sharper terrain/imagery level selection, full device resolution, 4× MSAA, larger tile cache, 5×5 building tiles (up to 12,000 per tile, below 8 km), finer Google Photoreal 3D detail with a 2 GB session cache and flight-destination preloading. Saved, so the app launches with it | ✅ (78,325 OSM buildings around Manhattan, no render errors). Google 3D part not verified (needs your key) |
| Pre-rendering Google Photoreal 3D | Not done: Google's Map Tiles API terms do not allow pre-downloading or storing tiles. Tiles are cached in memory for the session only | ⛔ by provider terms |
| Worldwide aircraft (Settings) | Opt-in. When zoomed out past 3,000 km, uses the OpenSky Network worldwide snapshot: every 15 min anonymously, about every 90 s with your free OpenSky API client (Providers → OpenSky). Positions are labelled as a snapshot, not a live track. Zoomed in, live adsb.lol data is used | ✅ (10,672 aircraft in one snapshot). OpenSky's free API is meant for non-commercial use, so check with OpenSky before selling |
| Many-object rendering | More than 1,500 aircraft or vessels in a layer are drawn as one batched billboard collection (picking and selection still work) | ✅ |
| Worldwide ships | With your AISStream key, ships stream for the whole visible area, worldwide at globe scale (up to 20,000 kept) | 🟨 needs your key |

## v0.4.3 additions

| Feature | Now | Status |
|---|---|---|
| White patches near the U.S. border | Fixed. USGS sends part-imagery, part-white JPEG tiles at the edge of its coverage (e.g. Kingston, Ontario). Large flat white areas in those tiles are now made transparent so the global base shows through; snow, clouds and white roofs are kept | ✅ (Kingston: 16 mixed tiles cleared, no white patches) |
| Vehicle identity at the top of the details panel | Model line, operator, photo and journey now appear right under the Focus/Track buttons. IMO, MMSI and similar identifiers are shown without digit grouping | ✅ |

New main-process hosts: api.adsbdb.com, commons.wikimedia.org, airport-data.com. New renderer image prefixes: upload.wikimedia.org/wikipedia/commons/, thumb.wikimedia.org/wikipedia/commons/, image.airport-data.com/aircraft/, airport-data.com/images/aircraft/. Planespotters hosts removed. airport-data.com photos are the photographers' copyright; review their terms before commercial use.

## v0.4.4 fixes

| Issue | Cause and fix | Status |
|---|---|---|
| Dark rectangles in the ocean (e.g. Gulf of Guinea) while rotating | About 7% of terrain tiles lost their water mask: an all-land map data tile (no water layer) produced an uninitialised canvas that crashed the mask step, so any terrain tile touching inland areas was left at sea-floor depth without water shading. Fixed at the source; if coastline data is ever unavailable, elevation below -10 m is now used as the sea, so a tile can no longer sink | ✅ (Gulf of Guinea views: 0 tiles without a mask, was 19-59) |
| Camera Fullscreen button did nothing | The app denied all browser permissions, including fullscreen. Fullscreen (only) is now allowed, and only for the app's own page | ✅ (camera picture entered and left fullscreen) |

## v0.5.0 — Markets and Community

| Feature | Configuration / cost | Builder verification |
|---|---|---|
| Markets setup and empty states | No key: no provider calls, no default symbols or fabricated prices | Unit tests; desktop visual verification blocked by sandbox |
| Watchlist, symbol search, quotes, candlestick/line and volume charts | Included publisher key when supplied, or the user's OS-encrypted key; prices may be delayed; check exchange/plan rights | Built and fixture-tested; real-key calls not verified |
| Twelve Data | 800 credits/day and 8/minute; app counts all attempts including Provider tests | Mock service tests; external account usage is not visible to the app |
| Alpha Vantage | 25 requests/day and app limit 5/minute; warning at 20; premium-only responses shown as errors | Mock service tests; real-key calls not verified |
| Market caching | Quote 60 seconds; intraday 5 minutes; daily/weekly 1 hour; search 24 hours; bounded to 200 entries with in-flight coalescing | Tests cover cache/coalescing and quotas; counters persist across restarts using UTC days |
| What's moving it | GDELT keyless news index, no article images; 15-minute cache; one app-wide request start every 6 seconds | Fixtures include GDELT plain-text rate-limit responses; queue tested |
| Movement context | Numeric range change, last available session, largest session move; sessions grouped by UTC date; weekly ranges explicitly report weekly-bar moves | Pure helper tests; no causal claim or investment advice |
| Optional local AI | Enabled and reachable Ollama only; explicit click; numbered untrusted headlines, citations, maximum 120 words, no advice/prediction instructions | Prompt tests; actual model output not verified |
| Community reading | Keyless Lemmy API v3 from the configured HTTPS instance (default lemmy.world), with NSFW/deleted/removed filters and nested comments | Helpers and mocked service tested; live anonymous feed not verified |
| Community participation | User's Lemmy account; login/2FA, create post, comment/reply, vote, report, block author/community, follow/unfollow | Implemented; live login and writes not verified; no account created and nothing posted by builder |
| Community secrets and images | Password sent once, never stored; JWT encrypted per instance, cleared on instance change; only same-instance thumbnails through main, image MIME allowlist and 1 MB cap | Mock auth and host-boundary tests; OS encryption unavailable during desktop smoke launch |
| GUI | Lucide icons, calmer surfaces, finite eased feedback and content/dialog entry, reduced-motion support; title bar remains 46 px with reserved system-control space | Typechecked and renderer production build passed; 1280×720 and 1920×1080 visual checks remain unverified |

Outbound JSON hosts added: `api.twelvedata.com`, `www.alphavantage.co`, `api.gdeltproject.org`, plus exactly the configured Lemmy instance at runtime. Lemmy API redirects must stay on that origin; thumbnail redirects are refused. Renderer CSP is unchanged; globe changes are limited to redacting diagnostic errors, with rendering behavior preserved. No remote scripts, widgets, or frames were added.

External browser links still use the existing validated `openExternal` IPC. The main process additionally registers a bounded set of exact HTTP(S) URLs observed in news/community responses, since the previous fixed publisher list would block these user-requested links. This does not authorize renderer network access or arbitrary renderer-provided browser destinations. Provider documentation/signup domains were added to the browser-link list.

Dependencies: `lightweight-charts: ^5.2.1` (Apache-2.0), `lucide-react: ^1.70.0` (ISC); `package-lock.json` and third-party notices refreshed by the host. TradingView attribution remains enabled on charts.

### Built-in keys

The publisher may supply an optional build-time JSON file at `%USERPROFILE%\.atlas-watch\builtin-keys.json` (resolved with `os.homedir()`), or set `ATLAS_WATCH_BUILTIN_KEYS` to its path. Supported fields are `google3d`, `twelvedata`, and `alphavantage`; values must be 8–200 printable ASCII characters. Missing file means no included keys. Keep this file outside the repository.

The main bundle uses per-build random XOR/base64 **obfuscation, not security**: anyone with a copy of the application can extract these keys. Google tiles inherently need the resolved browser key in the renderer. Market included-key values stay in main. The user's saved key always wins; a failed user key is never retried using the included key. Removing the saved key restores the included key, if present.

The included Google key is used **only for Photoreal 3D**. Google Satellite (2D tiles) and Google place search are separately billed products and always require the user's own key.

Per install and UTC day, included-key allowances are 30 Google tileset/key requests, 200 Twelve Data requests, and 10 Alpha Vantage requests. Provider tests share the applicable allowance. Market cache hits do not consume requests. Existing user-key limits remain in effect. Providers shows the active credential source and remaining included allowance without displaying its value.

**Set a daily request quota on the Map Tiles API in Google Cloud Console so usage cannot exceed the free allowance.** Per-install allowances do not cap aggregate usage across copies and are not tamper-proof. Free market-data plans may not permit commercial redistribution; the owner must check the provider's terms before distributing a keyed build.

### Floating map workspace

The globe fills the workspace without being unmounted. Layers, Places, Scenes, Data/legend, diagnostics and tools float above it; other narrow pages use a 400 px floating panel. Markets and Community keep their wide layouts. Existing actions remain reachable through labeled pills/tooltips, the compact top bar, bottom toolbar, and view controls. Credits remain visible and expandable; reduced motion is respected.

### Host verification (2026-11-09)

Built by Codex (spec + two fix rounds), inspected and fixed by Claude, re-inspected by Codex five times (13 findings fixed: R1–R13).

- Proof on the host: npm run typecheck && npm test && npm run build -> 250 tests pass, build OK.
- Desktop checks at 1920×1080, 1440×900 and 1280×720: floating map workspace (Layers, Data, Places/Scenes/Cameras, bottom toolbar, zoom stack), no clipped buttons, globe full-bleed; Ops floating page; Markets setup card without a key; Community live from lemmy.world (20 posts, 80-comment thread).
- Not verified: Markets with a real Twelve Data / Alpha Vantage key, Lemmy sign-in and writes (no account was used), local-AI summaries, Google Photoreal with an included key (none configured).

### v0.5.1 fixes

Both known issues from the v0.5.0 final review are fixed and approved by a focused Codex review (APPROVED, no findings):

- Community: opening a post, going back to the feed, or a feed reset cancels any late post refresh, including one that follows a vote or comment that was still being sent. A slow refresh can no longer reopen a post you left.
- Floating panels: opening any page other than the Globe (nav rail, Browse all cameras, Watchlist, search results, notifications) closes Diagnostics and Credits first, so they never sit under a page. Verified in the running app.

### v0.5.2 fixes (first live test with real Twelve Data and Alpha Vantage keys)

Approved by a focused Codex review (APPROVED, no findings).

- Alpha Vantage: free keys also allow at most one request per second, so a quote followed by its chart was refused. Requests are now serialized 1.2 s apart, and quota is counted when each request is actually sent.
- GDELT news: queries follow GDELT's rules (parentheses only around OR'd terms; only multi-word names quoted, since short quoted phrases are rejected). A rate-limited reply is retried once after 10 s, then explained in plain language; other plain-text GDELT errors are shown as "GDELT: <message>". GDELT throttles harder than its stated one request per 5 s, so headlines can occasionally take a minute.
- Headline titles: spaces before punctuation removed.
- Live results: Twelve Data (Apple, IBM) quote, chart, movement figures and 18 headlines; Alpha Vantage (IBM) quote and 1M chart.

## v0.6.0 — 3D aircraft and ship models

| Feature | Now | Status |
|---|---|---|
| 3D models | In the 3D view below 400 km, the aircraft and ships nearest the camera (up to 60, or 150 with Maximum quality) are drawn as 3D models; the rest stay icons. Settings → Display → "3D models for nearby aircraft and ships" (on by default) | ✅ Verified at JFK (parked, taxiing, airborne) and Helsinki harbour; 89 models across 14 types, 0 failures; frame rate unchanged (about 278 frames/s with and without models) |
| Aircraft shapes | Built by the app per class (wide-body, narrow-body, regional, turboprop, business jet, light, helicopter, glider, balloon, drone). About 110 common ICAO types use real length and wingspan, engine count and placement (wing, tail, nose, trijet), high or low wing and T-tail. Unknown types use the class shape. Pitch follows the climb/descent rate; heading follows the reported track | ✅ (unit-tested dimensions, layouts and orientation through Cesium's glTF axis conversion) |
| Ship shapes | Per AIS ship type: container ship (bridge, funnel, container stacks), tanker (deck pipe), passenger/ferry (multi-deck), high-speed, fishing (wheelhouse, mast, gantry), tug, sailing (mast and sails), pleasure, service, military. Sized from the ship's AIS length and beam | ✅ |
| Paint and textures | Generated in the app: fuselage window rows, cockpit glass, doors, a generic accent line, light-grey belly; ship hulls with red below the waterline, decks and window grids. Generic paint only: airline liveries are not available under licence and their logos are trademarks | ✅ |
| Picking | Clicking a model selects the vehicle (same as its icon); the selected model gets a yellow outline | ✅ |

Not included: the exact model, livery or registration-specific paint of individual aircraft or ships. Windows become visible only close up (the camera stops at 100 m).

Review: four focused Codex reviews of the v0.6.0 change found 13 issues (VR-001…VR-013: model readiness and failure handling, camera and selection sync, budget, bulk icon culling, ground placement, terrain-height checks, ship-beam limits, military balloon paint). All are fixed; the last two (clamp parked aircraft to terrain rather than 3D tiles; grey military balloons) are one-line fixes applied exactly as the final review suggested and were not re-reviewed.

### v0.6.1 fix: icon / 3D model flicker

Vehicles near the cut-off (budget, range, screen edge) could swap between icon and model as positions changed. Now a vehicle that has a model keeps it unless another is clearly closer (30 % margin), with 30 % extra range and a 3 km screen-edge margin before it reverts; new models load 800 m before a vehicle enters the screen; an aircraft report without type data keeps the last reported type. Measured on a busy view with 60 models: 2 swaps in 25 s before, 0 after. Codex review R1–R2 fixed; R3–R4 (type-cache recency for untyped reports, flip diagnostics) fixed afterwards and covered by the next review.

## v0.7.0 — real 3D models from Sketchfab

| Feature | Now | Status |
|---|---|---|
| Real models | 27 downloadable Sketchfab models (CC BY 4.0) chosen per type: A320 family, 737, 777, 787, A330, A350, A380, 747, 767, 757, E-Jets, ERJ-145, CRJ, ATR 42/72, Dash 8, Cessna 150–182, Gulfstream, Citation X, SH-60 (military only); container ship, tanker, ferry, fishing boat, tug, sailboat, motorboat, pilot boat. Airline liveries included by the owner's decision | Shortlist ready; download waits for the owner's Sketchfab token |
| Matching | Aircraft by ICAO type code (paint must match: civil models for civil aircraft, military for military); ships by AIS category. Each instance is scaled to the type's length and span (aircraft) or the ship's AIS length and beam. Anything without a match, military ships and unknown types keep the app-built models | ✅ unit-tested; verified in the app with a synthetic pack |
| Download (`node scripts/fetch-models.mjs`) | Uses the owner's own token from `%USERPROFILE%\.atlas-watch\sketchfab-token.txt` (or `SKETCHFAB_TOKEN`), sent only to api.sketchfab.com and never printed. Re-checks each licence (CC0 / CC BY only) before downloading. Files go to `%USERPROFILE%\.atlas-watch\models\raw\` (outside the repo), with path checks on every archive entry | Waiting for the token |
| Import (`node scripts/import-models.mjs`) | Strips animations and lights, bakes transforms, detects nose/bow and up, scales to real size, puts aircraft on their wheels and ships at their waterline, simplifies to about 30k triangles, shrinks textures to 1024 px, converts triangle strips and fans, and writes `public/vehicle-models/` (packed into the app, not committed) plus a preview image of each model. The detected orientation is only a suggestion: a model ships once its shortlist entry confirms `forward` and `up` after the preview has been checked; until then it is held back | ✅ on synthetic Sketchfab-style files (Z-up centimetre export, mirrored parts, 2048 px texture, 192k → 30k triangles) |
| Credits | Details panel: model title, author, licence and links. Credits panel: every model with its Sketchfab page and licence, and a note that models were converted and stand for the type, not the individual vehicle. `ATTRIBUTION.txt` ships next to the models | ✅ verified in the app |
| Diagnostics | "Vehicle 3D models": pack state (real models / not installed / failed to load), shown, loaded, failed | ✅ |

Review: seven Codex review rounds of the v0.7.0 pipeline raised 15 issues (AW-701…AW-715): glTF resource paths confined to the model folder (a downloaded file could otherwise reference the token file), redirect and host checks on every download hop, streamed byte limits and bounded unzip, token format checks and redacted errors, strict pack-index validation and error reporting, civil/military model indexing, Z-up and upside-down ships (orientation is now always confirmed by hand), strip/fan geometry, stale-output cleanup, renderer teardown, and the details-panel credit following the drawn model. All are fixed; the final round approved with no findings. Not yet verified: real Sketchfab downloads and the 27 real models (waiting for the owner's token).

### Ships and parked aircraft in Photoreal 3D

Reported: "not all the ships are showing up". Two causes:
- Coverage. Without an AISStream key, ships come only from Fintraffic (Finnish and northern Baltic waters). This installation has no AISStream key. A free key from aisstream.io (Providers) adds ships in the view area, from community receivers, so coverage is still not complete.
- Photoreal 3D height mismatch. Ships and parked aircraft are placed at height 0 on the WGS84 ellipsoid. Google's 3D tiles are at true height, and the local sea level differs from 0 by up to about 100 m (about +18 m at Helsinki, −33 m at New York). Nearby ships' 3D models sat under the 3D water while their icons were hidden, and depth-tested icons in tilted views sank under it too.

Fix:
- Sea-level grid. `public/geoid/egm96-30.bin` (508 KB, shipped with the app) is built by `scripts/make-geoid.mjs` from NGA's public-domain EGM96 15′ grid (`us_nga_egm96_15.tif` from cdn.proj.org, downloaded with the owner's approval and kept outside the repo). It matches NGA's published test points to within 0.25 m.
- On Photoreal 3D: ships sit at local sea level. Parked aircraft sit at terrain height plus sea level; terrain comes from the app's own Terrarium source, whatever the Terrain setting, sampled once per ~200 m cell and only near the camera. Airborne aircraft, flight trails and history playback markers get the same offset. Aircraft trail points use the recorded on-ground flag (new database column; older points count as "unknown"), and airborne points with no altitude are left out.
- Fallbacks: a vehicle gets its 3D model only once its height is known; until then it shows its icon. Ship and parked-aircraft icons are never hidden by the 3D water or ground.
- Culling: vehicles below the ellipsoid (sea level is up to 107 m under it) still pass the far-side-of-the-earth test.
- On the app's own globe nothing changes; its sea is at 0.
- Credits name EGM96 when Photoreal 3D is selected, and Diagnostics shows the grid's state.

Verified on the app's globe at Helsinki: the grid loads, ship models show as before (about 37, none failed), and performance is unchanged. Not verified: Photoreal 3D itself (it needs the owner's Google key) and history playback in the app.

Review of the sea-level work: 17 Codex rounds raised 23 issues (AW-716…AW-738). They covered:
- far-side culling below the ellipsoid;
- terrain sampling independent of the Terrain setting, strict about missing data and sea flattening, and limited to the terrain source's ±85° coverage;
- parked aircraft at high airports;
- a strict parser for the grid file;
- non-vehicle layers keeping height 0;
- trail and playback heights, including the recorded on-ground flag, transit trails and altitudes below sea level;
- GNSS-only altitudes (ADS-B and OpenSky) converted to height above sea level;
- retry scheduling for failed ground samples;
- importer robustness (parts scaled to zero, non-numeric vertices, unused vertices, final origin check);
- unique ids in the model index.

All are fixed. The final round approved. Its one low finding (sea-mask statistics counted ground samples) was then fixed in one line exactly as suggested, and that line was not re-reviewed.

### More public cameras (8,780, up from 5,222)

Four official open-data camera catalogs added, each checked for terms that allow use in a sold app:

| Publisher | Cameras | Terms | In the app |
|---|---|---|---|
| Transport for London JamCams | ~820 | TfL open data (based on the UK Open Government Licence), "Powered by TfL Open Data" | Still image, refreshed every 5 min |
| Hong Kong Transport Department | ~1,010 | DATA.GOV.HK terms (commercial use with attribution) | Still image, every 2 min |
| DriveBC (British Columbia) | ~1,040 | Open Government Licence – British Columbia; per-camera credit shown | Still image, at the camera's own rate |
| Québec 511 (MTMD) | ~680 | CC BY 4.0 (Données Québec) | The catalog links each camera to the Québec 511 viewer page, so the app shows an "Open in Québec 511" button instead of an image (the viewer's internals are not used) |

Images come straight from each publisher's own image host (allow-listed; nothing proxied or stored). Credits list every publisher.

Not added:
- Unclear or personal-use terms: NZTA New Zealand, Maryland CHART, Delaware DelDOT.
- Singapore LTA: its image links change every minute, which needs a per-camera refresh.
- Systems that need a free key: now supported with each customer's own key (next section).

Verified in the app: each new source's cameras load. Opening one of each shows its image (TfL 352×288, Hong Kong 320×240, DriveBC 800×468) or, for Québec, the viewer button.

### Cameras with your own free key (22 systems)

Some publishers only hand out their camera catalog to registered developers. The key is free, but each customer registers for their own and accepts that publisher's terms. **Provider settings → Camera keys** lists them, each with a link to the publisher's developer page:

| Systems | Where the key goes | Terms |
|---|---|---|
| 19 sites on the "511" platform: Ontario, Alberta, Saskatchewan, New Brunswick, Nova Scotia, Newfoundland and Labrador, Yukon, Georgia, Florida, Arizona, Wisconsin, Idaho, Utah, Louisiana, Nevada, Alaska, Connecticut, Pennsylvania, New England (Maine, New Hampshire, Vermont) | In the catalog request to that site only. Camera images load without the key. | Each publisher's developer terms. 511PA: PennDOT's own video-sharing agreement applies, so confirm the use is covered first. |
| WSDOT (Washington State) | Access code in the catalog request | No published licence; the provider entry says so |
| Transport for NSW (Australia) | `Authorization` header | CC BY |
| Trafikverket (Sweden) | Inside the XML query | CC0 |

How it behaves:
- Nothing is requested from a system until its key is saved. Built-in keys are never used for these.
- Keys are stored encrypted and sent only to that system's own address. A redirect to any other address is refused before anything is sent there.
- **Test** loads the catalog with the saved key and reports how many camera views it lists.
- Saving or removing a key takes effect straight away, and only that system's catalog is fetched. If a reload was already underway with the old key, its result is thrown away and one more reload runs with the new key.
- Every camera catalog, open or keyed, is fetched at most once every 6 hours; a reload in between reuses it. Images load only when you open a camera.
- If a publisher asks the app to slow down (HTTP 429 or 503), nothing more is sent to that host until the wait it asked for is over (at least a minute, and longer each time it happens again). Then only that catalog is fetched again. Meanwhile its last catalog, if less than a day old, stays on the map, and the layer status says so. The same applies when a source is simply unreachable. After a day the catalog is removed, as are the cameras of a rejected or removed key, even when no other camera source is answering.
- Error messages name the system ("key rejected" for HTTP 400/401/403) and never include the key or the request address.

Not included: New York (511NY), which wasn't confirmed to work the same way.

Not verified yet: no real keys were available. The response parsing is tested against the publishers' documented formats, not live responses. 511 camera images were checked to load without a key on 5 of the sites. Image loading for WSDOT, TfNSW and Trafikverket is untested.

### Weather satellite overlay (10-minute frames)

**Layers → Weather → Weather satellite (10-min)** draws the newest full-disk frame from three geostationary weather satellites, served free by NASA GIBS (no key, no account):

| Satellite | Operator | Drawn for | Infrared | True colour |
|---|---|---|---|---|
| GOES-West | NOAA | 180°W – 106.2°W (Pacific, western Americas) | Band 13 clean IR, ≈2.4 km | GeoColor, ≈1.2 km |
| GOES-East | NOAA | 106.2°W – 10°E (Americas, Atlantic) | Band 13 clean IR | GeoColor |
| Himawari-9 | JMA | 60°E – 180° (East Asia, Australia, western Pacific) | Band 13 clean IR | Red visible band (daylight only, grey; GIBS has no Himawari GeoColor) |

- Infrared shows clouds day and night, coloured by cloud-top temperature. True colour is what the eye would see by day, with city lights at night (GOES GeoColor).
- The app asks GIBS for each satellite's newest frame every 10 minutes (a few hundred bytes each) and draws exactly that frame; it never guesses a time. Frames are usually 30–60 minutes old. The frame time of each satellite is in the credits.
- A satellite whose newest frame is more than 3 hours old is not drawn, so an outage shows as missing imagery rather than old weather. If a lookup fails, the current frame stays until it reaches that age.
- A new frame replaces the old one only after its tiles have loaded, so the overlay doesn't blink every 10 minutes.
- Frames sit above the basemap and below place names and radar. The ocean's glare effect is switched off while the layer is on, because over cloud imagery it looks like a cloud that isn't there.
- Not covered: Europe, Africa and the Indian Ocean (Meteosat is not in NASA GIBS). Not drawn over Google Photoreal 3D, like the radar overlay.
- Terms: NASA GIBS data is "full and open" with an acknowledgement requested; the credits name NOAA GOES, JMA Himawari and NASA GIBS (ESDIS).

Verified in the app (2026-11-11, isolated profile): all three satellites loaded the 13:30 UTC infrared frame and the 12:50–13:20 UTC true-colour frames, switching products replaced all three layers, turning the layer off removed them, and no tile errors were logged.
