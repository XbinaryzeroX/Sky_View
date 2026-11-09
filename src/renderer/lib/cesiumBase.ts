// Must be imported before 'cesium' so the library finds its bundled
// Workers/Assets. All Cesium assets ship with the app; nothing is loaded
// from Cesium ion or any remote server.
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/';
export {};
