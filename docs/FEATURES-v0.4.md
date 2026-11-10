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

### Known issues (found by the final review, not fixed in this release)

- After a vote/comment inside a post, a slow background reload can reopen that post if you have already gone back to the feed or opened another post.
- With Diagnostics open, "Browse all cameras" and the toolbar's Watchlist open their page over the Diagnostics panel (the nav rail closes it first).
