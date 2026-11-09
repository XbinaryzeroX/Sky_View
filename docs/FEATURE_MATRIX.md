# Feature matrix: Atlas Watch vs. the reference application

**Reference inspected:** [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) at commit
`027c9616a5245bd5e0725cd03d62fce41d54c691` (HEAD, 2026-11-08, "Merge pull request #1637 …orbital-followups").
The latest tag is `v0.3.0` (`72eb3fd`). Sources read: `README.md`, `DATA_SOURCES.md`, `LICENSE`, and
`THIRD_PARTY_NOTICES.md`. The reference code is MIT licensed. No reference source code was copied into Atlas Watch.

**Status key**

| Status | Meaning |
|---|---|
| ✅ Live-verified | Implemented and checked against the real provider on 2026-11-09. |
| 🟨 Implemented, unverified | The code and UI exist, but no live check was possible (it needs customer credentials or hardware). |
| 🟧 Partial | Some of the reference capability exists; the gap is described. |
| ⛔ Not implemented | Not built yet; the reason is given. |
| 🚫 Excluded | Deliberately left out because of cost, terms, or privacy. |

**Cost key:** Free = no key, no charge. Free-key = free registration. Restricted = unclear terms or
non-commercial. Metered = billed to the customer's account.

## Map and exploration

| Reference feature | What it does (reference) | Reference source | Atlas Watch status | Atlas Watch source / notes | Credentials / hardware | Commercial use | Cost / quota |
|---|---|---|---|---|---|---|---|
| 3D globe | Cesium globe | CesiumJS | ✅ | CesiumJS 1.147. No Cesium ion. | None | Apache-2.0 | Free |
| Keyless satellite basemap | Esri World Imagery | Esri (classic endpoint) | 🚫 Esri / ✅ alternative | NASA GIBS Blue Marble (global, zoom 8) plus USGS National Map orthoimagery (U.S., zoom 16, about 2.4 m per pixel). Live tile requests verified in Denver, Anchorage, and Honolulu. | None | Public domain | Free. Esri is excluded because the Esri Master Agreement governs it and commercial apps should use ArcGIS Location Platform terms. |
| OSM basemap | OSM tiles | OpenStreetMap | 🚫 | The OSM tile usage policy forbids heavy or app use of the public tile servers. | — | — | — |
| Photorealistic 3D cities | Google 3D Tiles (ion or direct key) | Google Map Tiles API | 🟨 | Optional "Google Photorealistic 3D" surface using your own key (Provider settings). Never uses an Atlas Watch key. | Customer Google key | Google Maps Platform terms | **Metered** |
| Daily satellite view | Observed satellite clouds | NOAA nowCOAST / GOES | 🟧 | NASA GIBS VIIRS true color from the previous UTC day, with the date shown. No GOES loop yet. | None | NASA open data | Free |
| Terrain | Keyless terrain / ion world terrain | — | ✅ | Terrain Tiles on AWS Open Data (terrarium), zoom 15 source. Live-verified on Mount Rainier. | None | Open data, per-source attribution | Free |
| Progressive detail diagnostics | — | — | ✅ | Diagnostics panel shows providers, tile levels, pending/failed requests, per-host status, and the detail limit. | None | — | — |
| Place and coordinate search | Coordinates, `geo:` URIs, bundled cities; Google / Photon / Nominatim | Bundled Natural Earth; geocoders | ✅ coords/places · ✅ U.S. addresses | Decimal coordinates, `geo:` URIs, 7,342 bundled Natural Earth places (offline), and U.S. Census Geocoder for street addresses. | None | Public domain | Free. Photon and Nominatim are excluded (fair-use public instances; not for app distribution). |
| Layer controls, legends, selection | Grouped data layers | — | ✅ | Grouped layers, each labeled live / delayed / calculated / static, with freshness, counts, and errors. Click any object for details. | None | — | — |
| Click-to-track with trail | Camera lock, fading trail | — | ✅ | Track: the camera follows the object; the trail is the recorded observed fixes (not interpolated). | None | — | — |
| Contacts roster (250 km) | Nearby aircraft list | — | ✅ | "Nearby contacts" lists aircraft and vessels within 250 km of the selected object. | None | — | — |
| Cockpit view | Ride inside a tracked flight | — | ⛔ | Not built. | — | — | — |
| 3D aircraft models | Per-class glTF models | Third-party models | ⛔ | Not built. Model licenses would need separate review. | — | — | — |
| Tilt / North up | 35° oblique, north up | — | 🟧 | North-up and reset buttons exist. Tilt with right-drag or Ctrl-drag; there is no one-click oblique button. | — | — | — |
| Share links / saved views | URL-serialized scene | — | ✅ (desktop equivalent) | Saved views (camera, layers, surface), last-view restore, and scene file export/import (strict schema, no credentials). | None | — | — |
| Global Context switch | Stage layers plus a pulled-back view | — | 🟧 | A saved view reproduces this; there is no dedicated one-click button. | — | — | — |
| Scene director (cinematic tours) | Authored camera moves | — | ⛔ | Not built. | — | — | — |

