# Atlas Watch v0.3.0 — handoff (2026-11-09)

## 1. Map defects: root causes and fixes

| Defect | Root cause | Fix |
|---|---|---|
| White sheets (Mexico, ocean) | USGS returns opaque white no-data tiles outside U.S. coverage: ~96%-white PNGs and ~2.4 KB uniform-white JPEGs | `UsgsImageryProvider` makes no-data pixels transparent (PNGs always; JPEGs only when < 4 KB and > 99.5% white) |
| Black wedges / triangles (Baja, Gulf of California) | Transparent parts of those PNGs showed the old near-black Blue Marble NG ocean | Global base switched to NASA Blue Marble Shaded Relief + Bathymetry (its ocean matches USGS) |
| Rectangular cutoffs | Edge of the U.S. imagery rectangle where bright USGS ocean met the dark base | Same base change; USGS only from zoom 9 |
| Upside-down / mirrored labels | Chromium ignores WebGL `UNPACK_FLIP_Y` for `ImageBitmap` | All custom providers create bitmaps with `imageOrientation: 'flipY'` |
| Black stripe at 180° (Fiji) | NASA GIBS source defect: easternmost tile column ends in a 2–9 px near-black band | `GibsBaseProvider` detects the band (column means vs. inward reference) and fills each row from its last valid pixel; only tiles with x = 2^z − 1 |

Screenshots: `docs/screenshots/v0.3/` (`before-*`, `after-*`, `f*` worldwide, `e*` tracking/analyst, `city-*`).

## 2. Worldwide coverage (keyless)

Imagery is NASA Blue Marble everywhere (~500 m/px), with USGS ~2.4 m/px in the U.S. Streets, place names
and boundaries come from OpenFreeMap (OSM) worldwide. Buildings are OSM extrusions wherever they are mapped.
Terrain comes from Terrain Tiles on AWS. Worldwide high-resolution imagery needs the customer's key: Esri,
Mapbox, EOX or Google 3D. See the README section "Worldwide coverage".

These places were checked live with zero tile errors: New York, London, Dubai, Tokyo, Singapore, Sydney,
Cape Town, São Paulo, Anchorage, the open Pacific, the antimeridian, Baja and the Gulf, and the global view.

## 3. Tracking

- **Aircraft (adsb.lol, ODbL), live-verified.** New York showed 345 aircraft. Also verified: altitude
  colors and filters, special squawks 7500/7600/7700 (labeled "reported"), the watchlist, follow, trails,
  overhead (71 above Manhattan), airports (5,282 from OurAirports), and lookup by hex, callsign or
  registration. Dead reckoning is limited to 45 s. Aircraft are marked stale after 60 s and removed after
  300 s. No past tracks are fabricated.
- **Vessels (Digitraffic, CC BY 4.0), live-verified.** The ship SIRIUS showed its IMO number, reported
  destination, reported ETA and dimensions. AIS no-data values (SOG 102.3, COG 360, heading 511) are
  handled correctly.
- **AISStream (worldwide AIS) is implemented in the main process only and not verified.** It needs the
  customer's key.

## 4. Features from the reference screenshot

See `docs/FEATURE_MATRIX.md` → "Screenshot inventory". Markets, social/chat, ATC audio and voice are not
included, and each shows an in-app explanation. They need licensed or paid feeds or a backend. Detection
boxes were left out on purpose, because boxes without real computer vision would be misleading.

## 5. Costs and blockers

- **Running cost: none by default.** Every keyless source is free. Metered providers (Esri, Mapbox,
  Google 3D) are used only with the customer's own key, and never fall back to the developer's key.
- **Code signing.** Windows Smart App Control can block unsigned builds. Fixing this needs an
  Authenticode certificate, which costs money; none was bought.
- **Not live-verified (needs customer credentials):** AISStream, Esri, Mapbox, EOX and Google 3D.

## 6. Verification

- `npm test`: 134 passed across 9 files. Type-check is clean.
- `npm run dist`: built `release/Atlas-Watch-Setup-0.3.0.exe` (≈127 MB). The packaged app launched.
  The asar contains only `dist/`, with no sources or secrets; the only key-pattern matches are input
  placeholders.

## 7. Known limitations

- Place labels are drawn per vector tile, so a few labels repeat or overlap where tiles meet
  (for example "Chihuahua" at 1,500 km).
- A slight brightness step remains at 180° because the source imagery on the two sides differs.
- Building heights come from OSM tags or OpenMapTiles estimates. They are not survey data.

## 8. Launch

```bash
cd C:\Users\infob\Documents\Claude\Sky_View
npm.cmd run dev
```

Close any older dev session first; port 5173 must be free. To install the app, run
`release\Atlas-Watch-Setup-0.3.0.exe`.
