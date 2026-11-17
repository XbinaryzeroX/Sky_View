# Atlas Watch audit and upgrade progress

## Smooth aircraft motion and follow

The frame-by-frame position prediction and correction previously applied only to public airline flights. It now covers both aircraft layers when a fresh report supplies ground track and speed, with separate state per layer. Follow uses the same displayed aircraft position and tracked camera anchor for airline, general-aviation and military aircraft. Snapshots and reports without a usable ground track are not extrapolated. When successive observations lack speed or track, the displayed marker blends between the positions and then holds. Duplicate and older reports retain the current motion state. Larger or delayed corrections blend over up to 30 seconds, while prediction remains limited to 45 seconds after a timed observation. These are display estimates; stored observations and trails retain their original coordinates and times. [Motion logic](../src/shared/aircraft.ts) · [Renderer](../src/renderer/map/layerRender.ts) · [Tracking camera](../src/renderer/map/trackingCamera.ts).

The final Windows app passed a public ADS-B live check using an isolated profile. A tracked flight and camera each moved 606 m in about five seconds, the plane remained centered, and a subsequent source report arrived. Controlled desktop checks exercised the normal Follow control for an airline flight in 2D and 3D and the Track control for a non-airline aircraft, including a 440 m report correction. Unit regressions cover separate aircraft layers, report ordering, incomplete data, stale prediction and the date line. All 1,113 tests passed. [Live check](flight-follow-live.log) · [Airline desktop check](flight-follow-final-audit.log) · [General aircraft check](general-aircraft-follow-audit.log) · [Tests](../tests/passenger-motion.test.ts).

The executable and matching installer are in `release/aircraft-final`; the launcher selects the newer package. Google 3D credentials were not used in these aircraft checks. [Package verification](aircraft-smooth-package.log).

## Close-up North Pole streak

The prior edge repair did not cover the bright pixels in the top rows of the polar reference. At close range those pixels stretched from the date line toward the pole. The generator now joins the near-pole ocean edges and gently smooths the first four rows toward an observed ocean sample so longitude values converge at the pole. This is a visual repair of the 2004 composite, not a measurement of current sea ice. [Generator](../scripts/build-geographic-overview.mjs) · [Asset regression](../tests/geographic-overview.test.ts).

The packaged Windows app was checked at 89.8° N and 350 km, where the reported streak was reproduced before the repair, and at 89.99° N and 20 km afterward. The streak was absent in both repaired views. All 1,107 tests passed. The executable and matching installer are in `release/arctic-close`, selected by the launcher. [Before close view](screenshots/arctic-line/pole-before.png) · [After close view](screenshots/arctic-line/pole-after.png) · [Package check](arctic-close-package.log).

## Arctic ocean date-line seam

The faint line near the North Pole came from bright pixels at the right edge of the bundled NASA polar image, where it wraps at the date line. Its neighboring pixels on both sides are dark ocean. The asset generator now joins six edge pixels only when both adjoining areas are dark and opaque, preserving brighter land and ice. [Generator](../scripts/build-geographic-overview.mjs) · [Seam regression](../tests/geographic-overview.test.ts).

In isolated desktop views at the same camera position, a 210-pixel ocean sample had 32 pixels with a visible difference from the adjacent ocean before the repair and zero afterward. The Windows app and matching installer are in `release/arctic-edge`. The polar reference remains NASA's July 2004 composite and does not show current sea-ice extent. [Before](screenshots/arctic-line/before.png) · [After](screenshots/arctic-line/baseline.png) · [Package check](arctic-edge-package.log).

## Arctic coastline mask lines

The faint curved lines were caused by Natural Earth coastline rings crossing the ±180° date line. The geographic mask generator connected the opposite map edges across the image at about 65°, 69° and 71° N. The generator now unwraps each polygon ring and renders shifted copies at the date line. It regenerates both the global land mask and the Arctic reference mask, so neither reintroduces those lines. [Generator](../scripts/build-geographic-overview.mjs) · [Alignment regression](../tests/geographic-overview.test.ts).

At the three affected latitudes, six sampled Siberian land points now retain opaque land imagery. The rebuilt app was visually checked at the wide and close Arctic views and over Antarctica. All 1,106 tests passed. The matching Windows executable and installer are in `release/arctic-lines`, selected by the launcher. The polar reference still uses the July 2004 NASA composite and does not depict current sea-ice extent. [Arctic view](screenshots/auto-poles/north-wide.png) · [Antarctic view](screenshots/auto-poles/south.png) · [Package check](arctic-lines-package.log).

## Arctic imagery transition correction

The previous 74° N transition left the 2021 MODIS observation swath visible just outside the 2004 polar reference. The northern geographic reference now extends to 60° N and fades at its outer edge. Between 60° and 74° N it covers water only, leaving detailed land imagery available. The south reference is unchanged. This broadens the area using the historical July 2004 NASA ocean reference. The Arctic image does not represent current sea-ice extent and the coarser reference has limited open-water detail. [Generator](../scripts/build-geographic-overview.mjs) · [NASA source](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/).

The final packaged Windows app was inspected at the north pole from 8,000 km, 3,500 km and 350 km, and at the south pole from 3,500 km. Camera location and a rendered frame were checked before each screenshot. The reported Arctic band is absent in the wide view, and Antarctica remained visible. The app and matching installer are in `release/arctic-update`. All 1,106 tests passed. [Wide Arctic view](screenshots/auto-poles/north-wide.png) · [South view](screenshots/auto-poles/south.png) · [Package check](arctic-imagery-package.log).

## Polar imagery follow-up

The polar rings returned when the older Mercator land layer was enabled at globe scale. The square Arctic artifact was baked into the 2021 MODIS overview. Auto now uses a geographic, land-masked NASA Blue Marble July 2004 overview and separate 2004 geographic polar references, with a two-degree fade at each polar edge. The finer Mercator land layer still activates closer in. The 2004 polar reference is a historical composite, and its Arctic view does not depict current sea-ice extent. The credit identifies its date. Other selected imagery years keep their existing sources. The NASA source SHA-256 is `f55226d46d27e05511f2118dc6aa24f5dbf9b6b2cddc87cc6e0e7dd067c00b11`. [NASA source](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/) · [Asset generator](../scripts/build-geographic-overview.mjs).

An initial asset generation attempt misaligned the land mask and was corrected by applying the mask before resizing. The new regression samples North American land, Lake Superior and the Atlantic. Desktop checks waited for the requested camera positions and a rendered frame at both poles. The screenshots show the blue rings and square removed in Auto. [North view](screenshots/auto-poles/north.png) · [South view](screenshots/auto-poles/south.png) · [Alignment regression](../tests/geographic-overview.test.ts). The Windows installer payload matches the rebuilt app. Google 3D requests were not exercised for this imagery repair. [Package verification](polar-imagery-package.log).

## Photoreal 3D in coastal cities

The photoreal surface selector previously hid the entire Google tileset as soon as any sample was mapped as water. At shallow angles its sampling could see only the harbor in front of Manhattan. It now keeps the tileset visible in mixed views, confirms regional all-water results with detailed OSM masks, treats unavailable masks as uncertain, and checks the nearby coast at close range. [Surface selector](../src/renderer/map/photorealSurface.ts) · [Regression tests](../tests/photoreal-surface.test.ts).

The packaged desktop test aimed a controlled 3D mesh at Manhattan with a 67 m camera height and −3° pitch. The mesh remained visible with no foreground holes. Google requests were intercepted, so actual Google tiles, coverage and the user's credential were not exercised. [Manhattan desktop check](new-york-mesh-after.log) · [Fixture screenshot](screenshots/new-york-mesh/after-land.png).

The wider nearby-land check changes the ship-scale tradeoff. At the earlier Gulf of Finland coastal-water fixture, land in the surrounding area now keeps the mesh visible rather than exposing the photographic water. Open-water-only behavior remains covered by the regression tests. The Windows app and installer are in `release/photoreal-v3`, and the launcher selects the newest build. Type checking and all 1,105 tests passed. [Package check](photoreal-city-package.log).

## Photoreal buildings and restored satellite overview

Selecting Photoreal 3D now disables the application's OSM building extrusions for the whole time that mode is selected, including while Google's tiles are loading, hidden over water, or unavailable. The existing building preference is retained and extrusions return on other basemaps. An isolated packaged desktop check rendered 34,190 OSM buildings in Atlas mode, none in Photoreal mode, and restored them on returning to Atlas. The test blocked Google requests, so live Google tile coverage and billing credentials were not exercised. [Desktop check](photoreal-buildings-check.log) · [Building selection](../src/renderer/components/Globe.tsx).

The older 2004 NASA Blue Marble land reference now appears at global overview scale again. The observed ESA/NASA ocean remains below it, and the detailed Sentinel and USGS layers remain available closer in. Blue Marble reduces the clouds and seasonal snow visible in the user's North American overview; Greenland and polar ice remain white. The observed overview can still show imagery artifacts near the poles, and historical years still show their own dated imagery. [Restored global view](screenshots/imagery-restored.png) · [NASA Blue Marble](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/).

The updated Windows executable and installer are in `release/imagery-update`. The start launcher selects the most recently built release. Type checking and all 1,103 automated tests passed. [Package verification](imagery-restored-package.log).

The final imagery repair is packaged in `release/flight-card/win-unpacked`, which the project launcher selects as the newer build. Type checking and all 1,103 tests across 74 files passed. The installer payload matches the tested app archive (`b5d44038945a54e17c274b92b37b0d33d94564c70474add9bd0b0e006b3a2cad`), though installation and upgrades were not exercised. Live public imagery checks used isolated profiles and blocked Google requests. [Package verification](imagery-repair-package.log).

## Auto polar imagery repair

The Auto globe showed blue rings near the Arctic because the Mercator Blue Marble land layer stretched into polar terrain. Its land imagery is now used at terrain level 5 and closer, and an independent geographic polar land mask and the original geographic optical ocean cover both poles. The masks derive from Natural Earth land outlines and the existing NASA 2004 polar land imagery. The Antarctic land outline includes the plateau south of 84° S, beyond the published atlas clipping limit. [Polar mask generator](../scripts/build-polar-land.mjs) · [Blue Marble source](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/).

The final Windows executable (app.asar SHA-256 `b5d44038945a54e17c274b92b37b0d33d94564c70474add9bd0b0e006b3a2cad`) showed the reported Arctic view without the blue rings, and the close Arctic view and Antarctic overview retained satellite imagery. Existing natural ice and cloud features remain. Dark streaks in the high-Arctic MODIS composite trace missing polar observations in the source. A trial selecting the brightest available observation from all six same-year passes retained the polar gap. [Polar overview](screenshots/auto-poles/north.png) · [Close Arctic](screenshots/auto-poles/north-close.png) · [Antarctic overview](screenshots/auto-poles/south.png).

## Coastal water boundary follow-up

The USGS imagery layer now uses OpenStreetMap water polygons to retain the land photograph and immediate nearshore photography, fading the water into the existing Sentinel-2 and optical imagery farther offshore. It uses adjacent masks to keep transitions continuous across map tiles. When the water-mask service fails, the original USGS tile remains visible. This trades some offshore photographic detail for a more continuous coastal transition; the underlying optical fallback is coarser where Sentinel-2 is unavailable or is blended at a source-coverage boundary. [USGS imagery service](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) · [Implementation](../src/renderer/map/usgsProvider.ts).

In the isolated Windows preview (`e7fb14f479c90997542a2cd6754c52085c923a605bb900b9ef201cb5365eb70c`), a live Sanibel view showed a continuous shore with no abrupt USGS water-color block. A separate run blocked the water-mask host and showed the original USGS photography. In the same preview, the Åland regression had zero blue samples out of 440 and all eleven source-edge comparisons differed by at most one RGB level. Open ocean remained darker and coarser than the USGS source. [Sanibel preview](screenshots/coast-review/sanibel.png) · [Blocked water mask](screenshots/coast-review/sanibel-mask-offline.png) · [Åland checks](optical-water-after.log).

The packaged Windows app (`b5d44038945a54e17c274b92b37b0d33d94564c70474add9bd0b0e006b3a2cad`) passed the same Åland, oblique, offline-water and overview-service failure checks. The eleven Åland edge comparisons again differed by at most one RGB level. The live Sanibel view retained a detailed shoreline and showed darker offshore water without the original straight color block. [Final desktop results](optical-water-after.log) · [Final Sanibel view](screenshots/coast-review/sanibel-final.png).

Project: `C:\Users\infob\Documents\Claude\Sky_View` · package version 0.7.0 · audit started 2026-11-11.

