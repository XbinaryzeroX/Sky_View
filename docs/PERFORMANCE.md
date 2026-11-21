# Performance: GPU use and tile loading (v0.4.1, measured 2026-11-09)

Measured with the built app on the secondary monitor over a fixed 7-view route: globe, Southern California coast (200 km, tilted), SF Bay (40 km), Manhattan (1.5 km), Tokyo (60 km), Alps (80 km), Gulf of California (300 km). The harness (`ATLAS_WATCH_SMOKE_VIEWS`) reports per-view settle time, main-thread long tasks (over 50 ms), CPU seconds per Chromium process, the GPU feature status, and optionally a V8 CPU profile (`ATLAS_WATCH_SMOKE_CPUPROFILE`).

| Metric | Before | After |
|---|---|---|
| Main-thread blocking (sum of long tasks) | 140 s (487 tasks) | **2.9 s** (34 tasks) |
| Longest single freeze | 4.0 s | **0.16 s** |
| App window (renderer) CPU time | 139 s | 92 s |
| Time to finish the route | 244 s | 141 s |
| Views that never fully loaded | 0–1 per run | 0 |
| GPU rasterization / video decode | enabled / software | **forced on / hardware** |

Settle times vary a lot with network speed (the same view varied 2–4× between runs), so the main-thread numbers are the reliable comparison.

## What was changed, and why (from the CPU profile)

1. **Boundary lines** (~26 s of main-thread time per session). Country and state borders were thousands of separate polylines, and Cesium re-derived a material key for every line on every frame. They are now one static batched primitive per set, built in Cesium's workers and drawn in one call.
2. **Ocean-mask hand-off to workers** (66 s, introduced and fixed in this pass). Copying a GPU-backed bitmap to a worker forces a synchronous GPU readback. It is now transferred.
3. **Airports** (part of ~18 s of entity evaluation). 5,282 static airports were entities re-evaluated every frame. They are now plain point and label primitives, with picking unchanged.
4. **Terrain decoding.** Height-PNG decoding and sea-mask readback run in a worker pool (2–4 workers, with timeouts and crash recovery).
5. **USGS imagery.** Real imagery tiles skip all CPU pixel work. Black no-data fill is removed by Cesium's `colorToAlpha` shader on the GPU. The offshore-water cut is a GPU canvas composite, done only where a 24×24 coverage grid says the tile has offshore water.
6. **Offshore mask.** Built entirely with canvas compositing (GPU) instead of a per-pixel loop.
7. **GIBS close-ups.** Child tiles are GPU-scaled crops of the smoothed parent; the per-child pixel pass was removed.
8. **Tile loading.** Larger GPU tile cache (600), sibling preloading, up to 24 parallel requests per tile host, and 20 s timeouts on every tile fetch so a stalled request can't leave a tile loading forever.
9. **GPU selection.** `force_high_performance_gpu`, GPU rasterization, zero-copy uploads, WebGL `powerPreference: high-performance`, and hardware video decoding.
10. **Render errors** are recorded in Diagnostics and the render loop restarts instead of freezing.

## Known limits

- Public camera video: whether a Caltrans stream plays smoothly depends on the publisher's stream at that moment. Back-to-back runs gave 21 s with the GPU decoder and 0 s with the software decoder out of 60 s. The player reconnects with backoff (0.4–8 s) and falls back to the still image.
- The GPU process's CPU time varies with what is drawn. The goal was to move pixel work off the main thread and onto the GPU or workers, not to minimise any single number.


## 2026-11-18: Frame rate with ~11,500 aircraft and ~9,800 cameras

**Reported.** About 10 fps with all aircraft loaded. Reproduced on this PC with the owner's display settings (read-only from the profile; Photoreal 3D left out because it bills the owner's Google key): layers aircraft, cameras, cables, plate-reader cameras; maximum render quality, smoothed motion, 3D vehicle models, buildings with facades, street labels, traffic simulation, worldwide aircraft (OpenSky snapshot).

