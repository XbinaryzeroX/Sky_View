# Requirements audit — Atlas Watch worldwide upgrade

Audit date: 2026-11-11. Project: `C:\Users\infob\Documents\Claude\Sky_View`.
Specification: the user-provided `pasted-text-1.txt` attachment, read in full. This document preserves the full
upgrade objective; a successful repair increment is not completion of the entire specification.

**Overall status: incomplete.** Existing functionality is substantial and must be reused. Several required
workflows are missing, several adapters require credentials or terms review, and code presence alone does not
prove current end-to-end operation. The continuation implemented satellite passes and bounded camera boards,
verified with real connected sources. Cockpit entry/exit passed on a real aircraft; the native Cesium morph
fixture passed, while the final live mode-switch repeat was blocked by provider network failure. Later source
adds bounded GeoJSON annotations, an external Street View action and shared HTTP deadline repairs. The latest
area-watch checkpoint added an earthquake rule to existing saved areas and repaired date-line weather. Typecheck, 625 tests in
42 suites and the production build passed. A real USGS desktop run exercised the rule, bell, details and read
state across a restart. A real NOAA request returned stations on both sides of the date line. Native picker
input, default-browser handoff and Windows installation/upgrade remain open.

The preceding timeline work connects retained NWS/USGS reply revisions to History and Replay. Named views and scene files now save that timeline cursor and the civil investigation displayed there. [Timeline evidence](PROGRESS.md#shared-historical-timeline) and [Scenes evidence](PROGRESS.md#saved-investigations-in-scenes).

The latest briefing work adds visit-to-visit comparison to the existing location report and export workflow. The package also preserves existing settings and records on an isolated copy of the v0.7.0 database. [Briefing evidence](PROGRESS.md#since-last-visit-briefings).

The German weather-warning increment extends the existing live Weather and Events views after a source and packaged-app duplicate check. Regional history and briefing exports continue to need publisher-specific storage and reporting. [Implementation and coverage](PROGRESS.md#german-weather-warnings).

## Evidence and status rules

| Status | Meaning |
|---|---|
| V — verified | Specific running-app, provider, artifact or regression evidence is recorded; scope is named. |
| I — implemented, unverified | Source implements the behavior, but this audit has no matching current end-to-end check. |
| P — partial / needs improvement | Part exists, a requirement or verification is incomplete, or a concrete defect remains. |
| M — missing | No complete production workflow found in the current searched source. |
| C — credentials / hardware | Implemented path requires customer credentials, installed inference or external hardware to verify. |
| T — terms / provider access | Suitable licensed access or account-level rights have not been established. |
| W — active work | Another current increment is implementing it; no completion claim is made yet. |

Source paths below are project-relative, usually under `src/`. The authoritative checks available at audit start
were the preceding repair increment's 389 unit/regression tests, four Chromium raster assertions, built production
bundle, NSIS artifact and eleven-view smoke logs. The later continuation checkpoint in PROGRESS records 452 passing
tests across 31 suites, successful typecheck/build, real pass/board/imagery checks, native Cesium cockpit checks and
a rebuilt unsigned installer whose packaged bundles match that build. These are dated checkpoints, not a promise
that subsequent edits are already packaged. A subsequent source checkpoint passed typecheck, 560 tests across
37 suites and the production build after the latest GeoJSON freeze. The final packaging build/typecheck passed,
and [package-audit-2026-11-11.log](package-audit-2026-11-11.log) verifies the current output/archive association.
This is not evidence of native chooser, default-browser or installation/upgrade acceptance. These checks do not
validate every requirement below. The audit inspected
the named source, tests, package manifest, provider metadata, logs and existing implementation notes; it did not
re-run every provider or install/upgrade the packaged app. [PROGRESS.md](PROGRESS.md) records those exact checks.

Historical artifact context: the earlier 452-test continuation checkpoint produced a 127,476,753-byte installer,
SHA-256 `572639E442A37FC80D2865568132108F44F1DE8F44309669DD94E255262D51A1`. That hash predates the later
GeoJSON/Street View/shared HTTP work and is not the current artifact. The audit-start artifact was 127,449,626
bytes. The current installer/hash is in final deliverable 12 below.

Reference evidence is documented in [REFERENCE_RESEARCH-2026-11-11.md](REFERENCE_RESEARCH-2026-11-11.md):
[God's Eye View](https://godseyeview.ai/), its [repository](https://github.com/bilawalsidhu/gods-eye-view), release
v0.3.0 / `72eb3fd`, README, changelog, data sources, license, notices, model attribution, security document, relevant
issue and sampled modules. A direct Git check subsequently established main at
`aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a`. GodsView AI screenshot controls remain a separate reference.

## Access check and operating invariants

| Requirement | Current evidence | Status / remaining proof |
|---|---|---|
| Actual folder, source and instructions | `package.json`, `AGENTS.md`, `src/`, `tests/`, `scripts/`, current worktree | V: accessible, changes preserved; duplicate checks are now an explicit project rule. |
| Development and launch commands | `package.json`: `dev`, `typecheck`, `test`, `build`, `start`, `smoke`, `dist`, `dist:dir` | V for the dated continuation checkpoint; rerun affected checks after subsequent changes. Windows uses `npm.cmd` when PowerShell script policy blocks `npm`. |
| Browser, terminal, desktop and testing tools | Recorded terminal tests and Electron smoke hooks; Windows computer-use inventory | V: tools accessible. Native hidden-window capture had a helper error; Electron capture artifacts were usable. |
| Screenshots and references | `docs/screenshots/`, saved audit screenshots/logs, reference review | V for available files and web review. Do not infer hidden screenshot panels or proprietary asset rights. |
| Downloadable Windows desktop retained | Electron main/preload, `electron-builder.yml`, `release/Atlas-Watch-Setup-0.7.0.exe` | V artifact exists; installation/upgrade has not been exercised. |
| Preserve settings, locations, watchlists and history | Prior v0.7.0 source wrote a nine-table fixture, current source reopened its copy twice and attached a watch to an existing area. See store-upgrade-audit.log. | V prior rows and new rule survived. Separate installer-level upgrade acceptance remains open. |
| Core without mandatory paid APIs | Keyless map/NWS/USGS/layer adapters; optional providers catalog | I/V for exercised keyless paths. No new account, billing activation or deployment was performed. |
| Controlled optional cost; subscriptions are not API entitlements | `shared/providers.ts`, `main/credentials.ts`, `main/markets.ts`, build-time keys | P/T: per-install allowances exist, but do not establish an aggregate billing cap or commercial redistribution rights. Public browser keys are a separate credential class. |
| Worldwide architecture and honest regional coverage | Coordinates/types, provider coverage notes, eleven-view route | P: worldwide navigation verified; complete worldwide data coverage is neither implemented nor promised. |
| User's server available | No supplied server endpoint, account or deployment configuration used | Not a reason to block keyless/local work. Shared backend features need a concrete design/access path before deployment. |
| Own identity and compatible reuse | Atlas Watch branding; no reference code/assets copied in the repair review | I: code notices and optional model attribution pipeline exist. Individual data/image/model rights remain separate gates. |

## Phase 1 — audit the real app

| Audit subject | Source / evidence | Status |
|---|---|---|
| Architecture, dependencies, entry points | `package.json`, `main/main.ts`, `preload/preload.ts`, `renderer/main.tsx`, `renderer/App.tsx` | V source inspection: Electron 45, React 19, TypeScript, CesiumJS, SQLite, validated preload bridge. |
| Map rendering and providers | `renderer/components/Globe.tsx`, `renderer/map/*`, `shared/remoteHosts.ts` | V/P: global route and targeted ocean isolation; broader close/tilted/2D scenarios remain. |
| Real vs demonstration records | `main/layers/fetchers.ts`, normalizers, separate `tests/fixtures/`, explicit QA DOM errors | I/V: exercised feeds were real; no silent fake production fallback found in inspected adapters. This is not a claim that every future adapter is audited. |
| Cameras and media | `CameraPlayer.tsx`, `CameraBoard.tsx`, `cameraFocus.ts`, `Pages.tsx`, camera adapters and real camera QA | V/C/P: single-player and bounded two-stream boards exercised, including Data-panel suspension/restoration; optional keyed systems and broad long-session behavior unverified. |
| Aircraft and vessels | `layerNormalize.ts`, `aircraft.ts`, `vehicleClass.ts`, `layerRender.ts`, AIS client/manager | I/V/C: fields/symbols/aging implemented, regression checked; live keyed AIS unavailable. |
| AI and voice | `shared/ai.ts`, `analyst.ts`, `main/ollama.ts`, `MarketsPage.tsx`, `main/markets.ts` | I/C for optional local models; M for actual voice recognition/control. Deterministic analyst is ordinary calculation. |
| Persistence and migrations | `main/store.ts`: locations/cache/events/annotations/views/boards/people/track points, later `ground` column | I/V for store tests; prior-version upgrade and user-data copy checks remain. |
| Network/security | `main/security.ts`, `feeds/http.ts`, `secrets.ts`, `credentials.ts`, `shared/ipc.ts`, `remoteHosts.ts` | I/V focused tests; see Phase 9/10 boundaries. No arbitrary renderer Node/network proxy found in these paths. |
| Packaging and tests | Package scripts, notices, NSIS config, continuation tests and final package audit | V final packaging build and byte-identical current main/preload/HTML/renderer/worker in 409-entry ASAR; installer unsigned, not installed/upgraded. Later edits require checks/rebuild. |
| Performance/usability defects | Camera retry, AIS lifecycle, late route race, bulk aircraft aging, marine-area fill and synthetic waves | V repaired/tested with limits in PROGRESS; renderer bundle size and further workflows remain. |
| Required feature classifications | Tables in this file and current inventory in PROGRESS | P: families classified here; a full provider-by-provider live verification record remains incomplete. |

## Phase 2 — research and comparison

The reference review pins the November 11 main commit and the v0.3.0 release. Its source comparison covers the
modules listed in the research record. The current candidate table below draws on that review and the local source audit.

| Feature | Reference evidence | Current app evidence | Gap | User benefit | Provider | Coverage | Cost/license | Work required | Verification |
|---|---|---|---|---|---|---|---|---|---|
| Existing live tracking reliability | Reference live layers; official AIS docs linked in research | Existing AIS/ADS-B adapters, `aisstream.test.ts`, `layer-render-aging.test.ts` | Keyed live AIS check | Existing tracks survive outages truthfully | Existing AISStream/adsb.lol | Receiver-dependent | Existing customer key/ODbL; AIS terms separate | Preserve and verify existing repairs | V fixture/lifecycle; C real key |
| Camera monitoring | Reference camera source/server modules in research | Existing player/catalogs/favorites/SQLite boards extended with camera references and focus coordination | Long-session bandwidth/CPU characterization | Monitor chosen sources together | Existing public publishers | Regional catalogs | Publisher-specific; no new API required | Implemented in existing workflows; retain caps and cleanup | V real two-stream playback, persistence, pause/hide/close/reopen and app-wide two-video limit with a background Data player |
| Satellite passes | Reference satellite composition exposes pass methods | Existing TLE/SGP4/orbit display extended with observer worker/details | Optical visibility not evaluated | Plan observations without a paid API | Existing elements + local calculation | Worldwide calculation | Existing satellite.js MIT; TLE source terms | Implemented; preserve stale/unknown states | V: 12 regressions including independent Skyfield ephemeris, real ISS/manual/saved-observer UI checks |
| Cockpit perspective | Reference cockpit/follow capability | Existing follow extended with stable anchor, forward view and safe exit | Camera simulation; no observed flight attitude/interior | Explore from a selected aircraft | Existing positions/Cesium | Data-dependent | No new provider cost | Implemented; final live mode-switch repeat blocked by source outage | V initial real entry/Escape/stop and native Cesium morph/cleanup fixture; terrain/ground eligibility tested, not every terrain scene |
| Imagery date freshness | Reference dated products/timeline; NASA product docs are authoritative | Existing imagery panel/renderer now extends through `shared/imageryDates.ts` | Other catalog products retain their own source/coverage limits | Newly available dates stay reachable | Existing NASA GIBS DescribeDomains | Product-specific | Keyless; attribution | Reused panel; actual ranges/cadence/gaps, shared metadata cooldown and historical limits implemented | V seven strict live date/raster checks; not a guarantee of all advertised dates/products |
| Street-level access | Attached street-level family; official sources in STREET_VIEW.md | Tools → existing validated external-link IPC → Google Maps URL at picked screen center | No embedded/verified panorama or capture-date/availability layer | Open nearby historical imagery in its source viewer | Google Maps external viewer | Panorama availability varies | No API key/billing for link; Google viewer rights retained | Partial external workflow implemented | V fixtures and built-app center/validated URL with shell stub; I native browser/display unverified |
| Watch areas/imports | Phase 7 watch rules and user imports | Existing Map tools accept simple GeoJSON. Saved areas support local USGS threshold rules and persisted bell matches. | Other event types, richer geometry and file formats | Monitor an area already drawn or imported | Existing USGS summary and SQLite | Publisher-reported epicenters worldwide, within the configured feed | Keyless, same polling schedule | Extend these workflows for additional source types only after geometries and event times are established | Parser/store/IPC/renderer tests and desktop checks in PROGRESS |
| Offline voice | Reference metered voice workflows documented in research | Local Ollama text only | Supported local speech engine and safe command flow | Hands-free operation | Not selected | Language/model-dependent | Model and runtime rights undecided | Choose/install explicitly supported dependency, command allowlist and lifecycle | M/T/C; no fake voice button justified |

Additional candidate justifications, operating costs and research sources are in the reference review. Priority
remains broken core flows, missing useful functionality, reliability/worldwide support, then lower-value extras.
Phase 2 is **P**, not complete, until remaining reference capabilities have implementation evidence and providers
are reviewed individually. Record counts and timings in older docs are dated observations, not current promises.

## Phase 3 — map and labels

| Explicit requirement family | Current evidence | Status / exact limit |
|---|---|---|
| Rectangles, missing ocean, white patches, black wedges | USGS no-data handling in `usgsProvider.ts`/`tilePixels.ts`; GIBS edge repair; marine park fill correction in `vectorTiles.ts`; isolated Cape views | V targeted defect repairs. P for a claim that every location/scale is clean; antimeridian source seam remains. |
| Invalid triangles/rings/holes/date line | Geometry sanitization in `shared/geo.ts`, terrain resampling, vector even-odd fill; terrain/tile/geo tests | I/V bounded checks; no complete systematic invalid-geometry/tilted-view acceptance route recorded. |
| Blur and progressive detail | `basemaps.ts` level/extent metadata; NASA/USGS pyramid providers; vector overzoom | V tile route. Keyless non-U.S. photography is genuinely coarse; vector context does not create photography. |
| Provider extents/projection/rows/levels/alpha | `basemaps.ts`, custom imagery/terrain providers, pixel tests | I/V targeted fixtures and imagery diagnostics; exact origin/worker/request behavior in installed package remains P. |
| Terrain, clipping, request failure and lifecycle | `terrain.ts`, worker pool, render-error recording/restart, provider diagnostics | V zero terrain failures/render errors in eleven-view route; 38 USGS coverage 404s explicitly retained. |
| Continuous global navigation, 2D/3D modes | `Globe.tsx`, mode buttons, smoke hooks | V global 3D route; I full 2D mode/restore/keyboard round trip in this audit. |
| City/road context, footprints/heights, terrain | OpenFreeMap vectors/buildings; AWS terrain; attributed estimates | I/V source and route. Heights can be estimated; no photoreal claim. |
| Optional photoreal 3D | Google tiles path, configured renderer destinations and user browser key | C/T live access/billing needed; previous globe-only geoid/model checks do not validate Google. |
| Coordinates, places, addresses, attribution | Existing search box, multilingual Natural Earth catalog, WGS84 coordinates, Census and Google paths | Search recognizes alternate spellings and region qualifiers, rejects unsupported reference systems, and keeps optional geocoding explicit. [Worldwide search evidence](PROGRESS.md#worldwide-place-search). |
| Separate resolution/acquisition/terrain/buildings/live data | Source diagnostics and product metadata; temporal labels | I/P: generally present, but not all product units/acquisition availability are independently revalidated. |
| Label hierarchy/rank/collisions/dedup/size/outline/fade | `placeLabels.ts`, settings and `layerRender.ts` | I/V earlier screenshots and inspected source. All requested overview, tilted, selected-object and dense-vehicle combinations still need current acceptance checks. |
| Horizon/globe occlusion and selected priority | Place manager/horizon logic; vehicle selection and bulk aging/culling tests | I/V targeted renderer methods; not a universal scene proof. |
| Independent geographic/road/aircraft/vessel/density/text controls | `SettingsDialog.tsx`, shared settings schemas | I: implemented. Do not add another label control set. |
| Operator logos | No licensed logo set or complete control workflow found | M/T: intentionally absent; do not ship unlicensed marks or call generic paint exact livery. |
| Baked-in raster text vs dynamic labels | Screen-space vector labels separate; USGS topo/imagery-topo are separate basemaps | I: dynamic controls cannot remove publisher raster text. |

## Phase 4 — aircraft, vessels and reliability

| Required family | Source evidence | Status / remaining proof |
|---|---|---|
| Real aircraft position, oriented type-specific 2D symbols | ADS-B normalizer, `symbols.ts`, `vehicleClass.ts`, `layerRender.ts` | I/V fixture and earlier live evidence; rerun current integration in representative regions. |
| Callsign, registration, ICAO, model/operator, altitude/speed/track/vertical rate/ground | `layerNormalize.ts`, `RecordDetails.tsx`, `vehicleInfo.ts`, ICAO family tables | I: fields render when supplied, unavailable values stay null. Exact type must not be guessed from family. |
| Selection/follow/trails/search/filter, nearby/overhead, watchlist, airport context | `App.tsx`, `Globe.tsx`, `Pages.tsx`, `TrafficBar.tsx`, SQLite docs/settings/tracks | I: working infrastructure already exists. Full current UI/persistence workflow still requires acceptance checks. |
| Aircraft photos with attribution | Exact identifier matching in `vehicleInfo.ts`, `VehicleExtras.tsx` | I/T: opt-in and credited. Authorization/caching/redistribution rights of each publisher remain separate. |
| Origin/destination/departure/arrival/status | Usual callsign route lookup in `route.ts`; honest route legend in details | P: usual route is not today's itinerary; scheduled times/status/cancellations unavailable. No date-matched operational journey provider connected. |
| Observed vs reported vs calculated movement | Recorded tracks, dashed reported airport route, bounded smoothing and snapshot flags | I/V aging tests and code. No airport inferred solely from heading; no unrecorded history invented. |
| Callsign reuse/international/overnight matching | No date-keyed flight journey source/workflow found | M/T for complete journey matching; current route caveat avoids an unsupported claim but does not implement matching. |
| AIS positions and type-specific vessel symbols | Fintraffic normalizer, optional AISStream, vessel classification and 3D models | I/C: regional keyless source exists; keyed worldwide stream not live-verified. Fishing category exists. |
| Vessel name/MMSI/IMO/category/speed/course/heading/nav status | Normalizers and details fields | I/V normalizer tests. AIS unavailable sentinels are handled; missing values do not become fabricated data. |
| Dimensions/draft/reported destination/ETA/static-dynamic merge | `VesselStatic`, AIS conversions, repaired Class B merge/cache | I/V fixture tests; C real-key static/voyage report check. ETA/destination remain reported, not confirmed arrival. |
| Vessel selection/follow/trails/search/filter/watchlist/photos | Existing details, Page search/watchlist, traffic filters, exact IMO photo matching | I/T current multi-step visual/live check and photo rights remain. No manifests/cargo/port-call history invented. |
| Polling/streaming/viewport/rate limits/reconnect/dedup/history/cleanup | Layer manager, shared HTTP origin pauses/parser, bounded-deadline schedulers, AIS client, bounded tracks/caches | V selected regressions including full long Retry-After waits, manual/toggle bypass prevention and timer hops; P universal provider-outage/process-relaunch/long-session soak. |
| Bounded interpolation/staleness/expiry | `aircraft.ts`, `layerRender.ts` entity/bulk paths, AIS TTL | V regression scope. Vessel report aging is separately bounded; all contacts are not claimed continuously live. |

## Phase 5 — public cameras

| Requirement | Current evidence | Status / remaining proof |
|---|---|---|
| Authorized map discovery, clustering and navigation | Existing camera adapters, layer clustering, directory/player navigation | I/V real catalog loads and map screenshot; publisher terms vary. |
| Country/city/name search and viewport/media filters | `cameraDirectory.ts`, Cameras page, date-line tests | I/V filters/Qt viewer real scenario. No dedicated category taxonomy established. |
| HLS | Existing maintained `hls.js`, restricted publisher media destinations | V one real Caltrans stream before/after injected error. Availability of every listed stream is unproven. |
| DASH/MJPEG/official embedded players/other formats | No complete DASH/MJPEG player path found; official viewer links deliberately external | P/conditional: current catalogs use HLS/stills/viewer links. Add a format only with a suitable authorized source; a webpage is not a stream. |
| Favorites, camera groups and multi-camera boards | Existing favorites/SQLite boards/player extended with references and focus coordination | V: real two-stream boards, persistence, pause/hide/close, background-player suspension/restoration; no duplicate catalog/player. |
| Publisher/source links, availability/error/retry/cleanup | `CameraPlayer.tsx`, recovery/focus helpers, provider/source status | V retry, hidden-document, board switch/close and restoration checks; P broad offscreen and long-session behavior. |
| Last checked time and capture freshness | Source status `lastSuccessAt`, still `loadedAt`, per-record observation/source fields | P: loaded/download time is not publisher capture time; no universal per-camera last-health-check registry. |
| Live/still/recorded/offline/unconfirmed distinctions | HLS/still/publisher-viewer badges and fallback messages | I/V exercised types; no recorded-footage provider or universal live-status proof. |
| Authentication/embed/paywall restrictions and desktop protections | Exact publisher links/prefixes; no remote frames in CSP | I/V boundary tests. No bypass implemented or authorized. |
| Finite media resource budget | 32 references/group, four visible cards, two HLS streams; shared focus/visibility gates in existing player | V document-wide two-video limit, background suspension/restoration, pause/hide/close/reopen in real desktop QA. P actual bandwidth/CPU and long-session measurements. |

## Phase 6 — remaining reference feature families

| Family (all explicit items retained) | Existing workflow / source | Status / remaining gap |
|---|---|---|
| Selection, tracking, nearby, follow, supported models | Details/Globe/layer renderer/type models/optional model pack | I/V targeted checks; cockpit implemented with the limits above. Real third-party model download pack C/T and orientation verification. |
| Saved views, scene restoration, drawing, annotations, measurement | Existing Scenes, versioned scene schema, SQLite store, map tools and geodesic helpers | Named live/recorded views passed desktop save, change, restore and offline restart. V2 export/import and v1 compatibility passed with a temporary file-dialog adapter. [Scenes audit](scenes-audit.log). |
| Scene capture/export and real historical replay | PNG/scene export, playback bar, stored observed track points | I: already implemented. No fictional reconstruction, video export or broad provider archive asserted. |
| Street-level imagery | Existing Tools/openExternal hand off Google Maps URL at picked map center; STREET_VIEW.md records official source/rights | P: fixtures and built-app center/URL integration passed with shell stub; native browser/panorama availability unverified. M embedded imagery layer; source/rights/key/CSP design is separate. |
| Satellite positions/orbits/pass predictions | Existing CelesTrak+SGP4/orbits, local pass worker and RecordDetails observer UI | V 12 regressions and real ISS manual/saved-observer checks; optical visibility, weather and terrain obstruction remain outside the calculated geometric result. |
| Layer manager tabs/search/counts/chips/groups/off/legends/source/freshness/setup/errors | `LayersPanel.tsx`, statuses, diagnostics/provider UI | I/V source inspection; some legends/provider metadata still need full consistency review. |
| Aircraft/military/vessels/fishing/transit/trains | Existing aircraft flags, AIS ship classes, Boston MBTA | I regional transit. MBTA can report rail, but no general international train adapter; M broader trains. |
| Traffic/bikeshare/airport delays/gliders | No dedicated live traffic/GBFS/delay/FLARM adapter found | M/T. ADS-B can classify a reported glider, which does not establish a FLARM integration. |
| Wind, conditions/colors, radar, alerts, METAR | Radar/NWS/METAR and dated imagery exist. METAR points already carried flight-category colors and measured wind. The existing markers now update color on a revised report, and their layer explains the colors. | V both sides of a real Fiji/Tonga viewport. Separate gridded wind or interpolated conditions remain missing. |
| Lightning, storm reports, severe outlooks | No full adapters found | M/T; choose primary observed/forecast products and actual regional limits. |
| Storm tracks and satellite clouds | NHC advisory positions/link out; GOES/Himawari actual frames | P tracks/cones; I satellite frames with geographic gaps. No complete worldwide cyclone warning service. |
| Region-specific warning adapters | NWS U.S. zone/polygon evaluation and the optional German DWD STATUS layer, including source-specific saved-place evidence | Germany covers the areas in DWD's published product. Additional countries, regional warning history and briefing integration remain open. [DWD checkpoint](PROGRESS.md#german-weather-warnings) |
| Earth/environment | USGS quakes, FIRMS, NIFC, incidents and NASA imagery | Existing NIFC perimeter workflow repaired. Features preserve multipart footprints, holes, incident IDs, both acreage fields and publisher dates. The U.S. layer covers published wildfires and prescribed fires. [Perimeter verification](PROGRESS.md#us-fire-perimeters) |
| Space | Satellite positions and existing weather-satellite imagery | I existing; M launch/mission/radio/GNSS integrity workflows if adopted from supported reference evidence. |
| Places/infrastructure and aviation charts | Airports, places, roads, buildings, FAA special-use airspace | P: special-use boundaries are not a complete navigation-chart system. No broad cable/dam/facility database workflow. |
| Signals/media and other discovered categories | Existing cameras/official bulletins | P/M broader supported radio/signals; hidden screenshot category contents remain unknown. |
| Imagery dates/available-date navigation/playback/comparison/swipe/legends/metadata | Existing 23-product GIBS catalog and split layers; current DescribeDomains repair | V date refresh/gap navigation and actual raster failure/positive states for two products. I other products/playback/swipe; P units are not a required catalog field. Separate synchronized two-map workflow M. |
| True/false color, nighttime, temperature, vegetation, atmosphere, fire, water/ice, precipitation, land, ocean, gravity, air quality | All represented among catalog categories | I/P: representation exists; meaning/units/actual availability must be verified product by product. Some products share a source layer under different use categories. |
| Normal/CRT/NVG/FLIR/Anime/Noir/Snow | `visualModes.ts`, style controls and effect notes | I: already implemented. Effects must remain separate from temperature/observed snow. |
| Controls/help, HUD, kiosk/fullscreen, share/export, watch | Existing tools/help/HUD/actions and validated IPC | I/V earlier workflow checks; broad current keyboard/resize/accessibility checks remain. |
| Voice and highlighting/detection | No actual speech engine; selection highlight exists | M voice. Highlighting is not computer-vision detection; do not add decorative bounding boxes labeled detection. |
| Ops incidents/map/trends/source health/countries/filter/statistics/source timestamps/dedup/updates | `incidents.ts`, Ops page, actual source levels and counts | I/V older/live record evidence; full current data lifecycle not rerun. Country summary is not an authority risk score. |
| Geographic watch areas | Map tools link saved areas to local USGS magnitude rules. The existing bell retains the evidence. | I earthquake rules. Additional dataset rules and a separate Ops workflow remain unevaluated. |
| Discover/Near Me/My Places/Boards/source feed/replay/admin/settings | Pages, location forms, watchlist/replays, Org, Community, Markets | I real existing infrastructure; V bounded camera-board extension. News context is scoped, not a global news service. |
| People/community/chat persistence and access | Local team docs/boards; real configured Lemmy auth and write adapters | I/C Lemmy credentials/writes unverified. Local team list is not people tracking or shared access control. M private team chat/roles/SSO backend. |

## Phase 7 — every numbered improvement candidate

| # | Candidate | Current evidence / status | What remains or reason to defer |
|---|---|---|---|
| 1 | Source-health dashboard | I: Ops source monitor and Diagnostics already exist | Improve provenance/errors in place; do not add a duplicate dashboard. |
| 2 | Geographic coverage visualization | P: written provider coverage, source extents and global route | No explicit unified coverage-footprint visualization found; design from actual source extents, not inferred completeness. |
| 3 | What changed since last visit | The existing Briefing dialog compares NWS/USGS observations across app launches. Analyst routes explicit visit questions there. | The report covers two retained replies with matching source scope. Per-source limits identify missing evidence. [Implementation and verification](PROGRESS.md#since-last-visit-briefings). |
| 4 | Unified timeline | NWS and USGS recorded replies and four existing movement layers share one historical cursor. History opens an exact observation and Data uses the corresponding revisions. | Other live datasets and dated imagery do not share this recording model. Legacy latest-event rows contain insufficient evidence for earlier frames. [Timeline evidence](PROGRESS.md#shared-historical-timeline). |
| 5 | Synchronized side-by-side maps | M: existing two-date swipe is already implemented | Separate two-view comparison, not another swipe widget. Needs camera/time sync and resource budget. |
| 6 | Watch areas and notification rules | Existing drawn/imported areas and bell now support enabled/paused USGS rules, saved matches, read status and persistent deduplication. | Earthquake epicenters only. Weather-area intersections and further notification channels would require separate evidence. |
| 7 | Saved investigation workspaces | Existing Scenes saves and restores the clock, civil event reference, filters, camera/mode, dated imagery configuration, HUD and Data panel. Old views and v1 files remain readable. | Raw observations stay local. Private place, vehicle, board and arbitrary panel state are outside the shared context. [Scope and evidence](PROGRESS.md#saved-investigations-in-scenes). |
| 8 | Source-linked exportable briefings | The existing deterministic HTML/PDF workflow covers saved locations and now offers a visit-to-visit report. | Wider incident datasets require their own retained evidence and source permissions. [Briefing scope](PROGRESS.md#since-last-visit-briefings). |
| 9 | CSV/GeoJSON/geospatial imports | I CSV/scene workflows; local GeoJSON annotation preview/import/export subset | V parser/atomic store/IPC tests and built UI/import/export/restart with temporary native-dialog adapters; native picker unverified. Holes/Multi/3D/CRS and other formats unsupported. |
| 10 | Credential diagnostics/tests | I/C: provider dialog, secure save, tests already exist | Not every new open camera publisher has a separate provider registry row; real keyed paths remain unverified. |
| 11 | Provenance/uncertainty | Saved-location monitoring carries the provider, query, retrieval time, reply completeness and spatial uncertainty through Places, Data, Analyst and export. | Separate source-specific verification remains necessary for other datasets. [Monitoring evidence](PROGRESS.md#saved-location-monitoring-evidence). |
| 12 | Accessibility/low-resource modes | P: ARIA, keyboard/help, reduced motion, balanced quality | No full screen-reader/contrast/zoom audit or dedicated low-resource preset verified. |
| 13 | Compatible provider fallback | P: keyless imagery fallback and stale cached records; camera still fallback | Per-source legal/technical compatibility must remain explicit. Generic automatic paid fallback is not authorized. |
| 14 | Offline/cached behavior | Compatible cached records retain their original times and reply completeness. Legacy caches retain their records with unknown completeness. Saved-location counts distinguish current and last-observed results. | Broader optional-layer persistence/offline restore remains open. [Saved-location checks](PROGRESS.md#saved-location-monitoring-evidence). |
| 15 | Other researched opportunities | I: concrete recovery/aging/marine-fill repairs already adopted | Continue measured quality improvements. Do not use this open-ended item to invent unsupported features. |

### Pre-implementation duplicate check — areas, imports, timeline and investigations

This records the source/test review on 2026-11-11 **before the GeoJSON increment below**.
`AGENTS.md`, PROGRESS, the later v0.5–v0.7 implementation notes and the full attached specification were checked
before identifying these gaps. This table preserves the original findings. The GeoJSON, earthquake area watch
and shared historical timeline checkpoints in [the progress record](PROGRESS.md) give their current status.

| Workflow already present | Concrete source and UI path | Tested evidence and precise boundary |
|---|---|---|
| Saved-place monitoring | Places/CSV → saved coordinate and quake radius; `shared/monitoring.ts` evaluates NWS polygon membership or resolved NWS zones and geodesic quake distance; Location details/briefing show results | `monitoring.test.ts` and `core.test.ts` cover concavity, holes/date line, unknown zones, stale/unavailable feeds, revisions/cancellations and magnitude/radius filtering. This monitors a point, not the saved radius against weather polygons or an annotation area. |
| Object watches and bell | `Pages.tsx` Watchlist and `App.tsx` notifications: loaded aircraft special codes, confirmed alerts at saved places and watched aircraft/vessels present in loaded data | Existing watch item schema persists object references in settings. Bell entries are recomputed from current loaded records; no user-authored geographic condition, entry/exit transition, acknowledgement or restart deduplication state exists. |
| Drawing and annotation persistence | Map tools → Pin / Line / Area; rename/color/show/delete/Go in `ToolsPanel.tsx`; `App.tsx` → validated annotations IPC → SQLite documents → Globe renderer | `shared/ipc.ts` allows one flat array of 1–5,000 lon/lat pairs per annotation, not Polygon holes/MultiPolygon geometry. App drawing enforces 1/2/3 points, but the IPC schema only enforces at least one for every kind. Existing tests reject unsupported annotation kinds; no focused annotation restart/UI acceptance test was found. |
| CSV and scene files | Places → CSV preview/mapping/Skip/Update/Keep/export (`CsvImportDialog.tsx`, `shared/csv.ts`); Scenes → Export/Import scene file (`ToolsPanel.tsx`, `handlers.ts`) | CSV has 5 MB/5,000-row limits and validation/duplicate/formula-safety/round-trip tests. Scene import uses the main-process chooser with a 20 MB file bound and strict scene schema. No production GeoJSON user chooser, preview, commit or export command was found. Existing provider parsers and `scripts/build-places.mjs` serve different workflows. |
| Event history | Playback / History → Event history (`HistoryDrawer.tsx`), NWS/USGS ingestion/query/retention in `main/store.ts` | `store.test.ts` verifies observation clocks, superseded NWS revisions, quake alias merging, filters and pruning. History is only alert/quake, sorted by source update/event/observed time; `since` means last observed. Repeated updates overwrite the row payload. It is not an as-of revision archive. |
| Current Events and Ops | `Pages.tsx`: Events merges loaded alerts/quakes/cyclones/top fire detections/special squawks; Ops separately aggregates GDACS/EONET/NWS/USGS | These already provide a mixed current register and source-linked trends. Events is capped and current, not a persisted timeline; Ops country/time filters do not constitute geographic watch rules. No need for another register. |
| Recorded movement replay | Replays or Map tools → Replay recorded movement (`PlaybackBar.tsx`); existing track range/snapshot IPC, `store.trackSnapshot`, Globe playback source | Aircraft, military aircraft, vessels and transit share one recorded cursor. Latest fix at/before cursor must be within five minutes; no interpolation or closed-app reconstruction. `layers.test.ts` covers duplicate fixes, expiry, ground flags and old-schema migration. Live data-layer rendering is hidden during replay, while core alerts/quakes and imagery have no shared as-of query. |
| Saved views/scenes | Scenes → Save view stores camera/basemap/layer switches in `saved_views`; scene v1 adds terrain, visual style, annotations and saved views | `layers.test.ts` verifies strict scene fields and credential rejection. Import merges/upserts annotation/view IDs and changes the named display settings; it does not save/restore selection, filters, playback cursor, imagery dates/comparison, open panels or board reference. A scene is a useful existing base, not yet a complete saved investigation. |

The smallest coherent next increments extend the current surfaces. They do not replace CSV, saved places,
watchlists, History, Events, replay, Scenes or camera boards:

1. **GeoJSON annotations first.** Add import preview/commit and export to Map tools using the existing annotation
   store and narrow IPC. Reuse the main chooser/save abstraction; validate again in main. Set file, feature,
   total-vertex and property limits; permit only explicit lon/lat geometry and inert name/color metadata. Support
   Point/LineString/simple Polygon initially only if holes/MultiPolygon receive clear unsupported errors; never
   flatten them. A geometry-preserving schema/render extension is required before claiming their support. Keep
   existing IDs safe with an explicit duplicate policy and atomic batch commit; cancellation/invalid input must
   preserve existing annotations. A first importer is not support for every geospatial file format.
2. **Area rules on existing geometry.** Let an existing saved area become a watch in Tools/Ops, with dataset,
   threshold, enable/pause and in-app notification controls. Persist typed rules and deduplicated transitions;
   reuse the bell and source freshness. A minimal initial rule can match actual quake epicenters inside the area
   with a magnitude threshold. Aircraft entry/exit requires authoritative current source coverage, not an object
   disappearing from a viewport. NWS area overlap requires real polygon/zone geometry intersection, not testing
   an alert centroid or treating a drawn area's points as saved-location centers. Missing/stale coverage must be
   unknown, not a cleared watch. Broader notification/rule requirements stay partial until implemented.
3. **One timeline over recorded data.** Extend History/Events and the existing playback cursor with a bounded,
   source-tagged query for recorded events plus movement. Preserve occurrence, source update and app-observation
   clocks separately, with a stated sorting basis. A unified list can reuse existing history immediately; an
   accurate historical map needs append-only revisions/validity for datasets whose current payload is overwritten.
   Persist only supported normalized observations under retention/index limits; show unrecorded intervals and
   unsynchronized/live-only layers explicitly. Neither current GDACS/EONET records nor NASA advertised dates
   justify inventing historical states.
4. **Investigation state in Scenes.** Extend the existing saved-view/scene workflow with a versioned typed local
   investigation state: selected references, current filters, panel state, imagery configuration and explicit
   live/recorded time. Keep scene v1 import compatible, and keep credentials/private location notes out of shared
   exports. Define merge/replace behavior before applying changes; restore missing/pruned records with visible
   unavailable states. A controlled initial cursor is needed in `PlaybackBar`, whose time is currently internal.
   Existing boards remain references to the same board documents and player, not copied streams or credentials.

Verification should extend `layers.test.ts`, `ipc-security.test.ts`, `store.test.ts`, `monitoring.test.ts` and
the CSV/scene patterns, with focused geometry/rule/timeline/workspace tests as behavior is added. Cover malformed
JSON, coordinate order/ranges, ring closure, holes/date line, aggregate limits, ID conflicts, atomic rollback,
legacy schemas, retention, equal-time ordering, update/cancel revisions and unknown coverage. Rule tests need
repeat/restart deduplication and stale/disappeared-source cases; workspace tests need missing references and
credential/private-note exclusion. Then use an isolated desktop profile to import → inspect → restart → export,
draw/import → enable a rule → refresh without duplicate notices, and save → change time/selection/layout →
restore. Exercise real public records where available and label deliberately injected observations as fixtures.
No claim of current UI completion or live rule/timeline verification follows from this proposed design.

### GeoJSON annotation increment — source and adapted desktop checks verified

The authorized next increment extends Map tools and existing SQLite annotations. `shared/geojsonAnnotations.ts`,
`GeoJsonTools.tsx`, ToolsPanel, three narrow annotation IPC methods, preload/API, existing handlers and
`AtlasStore.importGeoJsonAnnotations` implement a chooser-only preview, explicit valid-only commit and export.
The App callback refreshes the same annotation collection. No new layer/provider, dependency or database
migration is introduced by the GeoJSON increment. Step 2 now also covers local earthquake watches.
Steps 3–4 remain open.

The main-process chooser bounds the actual read to 2 MiB plus one overflow-detection byte, including file growth,
and accepts local regular UTF-8 files. Parser/IPC also enforce actual UTF-8 bytes. Limits are 2,000 source features,
5,000 positions per geometry, 20,000 supported input positions per file and 2,000 stored annotations. Accepted
geometry is 2D WGS84 Point, LineString and Polygon with one closed exterior ring; holes, Multi geometries,
GeometryCollection, explicit CRS, altitude and globe/pole-wrapping rings are rejected with feature-level reasons.
Invalid features are never flattened or repaired into fictional coordinates. Repeated vertices, zero
planar/geodesic area and self-intersection/touching are rejected; lines of zero geographic length (including
equivalent ±180 positions and pole longitudes) are also rejected. FeatureCollection entries must be Features,
while bare geometry is accepted at the root. The intersection sweep has a shared million-pair
budget; overly complex validation is rejected visibly rather than consuming unbounded work. A simple ring with
4,999 vertices plus closure is exercised.

Preview shows rejected features and exact geometry/name duplicate counts; importing while skipping entries
requires an explicit checkbox. Commit reparses in main and deduplicates against the current database inside one
transaction, generates new local IDs and uses insert rather than overwrite. Existing annotations remain intact
on capacity or insertion failure. Only name, color and visibility survive from properties; source IDs, notes,
credentials and arbitrary foreign members are discarded. Custom colors remain editable in the existing select.
Export reads stored annotations through the existing save dialog, emits a standard FeatureCollection with closed,
counterclockwise exterior rings, and exports no saved places/private fields. Export uses the same byte, feature,
coordinate and validation-work bounds as import. A fresh-database round trip of all 2,000 stored pins is tested.
Imported lines and polygon edges retain the existing Cesium annotation renderer's shortest geodesic paths;
RFC 7946 defines straight longitude/latitude segments. This can change the visible shape at high latitude or
across long spans. Add intermediate vertices for the intended shape; import does not densify/reproject geometry.

The format decisions were checked against [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946), especially §§3.1.1,
3.1.4, 3.1.6, 3.2–3.3 and 4. Targeted typecheck passed and **122 tests across GeoJSON, IPC security, layers, store
and CSV suites passed**. New tests cover Unicode/southern/date-line coordinates, invalid dimensions/ranges,
unsupported holes/CRS, geometry/byte/count limits, degenerate/self-crossing rings, safe exports/winding round trip,
commit-time duplicate changes, restart persistence, stored capacity and a real SQLite-trigger failure after the
first insert to prove rollback. The nine-feature fixture is deliberately local test data: three ready, one
duplicate and five rejected features. It is never a production-provider substitution.

The later full source checkpoint passed typecheck, 560 tests/37 suites and the production build. The first native
file-picker attempt exposed a Windows automation-helper limitation: UIA labels were readable, but input geometry
was unavailable and the controls could not be operated. The separate built main/preload/renderer check then
passed with temporary adapters replacing only chooser/save results and shell OS dispatch. Actual bounded UTF-8
reading, IPC, SQLite and UI ran: preview was three ready/one duplicate/five rejected, acknowledgement gated commit,
the original plus three imports survived, repeat import added zero and skipped three, export contained four safe
features, and restart preserved four rows including Unicode names. Renderer errors were empty. This was local
import fixture data, not synthetic provider records. Evidence: [log](geojson-adapter-audit.log),
[preview](screenshots/audit-geojson-preview.png), [final](screenshots/audit-geojson-adapter-scenario.png) and
[restart](screenshots/audit-geojson-restart-scenario.png). Native chooser/default-browser behavior remains unverified.
The final installer includes the source increment and matches the current production output. A repeat against
the final assets also passed every adapter flag and restart check, with zero renderer errors and healthy NWS/USGS
feeds; the same log records that final run. Native picker/browser and installation/upgrade remain unverified.
These checks do not complete broad geospatial formats or the full upgrade objective.

### External Street View and HTTP deadline increments

`shared/streetView.ts`, `StreetViewAction.tsx`, existing Tools/App/Globe center picking and validated
`openExternal` implement an explicit browser action. It uses the current screen-center intersection at click
time, not a stored camera subpoint, and refuses unavailable intersections or view morphs. Only bounded/rounded
WGS84 coordinates enter the Google Maps URL. This fetches no imagery in Atlas Watch, requires no Maps API key
or billing activation and does not establish capture dates or panorama availability. It is partial street-level
access, not an embedded camera/panorama layer. [STREET_VIEW.md](STREET_VIEW.md) records official URL, coverage,
attribution and separate embed/static API conditions. Fixture tests cover worldwide coordinates, ±180, poles,
rounding, URL parameters and existing link boundaries. Built-app QA measured tilted screen center latitude
51.5256808708 versus camera latitude 51.5, refused a looking-past-globe center and obtained a 2D center. The
validated external-link IPC sent the exact rounded picked-center URL to the temporary shell stub. No browser
opened and no Google panorama was copied. Actual default-browser/panorama display remains unverified; the
temporary shell adapter proves the app's handoff request only.

The previously recorded shared HTTP one-hour truncation is repaired in existing infrastructure:
`shared/retryAfter.ts`, `main/feeds/http.ts`, `main/feeds/timing.ts`, `main/core.ts` and `main/layers/manager.ts`.
Delay-seconds and HTTP-date forms retain long waits; the obsolete two-digit year form uses its moving fifty-year
window. Main-process callers share per-origin pauses, including delayed redirects, provider tests and lookups;
concurrent short responses cannot shorten an existing longer pause. The bounded pause map preserves active
deadlines conservatively at capacity. Core/layer scheduling retains the true `nextAttemptAt` and reaches it with
non-overflowing timeout hops; manual refresh/settings/toggles cannot silently shorten publisher waits. Extreme
waits saturate at a serializable JavaScript date rather than causing an immediate retry or invalid timestamp.

`http-retry.test.ts`, `core-retry.test.ts`, `layer-deadlines.test.ts` and `feed-deadlines.test.ts` exercise multi-day
and 35-day waits, enormous values, delayed redirects, concurrent/cross-workflow origin pauses, timer hops,
scheduled resumption and bounded fetcher retry metadata. The full 560-test checkpoint includes these regressions.
No live throttling was induced. Pauses are session state, not persisted across app process relaunch; this is not
a claim of universal provider behavior or complete quota/account-budget management.

## Phase 8 — worldwide audit scope

Weather warnings have independent NWS and DWD sources. The optional DWD layer uses the German complete-status product and keeps original CAP identity, time, language and supplied geometry. The Canada/Norway research retrieved a bilingual Canadian CAP update and an ended Canadian GeoMet item. Norway was researched from official documentation. Neither country has a connected warning adapter. [Regional warning research](REGIONAL_WARNING_RESEARCH.md).

| Check | Current evidence | Status / remaining proof |
|---|---|---|
| Hard-coded U.S. restrictions | Regional NWS/USGS imagery/NIFC/FAA providers labeled; world geometry/providers exist | P: source review and route, not a blanket removal of legitimate U.S. coverage limits. |
| Country-only search | Worldwide offline places and coordinates, existing airports, U.S. Census addresses and optional Google geocoding | The 7,342-place offline catalog includes publisher local-script aliases and region/country qualifiers. Global address-level coverage remains provider-dependent. [Coverage and verification](PROGRESS.md#worldwide-place-search). |
| Coordinates/date line | Shared validation/geodesics, camera filter/AIS split tests, route at 180°, GeoJSON subset, area-watch boundary tests and NOAA METAR | V navigation, bounded GeoJSON workflows, positive/negative 180° watch fixtures and a real METAR viewport returning stations east and west of the date line. Native picker input remains unverified. |
| International airports/ports | Bundled international large/medium airports and regional AIS | P: no equivalent worldwide port directory/confirmed arrivals. |
| Unicode/non-Latin | OSM local-script preference and Unicode text storage/search | V earlier Tokyo evidence, GeoJSON export/import tests and adapted built-app Unicode restart; P other/new workflow round trips. |
| Time zones/date boundaries | UTC ISO domain times, UTC+local formatting; reported AIS ETA has limited source semantics | P: no timezone/date-matched journey workflow. Avoid inventing a year/timezone for incomplete ETA. |
| Units | `shared/units.ts`, display preferences | I/P: core metric/imperial/nautical support exists; audit all detail/tool/export values for consistent user units. |
| Southern hemisphere | Sydney/Cape Town/São Paulo actual tile route | V navigation; does not prove equivalent live data feeds in those cities. |
| Regional adapters/coverage/unavailable states | Provider/layer notes, null fields, source failures | I/P per-adapter verification needed; no U.S. data substituted as another country's result. |
| Requested eleven places | Saved route and `worldwide-audit-after.log` | V map navigation and visual record at New York, London, Frankfurt, Dubai, Tokyo, Singapore, Sydney, Cape Town, São Paulo, Anchorage and 180°. |

## Phase 9 — provider, licensing and AI gates

| Requirement | Current evidence | Status / remaining proof |
|---|---|---|
| Separate code/data/image/model/service permissions | Notices, provider metadata, model credit/index/download checks, reference license review | P/T: catalog metadata is not a complete legal permission record for each service/asset. No new proprietary assets copied. |
| Per-provider docs/commercial conditions/attribution/credentials/coverage/limits/caching/redistribution/billing | `shared/providers.ts`, `layers.ts`, `keyedCameras.ts`, README data table and source modules | P: fields exist across several files, but not all eight items are explicit for every provider (notably cache/redistribution and expanded open camera sources). Consolidate without another settings UI. |
| Keyless core, optional paid configuration and tests | Existing provider catalog, secure save/testing, data adapter gates | I/C/T: real paid-key flows/account entitlements and quota caps are not all verified. |
| Secure secrets, no logs/exports/shared-scene leaks | DPAPI SecretStore, redaction, strict scene schema, IPC tests | I/V bounded tests. Browser map keys are deliberately returned to renderer as scoped public credentials; they cannot be promised secret there. |
| Included build-time credentials | `scripts/builtin-keys.mjs`, `main/credentials.ts`, documented XOR obfuscation | P/T: extractable from distributed main bundle; per-install budget is not aggregate protection. Do not call obfuscation encryption or assume customer commercial entitlement. |
| Grounded AI with sources/times and ordinary spatial calculations | `ai.ts`, `monitoring.ts`, `analyst.ts`, `main/ollama.ts` | I/V prompt tests and deterministic math. Real local model output/source fidelity C. |
| Stale/unknown/untrusted-data handling | Prompt framing, supplied computed results, null/freshness states | I/V fixture checks; no broad model adversarial-output acceptance proof. |
| Validated application commands, no unrestricted shell/network | AI receives no tools; narrow IPC; loopback Ollama | I: no command-executing AI agent exists. Safe absence is not completion of voice/agent workflows. |
| Optional local inference and honest deterministic labels | Settings/AiDialog, deterministic analyst and optional market explanation | I/C real model not exercised in current audit. A scripted analytical answer must stay distinguishable from model output. |

## Phase 10 — quality, security and validation gates

| Requirement | Current evidence | Status / remaining proof |
|---|---|---|
| Context isolation, renderer Node off, sandbox | BrowserWindow options, `app.enableSandbox()`, narrow preload | I/V IPC/security tests and built smoke. Installed-package check remains. |
| Restrictive CSP, safe links, validated destinations, SSRF limits | `security.ts`, `remoteHosts.ts`, `feeds/http.ts`, instance/receiver validation, tests | I/V focused tests. New adapters/players must preserve these boundaries. No TLS/CORS/auth bypass found in inspected changes. |
| Viewport filtering/clustering/label-symbol LOD/incremental updates | Layer manager, vector/label managers, batched vehicles/cameras, entity reconciliation | I/V partial performance/culling checks; per-feature long-session profiling remains. |
| Bounded caches/history, reconnect and cleanup | Store pruning, source caches, worker/player timers, AIS bounds/retries, camera focus/visibility gates | I/V targeted regressions and app-wide media cleanup checks; universal soak test P. |
| Full publisher waits and safe timer range | Shared Retry-After parser/origin cooldown, finite deadline helpers, core/layer timer hops | V regressions for multi-day/35-day/extreme waits, concurrency, redirects, bypass attempts and resumption; no induced live rate-limit check or cross-process pause persistence. |
| Resource-aware rendering/media | Balanced/maximum quality, model budgets, bounded boards and suspended background players | V explicit board concurrency/lifecycle limits; P dedicated low-resource preset and bandwidth/CPU measurements. |
| Same-hardware/scene before/after metrics | Two eleven-view logs, profiling counters | V raw measurements; route durations/network differed, so no general speedup claim. Larger renderer bundle remains. |
| Typecheck/tests/build/integration/desktop/packaged/visual checks | Initial 389/452-test history; later source checkpoint: typecheck, 560 tests/37 suites and production build; final packaging typecheck/build and archive byte comparison | V dated named source/package checks; P native dialogs/browser, install/upgrade, universal performance and remaining requirements. Earlier real-source/native-engine evidence retains its scope. |
| Loading/empty/stale/error/unavailable for every completed feature | Existing feed/player states and test cases | P: verify each new pass/cockpit/board flow against the whole state set before calling it complete. |
| Separate test fixtures; no fake production substitutions | `tests/fixtures`, explicit QA DOM error events; pixel regression synthetic fixture is test-only | I/V inspected scope. Move reusable test fixture data out of production paths; never substitute it in live fetchers. |
| Feature matrix/progress kept current | This audit, PROGRESS, reference review, historical warning | P: older matrices still contain false present-tense absence claims and must not drive implementation. |

## Documentation contradictions and corrections

These are current source/document observations, not requests to recreate the features.

1. `docs/FEATURE_MATRIX.md` has a historical banner, but its old rows and parity summary still say 3D aircraft
   models, expanded cameras, Markets/Community and satellite clouds are missing/excluded. Later source implements
   them. Keep historical evidence dated and provide a clearly current matrix rather than copying old gaps.
2. Resolved during this continuation: `README.md` now separates optional restricted OpenSky/Esri use from excluded
   classic/unauthorized endpoints, matching implemented provider behavior.
3. Resolved during this continuation: Organization now explains the included allowance, saved-key priority and
   absence of fallback after a saved-key failure, matching `CredentialService`.
4. PROGRESS labels its initial inventory as historical and explicitly superseded by later increments. Its
   continuation records pass/board/cockpit/date work and current artifact evidence. Preserve those dated limits;
   an initial missing/deferred row must not override the later source and verification.
5. Resolved during this continuation: the Layers Style note explicitly scopes missing news cards to the global
   map and identifies existing Markets GDELT context and Official bulletins.
6. Camera layer temporal wording was corrected to cover HLS/stills/viewer links. Some expanded open publishers
   still lack dedicated Providers entries/tests despite existing adapters and attribution.
7. The GIBS frozen-date defect is repaired in the current increment using actual per-product DescribeDomains,
   distinct from the preexisting ten-minute weather-satellite lookup. Real client reads reached Terra's listed
   2026-11-11 date and preserved GRACE's last listed 2022-12-01 date. One malformed reversed source period is
   disclosed and skipped. The real UI scenario passed date/gap checks, but raster checks found a separate source
   inconsistency: NASA lists GRACE December 2022 while its actual tile requests return 404. July 2022 tiles return
   PNG 200. Metadata availability therefore must not be labeled proof of raster availability.

### Additional date-repair evidence

Official protocol: [NASA GIBS time dimensions and DescribeDomains](https://nasa-gibs.github.io/gibs-api-docs/access-basics/#time-dimension).
The repair uses the existing allowed WMTS prefix and per-product `all/all.xml` endpoint, rather than downloading
global capabilities on every panel render. Actual integration at 15:21:58 UTC returned 11 Terra ranges (619 bytes)
and 63 valid GRACE ranges with one skipped malformed range (2,041 bytes), using the production helper. The helper
has a 15-second full-exchange timeout, 256 KB response cap, 32-product coalescing session cache, hourly TTL,
minimum one-minute retry and provider Retry-After backoff. The cooldown is shared across metadata products, so
switching products cannot bypass it; cached dates remain available and an uncached selection explains the source
pause. Thirteen new date regressions plus the 11 existing weather satellite tests passed; typecheck passed. The
first real-app scenario exposed a native Window.fetch receiver error, which the client now fixes explicitly;
its regression passes. The second real-app run passed all five strict date-control assertions: fresh Terra date,
Latest equals listed maximum, the known November 2025 gap is skipped, GRACE stays historical, and the malformed
source period is disclosed. Evidence: `imagery-dates-audit-final.log` / `screenshots/audit-imagery-dates-final-scenario.png`.
That run also exposed the GRACE raster/source inconsistency above; some verbose tile errors displaced the result
line in the saved first-60-line log, while the strict harness exit and screenshot remain evidence of the date check.

The existing Imagery panel now subscribes to root's session-scoped actual request counters, shows per-date
loaded/failed/pending counts, separates cancelled requests from failures, and explains that listed dates do not
guarantee imagery. No new tile requests are made for health reporting and no automatic older-date fallback was
added. The expanded `scripts/qa-imagery-dates.js` passed all seven strict assertions with terminal exit 0:
Terra's listed/selected date reached 2026-11-11; the known gap skipped to 2025-11-10; GRACE stayed historical and
disclosed its malformed range; the December source failure was visible; and an explicit July 2022 selection
loaded actual tiles. December recorded 0 loaded / 58 failed (HTTP 404). July had 25 loaded during script reporting
and 52 loaded / 0 failed / 0 pending in the visually inspected success capture, showing the actual red/blue
scientific raster. Renderer errors were empty; NWS and USGS remained healthy. Evidence:
`imagery-dates-raster-audit.log`, `screenshots/audit-imagery-dates-raster-scenario.png` and the final PNG.
The original failure log/screenshot are preserved. Bundled dates remain an explicitly labeled offline snapshot;
they are not silently advanced to yesterday. These results validate the controls and source-failure behavior,
not universal pixel coverage for every product/date.

### Camera resource-limit review

Source review confirmed that a selected camera in App's Data panel stays mounted when opening the narrow Cameras
page. The board opener previously closed only the directory player, so a Data-panel stream could exceed the
board's two-stream allocation. The existing player now has a small shared board-focus gate: a reference-counted
lease suspends normal player bodies while a board owns focus; board-context players start after the lease is
acquired. Unmounting the existing playback body invokes its established HLS, timer and image cleanup, and closing
the board restores the normal player. The same shared visibility hook now disconnects both ordinary and board
media while the document is hidden. No second player or provider was added.

Four focus-lifecycle regressions and the existing board/recovery suites pass (15 targeted tests), and typecheck
passes. The expanded `scripts/qa-camera-boards.js` keeps a real Data-panel video selected behind the modal, checks
the document-wide two-video limit, pause/hide cleanup, restoration and reopened boards. That additional desktop
check passed against the rebuilt bundle: two real board HLS streams advanced 7.3–7.6 seconds, the background
player disconnected and resumed on close, and hiding an ordinary player released media. Evidence:
`camera-boards-focus-audit.log`, `screenshots/audit-camera-boards-focus-scenario.png`. This establishes the tested
concurrency/lifecycle behavior, not a measured bandwidth/CPU budget or a long-session soak.

## Final handoff — all thirteen deliverables

| # | Requested deliverable | Current evidence | Status |
|---|---|---|---|
| 1 | Exact project folder | Top of this file and PROGRESS | V |
| 2 | Launch instructions | README/package scripts; PROGRESS `npm.cmd run dev` / `start` | V dated build; recheck affected commands after later changes |
| 3 | Improvements summary | PROGRESS repair and continuation increments | V named repairs/additions; full objective incomplete |
| 4 | Before/after screenshots | Tokyo in Japanese [before](screenshots/place-search/audit-place-search-before-tokyo-native.png) and [after](screenshots/place-search/audit-place-search-after-tokyo-native.png). The same two-part fire perimeter [before](screenshots/nifc/audit-nifc-before-same-scene.png) and [after](screenshots/nifc/audit-nifc-after-same-scene.png). German warnings in Events [before](screenshots/dwd/audit-dwd-before-events.png) and [after](screenshots/dwd/audit-dwd-live-events.png). Briefing [before](screenshots/packaged-playwright/before-data.png) and [after](screenshots/packaged-playwright/after-visit.png). Replay [before](screenshots/timeline/audit-timeline-before-scenario.png) and [after](screenshots/timeline/audit-timeline-actual-observation.png). Scenes [before](screenshots/scenes/audit-scenes-before-restored.png) and [after offline restart](screenshots/scenes/audit-scenes-restart.png). | V named workflows |
| 5 | Reference comparison/feature matrix | Historical matrix, pinned current main and release source review, this requirement audit | Current main verified. Reference behavior outside the inspected modules and source-specific runtime parity remain open. |
| 6 | Research sources/adopted improvements | Reference review source URLs and root-cause records | V repair scope; P remaining candidate research |
| 7 | Live-verification results | The [live Census address lookup](place-search-live-census-audit.log) returned a match that opened at its published coordinates. Separate [controlled Google and Census checks](place-search-after-audit.log) exercised provider changes, delayed responses and connection diagnostics. The [NIFC desktop check](nifc-after-live-audit.log) matched 65 perimeter features and verified selection and mapped-acreage ranking. [Live DWD package and restart](dwd-packaged-audit.log) matched the publisher's ZIP and exercised a real conditional HTTP 304. [Controlled DWD outages](dwd-conditions.log) and [NWS/USGS conditions](location-evidence-fixtures.log) used synthetic responses. Separate live checks cover [NWS/USGS saved places](location-evidence-packaged.log), [visits](visit-audit.log), [Scenes](scenes-audit.log) and [Timeline](timeline-audit.log). | Verified for the exercised sources. Credential-dependent checks remain open. |
| 8 | Worldwide coverage matrix | The [offline search check](place-search-after-audit.log) selected ten cities across continents plus a date-line coordinate. The [eleven-view map check](worldwide-audit-after.log) covers navigation. The [feature comparison](FEATURE_MATRIX.md) records each provider's geographic limits. Visit briefings currently cover NWS alerts in its service area and worldwide earthquakes in the selected USGS feed. | Individual countries, layers and listing availability need separate provider evidence. |
| 9 | Credentials and exact setup paths | Providers/Camera keys, optional imagery/market/Ollama setup in README/notes | I/C broad real-key check incomplete |
| 10 | Operating costs/licensing constraints | This installer uses customer-supplied credentials for optional paid providers. NWS/USGS and DWD require no paid subscription. German warnings credit Deutscher Wetterdienst under CC BY 4.0 and identify geometry conversion. [DWD terms and source](REGIONAL_WARNING_RESEARCH.md) · [Optional integration setup](../README.md#provider-setup-optional-integrations). | Provider account limits and commercial redistribution rights require separate review for any future publisher-configured build. |
| 11 | Test/build/performance results | 1,045 tests in 66 suites, typecheck and production build passed. [Place index and query timings](place-search-timing.log), [fire perimeter checkpoint](PROGRESS.md#us-fire-perimeters), [DWD parser sample](../tests/fixtures/dwd-cap/source.json), [location matching timings](location-monitoring-timing.log), [visit comparisons](visit-briefing-timing.log), [scene imports](scene-import-timing.log), [timeline storage](timeline-storage-audit.log) and [v0.7.0 store upgrade](store-upgrade-audit.log). | Timings cover the documented local operations. Native file-picker input and external-browser handoff remain unverified. |
| 12 | Installer path | `release/flight-card/Atlas-Watch-Setup-0.7.0.exe`, 145,960,197 bytes, SHA-256 `932D440E35C1290D5E149D872F7A39131EF7A318C62B9A5F5E2957A95D880203`. The [flight-card package audit](flight-card-package.log) matched all 393 production files, the embedded ASAR, notices and both samples. | Unsigned. Windows installation and installer-driven upgrade remain unverified. This Windows Home machine has previous installers, but no provisioned disposable Windows guest was found. |
| 13 | Remaining work/precise blockers | This document and PROGRESS | V gaps recorded. Does not mean implementation objective complete. |

## Completion audit and next actions

The full goal cannot be marked complete from the current evidence. At minimum:

- Preserve the verified pass/board/cockpit additions and their provenance/lifecycle limits; the final live cockpit
  mode-switch repeat remains provider-blocked. Continue missing workflows rather than rebuilding these features.
- Preserve the verified imagery availability/raster-failure workflow and finish broader product/units/playback
  verification, plus the corrected provider/news/credential wording in the existing UI.
- Preserve the verified current package and finish native picker/default-browser checks. Preserve the adapted
  GeoJSON/Street View integration, external-viewer limit and geodesic annotation disclosure rather than claiming
  a full imagery layer or arbitrary-file support.
- Implement or explicitly resolve remaining workflows: date-matched journey information where a suitable source
  can be connected, authorized embedded street imagery, broader transport/weather, geographic watch rules beyond
  USGS epicenters, broader imports, additional historical datasets and the remaining evaluated Phase 7 improvements. Local
  rule/timeline/workspace implementation is not blocked by credentials for unrelated optional providers.
- For voice, logos, external model assets, paid imagery/markets and authenticated sharing, establish actual
  supported dependencies, rights and credentials. Missing credentials block that live check, not unrelated work.
- Re-run appropriate checks after subsequent edits. The continuation installer/build association is verified;
  install/upgrade an isolated packaged build and verify copied prior-version data and packaged origins/assets.
  Produce a new artifact whenever later source changes make the dated checkpoint obsolete.
- Reconcile every table against current files and test results before a completion claim. Fixture tests cannot
  prove live-provider health; eleven map screenshots cannot prove every worldwide data feature.

The original audit wrote only this document. The subsequently assigned date repair extends the existing imagery
workflow and adds a helper, regression fixtures/tests and an app QA scenario; it adds no provider or dependency.
No new account, billing, deployment or external message was created. The full upgrade goal remains active.