Latest work covers [satellite water, imagery years and night viewing](#satellite-water-imagery-years-and-night-viewing). Earlier checkpoints cover [coastal imagery and oblique tiles](#coastal-imagery-and-oblique-tiles), [trending markets and article previews](#trending-markets-and-article-previews), [map loading and ship heights](#map-loading-water-and-ship-heights), [vehicle model coverage](#vehicle-model-coverage), [conflict updates](#conflict-updates), [following passenger flights](#following-passenger-flights), [aircraft selection](#aircraft-selection), [worldwide place search](#worldwide-place-search), [U.S. fire perimeters](#us-fire-perimeters), [German weather warnings](#german-weather-warnings), [saved-location monitoring evidence](#saved-location-monitoring-evidence), [since-last-visit briefings](#since-last-visit-briefings) and [saved investigations in Scenes](#saved-investigations-in-scenes).
The inventory, installer hashes and provider counts below describe their dated checkpoints. The full upgrade remains incomplete.

To open the packaged Windows app from the project folder, double-click [start.bat](../start.bat). The executable is present. A temporary test executable verified launch from another working directory, paths with spaces and the launcher's missing-build message.

## Satellite water, imagery years and night viewing

The **Imagery year** selector in the top bar covers 2000–2026, including annual composites for 2020 and 2021. **Day/night** beside **Layers** moves sunlight over the globe at the selected UTC time and shows city lights from NASA’s separately dated 2016 composite. In 2D and 3D the sunlight test shaded opposite sides of Earth twelve hours apart while the recorded playback cursor stayed fixed. [Acquisition-year sources and tests](#satellite-imagery-acquisition-years) · [Night-light sources and tests](#earth-lighting-and-city-lights).

The offline land stencil excludes open ocean and major inland waters. Natural Earth’s land polygons include lakes, so the generator subtracts the published lake and reservoir polygons as well as the Europe, North America and Australia supplements. Regressions sample the Åland Sea, Atlantic, Lakes Michigan, Superior, Victoria and Baikal, plus an inland land control across all four stencil levels. [Published outlines](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/) · [Packaged stencil regression](../tests/optical-water.test.ts).

**Stars.** The earlier build rendered six 1024 × 1024 Tycho JPEG faces. A cold offline desktop run reproduced the mottled background. The new six 2048 × 2048 lossless WebP faces plot 9,096 entries from the Yale Bright Star Catalog by equatorial position and visual magnitude, with colours approximated from the published B−V index when available. Star profiles use angular distance across cube edges. The six textures total 360,760 bytes on disk and are packaged for offline viewing. [Catalogue at NASA HEASARC](https://heasarc.gsfc.nasa.gov/W3Browse/catalog/bsc5p.html) · [Generator and pinned archive](../scripts/build-star-sky.mjs) · [Original desktop sample](star-sky-before.log). In a fixed 63,800-pixel open-sky crop, the share within one intensity level of the background rose from 53.2% to 99.6%, with distinct bright stars still visible. [Offline desktop results](star-sky-after.log) · [Orbital star view](screenshots/star-sky/after.png).

In the reported Åland view, the corrected map showed zero blue blocks at 440 sampled water points. Each of the eleven comparisons across the publisher’s coverage boundary differed by at most one RGB level. Three samples of island farmland retained the finer texture of Sentinel imagery. The map also uses the original satellite tiles to recover coastal detail if the publisher’s separate overview service goes offline. [Regional view](screenshots/optical-water/after-aland-regional.png) · [Oblique view](screenshots/optical-water/after-aland-oblique.png) · [Desktop results](optical-water-after.log).

The rebuilt Windows app passed type checking and all 1,102 automated tests across 74 files. The package audit verified that the installer contains the same app archive as the tested executable (`03bafa005199fc31acfcf055934308bd7b71a75412fe7c243802cb6fb1c339b8`). The desktop checks used isolated profiles. Installation and upgrades remain untested. [Windows package audit](satellite-earth-package.log).

## Coastal imagery and oblique tiles

The previous Photoreal 3D implementation hid the whole globe once one center sample hit a loaded 3D tile. Partial coastal meshes exposed the sky below the horizon. Two other paths removed real photography: a coarse NASA layer faded in offshore over configured imagery, and the USGS adapter erased valid water pixels by distance from land. The updated renderer keeps a continuous globe behind the mesh. Below 3 km, aiming at mapped ocean shows imagery across the view, including the shoreline. Aiming back at land restores the mesh. A failed map classification leaves the mesh eligible. The ordinary satellite layers now keep their source water. [Coverage logic](../src/renderer/map/photorealSurface.ts) · [Imagery stack](../src/renderer/map/basemaps.ts) · [USGS no-data processing](../src/renderer/map/usgsProvider.ts).

The Atlas and Google 3D fallback stacks use the 2021 ESA WorldCover Sentinel-2 true-colour annual median at 10 m, between 60° S and 83° N where the publisher has imagery. WMTS advertises levels 8–14 for this composite. Terrascope returned an opaque, varied RGB tile on the reported coast and a transparent no-data tile in the central Pacific. Finer U.S. and configured satellite photography retain priority. At ship scale the existing optional ripple effect adds low-opacity shading over mapped water beyond the composite’s native detail. Turning it off exposes the photographed colour alone. The coarse ocean background remains visible where no optical source covers the water. [Dataset, license and native resolution](https://esa-worldcover.org/en/data-access) · [Publisher’s WMTS capabilities](https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetCapabilities).

At 60.0214° N, 26.9797° E, the old build showed sky through 112,587 of 408,856 foreground pixels with a controlled partial mesh. The final executable showed zero at 105 m and −3.39°. With real terrain settled at level 18, a 117 m view at −3.80° also had zero gaps. Panning back to land restored a mesh 22 m below the ellipsoid. A separate vessel remained directly clickable on a 183 m test surface. Google requests were intercepted in these checks. Live Google coverage at this point remains unverified. [Before](coastal-mesh-before.log) · [After with public terrain](coastal-mesh-after.log) · [Oblique coastal view](screenshots/coastal-mesh/after-sea-terrain.png) · [Ship height](vessel-waterline-controlled-3d-tiles.log).

The desktop imagery check used the public Terrascope WMTS, a disposable profile and the app’s production renderer. It checked that removing the photograph visibly restored the coarse background, that the shoreline stayed the same when toggling ripples at the wider view, and that the toggle added fine detail over water at a 200 m camera height. [Rendered imagery and pixel comparisons](coastal-imagery-packaged.log) · [Photographed coastline](screenshots/coastal-imagery/baltic-sentinel.png) · [Ship-scale water](screenshots/coastal-imagery/baltic-ship-scale.png).

The final Windows build passed typecheck and all 1,095 tests across 72 suites. The full test rerun used four workers after two module imports timed out during simultaneous desktop checks. The packaged app and the installer contain matching production files. The existing project launcher chooses the newer package in `release/flight-card`. Close the previous instance before launching it. Installer execution and a billed Google session were outside these checks. [Package verification](coastal-markets-package.log) · [Markets desktop verification](trending-markets-packaged.log).

## Map loading, water and ship heights

**Continental imagery.** The old packaged app reproduced the reported U.S. view with clear state boundaries over a blurry parent texture. It took 8.52 seconds after camera placement to show the center at imagery level 5. During the first 16 seconds it received 650 remote elevation responses, 685 vector responses and 179 NASA responses. The sources were responding successfully. Each coarse terrain mesh waited for elevation and coastline data, and distant place labels independently requested detailed elevation. A cold, offline profile had no globe surface after 16 seconds. [Timed original](basemap-loading-before.log) · [Original screenshot](screenshots/basemap-loading/before-us-early.png) · [Offline original](basemap-loading-before-offline.log).

Atlas now ships 85 north-up overview tiles and both polar caps from the same NASA GIBS August 2004 Blue Marble composite. The Web Mercator overview resolves 8,192 pixels across the world. Finer views continue to use the existing NASA and USGS imagery. The first six terrain levels use bundled NOAA ETOPO1 elevations from Mapzen's Terrarium tiles. Distant labels use that same overview. Precise elevation queries and city views keep the existing detailed terrain sources. Across the measured continental view the final package requested no remote elevation or NASA base tiles. [NASA source, registration and checksums](../scripts/basemap-overview-source.json) · [Terrain source and reconstruction](../public/terrain/ATTRIBUTION.txt) · [Current U.S. view with live radar](screenshots/basemap-loading/after-radar-us-early.png).

With Balanced quality, level 5 appeared at the same U.S. camera in 2.30 seconds, down from 8.52 seconds. The final run received 55 local overview responses and 85 OpenFreeMap responses during the continental view. The cold offline run reached level 5 in 0.71 seconds. With NOAA radar enabled, the view reached level 5 in 1.43 seconds, and reached it in 0.86 seconds in a separate run that held remote overlay requests open. Denver still received native USGS level-13 imagery. Times are specific to this machine, view and run. [Live timings](basemap-loading-after.log) · [Cold offline](basemap-loading-after-offline.log) · [Radar](basemap-loading-after-radar.log) · [Stalled overlays](basemap-loading-after-radar-stalled.log).

**Close water.** On close-up 3D imagery the display can shade static ripples within OpenStreetMap ocean, lake and river polygons. The pattern uses Cesium's bundled water normals, shares coordinates across neighboring tiles and preserves the underlying imagery. The credits and Display setting identify the illustration. Dated and weather-satellite imagery keep their source appearance. A packaged check sampled real Baltic and Lake Tahoe water polygons and a dry tile in central Helsinki. Both water tiles showed texture. The dry tile remained fully transparent. Switching the setting off in the same Baltic view removed the pattern. The ripples depict no measured wind or wave conditions. [Desktop measurements](water-detail-packaged.log) · [Close-up water](screenshots/water-detail/baltic-ripples.png) · [Same view with the effect off](screenshots/water-detail/baltic-imagery.png).

**Tilted terrain.** At Mount Rainier the previous meshes differed by 63.79 m where two tiles shared an edge at the same detail level. Near the edge, one sampler lacked a neighboring source pixel needed for interpolation. The updated sampler uses pixel centers, includes neighboring source pixels, wraps longitude at the date line and handles unavailable coastal masks per sample. On the final build, the maximum measured same-level mismatch was 0.42 m at Rainier and 0.03 m on the Baltic coast. Neither settled view exposed background through the terrain across 467,852 tested ground pixels per view. The control that hid the surface detected all 467,852 background pixels. [Original check](oblique-terrain-before.log) · [Final tilted-view check](oblique-terrain-after.log) · [Mount Rainier](screenshots/oblique-terrain/after-rainier.png).

**Ship waterlines.** The old renderer assigned a ship a height of zero on the ordinary globe. When the test lake rendered at 78 m and then 183 m, its hull remained at zero. Ships now attach their model waterlines to the current displayed surface and update when the terrain refines. The AIS observation retains its reported location. The optional Google 3D mode checks for loaded geometry in the view before switching away from the ordinary globe, and its hulls track the loaded 3D tiles. The Google handoff was exercised with controlled scene responses. A paid Google session was not verified. [Previous hull heights](vessel-waterline-before.log) · [Controlled lake and actual mesh picks](vessel-waterline-after.log) · [Live Fintraffic ship](vessel-waterline-live.log) · [Google handoff checks](../tests/photoreal-surface.test.ts).

The live Fintraffic check found an inland cargo ship whose displayed waterline followed the local terrain at 92.06 m. At a second cargo vessel near the coast, the camera moved to 240 m range and the terrain reached level 19. Clicking the hull opened its AIS card showing a length of 99 m and a beam of 14 m. The close-up used normal Atlas imagery with terrain and water detail enabled. A separate test routed the Google URL to a local 3D Tiles fixture. The packaged renderer placed a clickable hull on its 183 m surface and restored the ordinary globe outside the fixture’s coverage. [Live ship and surface](screenshots/vessel-waterline/live-close-cargo.png) · [Controlled 3D Tiles desktop check](vessel-waterline-controlled-3d-tiles.log).

The Windows production typecheck and all 1,083 tests across 71 suites passed. The installer payload matched all 500 production files in the unpacked build. The installer is unsigned and Windows installation and upgrade were not run. [Package verification](map-water-package.log).

## Vehicle model coverage

Select a vehicle on the globe to see a rotatable, broadside preview. The map and details use the same type matcher. The previous pack had 37 airliner meshes and the aircraft card needed matching artwork to offer rotation. The new pack retains all 37 and adds the Cessna 172, Citation X, Gulfstream G650ER, Robinson R22 and R44, AS350 B2, AW139 and EC135. Nine vessel models cover cargo, tanker, passenger, high-speed, fishing, tug, sailing, pleasure and pilot craft. The pilot model applies only to AIS code 50. A ship’s broadcast dimensions scale the shape when available. AIS cargo and tanker codes establish categories. They do not identify an individual hull or establish that a tanker is carrying oil. [US Coast Guard AIS definitions](https://navcen.uscg.gov/ais-class-a-reports).

The 54 licensed models contain 68,492,608 bytes of local geometry and textures. All 45 aircraft designators and nine vessel categories resolve through the production pack reader. The credits identify the Sketchfab creator, source, license and conversions. The collection includes independent artists. The R22 creator identifies the Robinson model in the upload description. [Credits for all 54 models](../public/vehicle-models/ATTRIBUTION.txt) · [Side, top and front views of the 17 additions](screenshots/vehicle-coverage/model-orientations.webp) · [R22 artwork](https://sketchfab.com/3d-models/low-poly-helicopter-7677d87826f449ebadb6cccba2af38ca).

Aircraft without matching artwork use a labeled representative shape. The bundled FAA table covers 2,519 designators, including 175 helicopter and 46 gyroplane entries. It records configuration, propulsion, engine count and weight class. The renderer also uses existing measured dimensions when available. Eighteen aircraft classes and 14 vessel classes cover reported categories and unknown types. Different designators can share geometry. An unidentified aircraft or vessel still has a generic preview with the missing type called out. [FAA Order JO 7360.1K, Appendix A](https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf) · [Reproducible catalog extraction](../scripts/build-vehicle-type-catalog.py) · [Coverage and geometry checks](../tests/vehicle-models.test.ts).

The packaged Windows app opened six controlled vehicle records through globe clicks. Rotation changed the rendered pixels for the EC135, a category-only helicopter, a tanker and a cargo ship. A separate live check selected a tanker and a cargo ship from Fintraffic AIS and rotated both credited models. The real-time source check covered those two vessel categories. Other category coverage was verified from the catalog, model data and controlled records. All 1,077 tests across 69 suites and the production typecheck passed. The installer payload matched all 410 production files, notices and samples. The installer is unsigned. Windows installation and upgrade were not exercised. [Desktop check](vehicle-coverage-packaged.log) · [Live Fintraffic check](vehicle-coverage-live.log) · [EC135](screenshots/vehicle-coverage/controlled-ec135.png) · [Tanker](screenshots/vehicle-coverage/live-tanker.png) · [Cargo ship](screenshots/vehicle-coverage/live-cargo.png) · [Package comparison](vehicle-conflict-package.log).

The final build also retained smooth Follow on a moving airliner. A controlled globe click kept the plane centered through consecutive observations in 3D, icon mode and 2D. Recorded history retained the two source coordinates and timestamps. [Follow regression in this release](vehicle-coverage-follow.log).

## Conflict updates

The existing Events view had incident feeds and official weather bulletins. **Events → Conflict updates** adds two views. **CFR assessments** lists the Council on Foreign Relations' selected conflicts and potential crises, their regions, types and assessed trends. Each situation opens its own CFR overview. A country button appears when the app also has humanitarian reports filed under that country. Cases for Sudan and South Sudan have distinct matches. **Humanitarian reports** groups selected publications by country or territory with the posting time, original source and a short description of the civilian impact. A posting can describe an earlier reporting period. [CFR tracker](https://www.cfr.org/global-conflict-tracker/dashboard) · [CFR methodology](https://www.cfr.org/global-conflict-tracker/methodology) · [ReliefWeb](https://reliefweb.int/).

While the view is open, the app checks for new humanitarian publications every 30 minutes and new CFR assessments every six hours. The publisher check time and each report’s publication time are separate. UN News provides an identified backup source if ReliefWeb is unavailable. If both report sources or CFR are unavailable, the app retains that view's last successful data and shows the failed refresh. The feeds need no customer account or API key. Countries outside the published coverage have unknown current conditions. [UN News humanitarian feed](https://news.un.org/feed/subscribe/en/news/topic/humanitarian-aid/feed/rss.xml) · [Refresh and cache implementation](../src/main/publishedBulletins.ts).

At 04:19 UTC on November 12, 2026, the packaged app received 27 CFR situations across five regions and nine ReliefWeb reports across seven countries, posted November 9–12 UTC. The desktop check followed the Myanmar assessment into its humanitarian reports and verified its source links. A controlled outage after restart retained the original lists and check times. An earlier separate live read used the UN News backup and returned six articles covering four countries or territories. These are dated checks. Both publishers update their own coverage. [Packaged live and restart check](conflict-updates-packaged.log) · [Reports screen](screenshots/conflict-updates/live-reports.png) · [Assessments screen](screenshots/conflict-updates/live-assessments.png).

## Following passenger flights

In the previous packaged app, clicking a test airliner on the globe and choosing **Track** centered the camera once. During the next two seconds the plane advanced 227 m in two jumps. The camera moved 0 m and the model drifted 211 pixels off center. The prior tracking check measured the initial camera height and missed the failure on subsequent frames. The Cesium widget updates a tracked entity each tick only when its visualizer supplies a bounding sphere. The original tracking anchor had no visualizer. [Previous check](../scripts/qa-tracking-camera.js) · [Packaged reproduction](flight-follow-before.log) · [Frame-by-frame desktop check](../scripts/check-flight-follow-packaged.mjs).

The flight card places **Follow** under the flight heading. A passenger flight’s icon, 3D model and camera share the displayed position. The map estimates horizontal motion from the last reported ground track and speed for up to 45 seconds. Ordinary corrections in position, direction and reported altitude blend into the current display. After a prolonged outage or a large discontinuity the map reacquires the reported position. The tracking panel shows when the estimate pauses. Source details, recorded trails and playback keep their observation coordinates and times. [Camera](../src/renderer/map/trackingCamera.ts) · [Motion calculation](../src/shared/aircraft.ts) · [Map rendering](../src/renderer/map/layerRender.ts).

A controlled switch to the flat map exposed a second failure. Cesium’s 2D tracker carried the previous map center into the aircraft’s coordinate frame, moving the aircraft off screen. The 2D camera now centers explicitly on the flight when acquiring it.

On the final Windows build, a **Flights → Follow** search using UAL1123 from the live adsb.lol feed kept the airplane within one pixel of center as its symbol switched to a 3D model. Over five seconds the displayed aircraft moved 722 m and the camera moved 723 m. The next source observation arrived eight seconds after the first, and Follow stayed centered. This check used a temporary profile and the free feed. [Live desktop measurements](flight-follow-live.log).

In the same packaged build, two controlled position reports exercised a 440 m cross-track correction. The camera stayed centered through the correction, a click on the moving map icon, and a 3D → 2D → 3D round trip. After **Stop tracking**, the plane traveled another 137 m with the camera stationary. Local history retained the two original fixes with their exact coordinates and times. No renderer errors occurred. TypeScript and all 1,054 tests across 67 suites passed. The installer payload matched all 393 production files. [Packaged desktop results](flight-follow-packaged-audit.log) · [Installer comparison](flight-follow-package.log).

## Aircraft selection

Clicking a civilian aircraft opens its flight details at the top of the map panel. The previous panel placed the general overview ahead of the selected record. The new card uses the existing aircraft feed, opt-in registry and photo lookup, recorded observations, map route line and local vehicle model loader. Selecting a different flight discards the previous selection’s lookups.

The card labels an exact registry variant, a feed description and an ICAO type according to the evidence available. A readsb build year gives an approximate age at the observation date. A model’s introduction date, photo date and first appearance in the app cannot establish the airframe’s age. The type specifications cover 115 commercial aircraft codes. Model range and seating apply to the published configuration. [FAA Aircraft Characteristics Database](https://www.faa.gov/airports/engineering/aircraft_char_database) · [Iberia / Air Nostrum CRJ1000](https://grupo.iberia.com/about_us/iberia_fleet/air-nostrum-crj-1000).

An exact standing callsign match displays the published airports and a dashed geographical route. **View route on map** fits the airport path. A standing route cannot confirm the day’s destination, flight plan or delay. The card links to the airline’s official flight-status page for supported operators. [Route data, coverage and reproduction](#passenger-airline-route-data).

**Check dated flight status** is an optional lookup using the customer's AeroDataBox direct subscription. A unique match can supply the operating flight number, reported departure and arrival airports, scheduled and revised UTC times, terminal, gate and status. A dated match replaces the usual airports in the heading and map. A canceled or diverted status hides the projection. The predicted arrival is labeled separately from an estimated or actual movement time. The lookup omits live-position and flight-plan requests. [AeroDataBox API contract](https://doc.aerodatabox.com/docs/openapi-direct-v1.json).

The packaged model library contains 37 exact-type airliner meshes downloaded from Sketchfab under CC BY 4.0, including the A318-100 published by NATS. Creator, source URL, license and conversion credits accompany each asset. Conversion and visual inspection checked side, top and front views. All 37 GLBs use local geometry and textures, occupying 41,707,020 bytes in total with at most 42,287 triangles per model. The library includes artwork by aviation organizations and independent artists. Manufacturer authorship could not be established for these uploads. [Model credits](../public/vehicle-models/ATTRIBUTION.txt) · [Geometry review of the 37 models](screenshots/flight-card/sketchfab-aircraft-orientations.webp) · [NATS on Sketchfab](https://sketchfab.com/natsdigital).

The original shortlist used a CRJ900 mesh for all five CRJ designators. The CityJet Training model now appears only for CRJ9, including when an older index is loaded. The single exact-labeled CRJ1000 upload found on Sketchfab measured 39.2 m across when scaled to the aircraft’s 39.1 m length, compared with the operator’s published span of 26.1 m. CRJX retains a generic map representation and links to the creator’s model page. [Creator’s CRJ-1000](https://sketchfab.com/3d-models/crj-1000-38f477b8d66f48f684dce9533bf410c0) · [Operator aircraft reference](https://grupo.iberia.com/about_us/iberia_fleet/air-nostrum-crj-1000).

The public Sketchfab search covered 255 distinct type names, including all 237 civil entries in the app’s ICAO name table and all 115 commercial profiles. The app links 60 types to reviewed public model pages. Eighty type-name queries returned an empty first page. Other search results can include cabins, components or neighboring variants. Each audit row records the query, result count, download count, reviewed page and approved-mesh status. The 21 military-specific designators were outside this civil aircraft review. [Per-type search results](airliner-sketchfab-catalog.log).

The unsigned flight-card installer was built alongside the running copy. The package audit matched all 393 production files, notices and samples to the installer payload. TypeScript and all 1,045 tests across 66 suites passed. The packaged Windows app was exercised through actual globe clicks in an isolated profile. It loaded and rotated a local A320neo model, switched to a photo, showed unknown fields for an unidentified plane and cleared the previous route on selection or close. Controlled dated-status replies exercised a changed arrival airport, revised times, gates and a diversion. A separate live adsbdb lookup matched Air Nostrum registration EC-MJQ to a Bombardier CRJ 1000 NG. No paid AeroDataBox request was sent. Windows installation and upgrade remain untested. [Desktop acceptance](flight-card-packaged-audit.log) · [Installer audit](flight-card-package.log) · [A320neo card](screenshots/flight-card/controlled-a320neo-3d.png) · [CRJ1000 card](screenshots/flight-card/controlled-crj1000.png) · [Dated flight status](screenshots/flight-card/controlled-dated-flight-status.png) · [Route overview](screenshots/flight-card/controlled-usual-route-overview.png) · [Public registry record](https://api.adsbdb.com/v0/aircraft/3451da).

With globe models enabled, the packaged map loaded the credited A320neo GLB before any detail card opened. The app reported one visible model and zero model failures. A pointer click on that textured aircraft opened the matching A320-251N card. [Model on the globe](screenshots/flight-card/controlled-a320neo-globe-model.png) · [Local file checksum and desktop checks](flight-card-packaged-audit.log).

## Worldwide place search

The top search box already used an offline catalog of 7,342 Natural Earth places. In the previous packaged app, Tokyo worked in Latin script, but 東京 returned nothing. São Paulo worked with a precomposed ã and failed with the equivalent decomposed spelling or plain “Sao Paulo”. Adding “Ontario” to London suppressed the Canadian match. The previous search also sent the camera to the same minimum height of 120 km for every destination. [Packaged baseline](place-search-before-audit.log) · [Tokyo search before](screenshots/place-search/audit-place-search-before-tokyo-native.png).

The catalog retains all 7,342 original names, positions, populations, regions, countries and row order. The generator joined each row to one Natural Earth 1:10m populated-place feature and added 97,615 distinct alternate spellings across those rows. The input is pinned to v5.1.2. A new local worker loads and indexes names on demand. Matching preserves the original display spelling, handles equivalent Unicode sequences and Latin diacritics, and supports comma-separated region and country qualifiers. Each place appears once per query. Natural Earth supplies a selection of cities and towns, and some language fields contain historical names or different geographic descriptions. [Generator and archive checksums](../scripts/places-source-manifest.json) · [Publisher data](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/) · [Publisher terms](https://www.naturalearthdata.com/about/terms-of-use/).

The existing input opens the globe for a city, coordinate or publisher address. The requested camera heights are 30 km for a city, 10 km for coordinates and 2 km for an address. Available terrain height is added. When terrain is enabled and the destination elevation is unknown, the camera stays at least 10 km above the ellipsoid. WGS84 geo URIs may include altitude and uncertainty. Search uses their horizontal coordinates. An unsupported coordinate reference system produces an input hint. [Geo URI specification](https://www.rfc-editor.org/rfc/rfc5870.html).

The final packaged app handled 29 offline queries and 19 map selections. These covered New York, London, Frankfurt, Dubai, Tokyo, Singapore, Sydney, Cape Town, São Paulo and Anchorage, plus a coordinate on the date line. Camera readings agreed with the catalog or entered coordinates. London, Ontario selected the Canadian city. Native-script input, keyboard selection, closing the popup, input-method composition and returning to the globe from Discover all passed. The app issued zero geocoding requests during these checks. [Desktop verification](place-search-after-audit.log) · [Tokyo after repair](screenshots/place-search/audit-place-search-after-tokyo-native.png) · [Date-line destination](screenshots/place-search/audit-place-search-after-date-line-flight.png).

The selected basemap now determines the external geocoder. On non-Google maps the city catalog is offline, and the existing U.S. Census address action sends text only when selected. With Google imagery selected, the separate Google Maps search action requires a customer key. A saved Google key alone previously switched the app away from offline place search. Both main-process handlers now check the basemap before requesting data, reject unusable coordinates and distinguish malformed replies from empty results. [Census service](https://geocoding.geo.census.gov/geocoder/) · [Google Maps geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies).

Changing search providers used to replace the input while someone was typing. On the packaged build, typing during the switch in either direction preserved the text, input focus and open results. A late Census reply after a query change or Escape and a late Google reply after a provider change were discarded. Controlled Google responses exercised the explicit search action with a temporary test key. The test sent zero paid Google requests. [Before the switch repair](screenshots/place-search/audit-place-search-google-transition-before-fix.png) · [Typing during the switch after repair](screenshots/place-search/audit-place-search-after-fast-google-transition.png).

On one machine, median index construction took 247 ms. Across the same 25 queries repeated 250 times, median lookup changed from 0.109 ms to 0.004 ms. The 95th percentile rose from 0.152 ms to 0.333 ms with the larger name set. These CPU measurements exclude catalog decoding, worker startup, drawing and network time. [Benchmark and hardware](place-search-timing.log).

In a fresh profile, selecting the U.S. address action for 1600 Pennsylvania Ave NW, Washington, DC 20500 sent one request to the Census Geocoder. The service returned HTTP 200. Selecting the result moved the camera to the returned coordinates (38.898703, −77.035189) at 2 km. [Live request and camera readings](place-search-live-census-audit.log) · [Address result](screenshots/place-search/audit-place-search-after-live-census-result.png).

In the Providers dialog, controlled Census replies with valid coordinates, null coordinates and an empty match list produced distinct messages. Null coordinates failed validation. A valid empty list confirmed the connection and explained that no map position was available. [Packaged diagnostics and search checks](place-search-after-audit.log).

The production build included zero credentials. The local search worker accounts for 2.25 MB of the package and loads separately from the main renderer. Typecheck passed. One label-hierarchy test timed out while packaging ran in parallel. After packaging finished, all 1,030 tests across 63 suites passed with the existing timeout. The packaged desktop checks and the installer audit used the same application archive. The unsigned Windows installer was checked by extraction. Clean installation and upgrade remain untested because a disposable Windows guest was unavailable. [Desktop acceptance](place-search-acceptance-audit.log) · [Installer payload audit](place-search-package.log).

## U.S. fire perimeters

The README, WFIGS adapter, Hazards toggle and source tests already contained U.S. fire perimeters. The previous Windows build drew the first piece of each multipart record and silently omitted the rest. An isolated two-part example reproduced the problem by clicking both areas in the packaged app. [Baseline interaction log](nifc-before-audit.log) · [Before screenshot](screenshots/nifc/audit-nifc-before-same-scene.png).

The existing globe layer renders the supplied polygon parts and interior rings. Selecting a filled part opens the corresponding NIFC feature. The Data panel distinguishes the footprint acreage, reported incident acreage, polygon capture time, polygon edit time and app retrieval time. Focus uses the complete footprint bounds, including across the date line. Discover ranks loaded features with a published footprint acreage. Features can share an incident ID and each retains its publisher feature identity.

The app requests public wildfire and prescribed-fire perimeters in the United States. Incident teams report at irregular intervals and coverage varies. The query asks for WGS84 coordinates with a generalization tolerance of 0.0005 degrees and five decimal places. Very small parts can collapse under that tolerance. The public item lists interagency contributors and limits on accuracy, completeness and legal use. The layer uses the same public endpoint and fifteen-minute polling interval while enabled. [Publisher metadata and field definitions](https://www.arcgis.com/sharing/rest/content/items/d1c32af3212341869b3c810f1a215824/info/metadata/metadata.xml?format=default&output=html) · [NIFC dataset and terms](https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824).

The main-process adapter rejects incomplete paging and malformed replies before replacing the last complete in-memory result. Before the first successful reply, coverage is unknown. A complete empty reply reports zero perimeter features. Layer details distinguish source errors and last-observed results. Replay suppresses the live perimeter status and Discover ranking. The connection test validates the publisher's count response, including zero.

The rebuilt desktop app passed the same synthetic interaction check using identical input bytes. Both pieces opened the original feature, and clicking inside either interior hole left it unselected. Disabling the layer removed selectable geometry. Re-enabling restored selection of the second piece. Its 1,234.5 reported acres remained visible separately from its missing mapped acreage, and Discover omitted the unmeasured footprint. [Controlled desktop check](nifc-after-audit.log) · [Same scene after repair](screenshots/nifc/audit-nifc-after-same-scene.png) · [Second piece selected](screenshots/nifc/audit-nifc-after-second-part.png).

At 01:53–01:55 UTC on November 12, the packaged desktop app matched a public NIFC response with 65 features, including 23 multipart features. All 2,205 parts, three interior rings and 20,366 coordinates matched the returned geometry. Two clicks on separate pieces of McCully opened the same feature, and a click inside a published interior hole left the feature unselected. In Discover, Ranger Road ranked first by its published mapped area of 278,898.81 acres. Opening its record also showed the distinct reported incident size of 283,283 acres. Both the controlled run and the live run used the same ASAR as the installer and closed with zero renderer errors. [Live verification](nifc-after-live-audit.log) · [McCully selection](screenshots/nifc/audit-nifc-after-live-real-part-2.png) · [Ranger Road details](screenshots/nifc/audit-nifc-after-live-discover-details.png).

On the same 65-feature geometry sample, the previous renderer constructed 65 Cesium entities and the repaired renderer constructed 2,205. Median CPU time for that first build rose from 1.04 ms to 15.06 ms. When the same geometry objects were passed again, the renderer retained all 2,205 entities and median update time fell from 1.05 ms to 0.009 ms. These headless timings cover entity construction and reuse. GPU rendering, frame rate and fresh IPC payloads were outside the benchmark. [Timing and hardware](nifc-render-timing.log).

Typecheck, all 900 tests in 59 suites and the production build passed. The unsigned Windows installer matched all 350 production files, the attribution notices and the samples. The build included zero credential providers. Native installation and installer-driven upgrade remain untested. [Installer verification](nifc-package.log).

## German weather warnings

The source search and November 11 packaged baseline found an existing U.S. alerts workflow. Searching Layers for DWD and Germany returned no matches and the Events filter offered U.S. weather alerts. The earlier build exposed twelve optional layer IDs. [Baseline log](dwd-before-audit.log) · [Before screenshot](screenshots/dwd/audit-dwd-before-events.png).

The existing Weather group, Events, Official bulletins, Data details, globe and saved-place view now share one optional Deutscher Wetterdienst source. The main process reads the German complete STATUS ZIP from a fixed publisher URL. Each bulletin retains its CAP identity, references, source issue time, original text, named areas and validity information. CAP polygon exteriors and exclusions become map geometry. Named areas without published geometry remain readable in lists. A saved-place intersection describes the supplied horizontal footprint. Unlocated portions and altitude restrictions limit the geographic result.

One complete compressed archive is retained in SQLite for restart. A successful conditional check updates the check time. The archive's receipt time, publisher modification time and CAP issue times stay distinct. Expiry and onset can update the display during an outage. A failed or incomplete refresh retains the prior complete snapshot and its timestamps. The layer shares its five-minute check and publisher-requested pauses with Provider settings. Enabling the layer requires no new account or API key. [DWD research and attribution](REGIONAL_WARNING_RESEARCH.md).

This adds live-list and map support for Germany and the published marine areas. DWD Replay, archive comparisons, area-watch notifications and briefing exports remain open. Canada and Norway are separate research candidates with different transport and usage conditions.

On November 12 at 01:14:40 UTC, the parser read a 120,665-byte official archive with 21 warnings and 3,670 named area blocks. Sixteen warnings contained 91 usable polygons. Five marine bulletins supplied only geocodes and no expiry. Seven local runs took 54.45–95.01 ms on this machine. These are parser timings for that archive. The adapter caps downloads at 2 MiB, expanded contents at 64 MiB, each entry at 4 MiB and the archive at 2,000 entries. An oversized package produces a visible refresh failure. Unsupported circle geometry is omitted and the place remains geographically unresolved. [Original source and fixture hashes](../tests/fixtures/dwd-cap/source.json) · [Parser limits](../src/shared/dwd.ts).

The production build, typecheck and 852 tests in 54 suites passed. The package build reported zero included credential providers. All 350 production files, license notices and samples matched the installer payload. The unsigned installer is 127,538,860 bytes, SHA-256 `7F2496FFAA55628133FE35552DC1FED27EBAE54E0F5D987D1570E9CCFC441013`. Windows installation and installer-driven upgrade have not been exercised. Vite still reports its existing large-bundle warning. [Package audit](dwd-package.log).

Eight isolated packaged runs exercised controlled HTTP responses. With no previous snapshot, a 503 and an unmatched 304 both left coverage unknown. A publisher-requested pause survived restart. A complete 200 response followed by a matching 304 preserved the CAP issue, publisher modification and original archive receipt times. Under a subsequent failed refresh, a finite warning expired on the wall clock and disappeared from the map, while an open-ended warning stayed in the last-observed list. A complete empty response stayed empty across a separate 304 restart. Each process closed with zero renderer or test framework errors. The controlled responses were synthetic. [Packaged conditions](dwd-conditions.log) · [Last-observed expiry](screenshots/dwd/audit-dwd-controlled-retained-failure-expiry-final.png).

Two runs of the unpacked Windows executable exercised the real publisher and the normal app controls. At 01:38 UTC on November 12, DWD returned 21 warnings. The independently read ZIP matched all 21 CAP records, 3,670 area blocks, 91 polygons, 11,496 coordinates and 3,579 geocodes. No exclusion rings occurred in that live sample. Exclusions and cancellations have separate fixture coverage. Restart sent conditional headers and DWD returned a genuine HTTP 304. On each run, the Provider settings test reused the layer's existing successful check. Both processes closed with zero renderer errors. Their ASAR SHA-256 matched the installer. [Live packaged check](dwd-packaged-audit.log) · [Events after enabling DWD](screenshots/dwd/audit-dwd-live-events.png).

The live interaction checks exposed and fixed two selection problems. A selected warning now opens with its original headline visible even after scrolling another bulletin. Choosing a saved place, NWS alert or USGS earthquake after a DWD warning switches the details to the chosen record. At the test point in Germany the saved-place view showed the one independently confirmed polygon intersection. The other twenty warnings had unlocated portions. Clicking a polygon opened its source bulletin, named-only warnings opened without a map position or Focus button, and live DWD records stayed out of recorded Replay. [Warning headline](screenshots/dwd/audit-dwd-live-unmapped.png) · [Map selection](screenshots/dwd/audit-dwd-live-map-pick.png) · [Saved-place intersection](screenshots/dwd/audit-dwd-live-saved-place.png).

## Rule before implementation

Inspect the current source, matching tests and the later sections of `FEATURES-v0.4.md` before adding a feature.
An older README/matrix absence claim is not evidence of a missing implementation. Preserve the existing workflow
and improve it in place when possible. Do not treat a button or a passing fixture test as live verification.

## Access and baseline

- Repository accessible, initially clean; no project `AGENTS.md` found by repository file search.
- Electron main/preload, React/TypeScript renderer, CesiumJS, built-in SQLite. Main owns JSON adapters, persistence
  and validated IPC; renderer has explicit tile/media/image destinations. No architecture rewrite is needed.
- Commands: `npm.cmd run dev`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run smoke`,
  `npm.cmd run dist`. Node modules, prior build, screenshots, tests and packaging configuration are present.
- Terminal/testing and Windows computer-use tools are available. Desktop smoke works outside the restricted sandbox.
- Baseline typecheck passed. All 365 baseline tests passed outside the sandbox; inside it, the existing temporary
  directory-junction security test received Windows `EPERM`. The test was not weakened or skipped.
- Baseline desktop smoke: globe ready, no renderer errors, NWS 391 alerts and USGS 320–324 events on this run.
  Counts are observations at test time, not coverage guarantees. Screenshot: `screenshots/audit-before.png`.

## Initial inventory (source-backed; later increments below supersede changed rows)

| Capability | Existing implementation evidence | Status in this audit |
|---|---|---|
| Globe, progressive imagery, terrain, vector context and buildings | `map/basemaps.ts`, `gibsProvider.ts`, `usgsProvider.ts`, `terrain.ts`, `vectorTiles.ts`, `buildings.ts` | Eleven-view live tile route exercised. Visual inspection found a marine-area fill defect, isolated and repaired in the existing vector context renderer. Final repeat recorded separately. |
| Label hierarchy, collisions, local script, independent controls | `map/placeLabels.ts`, `map/layerRender.ts`, `components/SettingsDialog.tsx` | Implemented; preserve. Full per-city readability recheck pending. |
| Aircraft, symbols/models, follow, recorded trails, search, filters, airports, watchlist | `layerRender.ts`, `vehicleModels.ts`, `vehicleClass.ts`, `aircraft.ts`, `Pages.tsx`, `TrafficBar.tsx` | Implemented; initial reliability repairs verified. Volunteer receiver coverage is incomplete. |
| AIS, static/voyage details, vessel symbols, watchlist | `main/layers/aisstream.ts`, `layerNormalize.ts`, `layerRender.ts`, `Pages.tsx` | Regional keyless adapter exists; AISStream requires customer key. Socket fixes fixture-tested; no live key used. |
| Vehicle photos, exact identification, reported route | `vehicleInfo.ts`, `route.ts`, `components/VehicleExtras.tsx` | Implemented; route selection race repaired. Schedules/status unsupported by connected sources remain unavailable. |
| Cameras, HLS, stills, official links, directory, filters, favorites | `CameraPlayer.tsx`, `Pages.tsx`, `cameraSources.ts`, `keyedCameras.ts` | Implemented; retry/filter/truthful media repairs verified. Keyed catalogs require credentials; no new catalog added. |
| Layer manager, source health, provider setup/tests | `LayersPanel.tsx`, `ProvidersDialog.tsx`, `providerService.ts`, `layers/manager.ts` | Implemented; not duplicated. Each live/credentialed integration needs its own verification. |
| Dated imagery, playback, swipe, GOES/Himawari frames | `imageryOverlay.ts`, `gibsCatalog.json`, `geoSatellite.ts`, `Globe.tsx` | Implemented (23 catalog products). Preserve actual frame times and geographic limits. |
| NWS alerts, USGS quakes, saved places, evaluation, history, CSV, HTML/PDF briefings | `core.ts`, `store.ts`, `monitoring.ts`, `csv.ts`, `briefing.ts` | Tests pass; NWS/USGS live-verified this run. Export UI/persistence migrations not all rerun. |
| Incidents, Ops register/trends/countries, boards, team directory, official bulletins | `incidents.ts`, `components/Pages.tsx`, `store.ts` | Implemented; no new competing dashboard. Cross-source matches are not independent verification. |
| Measurement, annotations, saved views/scenes, recorded replay, HUD, styles | `ToolsPanel.tsx`, `PlaybackBar.tsx`, `visualModes.ts`, `store.ts` | Implemented; preserve. Replay is recorded-only, styles simulated. |
| Markets, news context and Lemmy Community | `main/markets.ts`, `main/lemmy.ts`, renderer pages and matching tests | Implemented; fixtures tested. Credentialed market data, authenticated writes and redistribution rights unverified here. |
| Optional local AI | `main/ollama.ts`, `shared/ai.ts`, `analyst.ts` | Implemented; no real Ollama model exercised in this audit. |
| Multi-camera boards, cockpit, satellite passes, wind/lightning, voice | No complete workflow established in current audit | Missing/deferred. General boards, follow, orbital positions and weather satellite already exist and must not be recreated. |

Paths without a prefix in the table are under `src/shared`, `src/main` or `src/renderer` as named. See
`REFERENCE_RESEARCH-2026-11-11.md` for primary-source comparison, cost/license boundaries and candidate work.

## Current repair increment

- Camera stream retry can initialize again after offline/error fallback; stale reconnect timers are disposed.
- Still image failures can recover by manual retry or scheduled refresh; publisher URL queries stay intact.
- Camera directory handles date-line bounds, distinguishes official viewer links and lists loaded publishers.
- Late route lookups cannot replace the route of another selected aircraft or a changed callsign.
- AIS subscriptions wait for open, decode binary frames, coalesce viewport updates, split date-line boxes,
  include supported Class B messages and ignore replaced sockets. Metadata and observation retention are bounded.
- Smoke runs now get a temporary user-data profile as well as a temporary database, avoiding saved user credentials.
- Stale README claims are corrected; the older feature matrix is explicitly historical.
- Large batched aircraft layers now dim and expire during provider outages, matching the smaller entity renderer;
  camera movement and model removal do not revive expired reports.
- Cape Town ocean rectangle: isolation proves it is the vector context overlay, not terrain or NASA imagery.
  Real OpenFreeMap tile `12/2257/2458` contains Robben Island marine protected-area rectangles. Generic park fills
  painted them green. Context land fills now exclude the same tile's ocean geometry, preserving island holes and
  roads. No extra overlay or invented coastline was added.
- Cesium's synthetic white wave shader obscured coastlines independently of that rectangle. Default shading is
  disabled, including after weather-satellite toggles; actual sea-level geometry and water masks remain.

## Validation and next steps

Completed: typecheck, all 389 unit/regression tests, production build and Windows NSIS installer generation.
Four additional real Chromium raster assertions pass with `node scripts/check-vector-context.mjs` (ocean
transparency, retained land fill, island holes and roads over water). No new dependencies were added.

Desktop camera scenario (`scripts/qa-cameras.js`) loaded 8,781 real catalog entries. Official viewer filtering and
the Québec viewer state worked; a real still loaded and reloaded. A Caltrans stream advanced 14.38 seconds at
320-pixel width, then 6.69 seconds after retry. Failure events were deliberately injected in the test DOM to
exercise retry controls; no fake camera or stream was inserted into production data. Renderer errors: none.
Screenshot: `screenshots/audit-cameras-after-scenario.png`. No customer-key catalog was exercised.

Worldwide baseline: New York, London, Frankfurt, Dubai, Tokyo, Singapore, Sydney, Cape Town, São Paulo, Anchorage
and the antimeridian all settled with zero pending tiles, zero terrain failures and zero render errors.
USGS returned 38 out-of-coverage tile 404s near Anchorage; this is recorded, not hidden as a successful imagery
request. NASA/vector fallback remained visible. Source logs: `worldwide-audit.log`; isolation: `ocean-isolation.log`.
Final map repeat passed: all eleven views settled with no pending tiles, no terrain failures and no render errors;
the same 38 USGS coverage 404s occurred near Anchorage. All eleven final screenshots were visually inspected.
The Cape Town rectangle and synthetic white highlights are gone. A thin source seam remains at the antimeridian
at overview scale; the existing GIBS edge repair does not guarantee a seamless source mosaic.
Evidence: `worldwide-audit-after.log` and `screenshots/audit-worldwide-after/`.

Installer: `release/Atlas-Watch-Setup-0.7.0.exe`. Unpacked app: `release/win-unpacked/Atlas Watch.exe`.
Generated ASAR contains the main/preload bundles, renderer HTML and Cesium workers. The installer is unsigned;
installation/upgrade was not performed. No performance improvement is claimed; the baseline route records
24 long tasks totaling 2,430 ms (maximum 243 ms), renderer CPU 40.9 s and GPU-process CPU 29.4 s on this machine.
The final same-view route recorded 17 long tasks totaling 1,724 ms (maximum 267 ms), renderer CPU 51.8 s and
GPU-process CPU 41.6 s. Tile loading and route durations differed; these are raw observations, not a controlled
speedup claim. Vite still warns about the existing roughly 7.2 MB renderer bundle; code splitting is deferred.

### Launch and artifacts

From the project folder:

```powershell
cd C:\Users\infob\Documents\Claude\Sky_View
npm.cmd run dev
```

For the built production bundle, use `npm.cmd start`. End users can use the installer or unpacked executable;
they do not need Node installed. Existing `%APPDATA%\Atlas Watch` data was not migrated or cleared in this increment.

- [Installer](../release/Atlas-Watch-Setup-0.7.0.exe), 127 MB approximately, unsigned.
- Initial repair installer SHA-256: `CCBE519B24BC00E19786BE47156EBB1C02968CB0D5C8E6A7449BD9608C08BD04`.
  The continuation artifact below supersedes this file/hash.
- [Map before](screenshots/audit-worldwide/cape-town.png) and [map after](screenshots/audit-worldwide-after/cape-town.png)
  use the same Cape Town position, altitude and hardware.
- [Live camera and recovered player](screenshots/audit-cameras-after-scenario.png).
- [Historical feature matrix](FEATURE_MATRIX.md), [current implementation notes](FEATURES-v0.4.md),
  [current reference comparison and sources](REFERENCE_RESEARCH-2026-11-11.md).

Reproduce camera QA with `ATLAS_WATCH_SMOKE_JS` set to the absolute `scripts/qa-cameras.js` path and
`npm.cmd run smoke -- <screenshot.png> 150000`. Reproduce the eleven views with `ATLAS_WATCH_SMOKE_VIEWS` set to
`scripts/qa-worldwide-views.json`'s absolute path, `ATLAS_WATCH_SMOKE_OUT` set to an existing output directory,
and `npm.cmd run smoke -- <screenshot.png> 800000`. Profiles/databases are temporary by default. The smoke command
checks a normal result for renderer errors, or requires every configured view and zero render errors for a route.
Review imagery warnings and screenshots as well: a successful navigation check does not prove perfect imagery.

The reference's latest published release was researched as v0.3.0 (`72eb3fd`); current branch HEAD was not reliably
available through the network/cache. Never label that as a fresh main-branch checkout.

## Coverage, cost and remaining work

| Area | Coverage and access | Remaining verification or implementation |
|---|---|---|
| Map/terrain/vector context, coordinates and bundled places | Worldwide keyless; photographic detail varies. USGS high-resolution imagery is U.S.-regional; NASA global base is coarse. | Optional Google/Esri/Mapbox/EOX need configured credentials/license and may be metered. No new paid request was exercised. |
| Weather alerts and radar | NWS/NOAA, U.S. coverage; zone/polygon uncertainty remains explicit. | Non-U.S. warning adapters not connected. Do not show U.S. alerts as another country's warnings. |
| Earthquakes | USGS worldwide feed; distance to epicenter is not shaking/damage. | Existing live feed checked; no risk scores added. |
| Aircraft | Existing adsb.lol receiver-dependent queries; optional OpenSky snapshots have separate terms. | Current repair tested aging/expiry. Real route matching, schedules and every regional receiver were not exercised here. |
| Vessels | Fintraffic keyless in Finland/northern Baltic; AISStream requires customer key, coverage depends on AIS receivers. | `Providers → AISStream.io`: save own key, test and enable Vessels. Binary/socket handling tested; no live key available. |
| Cameras | Seven open publisher adapters in five countries/regions; customer-key systems are optional. Catalog availability is not playable-media availability. | `Providers → Camera keys`: publisher signup/terms → save own key → Test. 22 keyed systems remain unverified without real keys. Single-player workflow retained; multi-camera boards deferred. |
| Weather satellite | Existing GOES/Himawari footprint and product/time limits; no complete Meteosat coverage. | Satellite frame UI is preexisting; not reverified in this increment. Wind/lightning remain missing. |
| Photos and journeys | Existing matched/attributed photos, usual callsign route when returned. | Source-backed departure/arrival times, cancellations and confirmed port calls not connected. Late-response guard fixed; flight-data provider verification remains. |
| Markets / Community / AI | Existing optional market plans, configured Lemmy instance/account, loopback Ollama model. | Provider rights and costs remain account-specific. No billing activated, account created, authenticated write sent or local model run. |
| Other reference candidates | Cockpit, satellite passes, street imagery, multi-camera monitoring, GeoJSON imports/watch rules and local voice are not completed workflows here. | Explicitly deferred after core repairs. Reuse follow, orbit, boards, annotations and provider infrastructure; inspect current code again before implementation. |

No uniform worldwide data coverage, full reference parity, complete performance optimization or universal camera
availability is claimed. See the reference research for licensing and candidate-by-candidate evidence.

No new accounts, billing, deployments or messages were created. No stored user locations, watchlists or history were changed.
No measured performance improvement or full reference parity is claimed. Broader feature work remains after this repair increment.

## Continuation — missing workflows and source-date reliability (2026-11-11)

The active goal includes the full attached worldwide-upgrade brief. The preceding repair handoff did not complete
that brief. The previous goal turn was **progress**: code and verified runtime evidence changed. The new attachment
was read in full and found to contain the same specification. [REQUIREMENTS_AUDIT.md](REQUIREMENTS_AUDIT.md)
now maps phases 1–10, every numbered Phase 7 improvement, feature families, invariants and all 13 final deliverables.
The full objective remains active; missing and unverified rows are not redefined as completed by this increment.

Before adding each workflow, searches established the existing scope: satellite positions/orbit existed without
observer pass events; generic SQLite boards and camera favorites existed without simultaneous players; tracking
existed without a cockpit perspective. These implementations were extended, rather than recreated.

| Workflow | Implementation / source evidence | Verification and limits |
|---|---|---|
| Satellite pass predictions | `shared/satellitePasses.ts`, `renderer/map/satellitePassWorker.ts`, `components/SatellitePasses.tsx`, existing RecordDetails/saved places | 12 regressions include independently published Skyfield ISS event times, geometric position, grazing/window-clipped/GEO/polar passes, date line and stale/invalid elements. Real CelesTrak ISS: six New York and two saved antimeridian passes. No sunlight/weather/terrain visibility guarantee. |
| Bounded multi-camera boards | `shared/cameraBoards.ts`, `components/CameraBoard.tsx`, existing Pages/SQLite board documents and CameraPlayer | Six focused unit/persistence tests; six real camera references persisted without URLs. Four cards, two real HLS streams advanced about 7.3 s. Pause, hidden-window, close, viewer links and reopening from Boards passed. Caps: 32 references/group, four visible cards, two HLS streams. |
| Cockpit perspective and bulk follow | `shared/trackingCamera.ts`, `renderer/map/trackingCamera.ts`, TrackingControls, existing Globe/App/LayerRenderer | Fresh real aircraft UAL858: follow altitude 11,868.5 m, cockpit 10,668 m, Escape/stop passed, zero renderer errors. Final live mode-switch repeat was blocked by repeated adsb.lol network failures. A separate real Chromium/Cesium fixture harness passed 3D→2D→3D, refusal while morphing, restored controls/pose/visibility, stale exit and continued rendering; a negative control reproduced the original exception. Camera simulation does not establish aircraft attitude. |
| Live imagery date availability | `shared/imageryDates.ts`, existing imageryOverlay/LayersPanel and Globe availability subscription; `renderer/lib/imageryHealth.ts` | Source-checked Terra latest 2026-11-11, actual gap navigation, historical GRACE bounds and malformed-period disclosure passed strict desktop checks. NASA lists GRACE December 2022 but its tiles returned 404; visible per-date failure status was verified. Explicitly choosing July 2022 rendered actual red/blue data, final screenshot 52 loaded / 0 failed / 0 pending. Bundled bounds remain a labeled fallback. |

Additional tracking repairs: normal follow now uses a stable position anchor through entity/batched transitions;
cockpit hides its own model/icon and limits nearby aircraft/vessel symbols to 75 km. It rejects stale, missing,
grounded, snapshot or terrain-intersecting reports and restores camera controls on exit. Cleanup occurs before
2D morphing, and the controller never requests a transform during a morph. Aircraft normalization retains ground
track and true heading separately; heading alone is not used to extrapolate ground movement. Worldwide snapshot
positions now remain fixed in either renderer, including after filtering reduces a large layer to a small set.

Current source validation: typecheck/build pass; **452 unit/regression tests pass across 31 suites**. The satellite
worker is a separate local asset. All current scenario processes have exited; their logs distinguish live public
integrations, deliberately injected player errors, simulated visibility events and the separate native-engine
fixture harness. adsb.lol failed repeatedly during the final live cockpit repeat; this is not counted as a live
mode-switch pass. No renderer errors occurred in the successful camera, satellite, imagery or native-engine checks.

The expanded camera focus scenario verifies the app-wide edge case: a real Data-panel player was already mounted
behind the board, yet there were only two video elements globally. The background player disconnected and resumed
on close; hiding the ordinary player also released media. Both real board HLS streams advanced 7.3–7.6 seconds.
Evidence: `camera-boards-focus-audit.log`, `screenshots/audit-camera-boards-focus-scenario.png`.

Imagery status counts actual completed/failed requests separately per comparison date, excludes scheduler deferrals
and cancellations, coalesces UI updates and ignores obsolete selection callbacks. A loaded tile can still contain
clouds or no observations; metadata availability is never presented as proof of raster availability. The browser-only
native-fetch receiver issue discovered by desktop QA was repaired and regression-tested. Shared NASA metadata
cooldown prevents product changes/force checks from bypassing 429/503 waits.

Aircraft rate-limit repair uses existing per-source state and scheduler: stops later grid batches on 429/503,
shares adsb.lol limits across aircraft/military layers, preserves partial observations and original timestamps,
prefers fresh duplicates, includes the oldest contributing source time, and resumes scheduled polls. Independent
local receivers and opted-in OpenSky remain usable. Fourteen targeted cases include pans/force/toggles, source
switches, delayed concurrent limits and cached payloads lacking source clocks. No live throttling was induced.

Antimeridian isolation proved the line persists without terrain/overlays and disappears without base imagery.
The actual NASA z5/y17/x31 tile has a half-dark last column (mean 39 versus 73 next door), affecting 254/256 rows.
The old near-black threshold missed it. The existing edge repair now recognizes this narrow high-agreement case,
replaces that one column from its neighbor and leaves every other pixel unchanged. A raw NASA regression fixture,
gradient/coastline guards and before/after screenshots verify the repair. The dark line is reduced; a slight source
brightness step remains. Evidence: `antimeridian-isolation.log`, `antimeridian-after.log`,
`screenshots/audit-antimeridian/anti-imagery-only.png`, `screenshots/audit-antimeridian-after/anti-imagery-only.png`.

Provider/UI consistency repaired in place: README distinguishes optional restricted OpenSky/Esri from excluded
endpoints; Organization describes included-vs-saved credentials accurately; camera source notes distinguish video,
stills and viewer links; global map news cards remain distinct from existing Markets GDELT context.

No new runtime dependencies, paid providers, accounts, billing, deployments, messages or production-data migrations
were introduced. The current unsigned installer was rebuilt successfully at `release/Atlas-Watch-Setup-0.7.0.exe`
(127,476,753 bytes). SHA-256: `572639E442A37FC80D2865568132108F44F1DE8F44309669DD94E255262D51A1`.
The packaged ASAR has 409 entries; extracted main/preload/renderer bundles and satellite worker are byte-identical
to the just-built output. Installation/upgrade and every optional credentialed provider remain unverified.

Current evidence links: [camera board](screenshots/audit-camera-boards-focus-scenario.png),
[satellite passes](screenshots/audit-satellite-passes-visible-scenario.png),
[imagery and actual raster health](screenshots/audit-imagery-dates-raster-scenario.png),
[native cockpit check](tracking-camera-engine-audit.log), [initial real cockpit check](tracking-camera-audit.log).

Next required work: the shared HTTP `parseRetryAfter` in `main/feeds/http.ts` still truncates waits above one hour.
Resolve that existing standards/reliability gap and safely handle long timer deadlines before claiming universal
Retry-After compliance. Then continue missing/partial rows in the requirements audit, including authorized street
imagery, broader transport/weather, watch areas/imports,
unified timeline/workspaces and the evaluated Phase 7 candidates. Credentials/rights block particular integrations,
not unrelated implementation. Do not mark the goal complete from the checks above.

## Continuation — local imports, external Street View and publisher waits (2026-11-11)

Duplicate checks preceded every addition: map drawing/annotations, scene files, saved locations/CSV, current Events,
NWS/USGS history, movement replay, generic boards and saved views were inspected. GeoJSON extends existing Map tools,
annotation storage and native file services; it creates no competing import page or new database schema. Watch rules,
a unified historical cursor and investigation scene state remain separate gaps in the existing workflows.

### Publisher-requested waits

The shared HTTP parser no longer truncates Retry-After above one hour. Main and NASA metadata clients share the
standards parser: integer seconds, UTC HTTP-date forms, upward rounding and the obsolete fifty-year year rule.
Huge integer delays saturate at the representable Date boundary. Feed and layer timers keep the true displayed
deadline while reaching it through non-overflowing timer hops; refresh/settings/pans/toggles cannot shorten it.
All three structured source-fetch paths use safe absolute deadlines. Explicit waits apply beyond 429/503,
including delayed redirects, without retaining camera catalogs rejected as invalid credentials.

The existing main-process HTTP boundary now shares origin cooldowns across background feeds, lookup actions and
provider tests. Independent origins remain usable. Already-started responses cannot shorten a newer wait; error
and redirect bodies are released. A 256-origin bound has a conservative overflow deadline for an unusual burst
of distinct origins. This state is session-local; restarting the process does not preserve it. No claim of universal
publisher-limit compliance across every third-party renderer/media client is made.

Evidence: `tests/http-retry.test.ts`, `core-retry.test.ts`, `layer-deadlines.test.ts`, `feed-deadlines.test.ts`, expanded
imagery tests, and [native HTTP integration](http-retry-integration.log). The latter uses real native fetch and temporary
loopback servers, never induces throttling on public providers. It passed a forty-day wait, alternate-path blocking,
independent-origin success, deadline resumption, an enormous serializable delay and delayed-redirect blocking.
Primary technical sources: [RFC 9110 Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3),
[HTTP date rules](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7),
[Node timeout limits](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args).

### GeoJSON in existing Map tools

Import chooses a local file and displays candidates, exact geometry/name duplicates and rejected features before
writing anything. A mixed import requires explicit acknowledgement of skips. Main reparses the bounded raw text
against current SQLite rows, generates fresh IDs and commits atomically; existing annotations are not overwritten.
Repeated import, including after restart, skips existing geometry/name matches. Export reads only stored annotation
geometry/name/color/visibility; source IDs, foreign properties, saved places, notes and credentials are excluded.

Supported subset: two-dimensional WGS84 Point, LineString and simple Polygon with one exterior ring. Holes, Multi
geometries, altitude, CRS declarations, physically zero-length lines, invalid/self-intersecting rings and globe/pole
wrapping are rejected explicitly. Limits: 2 MiB UTF-8, 2,000 features/stored annotations, 5,000 positions per geometry,
20,000 supported positions per file and a shared 1,000,000-comparison geometry budget. Successful exports satisfy
the same import limits, close/orient rings and round-trip all 2,000 Unicode-named test pins. Globe edges follow
geodesics between vertices, which can differ from RFC 7946's straight coordinate segments; this is disclosed in Tools.

The actual native picker opened, but the Windows helper could not operate its controls (`coordinate input geometry
is unavailable`; indexed value setting also failed). That run was closed as failed and is not a native interaction
pass. A temporary test bootstrap then replaced only chooser/save results and OS browser dispatch. Production assets
and Electron isolation stayed unchanged. The first temporary launcher had a quoting error; it was corrected and a
syntax check was added before launching it. This was a test-runner error, not a production-source exception.

The final adapted desktop run exercised the real built main, preload, renderer, capped UTF-8 file reader, validated
IPC and SQLite: 3 ready / 1 duplicate / 5 rejected; acknowledgement gating; original row preserved with 3 imported
rows; repeat import added 0 and skipped 3; the real saved export contained 4 whitelisted features; restart restored
all 4 and the Unicode name. Both runs had zero renderer errors and received real NWS/USGS data. The local annotation
fixture is explicitly test input, never a production-provider fallback. Native chooser interaction remains unverified.

Evidence: [adapted desktop and restart log](geojson-adapter-audit.log),
[preview](screenshots/audit-geojson-preview.png), [restored Tools](screenshots/audit-geojson-restart-scenario.png),
42 focused parser/transaction/IPC regressions and the independent review. Root visually inspected preview, imported
map and restarted map. The controlled bootstrap and its adapters live only in a temporary directory and are absent
from the packaged archive.

### External Street View

Map tools now offers a user-clicked Google Maps Street View handoff. It picks the current screen-center intersection
at click time; morphing or a view past the globe returns an actionable unavailable state. The view is explicitly
external/historical, with variable coverage and Google's nearest panorama selection. No imagery is embedded,
downloaded, cached or copied, and no new API credential, provider, destination grant or fee is introduced.

Twenty-seven URL/bounds fixtures cover worldwide coordinates. The real Cesium desktop check picked latitude
51.5256808708 while the tilted camera subpoint was 51.5, refused a skyward view and picked successfully in 2D.
The actual validated external-link IPC handed the correctly rounded coordinate URL to the test shell adapter.
No default browser was opened and no real panorama availability was verified. This is a partial street-level
workflow, not an in-app panorama layer. [Official-source, cost and rights notes](STREET_VIEW.md).

### Current validation and artifact

- Full regression suite: **560 tests, 37 suites passed**. Typecheck and production build passed. After the only
  subsequent production edit (the geodesic explanatory text), `npm.cmd run dist` reran typecheck/build and succeeded;
  the adapted desktop/restart scenario passed again on those final assets.
- Latest unsigned installer: `release/Atlas-Watch-Setup-0.7.0.exe`, **127,487,376 bytes**.
  SHA-256: `F37583701C9B127266C30F63206DEE559C34936E8EE9165C1E905A32DD9A6EA8`.
- [Package verification](package-audit-2026-11-11.log): 409 ASAR entries; extracted main/preload/HTML/renderer and
  satellite worker byte-identical to current build; QA bootstrap/fixtures/credential source excluded.
- Installer installation/upgrade was not performed. Native file-picker input, real external-browser opening and
  optional credentialed providers retain their explicit verification limits.
- The existing large renderer chunk warning remains (~7,252 kB minified). No FPS/memory improvement is claimed
  for this increment. No runtime dependency, migration, account, billing activation, deployment or message was added.
- Fresh reference check again established release v0.3.0, full SHA `72eb3fdc739991a1286b7f1251de908e9744bb2a`.
  Current main HEAD remains unverified (DNS/API/cache limits); the research note records the exact evidence.

Launch: run the installer above, the unpacked `release/win-unpacked/Atlas Watch.exe`, or use `npm.cmd run dev` from
the project folder. Current comparison, worldwide coverage, credential setup and cost/rights limits are in
[README](../README.md), [feature matrix](FEATURE_MATRIX.md), [requirements audit](REQUIREMENTS_AUDIT.md) and
[reference research](REFERENCE_RESEARCH-2026-11-11.md). Earlier before/after screenshots and live tracking/camera/
imagery evidence remain linked in their dated sections above; they are not new performance or coverage guarantees.

Next unblocked work remains: link configurable rules to existing drawn/imported watch areas with persistent
notification deduplication; extend the existing history/recording surfaces with a shared timeline (retain revisions
before claiming as-of reconstruction); extend existing scenes for investigation state with v1 compatibility; research
and connect suitable broader weather/transport products. Native picker/browser verification, real-key AIS and
optional model/provider rights are specific limits, not reasons to halt unrelated work. The complete objective is
still active and incomplete.

## Earthquake area watches and date-line weather

**November 11, 2026.** The pre-change check found area drawings in Map tools, USGS radius matching for saved
points, an existing notification bell, and METAR markers already colored by station flight category. This work
extends those surfaces. A review of the README's local links found all referenced files. The development
instructions now reflect the locked Cesium Node 22.17 minimum and the two install-script approvals already in
`package.json`. Build verification used Node 24.22.1 and npm 11.19.1.

**Saved areas.** From Map tools, open an existing area's USGS watch control, set its minimum magnitude and save.
One rule belongs to one annotation. You can pause it, re-enable it or remove it. Match details show the area
name and threshold at detection, USGS event ID, reported origin time, magnitude, coordinates, local detection
time and the publisher URL when supplied. Read status survives restart. Rule or area removal clears only that
watch's evidence. Caches, missing timestamps, future origins and non-earthquake event types never generate a
match. The USGS query and polling schedule come from the existing earthquake settings. See the
[area-watch operating notes](../README.md#using-it) and [live desktop audit](area-watch-audit.log).

**Bounds and uncertainty.** The polygon test includes its boundary, handles equivalent ±180° longitudes and
uses straight segments in unwrapped longitude/latitude. The globe draws geodesic arcs. The editor explains
the distinction for long edges. Validation rejects self-intersections, pole-touching and globe-wrapping areas.
Rules share 20,000 enabled vertices. Each poll checks at most 10,000 reports, 100,000 candidate pairs and
2 million in-bounds vertex visits. A partial check keeps the previous complete-check timestamp and reports the
limit reached. Up to 500 notifications are retained across all rules. Deduplication has separate 31-day
retention and includes associated publisher IDs. The first live check exposed a validator that rejected the
timestamps on a persisted rule. The repair and its regression test preceded the successful desktop repeat.

**Desktop evidence.** In an isolated profile, QA set up local areas with a simulated prior activation time.
The final built app retrieved 198 real USGS features from the past-day feed generated at 16:31:30 UTC.
It saved 141 matches. Their IDs, origin times, magnitudes and coordinates matched the publisher response.
A new rule created through the UI skipped the backlog. Pause, threshold edit, re-enable, evidence details,
map focus and marking matches read worked. After restart the 16:33:30 UTC feed contained 199 features.
All 141 existing match IDs and read flags persisted. The second response contained one additional matching
report for a previously armed area. Its origin time preceded the restart and the rule created through the UI. Its saved values also
matched the actual feed. Both runs reported zero renderer errors.
[Area editor](screenshots/area-watch-live/audit-area-watch-live-controls.png) ·
[Notification bell](screenshots/area-watch-live/audit-area-watch-live-bell.png) ·
[Saved evidence](screenshots/area-watch-live/audit-area-watch-live-details.png).

**Weather.** The old METAR adapter clamped a date-line viewport at 180°. It now requests both ordinary
bounding boxes, observes at least 600 ms between request starts and keeps the most recent report per station.
An unsuccessful half leaves the previous complete data and its timestamps in place. At 16:28 UTC the normal
adapter received two HTTP 200 responses showing NFFN and NFNA in Fiji, and NFTF and NFTV in Tonga. All four
stations reported observations for 16:00 UTC. The calls started 608 ms apart and skipped zero records. The
existing map now updates a reused station point's color when its report changes. Its source details explain
the same four category colors and the unknown state. Geographic coverage follows reporting stations. The
publisher documents the response limit, HTTP 204 for an empty result and its station color conventions.
[NOAA API](https://aviationweather.gov/data/api/) · [NOAA observations legend](https://aviationweather.gov/gfa/help/).

**Compatibility.** The original v0.7.0 store from commit `a22dcb09ea6144d4899a373ab25c4f70931cd129`
wrote a fixture with nondefault settings, a saved location, watchlist, area, view, board, contact, cached feed,
event history and a recorded track. The new store opened a copy, attached a watch to the old area, closed and
reopened. Every pre-existing row in all nine tables survived and the foreign-key check passed. The test used
an isolated profile. [Upgrade-copy audit](store-upgrade-audit.log).

**Build.** Typecheck, all **625 tests in 42 suites**, and the Windows production build passed. The
unsigned installer is **127,501,580 bytes**, SHA-256
`20C6F55B8C2503B1FBD052CD19856E3B045C6D1499CBBE776B5F0AE1FBB58FBE`. The actual installer's
embedded ASAR matched the unpacked archive. All 350 files in dist, third-party notices and the two sample files
matched their packaged bytes. The installer was inspected without executing it. The existing large renderer
bundle warning persists. [Package audit](package-audit-2026-11-11.log).

**Reference comparison.** A fresh direct Git check resolved the previously unknown main branch to
`aa95c2c25f2d4428b52d3dfcb8ac2a8d83f15a7a`. The latest published release was v0.3.0 at
`72eb3fdc739991a1286b7f1251de908e9744bb2a`. The research record now distinguishes the branch's new
snapshot-timeline and weather implementation from the published release, and links to the actual modules.
[Pinned reference research](REFERENCE_RESEARCH-2026-11-11.md).

The remaining work includes a shared historical timeline, investigation-state restoration in existing Scenes,
broader weather and transit products, and credential-dependent provider checks. Actual installer installation
and upgrade, native file-picker input and the external-browser panorama handoff remain unverified. The
existing eleven-view worldwide map audit has a different scope from this two-region live weather check.

## Shared historical timeline

**Duplicate check.** The existing History drawer already searched NWS/USGS events, Events already listed current incidents, and Replay already placed recorded movement fixes from four layers. The old event index replaced earlier payloads for the same source identifier. A desktop run on the previous build showed current earthquakes on the map while Replay reported no recorded movement. [Before screenshot](screenshots/timeline/audit-timeline-before-scenario.png) and [before log](timeline-before-audit.log).

**Implementation.** The original timeline now reads both movement and locally recorded NWS/USGS replies at the same UTC millisecond. The existing History drawer can open an event's last observation. The Data panel shows the recorded alert or earthquake, its source, its publisher times and when the app retrieved the reply. Zone alerts are searchable without polygon geometry. A successful empty reply, a partial reply, a failed or expired interval and a time before the first retained frame have distinct states. Other live data is hidden on the replay map. Saved places, drawings and the basemap provide current geographic context.

**Persistence.** SQLite stores normalized revisions by content hash and tracks membership in successive replies. Unchanged replies share revision and membership storage. History retention and storage caps can shorten the recorded period. Clearing alert/earthquake history also clears its recorded frames. An isolated v0.7.0 database retained its old event rows, feed cache and movement fix after upgrade. Cache loading and reopening produced zero recorded hazard frames. A subsequent recorded observation survived another restart. [Upgrade evidence](store-upgrade-audit.log).

**Storage and timing.** The archive caps observation boundaries at 20,000, revisions at the lower of 50,000 and the user's history limit, membership intervals at 200,000 and normalized payloads at 64 MiB. It also limits each reply to 10,000 members and 10 MiB, and each revision to 256 KiB. Oversized replies are marked partial. SQLite indexes and the write-ahead log take additional disk space. A local synthetic load of 500 alerts and 10,000 earthquakes took 111 ms to record both initial replies. Repeating the same two replies took 55–64 ms and added zero revision payloads. Frame reads took 28–34 ms. These are storage measurements on this machine. [Reproducible benchmark](../tests/timeline-benchmark.mjs) and [measured output](timeline-storage-audit.log).

**Build and README.** Typecheck, 663 tests across 44 suites, the production build and Windows packaging passed. The new unsigned installer is 127,504,481 bytes. Its SHA-256 is `2B27A1DEF8B3D5DCFD547061A0EF8C97C63BC872EB6484EB943730C3A266E5AC`. The embedded archive, all 350 dist files, both samples and the notices matched the build inputs. The renderer exceeds Vite's configured 6 MB chunk warning threshold. The README's local file links resolve, and the named npm scripts exist in the manifest. [Installer byte check](package-audit-2026-11-11.log).

The README's previous claim that Atlas Watch never ships its own keys contradicted the existing credential resolver and build summary. The provider setup section now distinguishes the two included market providers, recoverable distribution keys, encrypted customer-entered keys and the map keys used by the renderer. Credential values and settings were not read or changed during this documentation check.

**Desktop verification.** On the final production bundles, all 414 archived NWS identifiers/issue times and all 199 USGS identifiers/magnitudes/coordinates/update times matched the captured HTTP 200 replies. Clicking the M5.2 Mid-Indian Ridge earthquake opened its recorded source details. A real USGS refresh left the selected historical frame intact. Controlled historical fixtures exercised changed polygons, quake coordinates and magnitude, zone-only alerts, empty/unknown/partial/failed intervals and the last-observation jump. A temporary test adapter delayed or failed individual local frame requests to exercise rapid seeking, retry and exit. The run finished with zero renderer errors. An initial click check used a crowded point and could not identify the intended earthquake. The final run picked an isolated real event. [Desktop log](timeline-audit.log), [actual observation](screenshots/timeline/audit-timeline-actual-observation.png), [earlier fixture revision](screenshots/timeline/audit-timeline-old-revision.png), [later fixture revision](screenshots/timeline/audit-timeline-new-revision.png) and [recorded empty reply](screenshots/timeline/audit-timeline-recorded-empty.png).

**Packaged executable.** Two normal launches of `release/win-unpacked/Atlas Watch.exe` used temporary profiles and databases. Each recorded 414 NWS alerts and 325 USGS events from the default weekly M2.5+ query. The desktop helper identified the Atlas Watch window but could not read its controls or capture it. It reported “foreground window did not report a process id.” The final runner timed out. The packaged feed path was exercised. Visual verification used the separate Electron integration run above. Native installer installation and upgrade remain untested. [Packaged launch evidence](packaged-launch-audit.log).

**Remaining work.** Existing saved Scenes do not restore the playback cursor, selected record and filters together. Additional historical datasets, broader regional provider checks, credentialed integrations and installer installation/upgrade are tracked in the [requirements audit](REQUIREMENTS_AUDIT.md).

## Saved investigations in Scenes

**Duplicate check.** Named views, camera restore, saved annotations and scene-file import/export already existed. The previous build stored camera, basemap and enabled layers in a named view. Opening Scenes during Replay immediately left the timeline. An offline desktop run saved an earthquake view, moved away and restored it. The camera returned, but the selected event and its observation time were lost. The run used a synthetic historical earthquake and made zero provider requests. [Before log](scenes-before-audit.log) and [previous restored view](screenshots/scenes/audit-scenes-before-restored.png).

**Changes.** The same Save view action captures 2D/3D mode, camera, style, terrain, map visibility, severity and spatial filters, dated imagery configuration, Data panel, HUD, airports and the selected NWS or USGS identifier. Live views use the connected feed. Recorded views return to an exact local observation time with Replay's existing unknown, empty, partial and gap states. Restoring a recorded view preserves the current live USGS time window and magnitude query. An unavailable saved imagery date stays visible as a requested date and the map withholds the overlay. Switching to a different metered or license-dependent surface on restore offers the choice to keep the current surface.

**Files and storage.** Version 2 scene files share the display context, drawings and named views. The chosen event is a source identifier. Saved places, provider credentials and event payloads stay outside the scene schema. Opening a scene on another computer depends on that computer's retained observations. Version 1 files and old SQLite views retain their original field meanings. Import merges by document ID within one database transaction.

**Compatibility and import time.** An isolated copy of a database written by the prior v0.7.0 source retained every existing row across nine tables. Tests also exercised rollback on a failed scene import and retention of earlier saved-view fields. On this Windows machine, importing the same 500 pins and 50 named views took a median of 42.88 ms with the previous per-record dispatch sequence and 7.10 ms with the new transaction. The two paths used the same local handlers and separate fresh databases. Dispatches fell from 553 to one. The measurement covers validation, dispatch and SQLite. It excludes the file picker, Electron transport and drawing the result. [Upgrade-copy check](store-upgrade-audit.log), [timings](scene-import-timing.log) and [benchmark](../tests/scene-import-benchmark.mjs).

**Desktop verification.** The final built app saved and restored a 3D view of USGS earthquake `us7000txc3` (M5.2, Mid-Indian Ridge) and a 2D view of an NWS alert with a polygon. The selected records matched their providers' HTTP 200 responses. The local observation at 17:18:46.265 UTC included 410 alerts and 204 earthquakes. Both views reopened after an offline restart with their original cursor, camera, filters and selection. After the test cleared its temporary archive, the same view showed the saved source ID and an unavailable reply at that time. A live view used the current query. Dated MODIS settings survived the round trip, and Replay made zero GIBS requests. The two desktop processes reported zero renderer errors. V2 export/import and legacy files used a temporary file-dialog adapter. [Desktop log](scenes-audit.log), [3D earthquake](screenshots/scenes/audit-scenes-recorded-save.png), [2D alert](screenshots/scenes/audit-scenes-recorded-nws-save.png), [offline restore](screenshots/scenes/audit-scenes-restart.png) and [missing history](screenshots/scenes/audit-scenes-unavailable.png).

**Panel layout.** An early screenshot showed Replay covering the bottom of Scenes. The app now measures the playback bar when it resizes. In the final 1440 × 900 desktop run, Scenes and Data ended at y = 630, above Replay at y = 636.61. Hit tests reached the name field, Save, Export and the Data close control. [Overlap before the fix](screenshots/scenes/audit-scenes-overlap-before-fix.png) and [verified layout](screenshots/scenes/audit-scenes-recorded-save.png).

**Build and package.** Typecheck, 704 tests across 46 suites, the production build and Windows packaging passed. The unsigned `release/Atlas-Watch-Setup-0.7.0.exe` is 127,508,588 bytes with SHA-256 `C12D3950232E35283D47E8704206C5C8E3A1DA6018A9E0BCE0CABC74087A72A1`. All 350 distribution files, both samples and the notices matched their packaged bytes. The existing renderer bundle-size warning persists. The normal unpacked executable recorded 410 NWS alerts and 324 USGS earthquakes with its default query in an isolated profile. The Computer Use helper listed the window, then its activation approval timed out. The runner ended the isolated process at its 150-second limit. The separate desktop integration above verified the rendered controls. Native window inspection on the packaged executable, Windows installation and installer-driven upgrade remain open. [Installer byte check](package-audit-2026-11-11.log) and [normal unpacked launch](scenes-packaged-launch.log).

**Remaining work.** The [requirements audit](REQUIREMENTS_AUDIT.md#final-handoff--all-thirteen-deliverables) records the wider delivery status, including additional weather and transit coverage, credential-dependent checks and last-visit briefings.

## Since-last-visit briefings

**Duplicate check.** The Location briefing already generated HTML and PDF for saved places. History already kept observation times. The Analyst and notification summaries compared consecutive refreshes. In the earlier build, asking what changed since a visit selected the refresh answer, and losing membership in a reply was described as an event ending. With zero saved locations the dialog offered only the location report and disabled both exports. Its offline Electron page capture showed a blank white preview despite populated HTML. A separate Playwright capture of the old unpacked executable showed the report heading and source table. The earlier location preview therefore worked in the packaged window. [Earlier Electron capture](screenshots/visit/audit-visit-before-scenario.png), [earlier packaged window](screenshots/packaged-playwright/before-data.png) and [offline run](visit-before-audit.log).

**Comparison.** A visit starts when the app opens its monitoring core. The report compares each provider's last locally recorded successful reply during the previous run with the latest successful reply during this one. Archived content hashes identify revised records with the same source ID. Each feed has its own times and query scope. The totals count distinct IDs and each category shows up to five examples. Returning after an overnight gap can yield a comparison of the two recorded replies. Events that appeared and disappeared while the app was closed cannot be reconstructed. Missing or partial replies and changed query scopes have explicit explanations. Previously saved caches and migrated event summaries never supply a visit baseline. [Source semantics](REFERENCE_RESEARCH-2026-11-11.md#visits-and-source-linked-briefings).

**Performance and compatibility.** A two-visit benchmark used 500 synthetic alerts and 10,000 synthetic earthquakes with one new, revised and missing ID per source. The first implementation validated and parsed shared revisions twice and took a median 109.31 ms on this machine. Reading common membership once brought the median to 55.81 ms. An independent comparison using the existing full-frame Replay reader and a JavaScript diff took 80.07 ms in the final run. Each median uses seven alternating measurements after a warm-up. These are SQLite and comparison times. They exclude provider access, UI and export. A separate test reopened a copy of a database created by the prior release. All original rows in nine tables survived. Both feeds showed unknown change totals on the first visit because the upgraded profile contained only cached replies. A subsequent recorded observation became a baseline after restart. [Benchmark](../tests/visit-briefing-benchmark.mjs), [measurements](visit-briefing-timing.log) and [upgrade-copy check](store-upgrade-audit.log).

**Packaged window.** Playwright ran the actual Windows executable in an isolated profile. The app reported its packaged ASAR path, sandboxing, context isolation, web security and disabled renderer Node integration. Data → Briefing showed the first-visit unknown state with zero saved places. After adding a temporary Washington location, the existing location report displayed its name, source freshness and counts of 516 NWS alerts and 336 USGS earthquakes. The default-size screenshot and text measurements confirmed the source table fit and its short words stayed on one line. All nine checks passed and the app exited cleanly with zero renderer errors. [Packaged test](packaged-playwright-after.log), [visit screenshot](screenshots/packaged-playwright/after-visit.png) and [location screenshot](screenshots/packaged-playwright/after-location.png).

**Installer.** Typecheck, all 746 tests in 49 suites, the production build and Windows packaging passed. The unsigned installer is 127,514,098 bytes with SHA-256 `2A486B105CF27B41B6B104806549456521071DC2E6BB1E6570533F7740AE9FC1`. The installer payload contains the same application archive that passed the packaged window check. All 350 production files, the notices and both samples matched their build inputs. The renderer build still warns about its bundle size. Windows installation and installer-driven upgrade remain untested. [Package audit](package-audit-2026-11-11.log).

**Live and controlled desktop cases.** Two consecutive live launches each received 516 NWS alerts and 211 USGS earthquakes. The retained records matched the original provider replies, and each feed correctly showed zero changes over those few seconds. An offline restart retained the previous observations and displayed unknown current totals. The existing Analyst opened the same report, and the location briefing included the selected place and its notes. In separate synthetic profiles, each source gained six IDs, revised one record and stopped returning six IDs. A changed USGS query and incomplete replies showed unknown totals. The 900-location case exported its full 9,556,956-byte HTML report on demand. That case exercised HTML only. All seven desktop scenarios completed with zero renderer errors. [Desktop cases and source evidence](visit-audit.log).

**HTML and PDF.** The exported HTML matched the preview byte for byte for reports held in memory. In the earlier PDF, the second page began at the paper edge. Printing now applies 14 mm page margins and keeps the source heading with the start of its table. We rendered every page from the final 0.7.0 exports. The first-visit and two-visit reports each occupied two pages. The location report fit on one page including attribution, and the synthetic change report occupied three. Exact observation times survived text extraction. All eight pages had at least 39.7 points of clearance between text and the paper edge. The app wrote to temporary file-dialog destinations during verification. Native save-picker interaction remains untested. [Earlier print findings](screenshots/visit/visit-behavior-before-print-fix.log), [final PDF measurements](screenshots/visit/visit-pdf-inspection.json) and [two-visit sample](screenshots/visit/visit-second-2.pdf).

**Next regional source.** The current app displays NWS weather warnings. The existing Canadian adapters supply road cameras. The project has no Canadian or Norwegian weather-warning adapter. The audit mapped the existing alert UI, NWS-specific zone lookups, source identity, archive and briefing fields before evaluating official sources for Canada and Norway. Canadian CAP and GeoMet records were retrieved during research. Integration, multilingual event lifecycle and publisher-specific attribution remain open. [Regional warning research](REGIONAL_WARNING_RESEARCH.md).

## Saved-location monitoring evidence

The [combined desktop audit](location-evidence-audit.log) connects the final installer archive, live and controlled runs, screenshots, and exported files by hash.

**Existing workflow and reproduction.** Places, the Data panel, Analyst, local model context, location reports and NWS/USGS caches already existed. In the previous build an offline test profile opened a saved Washington place before any provider reply. Its location briefing displayed zeros for confirmed alerts, unresolved alerts and earthquakes. Details reported unknown. The overview showed a green absence message, and Analyst reported zero affected places. The test used the actual built bundle with an isolated profile and issued no external provider requests. [Baseline log](location-evidence-before.log), [before report](screenshots/location-evidence/audit-location-before-summary.png) and [before Analyst](screenshots/location-evidence/audit-location-before-analyst.png).

**What changed.** A successful complete reply can establish an exact count for its query. A partial reply retains confirmed matches and identifies them as a lower bound. A failed refresh or a cached observation retains the known count and its time, with the current total unknown. The first launch without a compatible observation shows unknown. All of these states use the original Places, Data, Analyst and export paths. A saved-place earthquake question uses the radius and geodesic distances computed for each place. The optional local model receives the same source times, limits and bounded examples. Its prompt was tested without downloading or running a model.

**Spatial and temporal fixes.** The app matches NWS warnings against supplied polygons and typed zone IDs. A lookup supplying a forecast zone cannot rule out a missing county zone. A valid matching zone or polygon still confirms the record. Missing or rejected area references prevent an unsupported exclusion. The same physical point at −180° and +180° gives the same result for alert polygons that touch the date line. When a cached alert has since expired, the earlier match is evaluated at the original retrieval time. Live matches respect the current clock.

**Source and storage checks.** The NWS adapter detects an advertised next page in a returned reply. The USGS adapter compares the provider's count to the raw feature count before filtering and alias merging. A partial reply cannot produce exact totals in the map's saved-place reports, Replay, visit comparisons or refresh-change summaries. The local cache gained one nullable field for completeness. The upgrade check reopened a copy written by the previous v0.7.0 code, retained all the original fields across nine tables and verified that legacy cache rows had unknown completeness. [Provider semantics](REFERENCE_RESEARCH-2026-11-11.md#evidence-for-saved-location-counts), [upgrade test](store-upgrade-audit.log) and [backend regression cases](../tests/monitoring-evidence-backend.test.ts).

**Zone matching time.** A local benchmark evaluated 200 saved places against 400 synthetic alerts with six zone references each. Half the places lacked a county zone. Both implementations found the same 1,800 confirmed matches. The older implementation treated another 20,000 tests as outside despite the missing county data. The corrected implementation reported those as unknown. It parses zone references once per alert and prepares each place's zone set once per evaluation. On the same computer, the median across seven alternating samples was 60.05 ms for the prior code and 5.65 ms for the current code. These timings exclude network access, SQLite, rendering and export. [Benchmark](../tests/location-monitoring-benchmark.mjs) and [results](location-monitoring-timing.log).

**Controlled desktop checks.** Six runs covered missing replies, one partial and one cached feed, restart, complete empty feeds, partial empty feeds and an alert that expired after retrieval. In the last case the source overview showed the two original alert records, the place retained one polygon match, and the current total was unknown. Details, Analyst and export used the same observations. All six ran in isolated test profiles with zero renderer errors. [Scenario evidence](location-evidence-fixtures.log), [offline summary](screenshots/location-evidence/audit-location-missing-summary.png) and [mixed-source summary](screenshots/location-evidence/audit-location-mixed-summary.png).

**Live packaged checks.** Each of two launches of the unpacked Windows executable loaded 541 NWS alerts and 209 USGS earthquakes. The test compared their IDs and fields to the actual HTTP 200 responses. It added two manual places to an isolated database, one at USGS earthquake `nc75465542` and one inside a real Special Weather Statement polygon. Both places opened their source records, exported HTML and PDF, and retained their matches across the restart. The test used ordinary app entry points and temporary save-dialog destinations. The source requests were observed without replacing their replies. [Packaged log](location-evidence-packaged.log), [live report](screenshots/location-evidence/audit-location-packaged-live-summary.png) and [alert detail](screenshots/location-evidence/audit-location-packaged-live-alert-source.png).

**Print verification.** Eight final PDFs contained 20 pages in total, including the two live packaged reports. Each page was rendered and inspected. The printed text matched the corresponding HTML body apart from whitespace, and the provider IDs, times and links survived export. The word “Unknown” stayed together in the source table, and short notes stayed together across page breaks. The two live reports each occupied four pages, with attribution on the last page. All inspected text sat at least 39.7 points from the paper edge. The automated comparison also retained the one-page pre-repair baseline. [Content and margin measurements](screenshots/location-evidence/location-pdf-inspection.json) and [visual review](screenshots/location-evidence/location-pdf-visual-review.json).

**Windows handoff.** Typecheck, all 795 tests across 51 suites and the production build passed. The unsigned installer is `release/Atlas-Watch-Setup-0.7.0.exe`, 127,517,527 bytes, SHA-256 `29FD758C41734ABCA98B634406E8D89D352DDC957008AC0BF0B0F00869FD0B71`. Its application archive matched the one used in the live test. All 350 production files, the notices and both samples matched the build inputs. This installer was built with the existing customer-key option. The isolated app's provider status confirmed that Google, Twelve Data and Alpha Vantage had no included or customer keys. The core feeds ran without credentials. Native save-picker interaction, Windows installation and installer-driven upgrade remain unverified. The renderer still emits a bundle-size warning. [Archive verification](location-evidence-package.log) and [rebuild instructions](../README.md).

**Regional warnings at the saved-location checkpoint.** That build used NWS for weather alerts. Separate DWD research found a complete German status archive with 21 CAP messages. It included updates and marine entries without polygons. One English message was inspected. The subsequent [German integration](#german-weather-warnings) uses the original German product. [Official sources and retrieved examples](REGIONAL_WARNING_RESEARCH.md).

## Passenger airline route data

The original Journey button queried adsb.lol on demand and drew a dashed line between returned airports. Selecting a recognized passenger airline callsign now loads its usual airport sequence offline. The 2026-11-11 Virtual Radar Server snapshot yielded 354,280 exact callsigns for 116 operators after filtering for airports that OurAirports identifies as having scheduled service. The catalog excludes conflicting rows and the operators’ identified charter and positioning patterns when supplied. Every retained airport has map coordinates. The lookup reuses the app's existing airport directory and adds 130 missing stops. The published callsign tables are community maintained and do not include dates, delays, filed waypoints or changes of destination. [Pinned source and schema](https://github.com/vradarserver/standing-data/tree/57c9d605a36ef1ec5d6e0f48c2d0700002e582d2/routes/schema-01) · [CC0 dedication](https://github.com/vradarserver/standing-data/blob/57c9d605a36ef1ec5d6e0f48c2d0700002e582d2/LICENSE) · [Pinned OurAirports data](https://github.com/davidmegginson/ourairports-data/tree/97afc8b3ee4711d70199fda73bdd66df9fd58cb8).

The generated route text is 6,332,552 bytes (1,673,756 bytes with gzip) and loads on the first eligible selection. It requires no account or online request. In the published data, BAW117 joins London Heathrow to New York JFK, and ANZ4 joins Auckland to Los Angeles across the date line. The tests checked both joins, the camera bounds, suppression of source-rejected routes, and gaps where a position is missing from an explicitly requested online report. The live manual provider's coverage varies by callsign. Run `node scripts/build-passenger-routes.mjs` to regenerate the sorted LF source, SHA-256 `BC12EBD4789171C2F968F2A66ADB463D2801E5BDEA954B81FE217F737102A2C5`. [Generator](../scripts/build-passenger-routes.mjs) · [Route tests](../tests/passenger-routes.test.ts).

For dated status, configure a direct subscription key in **Providers → AeroDataBox**. The selected flight card can then request one Tier 2 lookup by callsign. Matching uses the main process's current commercial aircraft observation, the operating carrier and flight number, the scheduled service window, and an agreeing Mode S address or registration. Cargo, codeshares operated by another carrier, conflicting identities and ambiguous replies produce no dated match. The app requests only status, omits the optional flight plan, imagery and live location, refuses redirects, and shares repeated requests for the same flight and account for 60 seconds. Reported times retain their source timestamp. A time difference uses the revised and scheduled movement times. Terminal and gate depend on the source. The schema, not a paid subscription, was verified live. Controlled responses exercised the match and network boundaries. [Official contract](https://doc.aerodatabox.com/docs/openapi-direct-v1.json) · [Tier and usage terms](https://aerodatabox.com/pricing) · [Dated status tests](../tests/dated-flight-status.test.ts).

## Trending markets and article previews

Markets already supported a saved watchlist, symbol search, optional Twelve Data and Alpha Vantage charts, and GDELT headlines. The trending list now reads Yahoo Finance’s US Most Actives screener and shows up to ten equities ranked by regular-session share volume. The app keeps the time of the quoted market observation separate from the time it fetched the ranking. It caches rankings for five minutes and ticker news for fifteen minutes. [Publisher’s screener](https://finance.yahoo.com/research-hub/screener/most_actives/) · [Ranking feed](https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=10).

Selecting a ranked equity loads its ticker-specific RSS feed. Stories that name the company or ticker in their headline or preview appear first. Each preview uses the description supplied with the article. A missing or duplicate description yields an unavailable preview. The main process checks the RSS channel against the requested ticker and registers exact article links. The existing saved-symbol workflow continues to use the configured quote provider and GDELT. [Example ticker feed](https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US) · [Market service](../src/main/markets.ts).

At 04:55:20 UTC on 2026-11-12, the production market service returned ten ranked equities. NVDA led with 281,514,030 shares for the November 11 regular session. NVDA, CRWV, INTC, SPCX, IREN, NOK, NU, GRAB, CIFR and MARA each returned twelve articles with twelve publisher previews. This checked 120 ticker/article entries, including stories syndicated to more than one ticker. The check ran with credential, settings and storage access disabled. Optional credentialed charts were outside this check. The markets, shared RSS, IPC security and built-in credential suites passed 156 tests covering ranking, missing fields, empty responses, ticker matching, plain-text previews, duplicate URLs, cache reuse and IPC validation. [Market regression cases](../tests/markets-lemmy.test.ts) · [Shared RSS tests](../tests/conflict-reports.test.ts).

At 05:01 UTC on 2026-11-12, the final Windows build opened Markets directly to all ten ranked stocks in an isolated profile with no quote key. Selecting NVDA displayed twelve stories. The first had a 95-character publisher preview above its article link. Clicking the link passed the exact Stocktwits destination through the application’s URL validator. The test intercepted the final browser launch. Back restored focus to NVDA, and the saved IBM watchlist survived browsing. The renderer reported zero errors. The checked app.asar SHA-256 was `6e29aad3576da0f6a3ce1d650b6a83ffcb471b3cb908227db6dc204cfc94b486`. [Desktop test](../scripts/check-trending-markets.mjs) · [Result](trending-markets-packaged.log) · [Ranking](screenshots/trending-markets/ranking.png) · [Article preview](screenshots/trending-markets/article-preview.png).


## Satellite imagery acquisition years

On 2026-11-12, a user reported black orbital swath gaps in the globe view. NASA's public WMS response contained opaque near-black no-data pixels, including RGB 0,0,2. The renderer now makes pixels with all three channels at or below 8 transparent before texture filtering, then displays additional observations from the selected year beneath the priority date. Extremely dark real pixels may also reveal another same-year observation. On final Windows archive `b5d44038945a54e17c274b92b37b0d33d94564c70474add9bd0b0e006b3a2cad`, globe checks for 2000, 2001 and 2026 reported no near-black pixels in the central sampled area after loading. The checked images retained correct continent orientation and showed visible cloud and seasonal transitions where observations meet. [Desktop check](year-globe.log) · [2000 globe](screenshots/year-globe/2000.png) · [2001 globe](screenshots/year-globe/2001.png) · [2026 globe](screenshots/year-globe/2026.png).

The existing Layers → Imagery date picker controls a scientific overlay that can be translucent or split between two dates. A separate **Imagery year** selector in the main toolbar changes the underlying Earth photography. **Auto** restores the configured surface. A selected year survives a restart and can be saved with a scene or view. The archive temporarily hides current radar, weather imagery, building meshes and the scientific imagery overlay. Track positions and place labels keep their own timestamps. An active Google mesh can be parked during a year change, and starting in an archived year uses the keyless sources.

The 2020 and 2021 views use the corresponding 10 m Sentinel-2 annual median across covered land and coasts. The worldwide overview pairs the same year's Ocean Colour CCI composite with selected Terra/MODIS passes from that year. For other years, NASA's actual daily Terra/MODIS image nearest July 1 has priority. Nearby and seasonal observations from the same year fill missing orbital swaths at coarser resolution. Their differing cloud cover and seasons can remain visible at transitions. The layer panel and individual source credits identify acquisition dates. NASA's date-domain response supersedes the packaged list of verified dates. Years without an available source are omitted. [Terra/MODIS product](https://github.com/nasa-gibs/worldview-options-eosdis/blob/master/common/config/metadata/modis/CorrectedReflectance.md) · [NASA acquisition-date domain](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/MODIS_Terra_CorrectedReflectance_TrueColor/default/GoogleMapsCompatible_Level9/all/all.xml) · [ESA annual composite products and licenses](https://esa-worldcover.org/en/data-access).

On 2026-11-12 UTC, NASA reported acquisitions for every year from 2000 through 2026. Its historical gap runs from 2001-06-16 through 2001-07-02, so the preset uses July 3 for 2001. The NASA EPSG:4326 service returned real RGB pixels for 2001-07-03, 2020-07-01, 2021-07-01 and 2026-07-01. At Mariehamn, Terrascope returned distinct Sentinel composites for exactly the same level-13 tile (4549, 2374). The 2020 file was 64,030 bytes and the 2021 file 98,683 bytes. Both contained varied, opaque RGB imagery. [Date selection regression tests](../tests/imagery-dates.test.ts) · [Saved scene regression tests](../tests/investigation.test.ts).

The final Windows package (app.asar SHA-256 `03bafa005199fc31acfcf055934308bd7b71a75412fe7c243802cb6fb1c339b8`) rendered the July 3, 2001 Terra scene and native level-12 or finer Terrascope imagery under the camera at Mariehamn for both annual views. The tests waited for the visible tile queue to empty and checked spatial detail in the same 200 × 150 harbour crop. In 2020, 34.1% of horizontal neighbour pairs differed by more than 12 combined RGB levels; in 2021 the fraction was 37.2%. Switching years changed 64.90% of those pixels with both publishers available. A separate run blocked 24 ancillary WMS requests and retained the same spatial detail, with 64.89% of pixels changing between years. Both runs preserved the 2021 selection across restart, restored the configured surface and building setting on Auto, and issued zero Google requests. All 85 focused date, investigation and geocoding tests passed. [Live packaged verification](satellite-years-packaged.log) · [Coverage service unavailable](satellite-years-mask-offline-packaged.log) · [2001 NASA](screenshots/satellite-years/terra-2001.png) · [2020 Mariehamn](screenshots/satellite-years/baltic-2020.png) · [2021 Mariehamn](screenshots/satellite-years/baltic-2021.png).


## Earth lighting and city lights

The globe previously followed the camera with a directional light. The existing NASA Black Marble product under Layers → Imagery could display its annual composite across the entire map. The new **Day/night** control beside **Layers** uses the actual solar direction in Earth-fixed coordinates. **Current sunlight** updates the sun position every minute. **Choose time** accepts a UTC date and time and provides a one-minute slider through the day. **Daylight** restores the original viewing light. The lighting preference is retained locally. The playback cursor and the live movement clock stay independent. [Map controls](../src/renderer/components/EarthLightingPanel.tsx) · [Solar position and imagery](../src/renderer/map/earthLighting.ts).

The night view uses the 2016 VIIRS Black Marble composite from NASA Earth Observatory, by Joshua Stevens using Suomi NPP VIIRS data from Miguel Román, NASA GSFC. The original 3600 × 1800 JPEG is bundled for immediate global and offline coverage. The published JPEG’s SHA-256 is `D87DE751A264E4F8FF69C68DE5DAB9606DAEE87A6F15AE743C93200743BD7EC1`. Closer views request NASA GIBS tiles from the existing Black Marble catalog entry for 2016-01-01. The reproduction fetched a New York tile at level 6 (HTTP 200, 102,706 bytes). Cesium blends the two time-of-day appearances through twilight. Year selection changes the daytime imagery, with the 2016 light source separately identified. An existing Google photoreal session can be parked while the globe displays the night composite. Returning to daylight restores it. [NASA source, resolution and credit](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/) · [Original NASA JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg) · [Cesium imagery-layer blending](https://cesium.com/learn/cesiumjs/ref-doc/ImageryLayer.html).

In the final Windows executable at 00:51 EST on November 12, changing the chosen lighting time from 04:00 to 16:00 UTC over New York changed the illuminated hemisphere. Disabling the city-light layer altered night pixels by an average of 44 RGB levels in 3D and 54 in 2D. Daytime pixels stayed identical. A fresh renderer restored the chosen UTC time with all HTTPS image requests blocked and displayed the bundled overview. The same run showed the 2021 imagery choice alongside the 2016 light-source credit and retained the recorded cursor across lighting changes. The automated ephemeris checks cover opposite longitudes twelve hours apart, the Northern/Southern Hemisphere solstices, UTC leap-day validity and damaged saved preferences. [Desktop results](earth-lighting-packaged.log) · [Orbital view and controls](screenshots/earth-lighting/terminator-and-city-lights.png) · [3D city lights](screenshots/earth-lighting/3d-night.png) · [Sun position tests](../tests/earth-lighting.test.ts).

## Satellite water and Åland coverage edges

The blue rectangles west of Mariehamn matched transparent areas in the published ESA WorldCover Sentinel-2 composite. The previous global background exposed blue seafloor relief through those gaps. A single GetMap image reproduced the staircase, independent of the renderer’s tile boundaries. The replacement blends valid coastal observations into measured open-water reflectance across the source coverage edge. Actual land and island pixels retain the publisher’s native detail. The globe also uses satellite water with legacy smoothing and ripple preferences enabled. Coastal and lake views in Photoreal 3D can now reveal the satellite surface at regional and close range. [ESA WorldCover imagery and coverage](https://esa-worldcover.org/en/data-access) · [WorldCover compositor](../src/renderer/map/worldCover.ts) · [Coastal mesh visibility](../src/renderer/map/photorealSurface.ts).

The bundled 2020 and 2021 water layers use annual 665, 560 and 490 nm water-leaving reflectance from ESA Ocean Colour CCI v6.0. The original 4 km grid is sampled every 1/12 degree for the offline globe. Six same-year Terra MODIS true-colour dates supply observed RGB where annual ocean colour is unavailable, including inland water. Close-up detail depends on the coverage and resolution of the regional imagery. The detailed Sentinel-2 product reaches 10 m where the publisher has observations. The local land stencil limits NASA Blue Marble imagery to land, including cutouts for inland lakes. If the regional WMS is unavailable, adjacent native WMTS imagery supplies its parent and coverage border. Individual native images preserve their own alpha if the footprint is unavailable. [Dataset and original request hashes](../public/optical-water/SOURCES.json) · [ESA Ocean Colour dataset](https://www.oceancolour.org/) · [NASA Global Imagery Browse Services](https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs).

Packaged Windows checks on 2026-11-12 used the reported Photoreal 3D and Balanced settings with terrain, labels and both old water preferences enabled. Public imagery and terrain loaded in a disposable profile. The previous binary showed blue fill at 417 of 440 marine points during refinement, and RGB changes of 101–109 levels across eleven surveyed edges of the source’s T-shaped gap. The final binary showed blue fill at zero of 440 points both during loading and after tiles settled. The same eleven crossings changed by zero or one level. Three inland Åland samples retained 41–50% adjacent green-channel changes of at least six levels, with fields, islands and roads visible. All 77 coastal samples in the settled oblique view, 81 offshore Atlantic samples with the network disabled, and four offline Lake Superior samples showed the satellite background without the old blue fill. Independently blocking the overview WMS still returned 65,536 opaque native pixels and 183 distinct red values for a level-12 Paris tile. [Prior rendering](optical-water-before.log) · [Final checks](optical-water-after.log) · [Mariehamn regional view](screenshots/optical-water/after-aland-regional.png) · [Oblique coastal view](screenshots/optical-water/after-aland-oblique.png).

The shallow-angle slotted-mesh test showed zero holes across 408,856 foreground pixels over sea and land. Land coverage returned when moving back to Helsinki. The ship hull waterline matched the controlled 183 m surface. Google geometry and ship reports for those checks came from controlled fixtures, and all Google API traffic was intercepted. The archived run therefore verifies mode transitions and placement without consuming a paid Google session. All three final Windows logs use app.asar SHA-256 `03bafa005199fc31acfcf055934308bd7b71a75412fe7c243802cb6fb1c339b8`. [Coastal mesh check](coastal-mesh-after.log) · [Vessel waterline check](vessel-waterline-controlled-3d-tiles.log).

## Aircraft trail and interior perspectives — 2026-11-12

The existing recorded trail joins stored fixes. Its aircraft-only dashed continuation now uses the same displayed position as the moving marker, including its bounded interpolation or prediction; it does not write estimated positions into recorded history. Missing-altitude fixes remain omitted. The existing cockpit camera now accepts mouse or touch dragging, follows the smoothed displayed direction, and has a passenger-side option. Both views use generated, generic two-dimensional foreground artwork, not a model of the real aircraft interior; reported attitude is unavailable. Escape returns to Follow. [Rendering](../src/renderer/map/layerRender.ts) · [Camera](../src/renderer/map/trackingCamera.ts) · [Controls](../src/renderer/components/TrackingControls.tsx).

Type checking, the production build, and 31 focused tracking and renderer tests passed. The locally assembled Windows app was checked with two synthetic ADS-B reports in an isolated profile: the follow camera stayed centered, both packaged images loaded, dragging changed the cockpit overlay, passenger view opened, and Escape restored Follow. All external HTTP requests were blocked and no Google credential was used. The trail connector is covered by a renderer test. This is a controlled desktop check, not verification against a live aircraft feed or an accurate 3D recreation of a particular cabin. [Desktop audit](aircraft-interior-audit.log) · [Camera tests](../tests/tracking-camera.test.ts) · [Trail test](../tests/passenger-motion.test.ts).

The ordinary electron-builder packaging attempt could not download its Windows tool because DNS/network access was unavailable. The updated unpacked app was instead assembled using the existing local Windows runtime and a newly packed app.asar; the existing installer was not updated. `start.bat` selects this new unpacked build when it is newest.

## Fixed interior frames and estimated aircraft tilt — 2026-11-12

The existing generic cockpit and passenger foreground frames remain fixed during drag while the Cesium camera changes direction. Look is limited to 50° left/right in the cockpit or 40° around the passenger-side view, and 35° vertically. The exterior 3D mesh and interior camera use a bounded visual bank derived from the rate of the smoothed direction change; the bank returns to level when the correction ends. The existing vertical-rate and groundspeed estimate supplies the climb/descent angle, smoothed in the interior camera. These are visual estimates, not measured aircraft pitch or roll. When the required motion or vertical-rate data is unavailable, the corresponding estimate is level. [Camera](../src/renderer/map/trackingCamera.ts) · [Estimated bank](../src/shared/aircraft.ts) · [Mesh orientation](../src/renderer/map/vehicleModels.ts).

The production build and 80 focused tracking, motion, model and renderer tests passed. A local Windows app assembled using the existing runtime and rebuilt app.asar was tested with synthetic reports in an isolated profile: both frames remained fixed while the camera heading changed under drag, passenger and cockpit views loaded, Escape returned to Follow, and follow stayed centered. Unit tests exercise look limits, simulated pitch and banking, including level-off; tilt was not verified against live aircraft attitude data. HTTP traffic was blocked and no Google credentials were used. [Desktop audit](aircraft-attitude-audit.log) · [Camera tests](../tests/tracking-camera.test.ts) · [Motion tests](../tests/passenger-motion.test.ts) · [Mesh orientation tests](../tests/vehicle-models.test.ts). The existing installer was not rebuilt; start.bat selects the newer unpacked build.

## Interior parallax correction — 2026-11-12

The fixed-screen treatment described in the preceding section has been replaced. Dragging in either interior now moves and subtly rotates the illustrated cabin frame opposite the camera's look direction, making it appear anchored to the aircraft while the outside globe follows the camera. The limited angles and simulated aircraft tilt remain. This is a perspective effect applied to a 2D illustration, not geometry or a measured aircraft interior. [Implementation](../src/renderer/components/Globe.tsx) · [Look controls](../src/renderer/map/trackingCamera.ts).

The production build and 73 focused tests passed. The unpacked Windows app was checked in an isolated profile with synthetic flight data and blocked HTTP requests: both cabin images shifted opposite the camera turn and Escape returned to Follow. This confirms the interaction in a controlled desktop session; live-flight visual validation remains outstanding. No Google credentials were used. [Desktop audit](aircraft-parallax-audit.log) · [Camera tests](../tests/tracking-camera.test.ts). The existing installer was not rebuilt; start.bat selects the updated unpacked build.

## Interior look direction correction — 2026-11-12

The prior frame effect moved in the same direction as a drag and introduced artificial 3D rotation of the illustrated frame. Both cockpit and passenger views now use mouse-look direction: dragging right/down looks right/down, while the fixed-axis illustration translates left/up without rotation. Existing angle limits and estimated flight tilt remain. The frame is still a 2D parallax illustration; it is not physical 3D cabin geometry. [Camera interaction](../src/renderer/map/trackingCamera.ts) · [Frame transform](../src/renderer/components/Globe.tsx).

The production build and 73 focused tests passed. In an isolated desktop session with synthetic flight reports, the updated Windows app changed camera heading while both illustrated frames translated opposite a diagonal drag, and the frame transform had no rotational components. Escape returned to Follow. This was not a live-flight visual check; HTTP was blocked and no Google credentials were used. [Desktop audit](aircraft-level-view-audit.log). The installer was not rebuilt; start.bat selects the new unpacked build.

## Stationary interior frames — 2026-11-12

At the user's request, the cockpit and passenger illustrations now remain stationary on screen while the outside camera responds to looking around; the previous parallax translation and frame rotation have been removed. Look limits and estimated aircraft movement remain. [Globe overlay](../src/renderer/components/Globe.tsx) · [Camera controls](../src/renderer/map/trackingCamera.ts).

The production build and 26 focused tests passed. In an isolated desktop test using synthetic reports and blocked HTTP, both frames kept identical screen bounds and transforms during diagonal dragging while the camera heading changed; Escape restored Follow. No live flight or Google credentials were used. [Desktop audit](aircraft-fixed-interior-audit.log). The existing installer was not rebuilt; start.bat selects the updated unpacked build.

## Aircraft-fixed 3D interiors — 2026-11-12

The previous screen-attached cockpit and passenger pictures have been replaced with simple, generic 3D geometry. The cabin is positioned and oriented from the same displayed aircraft position, direction and estimated attitude as the tracking camera, independently of the user's look angle. Its window openings expose the globe, and it is removed when the view ends. The geometry is illustrative, not the real interior of the reported aircraft. [Interior geometry](../src/renderer/map/aircraftInterior.ts) · [Tracking camera](../src/renderer/map/trackingCamera.ts).

The production build and 74 focused tests passed. In a packaged desktop session with synthetic aircraft reports, blocked HTTP and an isolated profile, both cabins remained aligned with the aircraft while a drag changed their screen projection; Escape removed the geometry. Screenshots were inspected. A unit test also verifies geometry orientation does not change with the look angle. This does not establish live provider or real-aircraft accuracy. [Desktop audit](aircraft-3d-interior-audit.log) · [Camera tests](../tests/tracking-camera.test.ts). The earlier illustration files remain in the project but are no longer used for the tracking view. The existing installer was not rebuilt; start.bat selects the updated unpacked build.

## Supplied cockpit and passenger models — 2026-11-12

The existing cockpit and passenger tracking views load the two user-supplied GLBs in the aircraft frame, keeping the generated cabin as a fallback during loading or failure. Passenger look can turn fully around, with vertical angles limited to 80°. The 2D seat control offers 24 approximate viewpoints; the cabin model has no usable individual seat identifiers, so these do not claim to match the tracked aircraft's actual layout. Seat changes update the camera relative to the moving aircraft without resetting follow. Models and seat layout are explicitly simulated. [Model placement](../src/renderer/map/aircraftInterior.ts) · [Seat positions](../src/shared/passengerSeats.ts) · [Controls](../src/renderer/components/TrackingControls.tsx).

The user-provided cockpit metadata credits [VTX's Boeing 757-200 Icelandair cockpit](https://sketchfab.com/3d-models/boeing-757-200-icelandair-cockpit-1cb8f8109cb145849282ad703a652859), CC BY-NC-SA 4.0; the noncommercial and share-alike terms apply. The passenger model credits [Newbie99999993's airplane interior](https://sketchfab.com/3d-models/airplane-interior-f56acb1930b645aaab879a259e36b606), CC BY 4.0. Both original GLBs were copied unmodified; in-app credits identify authors and licences. [Attribution](../public/interior-models/ATTRIBUTION.txt).

Type checking, renderer and main builds, and 28 focused tests passed. The isolated packaged app loaded both GLBs and selected a different seat, with the camera's position measured relative to the moving aircraft; look and cleanup were also exercised with synthetic aircraft reports and blocked external HTTP. Source models are large (approximately 41 MB and 76 MB), and cockpit glazing and approximate seat placement depend on those models; precise seat/window alignment and live-flight appearance require further refinement. The repeated Windows build encountered an intermittent Cesium asset copy permission error; the renderer build succeeded on retry. No Google credentials or live provider data were used. [Desktop audit](supplied-interior-audit.log) · [Seat tests](../tests/passenger-seats.test.ts). The existing installer was not rebuilt; start.bat selects the updated unpacked build.

## Supplied interior loading — 2026-11-12

The old generated interiors were intentionally shown as a fallback while the supplied files loaded, which made the actual cockpit hard to distinguish. Those fallback meshes are now hidden; the tracking controls report loading or failure explicitly instead. The view loads optimized derivatives of the supplied models, and keeps the original files untouched. Flattening, joining and deduplication reduced the cabin from 3,826 meshes to 37, and the cockpit from 41.2 MB to 37.0 MB and the cabin from 76.5 MB to 65.3 MB without downscaling textures. Scene bounds changed by less than 0.0001 model units. [Loader](../src/renderer/map/aircraftInterior.ts) · [Optimization script](../scripts/optimize-interior.mjs) · [Model attribution](../public/interior-models/ATTRIBUTION.txt).

The production build, type check and 13 focused tests passed. In an isolated packaged desktop test with synthetic aircraft and blocked external HTTP, both optimized GLBs reached ready, the loading status cleared, passenger seat selection worked and Escape cleaned up. One initial run was inconclusive because desktop frame sampling stalled; the final run passed. Loading times in that test are recorded in the audit and vary by machine. The provided cockpit's glazing and camera alignment can still limit the outside view; the model and seat placement do not claim to represent the tracked aircraft. No live credentials were used. [Desktop audit](optimized-interior-audit.log). start.bat selects the updated unpacked build; the installer was not rebuilt.

## Cockpit surfaces and faster interior loading — 2026-11-12

The supplied 757 cockpit used single-sided surfaces and dark windshield materials, which produced missing interior faces and the opaque tint in the reported view. Interior models now render back faces, and the cockpit's generic windshield and glass_t1 materials are transparent in the new derivative. The original user-supplied GLBs remain unchanged. The fast derivatives simplify geometry within a bounded error and encode textures as WebP: cockpit 41.2 MB original / 37.0 MB previous derivative / 21.0 MB fast, cabin 76.5 MB / 65.3 MB / 50.9 MB. Original texture dimensions are preserved; geometry simplification and lossy texture encoding may alter fine detail. Loading now reports completion only after textures are ready. [Model loader](../src/renderer/map/aircraftInterior.ts) · [Asset optimization](../scripts/optimize-interior.mjs) · [Attribution and modifications](../public/interior-models/ATTRIBUTION.txt).

The production build and 14 focused model and tracking tests passed. The packaged desktop app loaded the models, rendered interior faces from both sides, selected a passenger seat, and removed the interior on Escape in an isolated synthetic-flight test. One preliminary desktop run failed its unrelated follow-frame sample during slow startup; subsequent runs passed. Geometry and full texture loading times are recorded separately in the final audit and cannot establish the user's machine performance. The screenshot was inspected with network access blocked; exact appearance over live Google photoreal tiles and live flights remains unverified, and camera alignment depends on the source model. No paid Google credentials were used. [Final desktop audit](fast-cockpit-audit.log) · [Material regression](../tests/interior-assets.test.ts). start.bat selects the updated unpacked app; the installer was not rebuilt.

## Protective planning workspace — 2026-11-12

A new **Plan** entry in the left rail (Tools group, "Protective planning") opens a floating workspace beside the globe with five steps: Site → Coverage → Buildings → Routes & zones → Save & brief. It is inspired by the workflows VILYA describes on its website; Atlas Watch does not claim parity with that product. [Panel](../src/renderer/components/PlanningPanel.tsx) · [State](../src/renderer/lib/usePlanning.ts) · [Map overlay](../src/renderer/map/planningOverlay.ts)

**Inventory before building (reused, not duplicated):** the existing globe, terrain source and OSM extruded buildings; the top search box and saved locations for choosing a site; Map tools annotations for routes, perimeters, zones and pins; the Cameras layer and camera viewer; the Satellites layer and its pass predictor worker; the briefing HTML/PDF export path in the main process; the SQLite document store. There was no line-of-sight/viewshed tool, no building-information lookup and no planning workspace, so those are new.

**What it does**

- *Site:* pick on the globe, use the map centre (after a search) or a saved location; "View site in 3D" flies to an oblique view. The panel states what geometry is on screen: terrain, OSM footprints extruded to mapped or estimated heights (simple blocks, not verified 3D models), or Google Photorealistic 3D (display only, not used in analysis), plus a reminder that unmapped buildings look like open ground. Predicted satellite passes above 30° for the next 12 h come from the Satellites layer's loaded orbits and are labelled as predictions, not imaging.
- *Coverage:* observation points (height, range, optional direction and field of view) and cameras. Public cameras within the area are listed from the Cameras layer with source, catalogue time and "direction not published"; a camera is only modelled after the user enters a direction and field of view (labelled user estimate). A geometric viewshed runs per point on a grid (up to 401 × 401 cells, 2–50 m) from terrain sampled independently of the display setting (strict: missing tiles are no data) and OSM building heights from the same vector tiles that draw the 3D buildings; Earth curvature and refraction are included. Results: covered by one, by two or more, modelled gap, unknown (no data), drawn as a colour-blind-safe grid with a checker for unknown. Unknown is never counted as visible or safe; a known blocker before a data gap decides "blocked". Loading and modelling run with progress and cancel; ray casting runs in a web worker. [Model](../src/shared/viewshed.ts) · [Geometry loading](../src/renderer/map/siteGeometry.ts) · [Raster](../src/shared/siteRaster.ts) · [Worker](../src/renderer/map/viewshedWorker.ts)
- *Buildings:* "Inspect a building" picks on the rendered surface (a roof, not the ground behind it) and queries OpenStreetMap through the public Overpass API (main instance, then one listed public fallback when it is overloaded). Shown: address, type/use, height (reported vs estimated from floors × 3 m), floors, footprint area, start date, operator (community-mapped), OSM link and last-edited time. Owner is always "not available — no property-records provider is configured"; OSM `owner` tags are not shown. Interiors and occupants: not known. Floor-plan images (PNG/JPEG/WebP, embedded and downscaled) can be placed on the map with width, rotation, floor and height; scale, orientation and floor stay flagged until the user confirms them; "View this floor" looks straight down. [OSM adapter](../src/main/osmSite.ts)
- *Routes & zones:* buttons open the existing Map tools; drawn items get roles (primary/alternative route, perimeter, zone, staging, exit, assembly point, note). Route comparison: length, time at an assumed speed (walking 4.8 km/h, driving 30 km/h, no traffic), share covered / gap / unknown / outside from the current coverage run; road restrictions "not available". Nearby hospitals, clinics, police, fire and ambulance stations and mapped assembly points come from OSM within 1–5 km; an empty answer is reported as a gap in mapped data. No crowd or evacuation simulation is provided.
- *Save & brief:* plans are saved locally (new `plans` table, strict schema, size-limited) and reopen with their last-run figures; the grid is recomputed with current data instead of being restored as current. Export writes a self-contained HTML or PDF briefing (no scripts or remote resources, every value escaped) with sources, limitations and whether the author acknowledged them. [Plan model and briefing](../src/shared/protectivePlan.ts)

**Security:** new IPC channels (`plans:*`, `site:building`, `site:facilities`) are validated with zod (coordinates, radius ≤ 5 km, strict plan schema, embedded-image-only floor plans, PNG-only coverage image); Overpass is reachable only from the main process (`overpass-api.de`, fallback `overpass.private.coffee`, same-origin redirects); `openstreetmap.org` was added to the external link allow-list. No credentials are involved.

**Verification.** Type check, production build and the full suite (79 files, 1,149 tests) passed, including 28 new tests: viewshed geometry (open ground, building and ridge occlusion, unknown propagation, observer without terrain, camera field of view and range, cancellation, curvature), combination of several points, route coverage, footprint rasterisation with holes, plan validation, briefing escaping, OSM parsing (inside vs nearest, reported vs estimated height, no owner, strict height parsing, failover on 502/timeout but not on 400) and IPC/allow-list boundaries. Live check in an isolated profile on the secondary monitor, Helsinki Senate Square: a 300 m analysis on a 201 × 201 grid of 3 m cells loaded level-16 terrain (0 missing cells) and one OSM building tile (16,507 building cells) and modelled two points in 0.6 s; the building lookup returned Helsinki Cathedral from OSM (inside its footprint, reported height 59 m, address, last edited 2026-10-30); 15 emergency facilities were found within 1 km; the plan saved and reopened. On the first run the main Overpass instance answered 502 and then timed out — the panel showed both as unavailable — which led to the fallback. [Live log](protective-planning-live-check.log) · [Top view](screenshots/protective-planning/coverage-top.png) · [Oblique view](screenshots/protective-planning/coverage-oblique.png) · [Building lookup](screenshots/protective-planning/building-lookup.png)

**Not verified / limits:** the export save dialog and PDF rendering were not exercised in the automated run (the HTML builder and request validation are unit-tested); the analysis does not use Google Photorealistic geometry, and its grid is not visible while Photoreal hides the globe; vegetation, walls, vehicles and unmapped buildings are not modelled; floor plans are not drawn over Photoreal 3D; Overpass is a free public service with fair-use limits and variable availability.

**Remaining work:** 3D building model (GLB) import and interior navigation; analysis against Photorealistic tiles (needs ray casting against the 3D tile mesh); road-network routing with restrictions (needs a routing provider and a decision on its terms/cost); property records (needs a licensed provider per country); video projection onto the scene (needs calibrated camera pose and lens); shared plans and live device locations (need a server or account decision by the owner).

**Independent review (Codex, round 1): 8 findings, all addressed.** Unknown building height at the observer now stops that point (its eye height is unknown) and an unknown roof at a target is unknown even behind a known wall; mapped buildings without a usable height are unknown, not open ground; footprints are filled by cell centre on both axes (a half-cell westward shift is fixed); every run stores the inputs it was computed from, so changed settings are flagged as out of date in the panel, after reopening and in the briefing (old grid and route shares are omitted there); lookups, image imports, saves and analysis progress are bound to the plan that started them, and Cancel takes effect at once; multipolygon buildings are matched on their assembled rings with courtyards excluded, and a bounds-only match is labelled as uncertain; View site in 3D switches to the 3D scene. OpenStreetMap completeness cannot be measured, so results are now labelled “clear sight line in mapped data” with the completeness caveat beside them rather than claiming unmapped areas are open. Afterwards: 79 files / 1,155 tests passed, build passed, and the live check repeated (the building lookup that run reported both Overpass instances busy, shown as unavailable).

**Review round 2: 7 findings, addressed.** Treating ground without mapped buildings as open is now an explicit per-plan choice: Run analysis stays disabled until the user ticks it, and the briefing records it as the author’s assumption (OpenStreetMap completeness cannot be established from the data; making all unmapped ground unknown would leave every result unknown). A point that cannot be modelled now contributes unknown over its range and field of view, so it never turns other points’ blocked cells into gaps. Lookup busy flags reset when another plan opens; a camera direction the user changed is labelled a user estimate, not the publisher’s; route shares are weighted by distance (repeated vertices ignored); areas beyond ±85° or across the 180° meridian are refused, and cells beyond the sources’ coverage stay unknown; a coverage grid computed for other inputs is no longer drawn on the map. Older saved plans load as out of date instead of being dropped. 79 files / 1,156 tests and the build passed; the live check repeated (both Overpass instances were busy during that run and the panel reported them as unavailable; earlier runs returned the cathedral and 15 facilities).

**Review rounds 3–4: 9 findings, addressed.** A point outside the analysed area leaves what it might see unknown; changing a floor plan’s size, rotation, position or floor clears the matching confirmation (enforced in the planning state, not only the form); a floor plan is drawn only once the terrain height under it is known (retried, never placed at sea level), and a “Hide 3D buildings” control shows floors inside OSM blocks; satellite-pass predictions and pending picks never carry over to another plan or site; sight lines now walk every grid cell they cross (cells clipped at a corner can block or make the result unknown); plans keep a copy of each assigned route, zone and marker, show items changed on the map since saving or deleted from it, and use the saved copy in the briefing; replacing a plan with unsaved changes asks first; camera moves add the terrain height under the site (and the floor height for floor views), stating when it is unavailable. 79 files / 1,162 tests and the build passed. Live: the Senate Square run, Helsinki Cathedral lookup, 15 facilities and save/reopen passed; a generated floor-plan image was imported, placed 12 m above ground, rotated (which cleared its orientation confirmation) and rendered. [Floor plan](screenshots/protective-planning/floor-plan.png)

**Review round 5: 2 findings, addressed.** Route coverage clips each segment to the analysis square, so far-away vertices count as outside by length without extra work (a 5,000-point route spanning the globe is tested), and results are cached per route and run. Briefings now carry the geometry: a self-contained site diagram (north up, scale bar, numbered routes, zones and markers, observation points, analysis radius) and a table of every item’s coordinates; floor plans list their centre coordinates. A sample briefing rendered from the real builder was inspected. [Sample briefing](screenshots/protective-planning/sample-briefing.png)

**Review round 6: 4 findings, addressed.** The building lookup also asks for buildings whose area contains the clicked point, so large halls are found from their middle (checked live: a point inside Helsinki’s Stockmann department store, more than 30 m from its walls, returned that building); the site diagram’s extent is computed without spreading coordinates (a 200,000-point route exports); route notes appear in the briefing; a camera’s direction and field of view carry separate provenance (publisher vs user estimate). 79 files / 1,166 tests and the build passed.

**Review round 7: 4 findings, addressed.** The terrain source keeps sea-floor depths, so cells below sea level are now resolved with the mapped water polygons from the same vector tiles: inside mapped water the surface is the water (sea level); elsewhere, or where water data is unavailable, the cell is unknown. Elevated building parts (OSM min_height: bridges, overhangs) keep the passage beneath them — a sight line is blocked only inside the occupied height interval or when it crosses it within the cell — and points under such a part are treated as ambiguous (unknown). Routes that pass the site without a vertex nearby, areas containing it, and every item already assigned stay available in Routes & zones. Floor-plan width is limited by the image’s proportions so both sides stay within 2000 m. 79 files / 1,171 tests and the build passed (one unrelated airline-route test timed out once under load and passed on rerun). Live: a quay-side point at Helsinki Market Square modelled 44% clear (the open harbour), 0 cells without terrain and 26 unknown. [Harbour](screenshots/protective-planning/harbour.png)

**Review round 8: 2 findings, addressed.** Only mapped sea (ocean polygons) is modelled at sea level; inland water or land below sea level is unknown, because its surface height is not in this data. Route coverage unwraps longitudes around the site (routes crossing the 180° meridian take the short way) and weights by geodesic length, the same model as the route table. 79 files / 1,172 tests and the build passed; the harbour check repeated with the same result.

**Review round 9: 3 findings, addressed.** A building in the target’s own cell or the observer’s own cell is now tested along the part of the line inside it: a roof-top target is hidden when the line enters its cell below the roof, and from a roof the ground close to the building is hidden by the roof edge (terrain inside a single cell is not tested, since a cell has one height). A saved camera keeps its catalogue time, media type and published direction, shown on its row and in the briefing (older plans show them as not recorded). Route segments are unwrapped continuously and placed on the world copy nearest the site, so a remote route crossing the 180° meridian stays remote; the briefing diagram uses the same handling. 79 files / 1,176 tests and the build passed; the live Senate Square run repeated (201 cells are now unknown there, from points under elevated building parts).

**Review round 10: 3 findings, addressed.** Building parts in one cell are merged only when they touch or overlap in height; parts separated by open space (for example 0–3 m and 10–20 m) make the cell unknown instead of one invented solid block, independent of the order the parts arrive in. Terrain-dependent camera moves are dropped when a newer move or another plan has taken over. The “items near the site” check moved to the shared plan module and uses the same longitude handling as route coverage. 1,178 tests: all pass except one unrelated airline-route test that twice exceeded its 5 s limit while the whole suite ran and passes on its own; the build passed. Final live run (Senate Square, camera on the square’s north edge): 201 × 201 grid, 3 m cells, 0.64 s; 9% clear from one point, 3% from both, 87% blocked, 1% unknown (cathedral parts at separate heights); the cathedral lookup, 15 facilities and save/reopen passed. A camera placed inside the cathedral footprint was reported mostly unknown, as intended. The screenshots and log linked above are from this final run.

**Review round 11: 2 findings, addressed.** Each planning camera move is bound to the plan it was requested for: it is applied only if it is still the newest move and that plan is the open one, so opening or starting a plan flies to its site, and declining the unsaved-changes prompt neither replaces the plan nor moves the camera. Checked through the real UI: with the camera at 59°N 20°E, clicking Open on the saved plan placed the camera at 60.1661°N 24.9522°E, 340 m, looking at Senate Square.

**Review round 12: 2 findings, addressed.** Camera placement now uses the same surface rule as the analysis (a one-cell run of the geometry loader): mapped sea is sea level, not the sea floor, and anything else below sea level or without data is reported as unavailable. Each run stores the radius and target height it used; the briefing describes the run with those and, when it is out of date, names the plan’s current settings separately. 79 files / 1,178 tests and the build passed. Live: a plan started on open water in Helsinki’s South Harbour and opened with View site in 3D placed the camera 437 m up (the terrain sample there is slightly above zero, so the below-sea-level branch is covered by the unit test of the shared rule, not by this run).

**Review round 13 and project rules — 2026-11-13.** Two findings addressed: floor plans take their base height from the same resolved surface as the analysis and the camera (mapped sea = sea level; other below-sea-level or missing terrain = unavailable, retried), and a building with many long use tags is still returned (the combined description is bounded). To match the project guide: rejection cases for the six planning channels and the two Overpass hosts were added to the IPC security test; the README gained a Protective planning feature row and an Overpass source row with its terms; screenshots moved to docs/screenshots/protective-planning/ and the live log to docs/. 79 files / 1,190 tests, type check and build passed; the floor-plan live check repeated (import, placement, rotation clearing the orientation confirmation, render).

**Review round 14: 2 findings, addressed.** The site’s satellite-pass list now counts completed and failed calculations separately (each bounded by an 8 s timeout): it says predictions are unavailable when none complete, says how many satellites are missing when some fail, flags satellites whose orbital elements are more than 7 days old, and states the calculation time and its fixed 12-hour window instead of “next 12 h” (warning once entries may have passed, and asking for a new prediction when the window has ended). 79 files / 1,191 tests and the build passed. Live: with the Satellites layer on, 60 satellites were calculated for Senate Square and the panel listed passes with the window stated.

**Review round 15 and close — 2026-11-13.** Two findings addressed: leaving the Site step during a satellite-pass prediction now abandons it (no replacement workers, no further satellites), and a planning camera move is dropped when the camera was moved by anything else (search, a restored view, tracking, the user) while terrain was loading. 79 files / 1,191 tests, type check and build passed; the live run repeated, including opening a saved plan through the panel (camera arrived at the site). The review loop was stopped here at the owner’s request after 15 rounds and 52 findings, all addressed; round 15’s two fixes were verified by tests, build and the live run but not re-reviewed. Still not verified: the export save dialog and PDF file in the running app (the HTML builder is unit-tested and a sample was rendered and inspected), the packaged build and installer, and behaviour over Google Photoreal 3D (no paid Google request was sent).

## Liquid-glass shell and regrouped navigation — 2026-11-13

The map now fills the whole workspace and the navigation is a slim floating glass rail (44 px, icons with tooltips) that the user can expand to show names and group titles; the choice is remembered locally. Pages are grouped in priority order — Monitor, Understand, Plan & track, Workspace — and Providers, Settings and Help form a separate cluster at the bottom of the rail (Providers and Settings left the top bar; their accessible names are unchanged). Every left-anchored float (Layers, page panels, dock, playback, credits, attribution) is offset by the rail’s current width, so nothing sits under it in either state. The bottom dock is one pill for Places, Scenes and Cameras (the overlapping “Browse all cameras” text link became an icon in that pill) and a centre pill with Playback, Watchlist and HUD; Screenshot, Share, Kiosk and Diagnostics moved under More (closes on Escape or an outside click). All floating surfaces share one glass material: a blurred, saturated and darkened backdrop (so text keeps contrast over snow and cloud), hairline border and inner highlight. Motion uses a soft spring: controls lift and their icon follows a beat later, a highlight sweeps across a widget on hover, and panels arrive with scale and blur; both reduced-motion paths (system setting and the app setting) remove it. [Styles](../src/renderer/styles.css) · [Rail](../src/renderer/App.tsx) · [Dock](../src/renderer/components/FloatingMapControls.tsx) · [Groups](../src/renderer/components/Pages.tsx)

Verified: type check, build and 80 files / 1,192 tests (one new test for the navigation groups). In the running app on an isolated profile, element rectangles were read back: with the rail collapsed the left widgets start at 66 px (rail ends at 54 px); expanded, they start at 226 px (rail ends at 214 px); screenshots were inspected. [Collapsed](screenshots/glass-shell/layers-collapsed-rail.png) · [Expanded with More menu](screenshots/glass-shell/rail-open-more-menu.png) · [Page panel](screenshots/glass-shell/planning-page.png)

Not verified: hover and press motion (screenshots cannot show it), windows narrower than 1920 × 1080, the wide Markets and Community pages, dialogs, and kiosk mode with the new rail. The design skill’s reference files were not installed, so no PRODUCT.md or DESIGN.md was created.

## Floating top controls and in-app window buttons — 2026-11-13

**Change.** The top bar no longer has a background, logo or name; its controls (view mode, basemap, imagery year, search, freshness, notifications) float over the map as separate glass pills. The native Windows minimise/maximise/close strip is replaced by three app-drawn buttons in a matching glass pill, because Windows paints a solid strip behind `titleBarOverlay` even with a transparent colour. New IPC channel `window:control` (`minimize` | `maximize` | `close`, strict enum) in all five places; `titleBarOverlay` removed from `main.ts`, `titleBarStyle: 'hidden'` kept. The pill is hidden in kiosk mode.

**Verified.** `npm run typecheck` passes; `npx vitest run`: 80 files, 1,195 tests pass (three new rejection cases for `window:control`); `npm run build` passes. Built app run on the secondary monitor with a temporary profile and database: pill at x 1810–1910, y 7–39 in a 1920×1080 window, accessible names "Minimize", "Maximize or restore", "Close", both `windowControl('maximize')` calls returned true and the first changed the window size. Screenshot: `docs/screenshots/glass-shell/window-buttons.png`.

**Not verified.** Minimise and Close were not clicked in the running app. The second maximise toggle did not change the reported window size within 0.9 s, so restore-then-maximise is unconfirmed. Windows 11 snap layouts on hovering the maximise button are lost with app-drawn buttons (not checked). Dragging the window by the empty top strip, windows narrower than 1920 px, and the packaged build were not checked.

## Labels, tanker and fighter filters, rooftop line of sight, draggable subject, route options — 2026-11-13

**What changed.**

- *Place labels* (`src/renderer/map/placeLabels.ts`): text size now follows the zoom per class (`ZOOM_SCALE`, `zoomScale`): country names are largest with the whole region in view and shrink as you zoom in; states peak at regional zoom; cities, towns, villages and suburbs grow as you approach them. Text is drawn at each class's largest size and scaled down, so it stays sharp. The old distance-only `scaleByDistance` was removed.
- *Street names* now run along their street. They are rotated billboards, kept upright and redrawn as the camera moves (`uprightAngle`). They appear at up to three points per name per tile on long streets (`streetLabelPoints`), and their collision boxes follow the rotation. Street text is 1 px larger.
- *Traffic filters* (`TrafficBar.tsx`, `shared/aircraft.ts`): a new aircraft class, fighter / attack jet, comes from the reported ICAO type code (`FIGHTER_TYPES`, `isFighterType`). There are one-click "Fighter jets only" and "All military" filters, and a "Tankers only" vessel filter (AIS ship types 80–89, already classified). No new data source: these filter the existing adsb.lol and AIS layers. The panel states the coverage limits: most military jets do not broadcast; keyless AIS covers Finnish and northern Baltic waters, and an AISStream key extends it to the viewed area.
- *Rooftops step in Protective planning* (`shared/overwatch.ts`, `PlanningPanel.tsx`, `planningOverlay.ts`): this lists the mapped roofs with a modelled clear straight line to the subject (the site marker). For each roof it shows distance, compass direction, roof height, view angle and the clear share of the roof. Roofs are outlined in vermillion at roof height, with dashed sight lines to the nearest 12. It runs the existing viewshed in reverse over roof cells only, using a new `mask` option. A person on a roof is placed at the roof edge facing the subject (new `edgeTargets` option), because someone at a parapet can look down past the wall below. The step also reports roofs that cannot be decided because data is missing, cells with no building data, and a warning when the subject marker stands on a mapped building (it is then modelled on that roof). Inputs: subject height, eye height on the roof.
- *Draggable subject, points and route ends* (`Globe.tsx` `planDragTarget`, `usePlanning.dragTo`): press and drag the site marker, an observation point, or a route's Start or Destination marker. The camera stays still while you drag. The rooftop check reruns against the loaded geometry, at most one calculation in flight. On release, coverage reruns if there was a run, and the area reloads if the subject has left it. Keyboard alternative: N, E, S and W nudge buttons (1–50 m) in step 1.
- *Route options* (`shared/routing.ts`, `map/roadNetwork.ts`, `map/planToolsWorker.ts`): pick a start and a destination (up to 12 km apart) and choose walking or driving. Up to three distinct routes are computed on this computer over the OpenMapTiles `transportation` lines from the same OpenFreeMap zoom-14 tiles the map already loads; no routing service is contacted. One-way streets apply when driving. Motorways are not walked and paths are not driven. Each option shows length, an estimated time (fixed speeds per road class), major-road share, junctions passed, the share of the route inside the loaded area with a clear line to a mapped rooftop within 300 m, and the share watched from your observation points when a current coverage run exists. "Use as primary" and "Use as alternative" save the route as a drawn line with that plan role, so it goes into the comparison and the briefing. These are measures for comparison, deliberately not a single safety rating, in line with the project's no-risk-score rule.
- Street names on routes come from `transportation_name`, joined by feature id or, failing that, by at least two shared vertices.

**Defect found and fixed during verification.** Zoom-14 tiles simplify long roads and can drop the vertex where a side road joins. In central Helsinki the driving graph then fell into 1,407 disconnected pieces (largest 5,361 nodes), and a driving route between two points 800 m apart failed. `joinTJunctions` joins a road end that lies within 3 tile units (about 0.3–0.6 m) of another road's line. After the fix: driving 119 pieces (largest 10,805 nodes), walking 6,961 → 261 pieces. The quickest walking route for the same pair went from 1.70 km (a detour) to 1.06 km. Roads that cross mid-line (bridges, tunnels) are still not joined. The route search also tries end-node pairs nearest-first and never returns a zero-length route. The panel reports how far the route starts and ends from the requested points.

**Verified.**

- `npm run typecheck` passes. `npx vitest run`: 83 files, 1,227 tests passed. New: `tests/overwatch.test.ts` (14), `tests/routing.test.ts` (12) and `tests/label-scaling.test.ts` (6), covering hidden roofs, missing data treated as undetermined rather than clear, roof edges, the range limit, the subject-on-roof flag, roof grouping, the viewshed mask, route overlook, footprint ids, tile-edge clipping, T-junction joins (and no join for mid-line crossings), one-way streets, mode restrictions, failure reasons, fallback gaps, zoom scale ramps, upright rotation and street label points, and fighter classification and filtering.
- `npm run build` passes.
- Built app run on the secondary monitor with a temporary profile and database, central Helsinki, live OpenFreeMap and terrain tiles:
  - The rooftop check found 34 of 173 roofs clear, with 21 undetermined.
  - Moving the subject through `dragTo` refreshed the result in about 100 ms.
  - Walking produced three routes of 1.06, 1.13 and 1.44 km, about 13, 14 and 18 min (12 tiles, 43,314 nodes, no tile failures).
  - Driving produced three routes of 3.03, 3.56 and 4.40 km, the long way round because of one-way streets.
  - Screenshots: `docs/screenshots/protective-planning/rooftops-line-of-sight.png`, `route-options-walk.png`, `route-options-drive.png`, `docs/screenshots/labels/street-names-along-streets.png`, `countries-zoomed-out.png`, `countries-and-cities-closer.png`.

**Not verified.**

- Dragging with a real mouse on the globe: the drag path was driven through `dragTo`, not pointer events.
- The automatic coverage re-run after a drop, in the app.
- "Use as primary" saving a route, in the app.
- The fighter and tanker filters against live aircraft and vessels: no military aircraft or tankers were loaded in this run.
- Label readability on other monitors and scales, and Photoreal 3D with the rooftop outlines.
- The packaged build and installer.
- Rooftop results and route overlook are not saved in the plan or the briefing; only a route adopted as a drawn line is.

**Remaining work.** Put the rooftop list and per-route measures into the saved plan and the briefing. Join roads that cross at a mapped crossing vertex lost in simplification only where the source shows one. Decide whether to offer turn restrictions, which would need a routing data source.

## Rooftop and route results in saved plans and briefings — 2026-11-13

**What changed.**

- Plans gain two optional fields, `rooftops` (`rooftopStudySchema`) and `routeStudy` (`routeStudySchema`), in `shared/protectivePlan.ts`. Both are strict and bounded: at most 60 roofs and 3 route options. They are additive with a `null` default, so plans saved earlier open unchanged.
- On **Save** and on **Export** (`usePlanning.studies`), the plan takes the current rooftop result and the current route options with their measures. The rooftop result is only taken if it was computed for the plan's current subject position; otherwise the plan keeps what it had.
- `rooftopStudyIsStale` flags a saved rooftop list once the subject moves or its height changes. A route option saved with "Use as primary" or "Use as alternative" records its drawn line, so the briefing names its role.
- The briefing gains a "Rooftops with a line of sight to the subject" section:
  - when and for which position and heights the list was computed
  - counts of clear, undetermined and no-data roofs
  - a warning when the subject was modelled on a roof
  - a table R1, R2, … with distance, direction, roof height, angle, clear share and position
  - the limits of the model

  An out-of-date list is marked as such and left off the diagram.
- The briefing also gains "Route options considered": mode, ends, tile failures, and per option the length, time estimate, major-road share, junctions, share overlooked, the distances at which the route leaves and joins the network, and its role in the plan. A "not a safety rating" note follows the table. Rooftops appear on the site diagram as numbered vermillion triangles.
- The planning panel says when results are saved with the plan. After reopening a plan it shows the saved rooftop list and route study, and whether the rooftop list is out of date.
- **Defect found in the live check and fixed:** the first save was refused ("expected number to be <= 1"). A route's overlooked share, summed from floating-point steps, can land a hair above 100%. Shares are now clamped to 0–1 in `routeOverlook` and when snapshotted. A new test checks the shares stay within 0–1 across sample spacings; I did not confirm that the test fails without the clamp.

**Verified.**

- `npm run typecheck` passes. `npx vitest run`: 84 files, 1,236 tests passed. New `tests/plan-studies.test.ts` (8) covers:
  - old plans opening without the fields
  - strict validation
  - staleness
  - briefing content for rooftops, subject-on-roof, not checked, out of date, route options and adopted role
  - escaping of street names
- `npm run build` passes.
- Built app with a temporary profile and database (central Helsinki):
  - Loaded the area: 41 roofs with a clear line.
  - Found three walking routes and adopted option 1 as the primary route.
  - Saved, read the plan back through `listPlans`: 41 roofs, three route options with the first marked adopted, the primary-route role with its geometry snapshot.
  - Closed and reopened: the panel shows "Saved list … 41 roofs" and "Saved route study … 3 walking options", and the plan is not marked unsaved.

**Not verified.** The exported HTML/PDF itself was not opened from the running app (the save dialog was not driven); the briefing content is covered by the unit tests above. Dragging with a real mouse, the packaged build and the installer remain unchecked.

## OpenStreetMap 3D buildings stand on their own ground — 2026-11-13

**Report.** The 3D building blocks did not line up with the buildings in the satellite imagery.

**Cause.** `BuildingManager.load` (`src/renderer/map/buildings.ts`) put every building in a zoom-14 tile on one ground height: a single terrain sample at the tile centre, at terrain level 13. A tile spans about 1–2.5 km, so on any slope buildings floated above or sank into the terrain. In a tilted view, a building at the wrong height is drawn displaced sideways from its footprint in the imagery draped on the terrain.

**Change.** Each building part is now based on the lowest of five terrain samples at its own footprint (`footprintSamplePoints`: the centre, plus points 70% of the way to the corners of its bounds; `buildingBase`). The samples are taken at terrain level 15, the level the ground is drawn from. A failed sample falls back to the tile-centre height, and these fallbacks are counted in `stats.baseFallbacks`. Diagnostics report `stats.baseSpreadM`: the median and maximum difference between the per-building bases and the tile-centre height in the last tile, a measure of the error the old method had (its old sample was at level 13, so this is approximate).

**Measured** (built app on the secondary monitor, temporary profile, keyless Atlas imagery, same camera positions before and after):

| Place | Buildings drawn | Old vertical error in the last tile loaded (median / max) | Fallbacks |
|---|---|---|---|
| San Francisco, Russian Hill | 28,742 | 1.9 m / 27 m | 0 |
| Lisbon, Castelo / Graça | 51,415 | 23.7 m / 74.5 m | 0 |

Before, the Lisbon view showed buildings buried in the castle hill with streets running across their roofs. After, they stand on the slope with the streets between them. Screenshots: `docs/screenshots/building-ground/` (`lisbon-before.png`, `lisbon-after.png`, `san-francisco-before.png`, `san-francisco-after.png`). Building geometry took 474 ms over 16 tiles in the Lisbon run.

**Tests.** `tests/building-base.test.ts` (3) covers the sample points, the lowest-ground rule and fallbacks. `npm run typecheck` passes; `npx vitest run`: 85 files, 1,239 tests passed; `npm run build` passes.

**Not verified, and what this does not fix.**

- The check used the keyless Atlas imagery. Google Satellite was not loaded, because it is metered on the user's key.
- Satellite images are not true orthophotos: tall buildings lean away from the image centre, so roofs in the imagery can sit several metres off their footprints while the bases line up.
- OpenStreetMap footprints are traced from various imagery sources and can be offset by a few metres from Google's imagery.
- Heights from OSM tags or a default estimate can differ from the real building.
- With Photoreal 3D on, the OSM blocks are hidden and Google's own mesh is shown; the planning rooftop outlines still use OSM heights.

## Coverage traced along sight lines (smooth, exact-angle edges) — 2026-11-14

**Request.** The blue coverage areas were drawn as 4 m squares; show smooth edges that follow the true line angles.

**Change** (`src/shared/viewshed.ts`, `src/shared/siteRaster.ts`, `src/renderer/map/viewshedWorker.ts`):

- Coverage is traced as a fan of sight lines from each observation point (`addObserverToDisplay`):
  - a quarter-cell step along each ray
  - rays no further apart than that at the edge of the range (up to 8,192 rays and 1,600 steps)
  - against buildings rasterised at a quarter cell from their OpenStreetMap outlines (`fineBuildings`)
  - with terrain interpolated between cell centres
- The result is a picture of up to about 1,200 pixels per side (0.44 m pixels in the test below), drawn with linear filtering. A shadow's side edge runs along the line from the observer past the blocking corner, and range circles and field-of-view edges are exact.
- Shares, per-point shares and route shares now come from this traced picture (`displayCombined`, `pictureGrid`), so the numbers match what is drawn. A point that cannot be traced (no terrain, unknown building, or under an elevated part) and rays crossing an elevated building part fall back to the cell model.
- The cell model also interpolates open-ground terrain between cell centres (`groundBetween`), so lines along a slope are no longer blocked by cell steps.
- The briefing image is the traced picture (98 KB as a data URL in the test), and the briefing wording says sight lines are traced finer than the sampling grid.

**Measured** (central Helsinki, two observation points, 250 m radius, built app, temporary profile):

- The old cell figures said 15.0% of the area clear, 82.1% blocked and 3.0% unknown.
- The trace finds 19.1% clear, 77.9% blocked and 3.1% unknown.
- Experiment: tracing without the outline raster still gave 18.6% clear, so most of the difference is the cell model counting a line that clips the corner of a 4 m cell as blocked by the whole cell. Interpolating terrain moved the cell figures by only 0.1 percentage points.
- Picture and figures now both read 19.1%.

Screenshots: `docs/screenshots/protective-planning/coverage-cells-before.png` and `coverage-traced-after.png`.

**Tests.** `tests/viewshed-display.test.ts` (8):

- a shadow edge on one straight line through the observer
- a rotated building's shadow passing within a metre of its real corner
- 97%+ agreement with the cell model at cell centres
- the exact range circle and field of view
- unknown terrain and the fallback
- lines along an even 45° slope staying clear
- the combined-share bookkeeping

`npm run typecheck` passes; `npx vitest run`: 86 files, 1,247 tests passed; `npm run build` passes.

**Not verified / limits.**

- Building outlines are rasterised at 1 m, so a corner can be up to about a metre off: measured 0.6 m at a diamond's tip.
- Some fine fringes remain where rays graze small or narrow mapped features.
- The rooftop check (step 3) still uses the cell model.
- Saved plans from before this change keep their earlier cell-based figures until run again.
- Trace time was not measured separately: the full run, terrain and building loading included, finished within the 60 s wait.

## Dragging the subject fixed; dark "site view" for planning — 2026-11-14

**Report 1.** Dragging the subject marker did not move it, though the highlighted sight lines changed.

**Causes and fixes** (found by driving real pointer events in the built app; `window.__atlasDebug.toScreen` and `pickId` were added for that):

1. **Grabbing.** The dashed sight lines start exactly at the subject marker, so pressing on the marker picked a sight line and no drag started. Pressing and hovering now look through everything stacked under the cursor for a draggable item (`draggableAt`, `scene.drillPick`) in `Globe.tsx`.
2. **Redrawing.** `PlanningOverlay.update` removed all plan entities and re-added them under the same ids while entity events were suspended. Cesium then reports a re-added id as unchanged, so the map kept drawing the old entity objects. This affected every overlay update, not only dragging. The removal is now flushed before re-adding. One extra render is also requested on the next frame, because markers clamped to the ground settle a frame after they move.

Before/after with the same scripted drag: `docs/screenshots/protective-planning/drag-before-fix.png` and `drag-after-fix.png`. After the fix, the marker is drawn where the moved site projects (1160, 620 on screen).

**Report 2.** Make planning look like the supplied reference images: dark map, lit sight lines, outlined vantage buildings, markers, rings and a route. No names, logos or assets from the reference product were used.

**Change.** A **Site view** switch, on by default, at the top of the planning panel. While the planning page is open:

- **Map and buildings.** Imagery is dimmed (brightness 0.36, saturation 0.1), except the coverage picture. OpenStreetMap buildings become uniform dark grey blocks without façades (`BuildingManager.setDark`).
- **Coverage** (`displayRgbaGlow`):
  - Only places with a clear line are lit: white near the observation point, fading to pink at its range, brighter where two or more see the same place, with fine hatching.
  - The limit of view is a two-pixel dashed magenta edge.
  - Unknown is a faint grey hatch.
  - Blocked ground is left unlit.
  - The legend says all of this, including that unlit ground inside the rings is blocked.
- **Rooftops.**
  - Roofs with a clear line are outlined in magenta.
  - The ten nearest get a diamond vantage marker (an original icon), and the four nearest that are at least 20 m away get a boxed label "Vantage point · N m".
  - The eight nearest have glowing magenta lines to the subject.
  - The labels say "vantage point", not "sniper position": they show a modelled line of sight, not a threat.
- **Subject, rings and routes.** The subject is a white ring marker with a boxed name. Dashed range rings at round distances (`ringStepM`), about four across the radius, plus the edge of the analysed area, each carry a distance label. The chosen route is white and the other options faint white, with boxed Start and Destination labels.
- **Colour classes remain.** Turning the switch off returns to the colour-class view. The briefing image keeps the colour classes.

**Verified.**

- `npm run typecheck` passes. `npx vitest run`: 86 files, 1,249 tests passed. New: the site-view picture test (lit near the observer and fading with distance, unlit in shadow and beyond range, magenta edge present, unknown hatched and never lit) and the ring-spacing test.
- `npm run build` passes.
- Built app, temporary profile, Senate Square in Helsinki: coverage from the subject, 25 rooftops, a walking route. Screenshots: `docs/screenshots/protective-planning/site-view-top.png` and `site-view-3d.png`.

**Not verified / limits.**

- Labels cannot avoid each other, so two close vantage points can overlap.
- In the site view, the dimming applies to all imagery, so "Imagery year" and Photoreal 3D are not distinguishable there.
- Dragging was exercised with scripted pointer events, not a physical mouse.

## The site is its own observation point — 2026-11-14

**Request.** Step 1 set the site, then step 2 needed an observation point added at the same place before coverage could run. Make them one.

**Change.**

- Plans gain `analysis.subjectView` (default on; plans saved before open with it on).
- `coverageObservers(plan)` in `shared/protectivePlan.ts` puts the subject first in every coverage run, as id `subject`: at the site marker, eye at the target height, over the whole analysis radius, all directions. Added points and cameras that can be modelled follow it. The id `subject` is reserved; the schema rejects an added point using it.
- The run controls (`RunCoverage`) are now in step 1, right after choosing the site:
  - a checkbox "Model sight lines from the subject"
  - the open-ground choice
  - a **Model coverage** button
  - the subject's own shares and the results
- Step 2 is renamed **Area & points**. It holds the radius, cell size and height settings, plus optional extra points (guards, rooftops, cameras), and shows the same run controls.
- Dragging the subject re-runs coverage when there was a run, now without needing an extra point.
- The briefing lists the subject's view as the first row of the observation table.

**Verified.**

- `npm run typecheck` passes. `npx vitest run`: 87 files, 1,253 tests passed. New `tests/subject-view.test.ts` (4) covers the default, ordering, switching off, old plans, the reserved id and the briefing row.
- `npm run build` passes.
- Built app, temporary profile, Senate Square:
  - Chose the site, ticked the open-ground choice and pressed **Model coverage** in step 1, with no point added.
  - The run modelled `subject` only (clear 7%, blocked 92%, unknown 2%) and the map showed its view.
  - Screenshot: `docs/screenshots/protective-planning/coverage-from-site-step1.png`.

**Not verified.** Exporting a briefing from the app after this change; the briefing row is covered by unit tests.

## Wind, lightning, launches, GPS accuracy, flight paths and directions — 2026-11-14

**Request.** Compare with God's Eye View (now MIT-licensed, <https://github.com/bilawalsidhu/gods-eye-view>) and add what Atlas Watch lacks; take code from it where the work is hard. The user chose the first group: animated wind, lightning, GPS interference, space launches, a past track for an aircraft, and turn-by-turn directions with a fly-along camera. Their detection boxes, OpenAI voice, Cesium ion, Nominatim/Photon, the paid Liveuamap feed and the non-commercial Nepal flood data were left out under this project's rules.

**Change.**

- **Wind (Weather → "Wind (animated forecast)", setting `windEnabled`).**
  - `src/shared/grib2.ts` is a small GRIB2 reader of our own for one message: regular lat/lon grid (template 3.0), complex packing with spatial differencing (template 5.3). God's Eye View decodes with a multi-megabyte ecCodes WebAssembly build; that dependency was not added. Other templates, bitmaps and missing-value management are refused, not guessed.
  - `src/main/windService.ts` reads the newest published NOAA GFS 1° run from the AWS Open Data bucket: the `.idx` file (about 50 kB), then the 10 m UGRD and VGRD messages by byte range (about 80 kB each). Run selection skips runs that are not published yet. The field is cached for an hour; a failed refresh keeps the last complete field with its own run time and says so; after a failure NOAA is not asked again for 10 minutes.
  - New `fetchBytes` in `feeds/http.ts` (bounded `maxBytes`, Range header). New allow-list prefix `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.`, not the whole shared S3 host.
  - New IPC channel `weather:wind` in all five places.
  - `src/renderer/map/windOverlay.ts` draws particles on a canvas over the globe, 2,200 of them (3,500 at maximum quality). The trails fade, the canvas clears when the camera moves, and drawing pauses while the window is hidden. With reduced motion it draws still arrows instead.
  - The Layers panel shows the run, forecast step and valid time, and the forecast wind at the map centre (m/s, knots, compass direction). It is labelled as a forecast; the streaks are described as a visualisation, not tracked air.
- **Lightning (setting `lightningEnabled`).**
  - nowCOAST WMS layer `ldn_lightning_strike_density`: 15-minute strike density on an 8 km grid from NLDN and GLD360.
  - Refreshed every 5 minutes while on. Coverage stated as given by NOAA: 25° S–80° N, 110° E eastward to 0°.
- **Space launches (layer `launches`, Space group).**
  - Launch Library 2 v2.3, 30 days back and 14 days ahead, polled hourly (the anonymous limit is 15 per hour). Allow-listed host `ll.thespacedevs.com`.
  - Records sit at the pad. The source status words are shown. An unknown status is never shown as a success.
  - Each status has its own marker shape: ring with an arrow for scheduled, tick for success, cross for failure, triangle for in flight, question mark otherwise.
- **GPS accuracy anomalies (layer `gnss`, Hazards group).**
  - `src/shared/gnssIntegrity.ts` is ported from God's Eye View (`src/layers/gnss/records.js`, MIT; notice added to `THIRD_PARTY_NOTICES.md` through `scripts/third-party-notices.mjs`).
  - Per-aircraft rule: GPS-loss flag, NACp < 8, or NIC < 7 except NIC 0 with NACp ≥ 10. TIS-B, MLAT-derived and ground reports are excluded.
  - Cells are 0.5° over a rolling 30 minutes, with at least 3 aircraft. Score and bands follow gpsjam.org.
  - The fetcher asks adsb.lol for one 250 nm area at the whole-degree view centre, at most once a minute per area, every 2 minutes while on. The store is bounded at 60,000 entries.
  - Labelled "calculated". Blank areas are described as too few aircraft, not as "no interference". High and medium cells carry text labels as far out as they are drawn.
- **Flight path for a selected aircraft (new IPC `tracks:flightPath`, all five places).**
  - God's Eye View dropped the undocumented adsb.lol trace route; it uses OpenSky's `/api/tracks/all`, which is what this does too.
  - A button in the aircraft details panel asks OpenSky once. It costs about 4 of the 400 anonymous daily credits; the result is cached 5 minutes per aircraft and concurrent asks share one request.
  - The path is drawn as a dashed amber line, apart from the recorded cyan trail, and never written to history. It covers the current flight only, not a full 24 hours; the panel says so.
- **Turn-by-turn directions and fly-along (protective planning, step 5 Routes).**
  - `routeSteps` in `shared/routing.ts` turns each route option into steps: a new step where the street name changes or the route turns 45° or more at a junction. Jogs under 25 m are folded into a neighbouring step, and same-street pieces meeting at a gentle angle are rejoined. Unnamed roads are described by class.
  - Each route card has a "Directions" list; clicking a step centres it.
  - "Fly along" moves the camera behind and above the route, looking ahead. It ends on any click, wheel or Escape. With reduced motion it shows a still overview instead.

**Verified.**

- `npm run typecheck` passes. `npm run build` passes (the usual chunk-size warning).
- `npx vitest run --maxWorkers=4`: 89 files, 1,290 tests passed. In the default parallel run `tests/nav-groups.test.ts` timed out once while importing `Pages.tsx` and passed alone, like the known `passenger-routes` timeout.
- New tests:
  - `tests/wind.test.ts` (13): decodes real GFS u/v messages saved as fixtures; easterly trades and Southern Ocean westerlies come out with the right sign; malformed and unsupported messages are refused. Also covers run selection and forecast step, index ranges, the S3 prefix allow-list, bilinear sampling across the date line, direction words, and the service's fallback to an older run, keeping the last field on failure and refusing a non-wind message.
  - `tests/group1-layers.test.ts` (14): launches from a trimmed real LL2 reply; GPS rule, gpsjam bands, window, sparse cells, date line and pole keys and store bound; the OpenSky path from a real reply, cache and refusals; every layer has a fetcher.
  - Three turn-by-turn tests in `tests/routing.test.ts`.
  - IPC rejection cases for both new channels.
- Built app, temporary profiles, window on the LED monitor (screenshots in `docs/screenshots/group1/`):
  - Over North America, wind particles animated from the 06Z run (9 h step); the Atlantic low's circulation is visible. Lightning cells showed over the Atlantic and the Caribbean. 35 launches loaded.
  - Over central Europe, GPS accuracy loaded 562 aircraft into 93 cells, 15 of them high.
  - For Austrian 230U (A20N, Berlin to Vienna), "Show this flight's path" returned 44 OpenSky waypoints, drawn from Berlin to the aircraft.
  - In Helsinki, a walking route gave three options with directions. "Fly along" moved the camera (two samples 2.5 s apart differed) and the button changed to "Stop flight".
- One request each was sent to Launch Library 2 and OpenSky, plus the GFS index and messages and a few adsb.lol requests; no paid or keyed service was used.

**Not verified.**

- ECMWF wind (God's Eye View's alternative model) is not added.
- The wind overlay was checked only in 3D. It is drawn over 3D buildings and terrain, not hidden behind them, and the field is the 1° grid (about 110 km).
- The fly-along was driven by script; a physical mouse ending the flight was not tried. Its camera height follows terrain only, not buildings, so tall buildings can come close to the camera on a walking route.
- The OpenSky path for military or non-ICAO (`~`) addresses is not offered. OpenSky's terms require an agreement for commercial use, as with the opt-in worldwide snapshot.
- The packaged app and installer were not rebuilt or run.

**Remaining.** God's Eye View group 2 (trains, bike share, street-level photos, wildlife, Canadian air quality, GDELT conflict events), not started.

## Trains, bike share, wildlife, Canadian air quality, news-reported violence and street photos — 2026-11-14

**Request.** God's Eye View comparison, group 2. Live radio was skipped as proposed: each station streams from its own host, which a fixed allow-list cannot cover. Infrastructure datasets were checked for licences, not added.

**Change.** Six new layers on the existing layer system (`shared/layers.ts`, `main/layers/fetchers.ts`, `map/layerRender.ts`). Each states its kind of data, coverage and terms. God's Eye View's feed catalogues were read for URLs and terms; its code was not copied. Its rail and street-level code is about 19,000 lines, and the versions here are much smaller.

- **Trains (`rail`, Movement).**
  - `src/shared/gtfsRealtime.ts` is a small GTFS-Realtime reader written from the published field numbers. It reads vehicle positions only and skips unknown fields; no protobuf dependency was added.
  - `src/shared/streetRail.ts` lists 15 rail-only feeds with published terms: MTA Metro-North and LIRR, SEPTA Regional Rail, MARC, Translink rail and G:link, Fintraffic, Renfe long-distance and Cercanías, Entur Vy, Go-Ahead and Flytoget, KTMB, and two Toyama tramways.
  - Fintraffic's GTFS-RT URL used by God's Eye View now answers 400, so its JSON `train-locations/latest` is used.
  - Feeds with no published licence (Tri-Rail, Metro Transit, Charlotte, Irish Rail positions) and mixed bus feeds are left out.
  - Only feeds near the view are polled, every 30 s. Positions older than 15 minutes are dropped. Renfe gives no per-train time, so its trains are dated by the feed snapshot and the details say so.
  - Entur lists rail-replacement buses in the Vy feed (11 of 70 vehicles on 2026-11-14); trips matching `:ServiceJourney:BUS-` are left out.
- **Bike share (`bikeshare`).** GBFS station information and status for Citi Bike, Divvy, Capital Bikeshare, Bay Wheels, Bluebikes, the Oslo, Bergen and Trondheim Bysykkel, and AMBici.
  - Citi Bike's Data License Agreement was read: "use the Data for any lawful purpose". The other Lyft systems publish the same agreement.
  - Loaded only when zoomed in near a system. A station without a status report shows unknown counts, not zero.
- **Wildlife (`wildlife`).** iNaturalist v2, wildlife groups only, last 7 days, current view.
  - Only CC0, CC BY and CC BY-SA records are requested, so the layer stays usable in a commercial product (most records are CC BY-NC).
  - Obscured locations are drawn hollow and labelled.
- **Air quality (`airQuality`, Canada only).** ECCC AQHI observations, with bands 1–3, 4–6, 7–10 and 10+. Marker size grows with the band, and bands above low keep their text label far out.
- **News-reported violence (`conflicts`).**
  - GDELT 2.0 15-minute exports, CAMEO roots 18–20, one point per article at its most specific place.
  - The newest announced file returns 404 for a while, so the fetcher walks back through 15-minute slots.
  - It reads 3 hours on enabling, then each new file, and keeps 24 hours.
  - Article links are registered with the main-process link allow-list (bounded to 2,000), so they open in the browser.
  - The layer says plainly that the coding is often wrong. The fixture itself shows a New Mexico story placed in Spain.
  - `main/layers/zipSingle.ts` reads the one CSV with size limits checked before inflating.
- **Street-level photos (`streetPhotos`, Cameras).**
  - KartaView (blurred photos only, 500 m radius, the API's maximum) and Panoramax, within 500 m of the view centre below about 4 km.
  - The renderer may load images only from KartaView's CDN path and the IGN and OpenStreetMap France Panoramax paths; pictures on other instances are dropped.
  - The details panel shows the photo with its date ("it shows the street then, not now") and credit. Mapillary is not included because it needs a token.
- New `fetchBytes` use for binary feeds through the shared fetcher; `FetchContext.fetchBytes` is optional and defaults to it.
- All destinations were added to the three allow-lists as exact paths on shared hosts. README sources table, credits and `THIRD_PARTY_NOTICES.md` were updated. `layersEnabled` now allows up to 40 entries.

**Licence check (not added).** God's Eye View's submarine cable data is TeleGeography CC BY-NC-SA 3.0, so it is excluded. Its data-centre (4,352) and dam (704) extracts are OpenStreetMap data under ODbL 1.0, which this app could bundle with attribution and share-alike on the database. Not done: it needs the owner's go-ahead and a generator script rather than a copied file.

**Verified.**

- `npm run typecheck` passes. `npx vitest run --maxWorkers=4`: 90 files, 1,310 tests passed. `npm run build` passes.
- New `tests/group2-layers.test.ts` (20), from real replies saved as fixtures:
  - Renfe and Translink GTFS-RT; a hand-made protobuf with a (0, 0) fix and truncation; the stale filter and header dating; replacement-bus filtering; Fintraffic JSON; feeds chosen by view
  - Oslo GBFS, including unknown status
  - iNaturalist licence filter and obscured locations
  - AQHI bands and 10+
  - a real GDELT export: unzip, parse, one point per article, file naming, size limit
  - KartaView and Panoramax image-host filtering
  - allow-list and licence-link checks for every feed
- Built app, temporary profile, LED monitor (screenshots in `docs/screenshots/group2/`):
  - Oslo: 86 trains from Vy, Go-Ahead and Flytoget (before the replacement-bus filter), 261 bike stations, 1 sighting.
  - Paris: 115 photos; a Panoramax photo opened at 2,048 px with its date and CC BY-SA credit.
  - Canada: 124 AQHI stations; 169 articles from 10 GDELT updates.

**Not verified.**

- The US train feeds (MTA, SEPTA, MARC), KTMB and the Toyama tramways were not fetched live; their URLs come from God's Eye View's registry.
- The Lyft bike systems other than the licence page were not fetched live.
- The replacement-bus filter was checked against a saved Vy reply in a test, not re-run in the app.
- The packaged app and installer were not run.

**Remaining.** Data-centre and dam layers (ODbL), if wanted. Mapillary photos with a customer token. Live radio is not planned.

## Data centres and dams (bundled OpenStreetMap data) — 2026-11-14

**Request.** Add the data-centre and dam layers after the licence check: OpenStreetMap data under ODbL 1.0. TeleGeography cables stay excluded (CC BY-NC-SA).

**Change.**

- `scripts/build-infrastructure.mjs` builds `src/main/data/infrastructure.json` from God's Eye View's OSM extracts (`src/data/local_data/{datacenters,dams}`, ODbL 1.0). It records their SHA-256 checksums and counts in the file.
  - Each site keeps its OSM type and id, one point (the area-weighted centre of its outline) and a few tags: name, operator, owner, start date, height and levels; source and output for plants.
  - Contact details, notes, fixme, websites and all other tags are dropped, as are values that look like an email or phone number.
  - Negative ids are OSM relations. Checked against the OSM API for relation 19953989 (HE Podlubnik) and way 1176042553 (AWS).
- `src/main/data/INFRASTRUCTURE_ATTRIBUTION.txt`: © OpenStreetMap contributors, ODbL 1.0 (the file is a derived database; share-alike applies to it), dams via Open Infrastructure Map. It also notes that the upstream extraction date was not recorded and that the dam set is a sample.
- Two static layers in Reference, no network: **Data centres (OpenStreetMap)** with 4,352 sites, and **Dams and hydropower plants (sample)** with 703 sites. One dam row was dropped by the generator as a duplicate or without a position.
  - `src/shared/infrastructure.ts` validates every row on read.
  - The thousands of points are drawn as one batched `PointPrimitiveCollection` per layer, not entities: filled dots for data centres, hollow rings for dams.
  - Each site links to its OpenStreetMap object.
- README sources row, credits and `THIRD_PARTY_NOTICES.md` updated.

**Verified.**

- `npm run typecheck` passes. `npx vitest run --maxWorkers=4`: 91 files, 1,315 tests passed. `npm run build` passes.
- New `tests/infrastructure.test.ts` (5) covers the counts, no contact or note fields, the OSM link for a checked relation, malformed rows, and both fetchers working with no network.
- `tests/layer-render-aging.test.ts` builds the renderer by hand, so its fixture gained the new `staticPoints` field; no assertion changed.
- Built app, temporary profile, LED monitor:
  - Both layers loaded (4,352 and 703), drew across Europe, and selecting Equinix FR6 opened its details.
  - Screenshot: `docs/screenshots/group2/datacentres-dams-europe.png`. It was taken before dams were changed to hollow rings.

**Not verified.**

- The hollow-ring style was not re-checked in the app.
- The upstream extract's age is unknown, so sites can be outdated or missing.

## Black disc at the North Pole on Google Satellite; weather-satellite gap — 2026-11-14

**Report.** On Google Satellite a black disc covered the North Pole, and the weather-satellite layer left Europe and Africa uncovered.

**Cause.**

- Google, Esri, Mapbox and EOX tiles stop at the Web Mercator limit (85.05°). Above it, only the bundled ocean-colour polar reference was drawn. It is dark navy and blends with the default Atlas imagery, but shows as a black disc against those providers' bright blue ocean. Read from the user's profile, read-only: basemap `google2d`.
- The default Atlas imagery has no visible disc. Checked in the app at 88° N with weather satellite, wind, lightning and radar each on in turn.

**Change.**

- `basemaps.ts`: `polarCaps(fromLat)` takes a start latitude. The new `keyedMercatorBase()` adds the Blue Marble bathymetry caps from 84° under the provider layer for `google2d`, `esri`, `mapbox` and `eox`.
- New `tests/polar-basemaps.test.ts` (4): each keyed basemap has caps covering 84–90° placed under the provider layer.
  - The Google provider is mocked and `fetch` is blocked in the test.
  - The first run of this test, before the mock was added, may have sent one Google session request with the dummy key `test-key`; an invalid key is refused, not billed.

**Weather satellite over Europe and Africa: not changed.**

- NASA GIBS still carries no Meteosat products (checked in its capabilities on 2026-11-14: GOES-East, GOES-West and Himawari only).
- EUMETSAT's View Service offers Meteosat 0° and Indian Ocean imagery (`msg_fes:ir108`, `msg_iodc:ir108`, 15-minute), and its capabilities state no fees.
- EUMETSAT's licence text could not be read here: the 2025 policy PDF is encrypted and the announcement page returned 403. Search results say data under 3 hours old is licensed for research, education and personal use, and that hourly imagery is no longer licensed. Not added until the owner decides.

**Verified.** `npm run typecheck` passes; 92 files, 1,319 tests passed; `npm run build` passes. The bathymetry cap at the pole renders, seen with the keyless street map, which uses the same caps (`docs/screenshots/polar/bathymetry-cap-north-pole.png`).

**Not verified.** Google Satellite itself was not loaded (metered), so the blend with Google's ocean is unconfirmed.

## Hourly Meteosat for the weather-satellite layer — 2026-11-14

**Request.** Fill the weather-satellite gap over Europe, Africa and the Indian Ocean with hourly Meteosat, the option offered after the licence check above.

**Change.**

- `shared/geoSatellite.ts` gains two satellites, `meteosat-0` (Meteosat 0°) and `meteosat-iodc` (Meteosat Indian Ocean, 45.5° E), with `source: 'eumetsat'`.
  - Infrared uses `msg_*:ir108`; colour uses `msg_*:rgb_naturalenhncd`, which is daylight only.
  - Seams are now halfway between sub-satellite points: GOES-East to 37.6° W, Meteosat 0° to 22.75° E, IODC to 93.1° E, Himawari from there. Before, GOES-East ran to 10° E and Himawari from 60° E, leaving the gap.
- `eumetsatFrameTime()` picks the last full hour at least 20 minutes old. Only hourly frames are used, because EUMETSAT licenses its 15-minute imagery under 3 hours old for non-commercial use. No lookup request is made; the WMS serves the frame for that time.
- `Globe.tsx` draws Meteosat frames as WMS tiles (EPSG:4326) from `view.eumetsat.int/geoserver/wms`. The infrared frame is opaque grey, so dark pixels are made transparent on the GPU (`colorToAlpha`, black, threshold 0.28) to show clouds only.
- Allow-lists:
  - renderer `https://view.eumetsat.int/geoserver/wms`
  - external links `eumetsat.int`
- Also: a provider entry, the credit "Meteosat © EUMETSAT (hourly)", updated Layers panel text, a README sources row and `THIRD_PARTY_NOTICES.md`.

**Verified.**

- `npm run typecheck` passes; 92 files, 1,320 tests passed; `npm run build` passes.
- `tests/geo-satellite.test.ts`: the seam test now requires five satellites with no gap or overlap (it used to assert the gap). A new test covers the hourly frame times, the renderer allow-list and the layer names.
- Built app, temporary profile, LED monitor, view centred on Africa:
  - All five satellites were drawn, with Meteosat frames for 15:00 UTC.
  - All 72 EUMETSAT tile requests succeeded, with no lookup failures.
  - Screenshots: `docs/screenshots/geo-satellite/meteosat-infrared-africa-europe.png` (clouds only, desert clear) and `meteosat-colour-africa-europe.png` (daylight colour; the night side fades out).

**Not verified.**

- EUMETSAT's own licence text: the 2025 Data Policy PDF is encrypted and the announcement page refused the request. The hourly-only choice rests on search-result summaries of EUMETSAT pages. Confirm with EUMETSAT before selling the app.
- The 0.28 transparency threshold was judged from one afternoon frame; very cold ground at night may also show as cloud.

## Longer movement history (up to 30 days) and a date/time jump in playback — 2026-11-14

**Request.** Replay past flight routes by date and time, as God's Eye View's history appears to. Checked first: God's Eye View has no per-date archive. Its 24-hour backfill used an undocumented adsb.lol route that has been retired, and it now uses OpenSky's current-flight track. Atlas Watch therefore extends its own recordings. Tracking cars through traffic cameras and archiving camera footage were declined: they would follow individual people (project rule: no people-tracking), and public camera publishers provide no archive.

**Change.**

- New setting `trackStorageMB`: default 250, range 20–4,000, additive with a default for older databases.
- `trackRetentionHours` now allows up to 720 hours (30 days).
- `shared/timeline.ts`:
  - `TRACK_BYTES_PER_POINT = 170`, measured: 300,000 aircraft fixes took 50.4 MB including the primary key and time index.
  - `trackPointBudget()` converts the MB limit into a fix count.
  - Fixes older than `TRACK_THIN_AFTER_HOURS = 6` are thinned to the first fix per object per minute. Replay looks back 5 minutes, so thinned periods replay without gaps.
- Pruning:
  - Before: up to 400,000 fixes, pruned on every layer refresh. At about 700 aircraft every 20 s, that is roughly 3 hours whatever the retention said.
  - Now: the storage budget, at most once a minute.
  - Thinning (`AtlasStore.thinTracks`) runs incrementally on the stretch not yet thinned, at most every 15 minutes.
- Trains (`rail`) are recorded and replayed with aircraft, ships and transit (`REPLAY_LAYERS`).
- Organisation page: retention input up to 720 hours and a storage-limit input. A note explains:
  - the estimated fix count
  - that whichever limit is reached first wins
  - the thinning
  - that only what this app recorded can be replayed
- Playback bar: a "Go to" date-and-time field (local time, minute precision), bounded by the recorded range, next to the slider. A time outside the range gets the existing note; the cursor is never moved to another time.

**Verified.**

- `npm run typecheck` passes; 93 files, 1,326 tests passed; `npm run build` passes.
- New `tests/track-history.test.ts` (6):
  - settings bounds, and a database without the new field getting the default
  - the point budget
  - thinning keeps the first fix per object per minute and leaves recent fixes alone
  - a thinned stretch still replays a fix within the 5-minute window
  - oldest fixes are removed first when the budget is reached
  - the local time field format
- Built app, temporary profiles, LED monitor:
  - Ships near Helsinki: 593 fixes recorded. Playback showed the "Go to" field bounded by the recorded range.
  - Organisation page: showed 720 hours, 500 MB and "about 2.9 million" fixes.
  - Trains over Finland and Norway: 327 fixes recorded; at a playback time near the end, 160 trains were drawn from recorded fixes. Screenshot: `docs/screenshots/group2/playback-recorded-trains.png`.

**Not verified.**

- A real multi-day recording, thinning on hours-old fixes, and pruning at the storage budget were exercised only in tests. The app ran for minutes.
- Disk use over 30 days depends on how many aircraft were in view; the estimate is per stored fix.

## Traffic flow layer — 2026-11-14

**Request.** Add a traffic flow layer wherever possible worldwide. Agreed beforehand: measured traffic per road or sensor only, never individual vehicles; tracking specific cars through cameras stays out.

**Change.**

- `src/shared/trafficFlow.ts` puts five keyless sources on one scale: free / slow / heavy / stopped / unknown. Each record states its basis:
  - **New York City DOT** speeds (mph): speed bands, because no free-flow reference is published.
  - **Fintraffic TMS:** speed as a percentage of free-flow speed; the slower direction sets the class.
  - **Hong Kong TD detectors:** speed bands, averaged over lanes that counted vehicles and weighted by count.
  - **Madrid:** the city's level of service 0–3. Coordinates are converted from UTM zone 30N, and the local file time from CET/CEST.
  - **Paris:** the city's traffic state; "Inconnu" stays unknown. Hourly and about a day behind.
- One layer, `trafficFlow` (Movement), polls only the sources under a zoomed-in view, with per-source caches (2–5 minutes; Paris an hour; station and detector lists a day). It returns only what is near the view, up to 12,000 records.
- Drawing (`layerRender.updateFlow`): road lines are one ground-clamped `GroundPolylinePrimitive` and sensors one `PointPrimitiveCollection`. Okabe–Ito colours plus width and size by state; unknown readings are thin and grey.
- Allow-lists: exact dataset paths on the shared hosts (NYC Open Data, DATA.GOV.HK, opendata.paris.fr) and the host `informo.madrid.es`. README source rows, credits and notices updated.
- Considered and not added:
  - Netherlands NDW: a 53 MB XML file every minute and a site table of about 150 MB uncompressed, too heavy to parse in the main process.
  - Chicago: dataset not updated since April 2026.
  - Hong Kong's old speed map: retired.
  - UK, Germany and most US states: no keyless live speeds; they need registration or a key.
  - TomTom worldwide flow: paid key and metered.

**Problems found in the data and fixed (each with a test that failed first).**

- New York reports links with no reading as status −101, speed 0. They were drawn as "stopped": 42 of 125 links on the day. They are now unknown.
- Fifteen New York encoded shapes were corrupt, jumping hundreds to thousands of kilometres and drawn as straight lines across Queens. The point list is used instead (17 links marked "partial (as published)"), or the link is not drawn. Nothing is repaired or invented.
- Hong Kong lanes with no vehicles still carry a speed value (70 with volume 0). They are no longer counted.

**Verified.**

- `npm run typecheck` passes; 94 files, 1,340 tests passed; `npm run build` passes.
- `tests/traffic-flow.test.ts` (14) runs on real samples from all five sources. It covers the class rules, source selection by view, the polyline decoding checked against the published points, the time zone conversions, the Madrid UTM conversion (Puerta del Sol), the three data problems above, and the allow-lists.
- Built app, temporary profiles, LED monitor (screenshots in `docs/screenshots/traffic-flow/`):
  - New York: 125 links, 108 with full shapes and 17 partial, following the FDR, BQE and Van Wyck.
  - Madrid: 4,904 sensors.
  - Hong Kong: 729 detectors.
  - Finland around Helsinki: 153 stations.
  - Paris: 2,942 arcs, 1,056 unknown as published.

**Not verified.** Picking a road line to open its details was not clicked in the app (lines carry the same record id as other layers). Behaviour at rush hour was not seen.

## ATC radio link and simulated traffic — 2026-11-14

**Request.** (1) Show each car moving in real time. (2) When an aircraft is selected, offer to hear the radio between it and the tower.

**What is possible.** No public source publishes live positions of individual private cars, so real per-car tracking cannot be built. The user chose both alternatives offered: keep the real per-vehicle layers (Transit, Rail; unchanged) and add a labelled simulation on the measured roads. For ATC audio, LiveATC.net's terms (items 3 and 4, read at https://www.liveatc.net/legal/ on 2026-11-14) forbid a dedicated app that makes their streams available without consent and ask sites to consult them before linking to streams. The app therefore links to LiveATC's public airport page in the system browser and plays nothing itself.

**Change.**

- ATC radio (`src/shared/atc.ts`, `src/renderer/components/AtcListen.tsx`, shown in aircraft and military-aircraft details):
  - The three nearest airports within 80 km that publish ATC frequencies, with each airport's frequencies as published.
  - "Listen to KJFK on LiveATC" opens `https://www.liveatc.net/search/?icao=KJFK` (four-letter ICAO codes only). `liveatc.net` added to `EXTERNAL_LINK_HOSTS`.
  - A "likely now" mark from the aircraft's height and distance (ground: ground, tower, clearance; below 3,000 ft within 20 km: tower; below 18,000 ft: approach, departure; cruise or unknown altitude: none). The text says it is a guess and that aircraft do not broadcast their frequency.
  - Frequencies: new generator `scripts/build-airport-frequencies.mjs` from OurAirports `airport-frequencies.csv` (public domain), producing `src/renderer/data/airportFrequencies.json` (266 KB; 9,560 frequencies at 3,610 airports; VHF 108–137 MHz only). JFK matches LiveATC's own list (tower 119.1 and 123.9, ground 121.65 and 121.9, clearance 135.05).
  - ATC view tooltip no longer says "no ATC audio".
- Simulated traffic (`src/shared/trafficSim.ts`, `src/renderer/map/trafficSim.ts`), setting `trafficSimEnabled` (default off), switch under Traffic flow in Layers:
  - Only on roads with a published shape (New York, Paris) and a known state. Finland, Hong Kong and Madrid publish sensor points, so they get no dots; no roads are invented.
  - Speed: measured speed (New York); Paris publishes no speed, so a speed is assumed per published state (35/20/10/3 km/h).
  - Number of dots: flow ÷ speed where a flow count is published (Paris), capped at 150 per km; otherwise a typical density per state (20/35/60/100 per km). Up to 12,000 dots; past that each dot stands for several vehicles.
  - Direction of travel is not published, so dots follow each line's drawn order. One point collection, advanced each frame in real time, hidden above about 60 km camera height, still with reduced motion, not pickable (clicks reach the road).
  - Map credit: "Moving dots on traffic roads: simulated, not real vehicles".

**Verified.**

- `npm run typecheck` passes; 95 files, 1,352 tests passed (`--maxWorkers=4`); `npm run build` passes (expected chunk-size warning only).
- `tests/atc-traffic-sim.test.ts` (12): nearest airport and JFK tower frequency from the bundled catalog, LiveATC URL validation and allow-list, date line, invalid position and open ocean (no suggestion), the "likely" rules, catalog band and types, rendered panel wording (no audio element); simulation speed and density bases, unknown and shapeless roads get none, zero speed, thinning, date-line length, stable offsets.
- Built app, temporary profile, LED monitor (screenshots in `docs/screenshots/atc-radio/` and `docs/screenshots/traffic-sim/`):
  - Paris: 941 arcs in view; dots on the boulevards; frames 1.5 s apart differ (about 20,700 changed pixels); the credit line is shown.
  - New York: dots moving along the FDR Drive (about 2,700 changed pixels between frames); unknown links get none.
  - JFK: EIN109 selected; the panel showed "Listen to KJFK on LiveATC", JFK's frequencies with ground, tower and clearance marked likely, and LaGuardia and Republic.

**Not verified.** Clicking the LiveATC button (it opens the system browser; the link was only checked by the allow-list test and by loading the same URL in a browser). Whether LiveATC covers airports other than JFK. Simulation performance at the 12,000-dot cap on slower GPUs. Rush-hour behaviour.

## Group 3: city transit, cameras, nearest camera, satellite groups — 2026-11-14

**Request.** "Start group 3": more real vehicles and cameras without keys.

**Change.**

- Transit layer (`src/shared/transitFeeds.ts`, `fetchTransit`): 36 operator GTFS-Realtime feeds beside MBTA, decoded with the existing reader. The layer is now view-based: it polls only feeds whose area meets the view, below 1,500 km, and returns the vehicles in view (nearest 2,500 when there are more, stated in the status note).
  - Positions older than 10 minutes and 0,0 positions are left out. km/h feeds (Montpellier, Toulon) are converted.
  - Feeds that mix buses with trams or metro without saying which are labelled "Transit"; the type is not guessed.
  - Entur train operators are dropped here because the Trains layer shows them.
  - Left out: every God's Eye View feed whose operator states no licence for the realtime data (Kraków, Vilnius, Bucharest, Rome, Turin, Cluj, Iași, Málaga, Carris, Adelaide, Atlanta, Minneapolis, Carris Metropolitana) and Warsaw (third-party mirror).
  - Behaviour change: Boston vehicles now load only when the view is near Boston (previously always).
  - Vehicle names show below 6 km camera height (was 30 km) to keep city views readable.
- Cameras: Iceland (Vegagerðin, CC BY 4.0), Calgary and Toronto (Open Government Licences) added as keyless sources; stills pinned to each publisher's own path in `RENDERER_REMOTES`.
  - Not added: Texas, Washington, Oregon, Norway, Catalonia, Taiwan, Estonia, Japan, Italy and Delaware. Their terms are a disclaimer rather than a licence, or they need per-frame proxying or stream handling the app does not have. New South Wales stays a keyed system.
- "Nearest camera" button (`src/shared/nearest.ts`) in the details of aircraft, vessels, fires, fire perimeters, transit, trains, traffic flow and incidents: the nearest loaded camera within 50 km, with the note that it is not aimed at the record.
- Satellites: three more CelesTrak groups, off by default: telecom (`geo`), imaging (`resource`), debris (`fengyun-1c-debris`, about 2,000 objects).
- Not built: 24-hour aircraft history from adsb.lol. God's Eye View's own code marks that route retired and undocumented and refuses it; the OpenSky "path since takeoff" remains.

**Verified.**

- `npm run typecheck` passes; 96 files, 1,363 tests passed (`--maxWorkers=4`); `npm run build` passes.
- `tests/group3.test.ts` (11): every feed is allow-listed with an openable licence link; view selection; a real Kingston feed; stale, 0,0, km/h and mixed-type rules; Entur train exclusion; the three camera normalizers against real samples and hostile inputs; nearest record across the date line; settings schema.
- All 36 feed addresses answered HTTP 200 once on 2026-11-14 (several small: night-time in Europe).
- Built app, temporary profile, LED monitor (screenshots in `docs/screenshots/group3/`): Toronto 1,455 vehicles (TTC, MiWay, Durham, YRT); Helsinki 72; Rio 364; Oslo 6 (1,228 older than 10 minutes left out, about 03:30 local); cameras 336 Toronto, 218 Calgary, 499 Iceland; a selected TTC bus offered "Nearest camera: KEELE ST & WILSON AVE · 0.7 km" and the camera opened with a 320×240 image; 2,718 satellites with the three new groups.

**Not verified.** The other 30 feeds in the app (address check only). Calgary and Iceland stills opened in the app. The 6 km label change was made after the app check and is covered by typecheck only. Packaged app and installer.

## Group 4: weather history, wind colours, OSM sites, tilt, global picture, launch events — 2026-11-15

**Request.** "Start group 4".

**Change.**

- Observed-weather history (`src/shared/weatherTimeline.ts`, Layers → Weather, shown while radar, lightning or weather satellites are on): one timeline for all three, two hours back in 10-minute steps, with older/newer buttons, a slider, Play (loops the two hours at 1.5 s a frame; disabled with reduced motion) and Newest. Not saved between sessions.
  - Radar and lightning ask NOAA nowCOAST for a past time; the service answers with its nearest frame (capabilities read 2026-11-15: radar about every 4 minutes for 7 hours, lightning every 15 minutes for 4.5 hours). The credit line names the time asked for.
  - Satellites count back from the newest frame GIBS lists (10-minute frames); Meteosat uses the hourly frame for that time.
  - The previous frame stays on screen until the next one's tiles have loaded (8 s at most), so stepping does not blank the overlay.
- Wind: "Colour by speed" switch (`windColorBySpeed`, default off): six bands with a text legend; lines also thicken with speed. Applies to the still arrows used with reduced motion too.
- Two OpenStreetMap layers through the existing Overpass client (`src/shared/osmSites.ts`, `fetchOsmSites`): "Military sites" (below about 500 km, up to 800 objects) and "Plate-reader camera locations" (below about 80 km, up to 2,000). One query per fixed map block, cached for a day, 24 blocks at most. Sites are placed at the mapped point or the centre of the mapped area; outlines are not drawn. Plate-reader records hold the location and device tags only. An empty answer is worded as a gap in the map. Both drawn as batched points.
- Tilt button in the view controls (straight down or a 35° oblique around the point at the screen centre; 3D only) and a "Global picture" button in the bottom toolbar: turns on six worldwide keyless layers (military-flagged aircraft, satellites, cyclones, incidents, launches, violence in the news) and moves to a whole-globe view; switching it off restores the previous camera and turns off only the layers it added. The way back is kept in `localStorage`, so it survives a restart. Rules in `src/shared/viewModes.ts`.
- Launch event replay (`src/shared/launchTimeline.ts`, `src/main/launchTimelineLookup.ts`, `LaunchReplay.tsx`; IPC channel `launches:timeline` in all five places): on request, loads the event sequence Launch Library 2 publishes for the selected launch and runs a T± clock through it at 1× to 600×, with a scrub slider. Launch Library publishes no trajectory, so no ascent path is drawn and nothing moves on the map; God's Eye View's drawn ascent is a reconstruction with a guessed direction and was not copied.
- README: three source rows (nowCOAST past frames, Overpass map layers, Launch Library detail).

**Verified.**

- `npm run typecheck` passes; 97 files, 1,393 tests passed (`--maxWorkers=4`); `npm run build` passes (expected chunk-size warning only).
- `tests/group4.test.ts` (25) and five rejection cases in `tests/ipc-security.test.ts`. Fixtures: a real Overpass military sample (Chesapeake area, 32 objects) and two real Launch Library detail records (one with 38 events, one with none).
- Built app, temporary profile, LED monitor (screenshots in `docs/screenshots/group4/`):
  - Weather: stepping back four times showed "40 min before the newest frames" and the satellite frames moved from 07:10/07:00 UTC to 06:30/06:40 (GOES, Himawari) and 06:00 (Meteosat); Play advanced to the next frame; Newest returned. Radar, satellite and coloured wind drew together, with the legend in the panel.
  - Tilt: pitch went from -90° to -55.0° with the same point at the centre (Eiffel Tower, 4 km).
  - Global picture: camera 4,000 m → 22,000 km and six layers added; leaving restored 4,000 m at the same position and left only the layer that was on before.
  - Launch replay: a Falcon 9 record loaded its published timeline and the clock ran from T-00:01:10 with the current event marked.

**Not verified.**

- The two OpenStreetMap layers with live data. Both public Overpass servers were at capacity during the checks: the military layer showed its "busy or unreachable" error, and the plate-reader layer got one answer with no elements for central Atlanta, which may be an incomplete answer from the fallback server rather than a real "nothing mapped". The plate-reader test data is hand-built for the same reason. The military query itself returned 418 objects when run once by hand.
- Radar and lightning past frames by image comparison (the request carries the time; the frames were not compared pixel by pixel). Lightning was not switched on in the app check.
- Tilt while following a vehicle (the follow camera may override it). Global picture across a restart (covered by a unit test of the stored state only).
- Packaged app and installer.

**Remaining.** Re-check the two OpenStreetMap layers when Overpass is available. Group 4 as proposed is otherwise complete.

## Photoreal 3D loads ahead on approach; render resolution with sharpened upscaling — 2026-11-15

**Request.** "Make the photoreal 3D already prerendered" and "let the software use DLSS". Neither is possible as worded, so the nearest things that are allowed and technically reachable were built.

- Google Photorealistic 3D Tiles may not be pre-downloaded or stored (the Map Tiles API policy; already noted in the code). They can only be fetched during a viewing session.
- DLSS is an NVIDIA SDK for native Direct3D/Vulkan renderers that supply motion vectors. The app draws through Chromium's WebGL, which exposes none of that, so DLSS (and FSR 2/3, XeSS) cannot be used.

**Changed.**

- `src/renderer/map/photorealSurface.ts`: new `PRELOAD_M` (400 km) and `shouldPreloadHidden`. The surface watcher now sets `preloadWhenHidden` itself: in 3D below 400 km the hidden mesh is traversed and downloaded, so it is in memory when it is first drawn at 40 km. Before, Balanced quality started downloading only at 40 km. Maximum quality still preloads at any height. Nothing is fetched in the whole-globe view, in 2D, at night or on an archived surface.
- `src/shared/renderScale.ts` (new), setting `renderScale` (1, 0.85, 0.75, 0.67, 0.5; default 1) in `types.ts` and the settings schema in `ipc.ts`. `Globe.tsx` applies it to Cesium's `resolutionScale`; `src/renderer/map/upscaleSharpen.ts` (new) adds a contrast-adaptive sharpening pass when the scale is below 1. Settings → "Render resolution" explains that this is simple upscaling and not DLSS. Only the globe is affected; panels and text stay at full resolution.

**Verified.**

- `npm run typecheck`, `npm run build`, full suite with `--maxWorkers=4`: 98 files, 1,397 tests passed. New tests: `tests/render-scale.test.ts` (3) and one case in `tests/photoreal-surface.test.ts` (preload off at 5,000 km, on at 200 km while hidden, off in 2D, on at any height when asked).
- Running app, temporary profile, 1920×1080 window on the LED monitor: the drawing buffer went 1920×1080 → 1286×723 (0.67) → 960×540 (0.5), the setting was saved, and Cesium reported no render errors. Screenshots: `docs/screenshots/render-scale/`.

**Not verified.**

- Photoreal 3D itself. No Google key was used (metered), so the earlier loading was not observed and no loading time was measured. The change rests on the unit test and Cesium's documented `preloadWhenHidden` behaviour.
- Any frame-rate gain from the render scale. Pixel counts were measured; frame times were not.
- Packaged app and installer.

**Remaining.** With the owner's key, compare time-to-sharp on a descent before and after. Preloading downloads more tiles per session; Google's per-tile and per-session charging should be confirmed against the current price list before treating it as cost-neutral.

### Live photoreal check attempted — 2026-11-15

The owner approved a check with their Google key. It did not run: no mesh was requested, so nothing was billed.

- Method prepared: two temporary profiles, each with a copy of the database and `Local State`, view settings reset in the copies (the stored surface was the metered `google2d`; it was switched to `atlas` before launch), then a cold arrival at 30 km compared with an arrival after dwelling at 200, 80 and 42 km.
- Result: in the unpackaged build `providers:browserKey` answered "Your saved credential could not be decrypted" with the `Local State` from `%APPDATA%\Atlas Watch` and with the one from `%APPDATA%\Electron`. The key was never read or printed. The database copies and temporary profiles were deleted afterwards.
- Added for the measurement and kept: `getDiagnostics().photoreal` in `Globe.tsx` (`shown`, `preloading`, `complete`, tiles `loaded` and `failed` this session). Typecheck, build and the full suite (98 files, 1,397 tests) pass.

**Still not verified:** the earlier loading with real Photoreal 3D tiles. It needs a key the test window can read, for example one the owner enters in Providers in a temporary-profile window.

## Internet cable layer, finer layer categories, earthquakes off by default, frosted wide pages — 2026-11-15

**Changed.**

- **Cables.** New layer `cables` ("Internet and telecom cables (OpenStreetMap)", group Infrastructure). `scripts/build-cables.mjs` turns one Overpass API reply into `src/main/data/cables.json` (1.9 MB): 5,863 mapped ways, 1,460 under water and 4,403 under ground, OpenStreetMap data as of 2026-11-15T15:02:06Z; 15 ways with fewer than two usable points were dropped. `src/shared/cables.ts` validates every row on read. `layerRender.ts` draws them as one batched ground primitive (blue, wider = under water; orange, thinner = under ground) and the selected cable as a second small primitive. Details show the kind, operator, medium and the calculated length of the mapped piece. No network at run time.
  - Source choice: the TeleGeography submarine cable map stays excluded (CC BY-NC-SA, non-commercial). OpenStreetMap is ODbL 1.0. Its coverage is a small part of the world's cables: most ocean systems are mapped only near the coast or not at all, and buried land cables only in a few countries. The layer note, the status line and the record details say so.
- **Layer categories.** `LAYER_GROUPS` in `shared/layers.ts` replaces the six groups with nine: Air traffic, Sea and ground traffic, Space, Weather, Hazards, Cameras, Infrastructure, Military and surveillance, Nature. The Layers panel reads the list from there.
- **Earthquakes.** The earthquake markers on the globe now start switched off (`App.tsx`). Earthquake monitoring, notifications, history and the Data overview are unchanged; the switch is still under Alerts & earthquakes.
- **Frosted wide pages.** `.wide-page` (Markets, Community and the other wide pages) is now a blurred translucent pane over the globe instead of a solid sheet; inner cards are tinted with a glass edge, with a small lift on hover. Solid again under `prefers-reduced-transparency`; no movement with reduced motion.
- README sources row and the exclusion note; `src/main/data/INFRASTRUCTURE_ATTRIBUTION.txt`.

**Verified.**

- `npm run typecheck`, `npm run build`, full suite with `--maxWorkers=4`: 99 files, 1,401 tests passed (before the final two-line CSS opacity change; build re-run after it). New `tests/cables.test.ts` (4): shipped rows all parse, malformed rows are skipped, a piece across the date line measures 22 km, layer wiring without network, every layer sits in a listed group.
- Running app, temporary profile, LED monitor: Earthquakes switch off at start; the nine categories listed; cables layer loaded 5,863 records with no render errors; a named cable (Atlantic Crossing 1) selected and highlighted; Community page computed `backdrop-filter: blur(30px) saturate(1.6) brightness(0.72)` over the globe. Screenshots: `docs/screenshots/cables/`, `docs/screenshots/glass-pages/`.

**Not verified.**

- The Markets page was not opened: it would spend the included market-data allowance. It uses the same `.wide-page` rules, but its look was not seen. The other wide pages were not opened either.
- Underground (orange) lines were not looked at up close; 2D mode; frame rate with the layer on; packaged app and installer.

**Remaining.** `cables.json` is a snapshot: re-run the generator to refresh it. If the owner obtains a commercial licence for a fuller cable dataset, it can replace the file behind the same layer.

## Layer categories start collapsed; wide pages float as rounded panels — 2026-11-15

**Changed.**

- `LayersPanel.tsx`: all nine categories and the "Alerts & earthquakes" section start collapsed. Searching still shows matching layers inside collapsed categories. New optional prop `groupsOpen` starts them expanded; `tests/nifc-layer-status.test.ts` and `tests/dwd-renderer.test.ts` now pass it, because they render the panel without clicks and check the rows inside the categories. Their assertions are unchanged.
- `styles.css`: wide pages (Markets, Community and the rest) are a floating glass sheet, at most 1,240 px wide, centred in the area right of the navigation rail, with 24 px rounded corners, a drop shadow and the globe visible around them. It opens with a short rise-and-fade, which is turned off under reduced motion. Below 900 px window width it fills the space with 12 px margins.

**Verified.** Typecheck, build, full suite with `--maxWorkers=4`: 99 files, 1,402 tests passed (new test: categories collapsed by default, expanded with `groupsOpen`). Running app, temporary profile, 1920×1080: all nine categories reported `aria-expanded="false"` and Alerts was closed; the Community page measured 1,240 px wide with 24 px corners, 106 px from the top and 24 px from the bottom (`docs/screenshots/glass-pages/community-floating.png`).

**Not verified.** Markets and the other wide pages were not opened (Markets would use the included market-data allowance). Narrow-window layout and packaged app.


## Group 5: camera cards, traffic look, landslides, rivers, new provider keys, voice commands, worldwide radio — 2026-11-16

**Request.** Street cameras shown like the reference screenshots; add the APIs from the reference provider screen (TomTom, OpenAI, Cesium ion, Launch Library; Google 3D stays); real-time traffic that looks like the screenshots; landslide events and river visualization; ATC listening without an external website; police and other radio worldwide. The user chose to include scanner and ATC relays and all four new keys.

**What is possible.**

- LiveATC's and Broadcastify's terms forbid playing their streams in another app, so the LiveATC button stays a browser link. In-app audio uses the open Radio Browser directory. Checked 2026-11-16: it lists no station tagged exactly `atc` and only a handful of scanner feeds (SomaFM SF Police Scanner, Perth Fire and Rescue, Kamloops Fire Rescue and a few others), so in-app ATC search usually finds nothing and the app says so.
- No open, live, located feed of reported landslides was reachable: NASA EONET's landslide category has no events in two years, NASA's COOLR ArcGIS services answered 404 on gis.earthdata.nasa.gov, maps.nccs.nasa.gov and maps.disasters.nasa.gov, and the ReliefWeb API answered 403 without a registered app name (its RSS has no coordinates). The layer therefore uses USGS Ground Failure model estimates after earthquakes, labelled as estimates.
- No public source publishes individual private cars, so the per-vehicle tags in the reference stay simulated and say so (`SIM-`, never `VEH-`). TomTom adds real congestion colours on roads with the customer's key.

**Changed.**

- Camera cards (`src/shared/cameraCards.ts`, `src/renderer/components/CameraCards.tsx`): with the Cameras layer on and the camera below 25 km, up to 5 cameras nearest the screen centre that publish a still float as cards above their position (title, latest still reloaded at the publisher's interval, `CAM-` tag, publisher, load time) with two leader lines and a dot at the camera; other cameras in view get a clickable `CAM-` tag (up to 60). Cards never overlap and stay on screen. Hidden during playback.
- Traffic look (`src/shared/trafficSim.ts`, `src/renderer/map/trafficSim.ts`): simulated dots are 6 px and coloured by the road's published state (Okabe–Ito: free blue, slow yellow, heavy orange, stopped vermilion); below 4 km the dots nearest the centre carry `SIM-####` tags, spaced so they do not overlap. Credit: "Moving dots and SIM tags on traffic roads: simulated, not real vehicles".
- Landslides (`src/shared/landslides.ts`, layer `landslides`, Hazards, temporal "calculated"): USGS earthquakes of the last 30 days with a ground-failure product, newest 25; each event's detail is fetched once and again only when USGS updates it. Shows the alert level in words, modelled area and population, the modelled extent and the estimate's update time; marker at the epicentre with a note that it is not an observation.
- Rivers (`src/renderer/map/vectorTiles.ts` style `rivers`, setting `riversEnabled`, switch "Rivers and canals" under Nature): OpenStreetMap waterways from OpenFreeMap as a glowing cyan line; streams appear at zoom 13 and closer.
- Providers (`src/shared/providers.ts`, `src/main/providerService.ts`, `src/shared/remoteHosts.ts`, `src/main/feeds/http.ts`, `src/main/main.ts`):
  - TomTom (browser key, metered): "Live congestion (TomTom, your key)" under Sea and ground traffic, setting `tomtomTraffic`; raster flow tiles `relative0`, reloaded every 2 minutes. The tile prefix enters the CSP only when a key is saved.
  - Launch Library 2 token (secret): sent as `Authorization: Token …` by the launches layer and launch replay.
  - Cesium ion (browser key, restricted): new surface `ionBing` ("Bing Maps aerial via Cesium ion") and Settings → "Use Cesium World Terrain instead" (`ionTerrain`); falls back to the keyless terrain if ion refuses. Google Photoreal 3D is unchanged. The ion and Bing hosts enter the CSP only with a token. No default ion token is ever set (`lib/cesiumBase.ts` comment updated).
  - OpenAI (secret, metered): voice commands. IPC `voice:transcribe` in all five places (at most 1 MB of audio, three audio types). `src/main/voice.ts` sends one multipart request to `/v1/audio/transcriptions` (`whisper-1`); errors never contain the key. `src/shared/voiceCommands.ts` maps the transcript locally to: layer on/off, go to a place (bundled place catalog), switch surface; anything else is "not a command". `VoiceControl.tsx`: hold-to-talk button (Enter or Space toggles), 15 s cap, shown only when a key is saved. `security.ts` now grants the microphone (audio only, app page only); camera and screen stay denied.
  - Connection tests: TomTom (one tile), Launch Library (`api-throttle`), OpenAI (`/v1/models`, free), Cesium (`/v1/me`). The main allow-list has exact prefixes for these only.
- Radio (`src/shared/radio.ts`, `src/main/radio.ts`, `src/renderer/components/RadioPage.tsx`, `src/renderer/lib/radioPlayer.ts`, new page "Radio" under Monitor, IPC `radio:search` in all five places):
  - Search by name, kind (All, News & talk, Music, Scanners, Air traffic), country code, or near the map centre (250 km). HLS, video and malformed rows are dropped; scanner and ATC rows are labelled as third-party relays with a local-law warning.
  - Relay at `app://atlas/radio-stream/<station id>`: only ids returned by a search (600 kept); DNS checked at every lookup against private, loopback, link-local, CGNAT, ULA and multicast ranges; at most 3 redirects with the same check; audio types only (playlists and video refused); 4-hour cap; aborted when playback stops. Counts a click with Radio Browser, as its etiquette asks. CSP `media-src` names the relay path.
  - One app-wide player: playback continues off the Radio page with a now-playing bar (volume, stop).
  - Aircraft details → ATC panel: "Find ATC streams near <ICAO> in the app" opens Radio with an ATC search near the aircraft.
- Tests: `tests/group5.test.ts` (15) with real USGS fixtures `tests/fixtures/usgs-ground-failure-list.json` and `usgs-ground-failure-us7000tymu.json`; IPC rejection cases for both new channels and the new provider ids in `tests/ipc-security.test.ts`. `tests/layers.test.ts` used `'openai'` as its example of an unknown provider id; it is now a real one, so the example is `'not-a-provider'` (same assertion).
- README sources rows (TomTom, Cesium ion, OpenAI, Launch Library, USGS Ground Failure, Radio Browser, OpenFreeMap waterways); CLAUDE.md lines on Cesium ion and the main-process direct network paths corrected.

**Verified.**

- `npm run typecheck`; `npm run build`; full suite with `--maxWorkers=4`: 100 files, 1,428 tests passed.
- Running app, temporary profile, LED monitor (screenshots in `docs/screenshots/group5/`):
  - Los Angeles, 9 km, oblique: 9,867 camera records; 5 cards and 33 tags; all 5 card stills loaded (three showed Caltrans's own "Temporarily Unavailable" image).
  - New York (Clearview Expressway): 110 published roads; dots and spaced `SIM-` tags; no render errors.
  - Paris, 45 km: Seine and Marne drawn as cyan lines; 303 vector tiles loaded, 0 failed.
  - Landslides: 24 live USGS estimates, newest M6.6 Indonesia (green, 0 km², 0 people), no errors.
  - Radio: 57 stations listed; the first played through the relay ("playing" on the now-playing bar, which stayed after leaving the page); near London listed stations by distance (0.9 km first); Scanners near London: none, with the "only a few" note. The first run found a bug (the view object carried `bbox`, which the strict schema rejected); fixed and re-checked.
  - Providers lists TomTom, Launch Library 2, OpenAI and Cesium ion (none configured).

**Not verified.**

- TomTom, OpenAI, Cesium ion (Bing surface and World Terrain) and the Launch Library token with real keys: no keys were used and no paid request was sent. The microphone permission and the voice button were not exercised (the button appears only with a key).
- Whether OpenAI still offers `whisper-1` was not checked live.
- Worldwide (not nearby) scanner and ATC searches; stations that use playlists; long playback; packaged app and installer.

**Remaining.** A located, live landslide-report feed if NASA's COOLR service returns or a ReliefWeb app name is registered (needs the owner). Test each new key with the owner present.


## Camera cards closer in, next frame, picture zoom; reorganized details panel — 2026-11-17

**Request.** Camera cards appeared too far out and got in the way; add a next-frame button with a 3-second cooldown; zoom while hovering a camera; make the right panel better organized with bold key information and icons.

**Changed.**

- `src/shared/cameraCards.ts`, `src/renderer/components/CameraCards.tsx`:
  - Cards only below 4 km (was 25 km), at most 3 (was 5), slightly smaller; tags only below 12 km, at most 30 (was 60).
  - Cards and tags avoid the floating panels (Layers, details, toolbars, voice, radio bar, HUD); a camera under a panel gets neither.
  - Bug fixed: the far-side test compared the camera's distance from the Earth's centre with the equatorial radius, which fails at street height in mid-latitudes, so cameras on the other side of the Earth were projected onto the view (Hong Kong cameras appeared off Brooklyn). Now Cesium's `EllipsoidalOccluder` horizon test plus a distance cap (6 × camera height, at least 5 km).
  - Each card has a next-frame button (reloads the publisher's still; disabled for 3 s after each press, with a one-turn spin) and an open-details button. The mouse wheel over the picture zooms it 1×–4× around the cursor (shown as "2.0×"); leaving the card resets it.
- `src/renderer/components/RecordDetails.tsx` and styles (all layers except the flight card, which keeps its own layout):
  - Header with the category's icon in a tinted badge, layer name, bold title and tags.
  - For cameras the picture comes right after the header.
  - Key facts as tiles with icons and bold values: time with "how long ago" bold, position, altitude (ft bold, m), speed (kt bold, km/h), heading (degrees bold, compass point). Fetch time stays in the details list.
  - A record's own note (`mappedNote`) shows under the facts with an info icon; the layer's explanation folds into "About this data · <kind>".
  - Remaining fields under "Details" (values in medium weight); Source as an icon list (provider bold, link, id, terms, coverage). Focus button has an icon.
- `src/renderer/App.tsx`: any selected record now comes first in the Data panel with "← Overview" above it (before, only flights, DWD warnings and fire perimeters did; other records appeared below the whole overview).
- `tests/group5.test.ts`: the placement test now expects a camera under a panel to get no tag (the new rule) and covers a panel that blocks only the card positions; constants for the thresholds and cooldown are checked.

**Verified.** Typecheck, build, full suite (`--maxWorkers=4`): 100 files, 1,428 tests passed. Running app, temporary profile, LED monitor, New York harbour (`docs/screenshots/group5/camera-cards-close-and-details.png`): at 9 km 0 cards and 30 tags; at 2.5 km 3 cards; the next-frame button changed the image URL, was disabled during the cooldown and enabled after 3.3 s; three wheel steps zoomed a picture to 2.0×; after the occluder fix no Hong Kong cards appeared; selecting "3 AVE @ 60 ST" showed the camera first in the panel with icon header, picture, facts and details.

**Not verified.** Other record kinds in the new layout were checked only by the existing panel tests, not by eye; narrow windows; packaged app.

## Clearer Google Map Tiles failure messages — 2026-11-17

**Why.** The owner saw "Google Photoreal 3D unavailable: Google did not respond" after entering a new key. That text was shown for every failure whose error carried no HTTP status 400/401/403/429, so it could not tell a refused key from a blocked or failed connection.

**Changed.** `src/shared/googleErrors.ts` (moved from `Globe.tsx`): reads the status from Cesium request errors (`statusCode`) or the message; distinct wording for refused key (400/401/403, including the website-restriction and new-key delay hints), not found (404), quota (429), server error (5xx) and no answer (offline, firewall, proxy or antivirus blocking `tile.googleapis.com`). Diagnostics now records "Google 3D Tiles: HTTP <code>" or "no HTTP answer" before the redacted message. `tests/google-errors.test.ts` (2).

**Verified.** Typecheck, build, full suite: 101 files, 1,430 tests passed. From this computer `tile.googleapis.com/v1/3dtiles/root.json` answered HTTP 403 in 0.26 s without a key (no billing), so the server is reachable outside the app.

**Not verified.** The owner's key and the cause of their failure: no key was read or used. The running app instance predates this build.

- 2026-11-17, same day: the owner's Google provider test answered HTTP 404. Public reports of this exact 404 on `root.json` trace it to the Map Tiles API not being enabled, or billing not active, in the key's project. `providerService.ts` now says that for a Google 404 instead of the bare status; `tests/google-provider-test.test.ts` (1) checks the wording and that the key is not shown. Full suite: 102 files, 1,431 tests passed; build passes.

## Cesium ion checked with the owner's token; map credit fixed — 2026-11-17

**Done.** The owner supplied a Cesium ion token in chat (default token: scopes `assets:read`, `geocode`). Checked against ion: `/v1/me`, World Terrain (asset 1) and Bing aerial (asset 2, Bing via `dev.virtualearth.net`) all answered 200. In a throwaway profile the token was saved through the app, Providers → Test answered "Token accepted by Cesium ion", and the Bing surface with "Use Cesium World Terrain instead" loaded over the Alps: after 45 s, 61 Bing tiles (zoom 1–13, all HTTP 200) and World Terrain tiles to level 13, 0 imagery errors. Zermatt at 1.5 km shows individual roofs on Bing versus 10 m pixels on the free surface (`docs/screenshots/cesium-ion/`). The throwaway profile and every copy of the token were deleted afterwards.

**Fixed.** The map credit line said "Surface: neutral" and "Terrain: Mapzen" while Bing and World Terrain were in use. `App.tsx` now credits "Bing Maps aerial (© Microsoft and its suppliers) via Cesium ion" and "Cesium World Terrain (© Cesium)" when they are on (checked in the app). Also corrected a garbled sentence in CLAUDE.md mistake 8. Suite: 102 files, 1,431 tests passed; build passes.

**Not verified.** The owner's own profile (the token must be entered there in Providers); usage against the ion Community plan limits.

## Camera cards only at street distance, pinned above their camera — 2026-11-17

**Request.** Previews appeared too far away (a 3 km oblique view over Lower Manhattan showed several cards); show them only much closer and keep each fixed to its street.

**Changed** (`src/shared/cameraCards.ts`, `src/renderer/components/CameraCards.tsx`): eligibility is the straight-line distance from the viewer to the camera, not camera altitude (an oblique view at a few km altitude still showed cards). A card needs ≤ 900 m; tags ≤ 4 km; beyond that nothing. Each card sits centred directly above its camera's point on the street (ground height read once per camera and kept), joined by one vertical pin, and never moves to another side: if it does not fit (screen edge, another card, a panel) that camera stays a tag. Cameras that already have a card keep it while they still qualify, so cards do not swap as you move. The overlay now updates every rendered frame (was every 120 ms), so cards stay on their street while the map moves. Tests updated for the new inputs and one added (distance cut-offs, centred pin, keeping the shown card, no side-switching).

**Verified.** Typecheck, build, full suite: 102 files, 1,432 tests passed. Running app, temporary profile, Lower Manhattan: at 3 km and −50°, 0 cards and 13 tags; at 450 m, one card above Bowery @ Cooper Sq; after a ~10 m pan the same card moved with its camera (left 1036→1016 px, top 230→239 px) (`docs/screenshots/group5/camera-card-pinned-street.png`).

**Not verified.** Frame rate with many cameras in a dense close view; packaged app.

## README: install guide and feature tour with screenshots — 2026-11-17

**Changed.** `README.md` now opens with a step-by-step Windows install (Node.js and Git, clone, `npm ci`, build and start, optional installer, updating, troubleshooting), a feature tour with twelve screenshots, and an optional-keys table. The earlier introduction follows as "Feature notes"; the detailed reference sections are unchanged. The PowerShell example no longer shows a personal folder path. Screenshots for the README are 1280-px JPEG copies (85–231 KB each) in `docs/screenshots/readme/`, made from the full-size captures listed in this record.

**Not verified.** The install steps on a clean PC.

## Renamed to Sky_View — 2026-11-17

**Changed.** The visible brand is now **Sky_View** (was Atlas Watch): window and page title, every on-screen text (61 places in 22 source files), briefings, scene files (`sky-view-scene-<date>.json`), README, `package.json` `productName` and `author`, and `electron-builder.yml` `productName`, copyright, shortcut and installer name (`Sky_View-Setup-<version>.exe`). The User-Agent and Fintraffic client headers now say `SkyView/…`.

**Kept on purpose.** `appId: app.atlaswatch.desktop` (a new installer upgrades the old install instead of installing beside it), the npm name `atlas-watch`, `ATLAS_WATCH_*` variables, `app://atlas`, internal names (`AtlasStore`, `window.atlas`), the "Atlas" imagery surface name, and the data folder: `main.ts` now sets `userData` to `%APPDATA%\Atlas Watch` explicitly, because Electron would otherwise derive `%APPDATA%\Sky_View` from the new product name and existing places, settings, encrypted keys and history would not load. `start.bat` still launches the older packaged builds named `Atlas Watch.exe`; builds made from now on are `Sky_View.exe`. CLAUDE.md and AGENTS.md updated.

**Verified.** Typecheck, build, full suite: 103 files, 1,433 tests (new `tests/brand-data-folder.test.ts` guards the data folder, appId and names). Test window: title "Sky_View", no "Atlas Watch" text on screen.

**Not verified.** First launch against the real profile after the rename (the owner's data was not touched), a packaged build and an installer upgrade from an Atlas Watch install.
