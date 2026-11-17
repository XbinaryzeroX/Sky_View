// Must be imported before 'cesium' so the library finds its bundled
// Workers/Assets. All Cesium assets ship with the app. Cesium ion is contacted
// only for the optional Bing aerial surface and World Terrain, with the
// customer's own token passed per request (never a default token).
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/';
export {};