**Measured** with a new test hook, `__atlasDebug.measureFrames(ms)`, which turns the camera slowly and counts rendered frames and per-frame main-thread time (built app, LED monitor, throwaway profile, same route before and after):

| View (owner's settings) | Before | After |
|---|---|---|
| World, 12,000 km, 11,500 aircraft | 16.7–22 fps (31 ms main thread/frame) | 251–260 fps (1.9 ms) |
| Europe, 1,500 km, tilted | 10.8–15.7 fps (41–63 ms) | 117–158 fps (5–6.5 ms) |
| London, 25 km, tilted | 8.2 fps (80 ms) | 177–232 fps (1.9–2.5 ms) |

The aircraft were never the cost: 11,588 of them were already one batched billboard draw (263 fps with cameras off).

**Causes found in the CPU profile.**
1. **Cameras as entities.** 9,845 camera entities with clustering cost 10–20 ms per frame, even with the layer hidden. They are now one GPU billboard batch that shrinks and fades with distance instead of clustering; the selected camera gets the only label. Picking, selection and details are unchanged (checked: five Helsinki cameras picked to their own ids; the details panel opened).
2. **Horizon culling wrote every marker four times a second** (added earlier the same day to stop markers showing through the earth). Writing an entity graphic raises Cesium change events and re-clusters the layer even when the value is unchanged. It now writes only when a marker crosses the horizon, and skips hidden layers.

**Limits.** 3D vehicle models still cost frames close up (London: 184 fps with models, 219 without). Camera icons no longer group into numbered clusters when zoomed out. Frame rates depend on this PC's GPU; the GPU process's CPU time rose (80 s → 189 s over the route), as expected when the GPU draws far more frames.


## 2026-11-18: Zooming in close, and aircraft disappearing

**Reported.** Zooming in for detail lags, and the air traffic sometimes disappears.

**Measured** with a second test hook, `__atlasDebug.measureZoom(lat, lon, fromH, toH, ms)`: a 12 s zoom over Heathrow from 600 km to 5 km at a 60° tilt, counting frame gaps and how many aircraft stay drawn. The aircraft came from a loopback-only stand-in receiver (2,500 moving test aircraft on 127.0.0.1) because adsb.lol was rate-limiting this PC; owner's display settings otherwise.

| Zoom pass, 3D models on | Worst frame before | After | Frames over 50 ms before → after |
|---|---|---|---|
| First zoom in | 1,742 ms | 523 ms | 18 → 29 |
| Zoom out | 345 ms | 135 ms | 16 → 33 |
| Second zoom in | 1,421 ms | 116 ms | 9 → 25 |
| Zoom in, models off (unchanged) | 57 ms | 57 ms | 1 → 1 |

The freezes came from starting up to 150 aircraft models at once when they came into range. A pass now starts at most 4 new models and keeps at most 8 loading; the rest start on later passes (nearest first, the selected aircraft first of all). The long single freezes became more, much shorter, frames. The remaining 523 ms happens once, on the first zoom, while a model type is built for the first time.

**Why aircraft disappeared.** Three causes in the aircraft requests, not the renderer:
1. Every zoom step counted as a new view and asked adsb.lol again (up to every 8 s), which led adsb.lol to rate-limit the app; live positions then went stale and were hidden. A zoom or small pan inside the circle the last request already covered no longer sends a request; the regular poll still refreshes it.
2. The request radius came from the camera height only (25 nm when close), so a tilted view lost the aircraft toward its horizon on every zoom-in. It now also covers the visible box (up to adsb.lol's 250 nm).
3. While adsb.lol asks the app to wait, the view now keeps the OpenSky worldwide snapshot already held (when Worldwide aircraft is on), drawn as a snapshot with its time in the layer note; no new request is sent for it.


## 2026-11-18 (late): Zooming into Manhattan with ~9,800 cameras

**Reported.** The app crashed while zooming into New York with the cameras layer on.

**What the PC recorded.** No app crash report: the app had no handler for a dead renderer or GPU process, so nothing was written. The Windows error log for the evening holds only re-reported October GPU watchdog dumps (LiveKernelEvent 193). RTX 3060 with 12 GB and 63 GB RAM, so device memory is not short.

**Reproduced** with the owner's display settings except Photoreal 3D (it bills the Google key): built app, LED monitor, throwaway profile, 9,848 cameras (388 in Midtown), maximum render quality, buildings with facades, 3D vehicle models, traffic simulation. Route: `measureZoom(40.758, -73.985, 60 km → 250 m, 12 s)` at 60° tilt. No crash without Photoreal, but long freezes:

| Midtown zoom, 60 km → 250 m | Before (2 runs) | After (2 runs) |
|---|---|---|
| Frame rate during the zoom | 40 / 36.6 fps | 70.9 / 67.1 fps |
| Worst single frame | 3,395 / 3,544 ms | 490 / 478 ms |
| Frames over 50 ms | 44 / 47 | 28 / 32 |

CPU profile of the zoom (self time, 1 ms sampling): shader program linking 7.9 s (unchanged, inside Cesium), USGS shoreline blend pixel readback 1.7 s (now 0), ground-height ray picks 1.3 s (now 0.4 s). Causes fixed:

- **USGS shoreline blend** (`usgsProvider.ts`): read every 256 px tile back from the canvas, and its `willReadFrequently` canvas moved the 768 px blur onto the CPU. It is now canvas compositing only (two additive draws for ×4, then invert), so it stays on the GPU. The Hudson shore at 2.5 km looks the same: smooth photo-to-water edge, piers intact.
- **Camera overlay** (`CameraCards.tsx`): below 4 km it asked the globe for the ground height under every one of the 9,848 cameras on every frame. Most were never cached, because their tiles were not loaded. A flat-earth distance test (`camerasNear`) now keeps only cameras within 4 km, and at most 24 lookups run per frame.

Street-level panning (12 Manhattan points × 3 laps, 162 s): JS heap stayed between 0.68 and 1.63 GB with no upward trend, and the renderer process stayed at 2.2–2.7 GB, so no leak was seen. Panning still has occasional long frames (worst 0.8–2.6 s). The profile puts them in Cesium's own billboard update over about 20,000 aircraft and camera billboards, in shader linking, and in drawing OpenFreeMap vector tiles on the main thread. The vector tiles are hidden under Photoreal 3D. Those were not changed.

**Not tested:** Photoreal 3D over Manhattan (billed), which is the owner's actual surface. At maximum quality it allows 2 GB of tiles on top of the renderer's own 2.2–2.7 GB.

**Correction (2026-11-19):** the run below did **not** load Photoreal 3D. The throwaway profile had no Google key and the build has no built-in Google 3D key, so no tileset was created (`diag().photoreal` is null). The Google credit line is shown whenever that surface is selected, whether or not it loads, and was misread as evidence. The numbers below are the normal globe with the surface set to Photoreal 3D, which also turns off the OSM buildings. Photoreal 3D over Manhattan remains untested.

**Photoreal 3D run (owner approved, 2026-11-18 21:04–21:08 local, one launch).** Same route with the surface set to Photoreal 3D: zoom 60 km → 250 m, then 36 street-level stops over Manhattan for 163 s.

| Photoreal 3D, Manhattan | Result |
|---|---|
| Zoom frame rate | 130.8 fps, worst frame 456 ms, 22 frames over 50 ms |
| Street-level panning | worst frame 2,842 ms, 105 frames over 50 ms |
| JS heap while panning | 655–1,066 MB, no upward trend |
| Largest processes (working set) | renderer 1.8–2.6 GB, GPU process 0.75–1.6 GB |
| Crash log | empty; no renderer or GPU exit |

No crash. The credits line names Google Photorealistic 3D, and the final screenshot (`docs/screenshots/performance/nyc-photoreal-pan-end.png`) shows the mesh still at coarse detail: the camera moved every frame, so tiles had little time to refine. Memory therefore stayed well below the 2 GB tile budget. A long stay at one street corner would load more detail and use more memory, and that was not tested.