## Data and context

| Reference feature | Reference source | Atlas Watch status | Atlas Watch source / notes | Credentials | Commercial use | Cost / quota |
|---|---|---|---|---|---|---|
| Live flights | OpenSky + adsb.lol | ✅ adsb.lol | adsb.lol point queries (within 250 nm of the view center), every 20 s while the layer is on. Each record shows its position age. Verified: 62 aircraft near Denver. | None | ODbL 1.0 (attribution, share-alike on derived databases) | Free; rate limits unpublished. OpenSky is excluded (non-commercial license). |
| Military flights | adsb.lol `/mil` | ✅ | Global military-flagged aircraft. The UI states the flag comes from a database and may be wrong. Verified: 53 aircraft. | None | ODbL | Free |
| GNSS integrity | adsb.lol / GPSJAM | ⛔ | Not built. | — | — | — |
| Fire perimeters | NIFC WFIGS | ✅ | Interagency current perimeters with date, acreage, and containment. Verified: 52 perimeters. | None | Public domain | Free |
| Live vessels | AISStream | ✅ regional · 🟨 AISStream | Keyless Fintraffic Digitraffic AIS (Finland and northern Baltic; positions older than 2 h hidden). Verified: 1,092 vessels. AISStream (your key) streams your view area. | None / customer key | Digitraffic CC BY 4.0. AISStream: free beta, no formal terms (marked restricted). | Free |
| Satellites | CelesTrak (6 classes, 1,300 objects) | ✅ | CelesTrak TLE groups (stations, brightest, GNSS, weather, science, Starlink). Positions are calculated with SGP4 and labeled as calculated; predicted orbit line shown. Verified: 168 objects. Downloaded at most once per 2 h per group. | None | U.S. government-origin data; no published license; usage policy applies | Free |
| Satellite passes (rise/peak/set) | Computed | ⛔ | Not built. | — | — | — |
| Earthquakes | USGS | ✅ | From the MVP: USGS feeds with distance to each location's epicenter. | None | Public domain | Free |
| Weather alerts | — (reference has none as a layer) | ✅ | From the MVP: NWS alerts with polygon and zone matching. | None | Public domain | Free |
| Air quality (Canada) | ECCC GeoMet | ⛔ | Not built. | — | — | — |
| Traffic (simulated) | OSM + TomTom | 🚫 | A simulation would not be data. TomTom live flow is metered. | — | — | — |
| CCTV mesh (25+ publishers, projected in 3D) | City and DOT APIs | 🟧 | Two authorized publishers: Caltrans (California, about 3,000 cameras) and Fintraffic weather cameras (Finland). Stills load only when opened. Verified: 4,252 cameras. No 3D projection. Each additional publisher needs its terms reviewed. | None | Caltrans public data; Fintraffic CC BY 4.0 | Free |
| Mapped ALPR cameras | OSM | 🚫 | Excluded for privacy, per the original product boundaries. | — | — | — |
| Street-level imagery | Mapillary / Google / KartaView / Panoramax | ⛔ | Not built. Mapillary (free token, CC BY-SA) and Panoramax/KartaView (keyless, CC BY-SA) are candidates. | — | CC BY-SA imagery | Free / free-key |
| Radio | Radio Browser | ⛔ | Not built. | — | — | — |
| Transit | Operator GTFS-RT (many cities) | 🟧 | MBTA (Boston) via the V3 API, every 20 s while on. Verified: 83 vehicles. Other agencies need feed-by-feed terms review. | None | MassDOT developer license (review) | Free; 20 req/min without a key |
| Bikeshare | GBFS | ⛔ | Not built. | — | — | — |
| Directions | OSRM on FOSSGIS | 🚫 | The FOSSGIS policy forbids heavy use, and the servers are a donated community resource. Self-hosting OSRM would be the commercial path. Straight-line routes can be drawn with Tools. | — | — | — |
| OSM places / mapped installations | Overpass (own server) | ⛔ | Not built. Needs your own Overpass instance (your local server is a candidate). | — | ODbL | — |
| Active fires | NASA FIRMS | ✅ | VIIRS NOAA-20 24 h detections from the keyless FIRMS files (U.S. default, global optional), every 30 min. Verified: 941 detections. Labeled "a detection is a hot pixel, not a confirmed wildfire". | None | NASA open data (citation) | Free |
| Space missions / launch replay | Launch Library 2 | ⛔ | Not built. | — | — | — |
| Prohibited & restricted airspace | FAA SUA | ✅ | FAA P and R areas with limits and times of use. Labeled "not for flight planning". Verified: 569 areas. | None | Public domain | Free |
| Wildlife sightings | iNaturalist / Acartia | ⛔ | Not built. | — | — | — |
| Wind (GFS/ECMWF animation) | NOAA GFS on AWS / ECMWF | ⛔ | Not built. | — | — | — |
| Observed weather: radar | NOAA nowCOAST | ✅ | nowCOAST base-reflectivity mosaic overlay (U.S.), refreshed every 5 min while on. | None | Public domain | Free |
| Observed weather: lightning | NOAA nowCOAST | ⛔ | Not built. | — | — | — |
| Weather observations | — | ✅ (addition) | NOAA AWC METAR for the view (zoom in below 1,500 km). An empty response (HTTP 204) is treated as "no stations", not as an error. | None | Public domain | Free; 100 req/min |
| Cyclones | NHC / CPHC | 🟧 | Advisory positions and intensity. Verified: Tropical Storm Pena. Forecast tracks and cones are linked to NHC rather than drawn. | None | Public domain | Free |
| Bundled infrastructure (datacenters, dams, cables) | OSM / TeleGeography | 🚫 | TeleGeography is CC BY-NC-SA (non-commercial). The OSM extracts are ODbL share-alike and would need review. | — | — | — |

