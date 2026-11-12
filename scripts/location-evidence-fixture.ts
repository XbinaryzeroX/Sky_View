// Explicit synthetic setup for isolated desktop acceptance. Never a production provider.
import { readFileSync } from "node:fs";
import { AtlasStore } from "../src/main/store";
import { AppCore } from "../src/main/core";
import { normalizeNwsAlerts, normalizeUsgsFeed } from "../src/shared/normalize";
async function main() {
  const [database, configPath] = process.argv.slice(2);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const store = new AtlasStore(database);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  store.saveSettings({
    ...store.getSettings(),
    basemap: "neutral",
    terrainEnabled: false,
    labelsOverlay: false,
    buildings3d: false,
    layersEnabled: [],
    zoneLookupEnabled: false,
    nwsPollSeconds: 3600,
    usgsPollSeconds: 3600,
    quakeWindow: "day",
    quakeMinMagnitude: -1
  });
  const fullZones = ["forecast/CAZ006", "county/CAC001", "fire/CAZ006"];
  const primary = store.createLocation(
    { name: config.primaryName, category: config.kind === "missing" ? "Isolated QA setup" : "Explicit synthetic QA setup", notes: config.kind === "missing" ? "Manual saved place; no provider observations" : "No real observations in this profile", lat: config.kind === "missing" ? 38.9 : 37.5, lon: config.kind === "missing" ? -77.03 : -122, radiusKm: 25 },
    now,
    config.kind === "missing" ? { status: "disabled", zones: [], checkedAt: null, error: null } : { status: "resolved", zones: ["mixed", "expired-cache"].includes(config.kind) ? ["forecast/CAZ006"] : fullZones, checkedAt: now, error: null }
  );
  store.createLocation(
    { name: config.secondaryName, category: "Explicit synthetic QA setup", notes: "Independent zero/unknown control", lat: 38.9, lon: -77.03, radiusKm: 25 },
    now,
    { status: "outside_coverage", zones: [], checkedAt: now, error: null }
  );
  if (["mixed", "expired-cache"].includes(config.kind)) {
    const at = new Date(Date.now() - 4 * 36e5);
    const core = new AppCore({
      store,
      now: () => at,
      alertSource: { name: "Explicit earlier-clock synthetic cache seed", fetchActiveAlerts: async () => normalizeNwsAlerts(config.seed.nws), fetchPointZones: async () => ({ status: "disabled", zones: [], checkedAt: null, error: null }) },
      quakeSource: { name: "Explicit earlier-clock synthetic cache seed", fetchRecent: async () => ({ ...normalizeUsgsFeed(config.seed.usgs), feedKey: "all_day" }) }
    });
    core.init();
    await core.refresh("nws");
    await core.refresh("usgs");
    core.stop();
  }
  console.log(JSON.stringify({ primaryId: primary.id, locations: store.listLocations().length }));
  store.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
