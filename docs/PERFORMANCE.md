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