## Tools and presentation

| Reference feature | Atlas Watch status | Notes |
|---|---|---|
| Historical playback | ✅ (recorded data only) | Replays aircraft, vessel, and transit fixes this app recorded while running (configurable retention, default 6 h). Labeled "recorded observations, not live". No reconstructed tracks. The NWS/USGS event history from the MVP remains. |
| Drawing and annotations | ✅ | Pins, lines and routes, and areas, with name, color, show/hide, fly-to, and delete. Saved in SQLite and included in scene files. |
| Measurement | ✅ | Geodesic distance and area (WGS84, geographiclib). |
| Street-following routes | 🚫 | See Directions above. |
| Scene capture / share | ✅ scene files · ⛔ video capture | Scene JSON export and import. Credentials and saved locations are excluded by a strict schema. |
| Visual modes (CRT / NVG / FLIR / Noir) | ✅ (visual effect) | Night-vision look, thermal-style color ramp, CRT, and Noir post-processing. Every mode is labeled a visual effect; the thermal style is explicitly "not infrared or temperature data". |
| Detection overlay (bounding boxes) | 🚫 | Boxes not backed by computer vision would be decorative and misleading. |
| HUD | ✅ | UTC clock, camera position and altitude, and per-layer counts. Values only, with no inferred "intelligence" text. |
| Local receiver integration | 🟨 | readsb / dump1090 `aircraft.json` from a literal private-IP URL, merged into Aircraft by ICAO address. Unverified: no receiver here. The browser RTL-SDR feature is not built. |
| AI analysis | ✅ local (from the MVP) | Optional Ollama. It explains computed results only, with untrusted-data framing and record IDs. Verified against a stand-in loopback server; no real model was tested. |
| Voice control | ⛔ | Electron has no offline speech recognition, and the reference's OpenAI Realtime / Gemini voice is metered. A local speech engine (for example whisper.cpp) would be the commercial-safe path. |
| AI HUD summary | 🚫 | Requires a metered cloud model in the reference. |
| External agent (MCP server) | ⛔ | Not built. A loopback MCP server exposing the validated IPC commands is the natural next step. |
| Provider Settings | ✅ | Purpose, docs and sign-up links, status (free / restricted / metered), encrypted credentials (Windows DPAPI via Electron `safeStorage`), and connection tests against the real endpoints. |

