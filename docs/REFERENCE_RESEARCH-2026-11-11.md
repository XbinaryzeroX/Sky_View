# Reference research and duplicate-feature check — 2026-11-11

This is a source review, not a claim of a new live-provider test. Atlas Watch's working implementation takes precedence over older README statements or earlier feature matrices. No reference code, branding, data, or assets were copied during this review.

## Reference version and research limits

**Latest check:** current `main` was successfully verified later on 2026-11-11 at
`aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a`. The pinned-source recheck at the end of this document supersedes
the earlier network/cache limitation below. Earlier failed checks and their release baseline remain dated evidence.

The official [God's Eye View site](https://godseyeview.ai/) links to [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view). The separate GodsView AI screenshot inventory in `FEATURE_MATRIX.md` remains a separate comparison; it does not establish this project's licensing or implementation.

The [release listing](https://github.com/bilawalsidhu/gods-eye-view/releases) currently identifies **v0.3.0**, commit [`72eb3fd`](https://github.com/bilawalsidhu/gods-eye-view/commit/72eb3fd), as the latest published release. Its published highlights include street imagery, phone layouts, translations, compact share links and expanded voice workflows. This is the reproducible release baseline for this review. The [changelog](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/CHANGELOG.md) also has an unreleased section.

The previous Atlas Watch matrix records `027c9616a5245bd5e0725cd03d62fce41d54c691` as the reference inspected on November 8. **That remains a historical inspection pin.** At the first November 11 check, terminal `git ls-remote` failed DNS resolution; the web tool could not access GitHub's branch-ref/commit API; the commits page returned a two-month-old cached representation, and `/commit/main` returned a six-day-old cached `ac28a11` page. Those cached results did not establish current HEAD. The documents sampled in that first review were not a revision-consistent checkout; the later successful pinned-source check below resolves that limitation.

## What already exists in Atlas Watch

Read `FEATURES-v0.4.md` through its v0.7 appendices alongside the source. Its later sections supersede many earlier missing-feature statements. These capabilities must be preserved and improved in place:

| Capability already present | Current source evidence | Existing behavior / verification boundary |
|---|---|---|
| Label hierarchy and controls | `src/renderer/map/placeLabels.ts`, `components/SettingsDialog.tsx` | Zoom/rank hierarchy, collisions, fades, horizon culling, local script and separate vehicle settings already exist. Do not build a second labeling system. |
| Satellite imagery dates and comparison | `src/renderer/map/imageryOverlay.ts`, `components/LayersPanel.tsx`, `data/gibsCatalog.json` | Product/date controls, playback and two-date swipe already exist. Side-by-side synchronized maps would be a separate workflow, not a missing swipe control. |
| Weather satellite frames | `src/shared/geoSatellite.ts`, `src/renderer/components/Globe.tsx` | GOES/Himawari IR/visible modes and actual latest-frame handling already exist. The older table saying satellite clouds are missing is obsolete. Coverage does not include every longitude. |
| Aircraft/vessel symbols and 3D vehicles | `src/shared/vehicleClass.ts`, `src/shared/vehicleDims.ts`, `src/renderer/map/vehicleModels.ts`, `vehicleMeshes.ts`, `shownModels.ts` | Type/category symbols, procedural 3D models and stable model selection already exist. A new generic 3D-model feature would duplicate them. |
| Optional external model pack | `src/shared/modelPack.ts`, `src/renderer/map/modelPack.ts`, `scripts/fetch-models.mjs`, `scripts/import-models.mjs` | Download/import/index/attribution pipeline exists. Actual external assets require the owner's authorized download and visual orientation checks; a pipeline test does not prove those assets are installed. |
| Sea-level correction | `src/shared/geoid.ts`, `src/main/geoid.ts`, `src/renderer/map/trailHeights.ts`, `groundRetry.ts` | Geoid offsets and terrain-dependent vehicle/trail height handling already exist. Google Photoreal verification needs configured access. |
| Real camera workflow | `src/renderer/components/CameraPlayer.tsx`, `src/renderer/lib/cameraRecovery.ts`, `src/shared/cameraSources.ts`, `keyedCameras.ts` | HLS/stills/official links, retries, directory filters and favorites are implemented. Catalogs extend beyond the old Caltrans/Fintraffic comparison. |
| Expanded regional camera adapters | `src/shared/cameraSources.ts`, `src/main/layers/fetchers.ts` | TfL, Hong Kong, DriveBC and Québec adapters exist; Québec uses the official viewer link. Do not turn a webpage into a supposed video URL. |
| Optional keyed camera systems | `src/shared/keyedCameras.ts`, `src/shared/providers.ts`, `src/main/layers/fetchers.ts` | 22-system configuration/normalization/reload paths already exist. Actual credentials and accepted publisher terms remain necessary; tests are not real-key verification. |
| Journey and identification enrichment | `src/shared/route.ts`, `vehicleInfo.ts`, `components/VehicleExtras.tsx` | Reported route and attributed-photo workflows exist; no source-backed schedule means unavailable, not an inferred destination. |
| Source monitor, incidents and briefings | `src/shared/incidents.ts`, `src/renderer/components/Pages.tsx`, `src/shared/briefing.ts` | Source health, incident register/trends/countries and exportable briefing workflows exist. Improve these instead of adding another competing dashboard. |
| Markets and community | `src/main/markets.ts`, `lemmy.ts`, matching shared modules and renderer pages | Both have real adapter implementations and tests. Earlier "missing" rows are obsolete. Live credentials/writes and plan-specific data rights remain separate verification questions. |
| Core tools and persistence | `src/main/store.ts`, `components/ToolsPanel.tsx`, `PlaybackBar.tsx`, `Pages.tsx` | Saved places, watchlist, boards, scene files, annotations, measurement and recorded-only replay already exist. Preserve database/settings and recording semantics. |

The paths above are relative to the project root, `C:\Users\infob\Documents\Claude\Sky_View`. This research did not independently replay every older visual or live claim in `FEATURES-v0.4.md`.

## Reference evidence and remaining candidates

The following candidate table records the **initial** Atlas source review. Subsequent increments implemented
satellite passes, cockpit perspective, bounded camera boards, GeoJSON annotations and local USGS earthquake-area
watches. Its absence/repair wording is historical and must not trigger duplicate implementation. Current source,
[PROGRESS.md](PROGRESS.md), [REQUIREMENTS_AUDIT.md](REQUIREMENTS_AUDIT.md) and the dated live logs supersede it.

Reference implementation, not just its marketing, was sampled: [satellite layer composition](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/src/layers/satellites/index.js) exposes pass/orbit methods, while [camera source](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/src/layers/cctv/source.js) separates catalog, health, frame and media access. Its [camera server](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/server/providers/cctv.js) distinguishes registered media, upstream images and synthetic/Street View fallback provenance and bounds frame caches. Those fallbacks must not be presented as live video in Atlas Watch.

| Candidate | Current Atlas evidence / gap | Benefit and priority | Dependency / coverage / cost | Work and verification |
|---|---|---|---|---|
| Repair existing AIS streaming | `AisStreamClient` already exists. Subscription filter omits the class-B static message its handler supports; viewport replacements have no client-side cadence control; static cache lacks the position cache's bound; socket callbacks need lifecycle review. | First priority: reliable existing vessel workflow. | Existing customer AISStream key; receiver-dependent coverage. | Repair in place. Socket fixtures should exercise replacement cadence, reconnect/stop races, static-vs-position timestamps and antimeridian boxes. Real-key validation remains separate. |
| Refresh stale feature documentation | `README.md` and early matrix sections disagree with later source and v0.7 notes. | Prevent duplicate implementations and misleading setup guidance. | Local documentation; no service cost. | Link the current inventory, remove superseded absence claims and preserve dated verification evidence. |
| Satellite pass prediction | Existing SGP4 positions/orbit display; no pass workflow found in current source search. Reference exposes pass methods. | Useful local calculation after core repairs. | Existing orbital elements; worldwide calculation, predictions rather than observations. | Rise/culmination/set solver with observer choice, UTC/local display, stale-element note; independent ephemeris checks and polar/no-pass cases. |
| Cockpit perspective | Existing follow/trails and 3D vehicles; no dedicated cockpit workflow found. | Optional navigation improvement, lower priority than data reliability. | Existing positions and Cesium; no new paid provider. | Extend existing tracking camera, handle missing altitude/heading and lost fixes; visual checks at ground/airborne and terrain transitions. |
| Broader observed weather | Satellite overlay, radar, METAR and NHC exist. Wind animation and lightning remain candidates rather than completed features. | Useful weather context, after core repairs. | Reference [data-source inventory](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/DATA_SOURCES.md) identifies GFS/ECMWF and nowCOAST products; regional limits vary. | Read official product docs before adding adapters. Keep forecast, observed radar, cloud temperature and derived lightning density distinct; validate units/time/coverage. |
| Multi-camera boards | General boards/favorites exist; current player is a single-camera workflow. | Useful monitoring with a real resource budget. | Existing authorized cameras; bandwidth/CPU scale with players. | Reuse player lifecycle, cap active video count, pause hidden players and show per-camera health. Measure the same scene before/after. Deferred until single-player verification is sound. |
| GeoJSON import / watch areas | CSV places and drawn areas exist; imported geospatial workspaces/rule-driven areas are not established by current source review. | Potential investigation workflow, not justification for another Places page. | Local files and existing datasets; no mandatory paid API. | Confirm exact supported geometry and persistence scope before implementation; bound files/vertices and test antimeridian/holes/Unicode. |
| Offline voice | Optional Ollama explanations exist; speech input is not an existing end-to-end workflow. | Lower priority; adds deployment/runtime complexity. | A separately installed local speech engine or explicit metered cloud account. | Defer until a supported engine, model rights, resource budget and command validation are chosen. |

These are candidates and repair findings, not newly completed features. No new accounts, billing, services, deployments or public messages were created during research.

## Provider and asset boundaries

The reference [LICENSE](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/LICENSE) grants MIT rights to its code but expressly excludes third-party data/assets. It calls out noncommercial TeleGeography and Bhote Koshi event material, ODbL extracts and individually licensed models. Its [model attribution](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/public/models/README.md) records the source, creator, license and modifications for each asset; an applicable credit must accompany any compatible model reuse. Its [third-party notices](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/THIRD_PARTY_NOTICES.md) separately document Web RTL-SDR, Signals, MapillaryJS and RxJS. None of this authorizes copying proprietary branding or unrelated GodsView AI assets.

The reference [security model](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/SECURITY.md) separates server secrets from intentionally public browser credentials and uses registered/fixed destinations rather than an unrestricted URL proxy. Atlas Watch should retain its own Electron isolation, validated IPC and exact network boundaries; the reference's web-server architecture does not require an Electron rewrite.

Official [AISStream documentation](https://aisstream.io/documentation) confirms replacement subscriptions, a maximum of one update per second per connection, supported `StaticDataReport` and `ExtendedClassBPositionReport` types, binary UTF-8 JSON frames, and exponential-backoff reconnect guidance. Invalid/late subscriptions and rapid replacement can close a connection. The subscription should stay in main with the customer's key. Documentation is not evidence that a real customer connection was exercised here.

The reference's [open camera-terms issue #1596](https://github.com/bilawalsidhu/gods-eye-view/issues/1596) is an implementation warning, not a license grant: publicly viewable camera feeds can have agreement, personal-use or embedding restrictions. Atlas Watch already has provider-specific terms/setup fields; keep those facts and authorization tied to the existing adapters instead of blindly importing every reference camera pack.

## Verification record

- Web-accessible primary reference: site, repository README, release listing/commit, changelog, data-source list, license, model credits, software notices, security document, relevant issue and sampled source modules read.
- Local duplicate check: current source filenames/modules, camera/stream implementation, provider catalog, `FEATURE_MATRIX.md`, and `FEATURES-v0.4.md` including later appendices read.
- At this initial checkpoint upstream HEAD was **unverified**, for the cache/network reasons above; the later pinned-source recheck below establishes it.
- Live Atlas integrations, packaged app, FPS/memory and current screenshots: **not exercised by this research subtask**. Use the main task's dated test/smoke record for those results.
- Prior successful screenshots/counts/timings in older docs remain historical observations; they are not copied as current counts, worldwide coverage guarantees or new performance measurements.

## Continued reliability research

[RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3) defines Retry-After as integer
delay-seconds or an HTTP date, including delayed redirects; it imposes no one-hour maximum.
[§5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7) requires UTC and a moving fifty-year rule for
obsolete two-digit dates. [Node timer documentation](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args)
states that a timeout above 2,147,483,647 ms is reduced to 1 ms. These sources justify repairing the existing
parser, shared request boundary and feed/layer timers. The resulting tests distinguish a publisher deadline from
bounded timer hops. `http-retry-integration.log` records a controlled native-fetch/loopback check, not a live public
provider throttling test. Cooldown state is session-local; restarting the process does not preserve it.

See [Street View linking research](STREET_VIEW.md) for the separately evaluated external-viewer workflow and its
rights/coverage limits. An official viewer link does not establish embedding or redistribution rights.

## Earlier unsuccessful freshness recheck — 2026-11-11

A second, earlier primary-source check did **not** establish current `main` HEAD or a revision-consistent module
comparison. `git ls-remote https://github.com/bilawalsidhu/gods-eye-view.git HEAD refs/heads/main
refs/tags/v0.3.0` failed with `Could not resolve host: github.com`. The web tool could not access the official
GitHub commit, branch-ref or latest-release API endpoints. Its `commits/main.atom` request failed because
`application/atom+xml` is unsupported. The repository tree, branches and commit-history pages were explicitly
marked as crawled two months ago; those cached pages are not fresh branch evidence.

The official [latest-release URL](https://github.com/bilawalsidhu/gods-eye-view/releases/latest), marked as crawled
today by the web tool, again resolved to **v0.3.0** (displayed release date `28 Oct 05:19`; no timezone was exposed
in the tool's rendered text). Its commit link
resolved to the full release pin
[`72eb3fdc739991a1286b7f1251de908e9744bb2a`](https://github.com/bilawalsidhu/gods-eye-view/commit/72eb3fdc739991a1286b7f1251de908e9744bb2a).
The accessible [raw main package manifest](https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/package.json)
still reports version `0.3.0`; a package version does not establish a branch SHA. The published release description
continues to identify street imagery, phone layouts, translations and share/voice changes already summarized above.
At that checkpoint no newer release or changed-module delta was verified. The historical November 8 pin remained
historical, and current HEAD was unverified. That unsuccessful recheck created no checkout or product changes.

## Successful pinned-source recheck — 2026-11-11

Read-only access to official GitHub succeeded after the earlier restricted-network/DNS failures. Two successful
`git ls-remote` checks agreed on HEAD/main and the peeled release tag. An isolated `%TEMP%` Git object repository,
created with `--filter=blob:none --no-checkout`, supplied revision-pinned source reads and snapshot diffs. No npm
install, reference script, build or application was run. Reference code/assets were not incorporated into Atlas
Watch, and no account, billing, deployment or external message was created.

| Reference object | Exact value and evidence |
|---|---|
| Verified HEAD and `refs/heads/main` | [`aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a`](https://github.com/bilawalsidhu/gods-eye-view/commit/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a), commit time 2026-11-11 16:24:53 UTC; merge of PR #1531, FIRMS age rounding |
| `refs/tags/v0.3.0` object | `b5cf313b6f8ab8ac56480d66f47ebbcd4a26b19c`, an annotated-tag object, not the release's source commit |
| Peeled v0.3.0 source commit | [`72eb3fdc739991a1286b7f1251de908e9744bb2a`](https://github.com/bilawalsidhu/gods-eye-view/commit/72eb3fdc739991a1286b7f1251de908e9744bb2a) |
| Latest published release | Official GitHub `releases/latest` API returned [v0.3.0](https://github.com/bilawalsidhu/gods-eye-view/releases/tag/v0.3.0), published 2026-10-28 05:19:57 UTC, not a prerelease. `target_commitish: main` is release metadata, not a replacement for the peeled commit. |
| Release-to-HEAD snapshot delta | `git diff --shortstat` between the exact commits: 2,005 files changed, 295,711 insertions, 29,846 deletions. This counts file-content changes, not new features or commits. The pinned package still says 0.3.0. |

The following is an implementation comparison, **not a reference runtime/provider verification**. All source
links are pinned to the verified commit, avoiding mutable `main` links for the new conclusions.

| Pinned source finding | Actual change or limit | Duplicate-safe implication for Atlas Watch |
|---|---|---|
| [README](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/README.md), [package](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/package.json), Vue/Pinia panel files and build-loader delta | The branch contains a substantial Vue/Pinia UI migration and many later source/translation/reliability changes despite retaining version 0.3.0. The newest merge itself is a narrow FIRMS cached-age rounding fix. | A package version is not parity evidence. Keep Atlas's existing Electron/React architecture and fixed runtime boundaries; no reference UI rewrite is justified. |
| New [world clock](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/time/worldClock.js) and [snapshot timeline](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/time/snapshotTimeline.js); new WorldTimeline Vue panel | Sky/satellites/launches/weather share a cursor. Live-contact layers follow it only when their source declares snapshot coverage/step capability; other sources stay live. Snapshot loads are cancellable, out-of-coverage data clears, and buffering has a bounded wait. This is not proof of a universal historical archive. | Extend existing PlaybackBar/History/Events when implementing a unified timeline. Preserve Atlas's recorded-only fixes and label unsynchronized/live-only layers; do not invent source history. |
| [Geographic file loader](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/data/geoFileImport.js), [file UI](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/ui/geoFileImport.js), new GeoImport Vue presentation | Existing import modules changed since release; they support session-local GeoJSON/KML/KMZ/GPX, not merely a picker label. Bounds include 12 files, 50 MiB/file, 120 MiB KMZ inflation, 20,000 entities and 250,000 positions/file. KML remote/network and unused metadata elements are stripped. | Atlas already has a persistent bounded GeoJSON annotation workflow. Broader formats/holes/Multi geometry remain genuine scope differences, not grounds for another importer or replacement of saved annotations. Reference limits are not performance measurements for Atlas. |
| New [area store](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/data/areaStore.js), area geometry/resolver and [area actions](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/voice/areaActions.js) | Session-local stable area handles support named/drawn/imported outlines and region-scoped analysis. The store uses bounded LRU/query maps with pinned-record exceptions. These sampled modules do not establish a persisted configurable earthquake-notification lifecycle. | Atlas's new annotation-linked USGS rules, epochs, read state, dedup and bounded event evidence are a separate implemented workflow; preserve it. Broader rules and saved investigation state still need their own specification and checks. |
| [Observed weather proxy](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/server/providers/weather.js), [weather source](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/layers/weather/source.js), new weather display metadata | Source/render/clock modules changed; manifests validate explicit times/bounds and cap frame counts. Products distinguish CONUS radar, global infrared mosaic with polar gaps/source latency, regional GOES infrared and 15-minute ground-network lightning density in the Americas/Pacific. Lightning density is not individual satellite flashes. Optional manifest fields provide product-specific units, coverage and credit. | Reuse Atlas radar/METAR/GOES/Himawari/imagery controls. Broader observed lightning/forecast wind are real remaining candidates, with explicit time/units/coverage; a colored animation is not an observation. Vendor/service rights and live availability still require primary-product review. |
| [Data-source inventory](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/DATA_SOURCES.md), wind modules, new StreetLevel Vue panel | Describes distinct GFS and ECMWF forecast products and multiple street-imagery sources. Street-level panel/controls changed; this does not turn Atlas's external Google link into an embedded panorama layer. | Keep the current external-viewer limitation. Any embedded source, new format or forecast adapter needs a scoped rights/cost/destination/credential review and live check. |

### Security, assets and unresolved access limits at the verified pin

The current [LICENSE](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/LICENSE),
[software notices](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/THIRD_PARTY_NOTICES.md)
and [model credits](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/public/models/README.md)
were read at the exact commit. These files and the sampled model/event asset paths have no release-to-HEAD
delta. The MIT grant remains source-code-only; the license separately identifies noncommercial cable/flood data,
ODbL extracts and individually licensed/attributed models. Their inclusion in a source repository does not grant
Atlas commercial redistribution or imagery reuse rights.

The pinned [security document](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/SECURITY.md)
has real updates: explicit HLS playlist/segment caps, opt-in click-gated Québec media, more detailed network/cost
boundaries and click-gated billed Street View. It still warns that per-process throttles are not billing caps and
that client/server credentials have distinct exposure/entitlement limits. Atlas's existing isolation, restricted
IPC, encrypted secrets and destination validation should remain intact; no broader remote-code/frame grant was added.

Official GitHub issue API checks also succeeded. [#1596](https://github.com/bilawalsidhu/gods-eye-view/issues/1596)
remains open: camera-source terms should be recorded structurally, not treated as permission from a URL. Current
open reports [#1668](https://github.com/bilawalsidhu/gods-eye-view/issues/1668) and
[#1667](https://github.com/bilawalsidhu/gods-eye-view/issues/1667) describe missing operator configuration for
OpenFreeMap and default basemap/terrain/font destinations. These are upstream issue reports, not a freshly
reproduced runtime test or a license determination. Their relevant lesson is that self-hosting does not itself
prove offline operation, configurable destinations or absence of third-party requests.

**Resolved blocker:** current reference HEAD and an exact release-to-HEAD source comparison are now established;
the earlier DNS/cache limitation no longer blocks this audit. **Remaining boundaries:** reference runtime/tests
and all upstream providers were not executed here; particular assets/providers still need their own rights,
credentials and live checks. Those limits do not block unrelated local implementation. This research completes
the current-source recheck, not Atlas Watch's full upgrade objective.

## Saved-investigation comparison at the pinned revision — 2026-11-11

The following official source files were read at `aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a`.
These are implementation observations, not a reference runtime test or a new HEAD claim. No reference code,
camera feeds, provider feeds or reference scripts were executed.

| Pinned file and function | What the inspected path actually preserves or restores |
|---|---|
| [`src/share/viewCodec.js` — `normalizeShareViewState`, `encodeShareView`](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/share/viewCodec.js#L676) | Camera coordinates/angles, map stack, visual settings, registered layer state/options, panel state, a supported tracked-entity ID/follow offset/last-known fix, shared-at time and world-clock time. The compact link normalizes defaults, quantizes coordinates to 0.0001 degrees and world time to seconds, then writes a versioned payload/checksum. It does not serialize a complete archived hazard reply in those fields. |
| [`src/ui/shareRestoration.js` — `applySharedWorldTime`, `_beginNavigatedShareRestore`](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/ui/shareRestoration.js#L361) | Pauses/seeks the shared clock, supersedes prior initial restoration, claims a navigation token and coordinates asynchronous layer-state restoration with the camera/tracking restore path. This is a restoration transaction; a shared timestamp alone does not establish that the receiving session has the matching observations. |
| [`src/scenes/director.js` — `captureShot`, `_captureLayerStates`, `_saveProject`](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/scenes/director.js#L974) | Captures a shot's camera, visual state and registered layers' enabled flags/parameters, with duration/hold settings. The validated project is stored in localStorage. These are authored scene/shot documents, rather than evidence that an arbitrary alert or earthquake selection was archived. |
| [`src/scenes/director.js` — `_loadShot`, `_applyLayerStates`, `_setCameraView`](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/scenes/director.js#L1109) | Claims camera ownership, cancels older scene travel, uses a generation/abort token, applies visual/layer state and reports refused layers. Seeking can set the camera and scene clock directly. Stored shot angles are converted from degrees to Cesium radians in `_setCameraView`; Atlas Watch's existing camera documents already store radians. |
| [`src/scenes/director.js` — `exportProject`, `importProjectFile`](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/scenes/director.js#L2123) | Exports a validated JSON project. Import normalizes/validates before replacing the current project, checks cancellation/generation and reconciles separately supplied bundle assets. This sampled project path should not be confused with a raw worldwide observation-history export. |

For Atlas Watch, the useful comparison is coordinated restore/cancellation and explicit missing-data outcomes.
Its existing Scenes/SQLite workflow should remain the entry point. A recorded investigation needs its own exact
millisecond cursor, source scope, recorded selection and filters; neither the reference's second-precision public
link nor its degree-based shot angles should silently replace Atlas Watch's existing representations.

## Packaged GUI verification alternatives — recommendation only

The failed Windows bridge relied on a foreground-window lookup. A separately scoped native UI Automation reader
could start from the spawned window's actual HWND and inspect only that window's subtree, rather than the desktop
or foreground window. Microsoft's [UI Automation documentation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/obtaining-ui-automation-elements)
documents `AutomationElement.FromHandle` and bounded subtree searches. This is a plausible independent diagnostic,
not a tested fix for the bridge or proof of WebGL rendering. No alternate native UI reader was run in this review.

A technically stronger instrumented option is [Playwright's Electron API](https://playwright.dev/docs/api/class-electron):
`electron.launch({ executablePath: <actual unpacked executable>, ... })` can expose its first window for DOM and
screenshot checks without relying on the Windows foreground bridge. [Electron's testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
explains that this uses remote debugging/CDP, and Playwright documents the Node CLI inspect-fuse prerequisite.
That would be a different, explicitly instrumented acceptance scope from the existing no-debugger normal launch.
It is not a reason to enable production test hooks, change security fuses, install dependencies or repeat the
failed bridge unchanged. This was a recommendation at the time of the Scenes review. During the subsequent
briefing review, an isolated Playwright launch verified both report previews in the packaged executable using
the existing local tooling. [Packaged window check](packaged-playwright-after.log).

## Visits and source-linked briefings

Atlas Watch already calculates changes between feed refreshes, keeps a bounded local revision archive and exports location briefings. The Phase 7 request asks what changed since the user last ran the app. The existing Analyst interpreted that question as a refresh comparison. That could cover a few minutes within one run even when the previous visit was days earlier. The pinned reference's snapshot timeline establishes time navigation. A cross-visit report is a separate improvement requested for Atlas Watch. [Reference timeline at the inspected commit](https://github.com/bilawalsidhu/gods-eye-view/blob/aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a/src/time/snapshotTimeline.js).

NWS publishes active alerts through its public API. USGS publishes summary feeds for specified time windows and magnitude thresholds. A record can leave a reply when the window advances. The report therefore compares source IDs and normalized revisions from two retained replies for the same query. It includes both observation times and calls a missing ID “no longer returned.” The local comparison introduces no provider requests, credentials, or new data license. [NWS API documentation](https://www.weather.gov/documentation/services-web-api) and [USGS GeoJSON fields and feed windows](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).

## Evidence for saved-location counts

NWS serves point and alert data separately. Atlas Watch can evaluate a supplied polygon directly. For an alert defined by zones, a point lookup that returns a forecast zone can confirm a matching forecast-zone ID. It supplies no evidence about a missing county or fire-weather zone. USGS publishes separate time windows and magnitude categories, plus a count in its GeoJSON metadata. The app checks that count against the number of original source features before normalization or merging network aliases. An unavailable or incomplete reply cannot establish that every saved place had zero matches. [NWS API and point lookup](https://www.weather.gov/documentation/services-web-api) and [USGS summary reply format](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).

The previous app already evaluated saved places, showed per-source freshness, and generated location reports. During the offline baseline it visibly disagreed with itself about the same place. The report showed numeric totals while the detail pane marked the sources unavailable. The repair preserves the existing workflow and qualifies each source independently. [Offline baseline evidence](location-evidence-before.log).
