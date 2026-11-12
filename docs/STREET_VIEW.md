# External Street View handoff

Atlas Watch's street-level action opens Google Maps in the default browser only after a user clicks. It sends the current map center as latitude/longitude, rounded to at most six decimal places. It does not embed, download, cache, analyze or capture Google imagery. It is a partial street-level workflow, not an Atlas Watch panorama layer or a live camera source.

The action picks the current screen center on the globe at click time; the HUD camera latitude/longitude can differ when tilted. It refuses a missing intersection or a morph in progress instead of substituting the camera subpoint. Coordinates must be finite WGS84 values (latitude -90 through 90, longitude -180 through 180). Both antimeridian endpoints remain valid. No new destination grant, provider, IPC or credential is needed: the existing external-link validation already permits Google Maps.

## Source, cost and coverage evidence

Reviewed 2026-11-11. Google's [Maps URLs documentation](https://developers.google.com/maps/documentation/urls/get-started) supports `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT%2CLON` without an API key. Google selects the closest photographed panorama, which may change as imagery is updated. Coverage is limited to available Google panoramas and contributions. Atlas Watch does not check availability or capture dates, and sending a browser-open request does not establish that imagery was displayed. This link workflow makes no Maps Platform API request from Atlas Watch and requires no customer API account or billing activation.

An optional embedded implementation would be separate work. Google's [Maps Embed API](https://developers.google.com/maps/documentation/embed/embedding-map) supports interactive Street View, and its [usage and billing page](https://developers.google.com/maps/documentation/embed/usage-and-billing) currently states no usage charge but requires an API key. Key/origin restrictions, Electron compatibility and CSP would need review. The [Street View Static API](https://developers.google.com/maps/documentation/streetview/usage-and-billing) requires billing and charges for image requests. No embedded or static API integration is included.

## Imagery rights and attribution

Google's [permissions and attribution guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/) permit text/button links and describe approved embeds. They prohibit Street View screenshots, removing imagery from embedded sources, separate downloads and obscured attribution. This external workflow leaves the imagery and attribution in Google's viewer. It grants no separate reuse license to Atlas Watch. The [Google Maps additional terms](https://www.google.com/help/terms_maps/) continue to apply to use of Google's viewer; do not infer embedding, extraction or redistribution rights from the ability to construct a URL.

## Verification and limits

Separate fixtures cover Tokyo, southern/western hemispheres, high latitude, poles and both antimeridian endpoints. Twenty-seven tests verify finite bounds, rounding, encoded coordinate-only parameters, the existing external allowlist and rejection of lookalike/credentialed destinations. The actual built desktop's adapted integration picked latitude 51.5256808708 while the tilted camera subpoint was 51.5, refused a view past the globe, worked in 2D and handed the correctly rounded URL through validated IPC to a temporary shell adapter. See [the integration log](geojson-adapter-audit.log). The OS browser was not opened; native browser handoff and real panorama availability remain unverified. No Google panorama screenshot is stored as audit evidence. Optional embedded providers remain unverified.
