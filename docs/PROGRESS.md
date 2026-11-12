# Atlas Watch audit and upgrade progress

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