## Parity summary

Atlas Watch covers the reference's core keyless map and data experience: a detailed globe, terrain, live
aircraft, vessels (regional), satellites, fires, perimeters, airspace, radar, observations, cyclones,
cameras (two publishers), transit (one city), tracking, contacts, playback, drawing, measurement, scenes,
visual modes, and provider settings.

**This is not full parity.** Major gaps:

- Cockpit view and 3D aircraft models
- Street-level imagery
- Wind animation and the lightning/satellite timeline
- Broad camera and transit coverage
- Radio, wildlife, and space missions
- Satellite passes
- GNSS integrity
- Voice, the AI HUD, and the MCP agent

Several reference features are excluded on purpose because they conflict with commercial-use, cost, or
privacy requirements:

- OpenSky
- Esri
- OSM tiles
- FOSSGIS routing
- TeleGeography cables
- ALPR cameras
- Traffic simulation
- Google News

---

# Screenshot inventory: GodsView AI reference (2026-11-09)

This section covers the interface shown in your third screenshot (GodsView AI, a separate commercial
product, not the open-source God's Eye View). Only its visible controls were used to identify
functionality. No name, logo, assets, ads, or paywall were copied.

**Status key:** ✅ implemented and verified against live data · 🟩 implemented, works on local data
· 🟨 implemented, not live-verified (needs your credentials) · 🟧 partial · ⛔ not implemented (reason
given)

| Reference feature | Intended behavior | Data / dependency | License / cost | Status | Verification |
|---|---|---|---|---|---|
| Map / 3D toggle | Switch flat map and globe | CesiumJS scene modes | — | ✅ | Top bar Map/3D |
| ATC view | Air-traffic focused view | adsb.lol + OurAirports | Free | 🟧 | Turns on aircraft layers and airports with altitude colors. **No ATC audio**: no authorized audio source is included (LiveATC and similar restrict redistribution). |
| Unified search | Callsign, airline, model, hex, city | Bundled places/airports, loaded aircraft and vessels, Census addresses, adsb.lol lookup | Free | ✅ | Search box plus Track a flight page |
| Airports | Airport browser and context | OurAirports (public domain), adsb.lol | Free | ✅ | 5,282 airports; nearby low aircraft from a live adsb.lol query |
| History / time | Replay | Track points recorded by this app | — | ✅ | Recorded data only; no fabricated history |
| Notifications | Alerts that need attention | Special squawks, saved places in alerts, watched objects in data | — | 🟩 | In-app bell. OS notifications are not used; the permission stays denied. |
| Language / display | Preferences | Settings | — | 🟧 | Units (metric / imperial / nautical), UTC + local times. English only. |
| Layers | Layer manager | Existing layer system | — | ✅ | |
| Follow / locate | Camera follow, locate | — | — | ✅ | Track button; ⌖ flies to the selected object or home |
| Track / trail visibility | Recorded trails | Recorded fixes | — | ✅ | |
| Altitude legend + filter (GND–FL400) | Color by altitude, filter range | adsb.lol altitude | — | ✅ | Legend and filters in the traffic bar |
| Emergency panel | 7500/7600/7700 and emergency status | adsb.lol squawk / emergency fields | — | ✅ | Factual "reported" labels with report age; never called a confirmed incident |
| Data panel | Feed health | — | — | ✅ | Ops center, Diagnostics |
| Terrain / buildings | 3D terrain, building extrusions | Terrain Tiles AWS, OSM via OpenFreeMap | Free | ✅ | 38,460 New York and 154,310 Tokyo footprints rendered. Heights from OSM tags or estimated. **Not photorealistic.** |
| Photoreal 3D | Photorealistic cities | Google 3D Tiles | **Metered**, your key | 🟨 | Optional |
| Measure / draw | Tools | — | — | ✅ | From earlier version |
| Zoom / orientation / reset | Controls | — | — | ✅ | |
| Scenes | Presets / scenes | Saved views, scene files | — | ✅ | |
| CCTV / cameras | Public cameras | Caltrans, Fintraffic | Free | ✅ | Cameras page (2 publishers) |
| HUD | Heads-up readout | — | — | ✅ | |
| Kiosk | Full-screen globe | Electron full screen | — | 🟩 | ⛶ button; Esc exits |
| Share | Share view | Scene files, PNG screenshot | — | 🟩 | ⎙ saves a PNG; Tools → export scene |
| Watch | Watchlists | Local storage (SQLite) | — | 🟩 | ☆ on aircraft and vessels; Watchlist page |
| Detect | Bounding boxes | — | — | 🚫 | Boxes not backed by computer vision would be misleading |
| Voice | Voice control | — | — | ⛔ | No offline speech recognition in Electron; cloud voice is metered |
| Globe / Ops center / Events / Discover | Overviews | Loaded feeds | — | ✅ | Computed from live loaded data |
| Near me / What's overhead | Nearby objects | adsb.lol point query around home or view | Free | ✅ | Elevation angle, distance, altitude |
| People | Directory | Local, opt-in | — | 🟩 | Team contacts only. **No tracking of people.** |
| Markets | Market data | Licensed feed required | Paid license | ⛔ | Explained in app; no free commercially licensed source |
| AI analyst | Answer questions on loaded data | Deterministic code plus optional local Ollama | — | ✅ | Altitude, vessel type, special codes, alerts at places, changes, fires, quakes |
| Boards | Working boards | Local SQLite | — | 🟩 | Notes and pinned items |
| Feed / Community / Chat | Social features | Server, accounts, moderation | Backend | ⛔ | Explained in app; could use your server later |
| Track a flight | Lookup by identifier | adsb.lol `/v2/callsign`, `/v2/hex`, `/v2/reg` | Free (ODbL) | ✅ | Live lookup verified |
| My places | Saved locations | Existing | — | ✅ | |
| Breaking news | News | Licensed news source required | — | 🟧 | "Official bulletins" page: severe NWS alerts, M5+ quakes, NHC advisories with source links. Commercial news is not included. |
| Flight replays | Replays | Recorded tracks | — | ✅ | |
| Enterprise | Admin | Local organization settings | — | 🟧 | Organization name on briefings, retention, provider policy. No SSO, roles, or central admin. |
| Help & resources | Help | — | — | ✅ | |

## Worldwide imagery and buildings (keyless baseline)

- **Global base:** NASA Blue Marble Shaded Relief + Bathymetry, zoom 0–8 (about 500 m per pixel),
  continuous worldwide. Oceans render consistently.
- **City and street context, worldwide:** OpenStreetMap streets, place names, water, and boundaries via
  OpenFreeMap. Vector data reaches zoom 14 and draws sharply beyond that.
- **Buildings, worldwide where mapped:** extruded OSM footprints. Heights come from OSM tags where present;
  otherwise they are OpenMapTiles estimates.
- **High-resolution imagery:** keyless only in the U.S. (USGS, about 2.4 m per pixel). Worldwide
  high-resolution imagery requires a customer key: Esri World Imagery or Mapbox Satellite (both metered),
  or an EOX commercial license for Sentinel-2 cloudless (10 m).
