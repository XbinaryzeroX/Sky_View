// Live buses, trams and ferries from operator GTFS-Realtime vehicle-position feeds (Boston's MBTA keeps its own
// JSON API in fetchers.ts). Fixed feed list and a normalizer only; no network here.
// Each feed is keyless and its operator publishes terms that allow display with credit. Feeds whose operator states
// no licence for the realtime data are left out. Feed addresses and licence links were taken from God's Eye View's
// registry (MIT) on 2026-11-14 and each address answered that day.
import type { GtfsFeed } from './gtfsRealtime';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';

export interface TransitFeed {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  radiusKm: number;
  url: string;
  headers?: Record<string, string>;
  /** 'Transit' where one feed mixes buses with trams or metro and does not say which a vehicle is. */
  mode: 'Bus' | 'Ferry' | 'Transit';
  /** Feed publishes km/h where GTFS-Realtime says metres per second. */
  speedUnit?: 'km/h';
  /** Routes already shown by the Trains layer. */
  excludeRoute?: RegExp;
  license: string;
  licenseUrl: string;
  attribution: string;
}

export const MBTA_AREA = { lat: 42.3601, lon: -71.0589, radiusKm: 70 };

export const TRANSIT_FEEDS: TransitFeed[] = [
  { id: "capmetro-austin", name: "CapMetro", region: "Austin, TX", lat: 30.2672, lon: -97.7431, radiusKm: 60, url: "https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream", mode: 'Transit', license: "CapMetro Developer Tools license", licenseUrl: "https://www.capmetro.org/developertools", attribution: "Capital Metropolitan Transportation Authority — data.texas.gov" },
  { id: "hsl-helsinki", name: "HSL", region: "Helsinki, Finland", lat: 60.1699, lon: 24.9384, radiusKm: 70, url: "https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl", mode: 'Transit', license: "CC BY 4.0", licenseUrl: "https://www.hsl.fi/en/hsl/open-data", attribution: "HSL (Helsinki Region Transport)" },
  { id: "ovapi-nl", name: "OVapi", region: "Netherlands", lat: 52.2, lon: 5.3, radiusKm: 220, url: "https://gtfs.ovapi.nl/nl/vehiclePositions.pb", mode: 'Transit', license: "Free to use per the OVapi README (best effort, no SLA)", licenseUrl: "https://gtfs.ovapi.nl/README", attribution: "OVapi / Stichting OpenGeo — Dutch integrated real-time transit data" },
  { id: "entur-norway", name: "Entur", region: "Norway", lat: 64, lon: 11.5, radiusKm: 720, url: "https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions", mode: 'Transit', license: "Norwegian Licence for Open Government Data (NLOD)", licenseUrl: "https://developer.entur.org/pages-intro-authentication", attribution: "Entur — data under NLOD", headers: { 'ET-Client-Name': 'atlaswatch-transit' }, excludeRoute: /^(VYG|GOA|FLT|SJN|GJB):/ },
  { id: "translink-seq", name: "TransLink", region: "South East Queensland, Australia", lat: -27.4698, lon: 153.0251, radiusKm: 150, url: "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions/Bus", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://translink.com.au/about-translink/open-data", attribution: "TransLink — Queensland Government (CC BY 4.0)" },
  { id: "ttc-toronto", name: "TTC", region: "Toronto, ON", lat: 43.6532, lon: -79.3832, radiusKm: 45, url: "https://bustime.ttc.ca/gtfsrt/vehicles", mode: 'Transit', license: "Open Government Licence \\– Toronto", licenseUrl: "https://open.toronto.ca/open-data-licence/", attribution: "Toronto Transit Commission \\— City of Toronto Open Data (Open Government Licence \\– Toronto)" },
  { id: "miway-mississauga", name: "MiWay", region: "Mississauga, ON", lat: 43.589, lon: -79.6441, radiusKm: 30, url: "https://www.miapp.ca/GTFS_RT/Vehicle/VehiclePositions.pb", mode: 'Bus', license: "City of Mississauga Open Data Terms of Use", licenseUrl: "https://www5.mississauga.ca/research_catalogue/CityofMississauga_TermsofUse.pdf", attribution: "MiWay \\— City of Mississauga Open Data" },
  { id: "hsr-hamilton", name: "Hamilton HSR", region: "Hamilton, ON", lat: 43.2557, lon: -79.8711, radiusKm: 30, url: "https://opendata.hamilton.ca/GTFS-RT/GTFS_VehiclePositions.pb", mode: 'Bus', license: "City of Hamilton Open Data Licence", licenseUrl: "https://www.hamilton.ca/city-initiatives/strategies-actions/open-data-licence-terms-and-conditions", attribution: "Contains public sector Data made available under the City of Hamilton\\’s Open Data Licence" },
  { id: "durham-region", name: "Durham Region Transit", region: "Durham Region, ON", lat: 43.9496, lon: -78.9365, radiusKm: 45, url: "https://drtonline.durhamregiontransit.com/gtfsrealtime/VehiclePositions", mode: 'Bus', license: "Region of Durham Open Data Licence v.1.0", licenseUrl: "https://www.durham.ca/en/regional-government/open-data.aspx", attribution: "Contains public sector information made available under The Regional Municipality of Durham's Open Data Licence" },
  { id: "guelph-transit", name: "Guelph Transit", region: "Guelph, ON", lat: 43.5325, lon: -80.2482, radiusKm: 15, url: "https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/vehicle/vehiclepositions.pb", mode: 'Bus', license: "Open Government Licence \\– City of Guelph (v2.0)", licenseUrl: "https://explore.guelph.ca/pages/open-data-license", attribution: "Contains information licensed under the Open Government Licence \\– City of Guelph" },
  { id: "kingston-transit", name: "Kingston Transit", region: "Kingston, ON", lat: 44.24, lon: -76.57, radiusKm: 20, url: "https://api.cityofkingston.ca/gtfs-realtime/vehicleupdates.pb", mode: 'Bus', license: "City of Kingston Open Data Licence 1.0", licenseUrl: "https://www.cityofkingston.ca/media/wtpgpkb0/gis_license_opendata.pdf", attribution: "Contains information licensed under the Open Data Licence \\– City of Kingston" },
  { id: "barrie-transit", name: "Barrie Transit", region: "Barrie, ON", lat: 44.371, lon: -79.6733, radiusKm: 10, url: "https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb", mode: 'Bus', license: "Barrie Transit Data licence", licenseUrl: "https://www.barrie.ca/services-payments/transportation-parking/barrie-transit/barrie-gtfs", attribution: "Realtime vehicle data \\© City of Barrie, used under the Barrie Transit Data licence" },
  { id: "yrt-york", name: "YRT/Viva", region: "York Region, ON", lat: 44.025, lon: -79.436, radiusKm: 38, url: "https://rtu.york.ca/gtfsrealtime/VehiclePositions", mode: 'Bus', license: "YRT Open Data Licence v2.0 (UK OGL-derived)", licenseUrl: "https://www.yrt.ca/en/about-us/open-data-licence-agreement.aspx", attribution: "Contains public transit Information made available under YRT's Open Data Licence" },
  { id: "burlington-transit", name: "Burlington Transit", region: "Burlington, ON", lat: 43.3342, lon: -79.8089, radiusKm: 12, url: "https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb", mode: 'Bus', license: "City of Burlington Open Data Terms of Use", licenseUrl: "https://opendata.burlington.ca/opendata-terms-of-use/City%20of%20Burlington%20-%20Open%20Data%20Terms%20of%20Use.pdf", attribution: "Transit data \\© City of Burlington (Burlington Transit), used under the City of Burlington Open Data Terms of Use" },
  { id: "smtr-rio-onibus", name: "Rio buses (SPPO)", region: "Rio de Janeiro, RJ", lat: -22.92, lon: -43.42, radiusKm: 45, url: "https://dados.mobilidade.rio/gtfs/realtime/onibus/vehicle-positions", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://www.data.rio/documents/997bc16cc4344a5cb0e48ab06cbdfd1f", attribution: "SMTR / Prefeitura da Cidade do Rio de Janeiro — buses (SPPO)" },
  { id: "smtr-rio-brt", name: "Mobi-Rio BRT", region: "Rio de Janeiro, RJ", lat: -22.92, lon: -43.42, radiusKm: 45, url: "https://dados.mobilidade.rio/gtfs/realtime/brt/vehicle-positions", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://www.data.rio/documents/8bb196cc02174d25b77437bb2f6443d4", attribution: "SMTR / Prefeitura da Cidade do Rio de Janeiro — BRT (Mobi-Rio)" },
  { id: "zditm-szczecin", name: "Szczecin buses and trams", region: "Szczecin, Poland", lat: 53.44, lon: 14.56, radiusKm: 25, url: "https://www.zditm.szczecin.pl/storage/gtfs/gtfs-rt-vehicles.pb", mode: 'Bus', license: "CC0 1.0", licenseUrl: "https://www.zditm.szczecin.pl/en/zditm/for-developers", attribution: "Zarząd Dróg i Transportu Miejskiego w Szczecinie (ZDiTM Szczecin)" },
  { id: "pid-praha", name: "Prague PID", region: "Prague and Central Bohemia, Czechia", lat: 50.08, lon: 14.45, radiusKm: 60, url: "https://api.golemio.cz/v2/vehiclepositions/gtfsrt/vehicle_positions.pb", mode: 'Transit', license: "CC BY", licenseUrl: "https://pid.cz/o-systemu/opendata/", attribution: "Pražská integrovaná doprava (PID) / Golemio" },
  { id: "tbm-bordeaux", name: "Bordeaux TBM", region: "Bordeaux, France", lat: 44.85, lon: -0.65, radiusKm: 20, url: "https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt", mode: 'Transit', license: "Licence Ouverte / Etalab 2.0", licenseUrl: "https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite", attribution: "Bordeaux Métropole (TBM)" },
  { id: "sendai-city-bus", name: "Sendai City Bus", region: "Sendai, Japan", lat: 38.27, lon: 140.82, radiusKm: 22, url: "https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_vehicle", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: "仙台市交通局 (Sendai City Transportation Bureau) / ODPT" },
  { id: "ztm-poznan", name: "Poznań buses and trams", region: "Poznań, Poland", lat: 52.39, lon: 16.92, radiusKm: 20, url: "https://www.ztm.poznan.pl/pl/dla-deweloperow/getGtfsRtFile/?file=vehicle_positions.pb", mode: 'Transit', license: "ZTM Poznań open-data terms", licenseUrl: "https://www.ztm.poznan.pl/otwarte-dane/dla-deweloperow/", attribution: "Zarząd Transportu Miejskiego w Poznaniu (processed)" },
  { id: "ztm-gdansk", name: "Gdańsk buses and trams", region: "Gdańsk, Poland", lat: 54.35, lon: 18.6, radiusKm: 20, url: "https://ckan2.multimediagdansk.pl/gtfs-rt?feed=vehiclePositions", mode: 'Transit', license: "CC BY 4.0", licenseUrl: "https://dane.gov.pl/pl/dataset/38599,rozklady-jazdy-i-lokalizacja-przystankow-gtfs-rt", attribution: "Zarząd Transportu Miejskiego w Gdańsku" },
  { id: "ets-edmonton", name: "Edmonton Transit Service", region: "Edmonton, AB", lat: 53.53, lon: -113.52, radiusKm: 25, url: "https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb", mode: 'Bus', license: "City of Edmonton Open Data Agreement", licenseUrl: "https://www.edmonton.ca/transportation/Web-version2.1-OpenDataAgreement.pdf", attribution: "Contains information licensed under the Open Data Agreement – City of Edmonton" },
  { id: "halifax-transit", name: "Halifax Transit", region: "Halifax, NS", lat: 44.7, lon: -63.6, radiusKm: 22, url: "https://gtfs.halifax.ca/realtime/Vehicle/VehiclePositions.pb", mode: 'Bus', license: "Open Government Licence – Halifax", licenseUrl: "https://www.halifax.ca/home/open-data/open-data-license", attribution: "Contains information licenced under the Open Government Licence – Halifax" },
  { id: "bc-transit-victoria", name: "Victoria Regional Transit", region: "Victoria, BC", lat: 48.53, lon: -123.43, radiusKm: 28, url: "https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb?operatorIds=48", mode: 'Bus', license: "BC Transit Open Data Terms of Use", licenseUrl: "https://www.bctransit.com/open-data/terms-of-use", attribution: "BC Transit" },
  { id: "tam-montpellier", name: "Montpellier TaM", region: "Montpellier, France", lat: 43.61, lon: 3.87, radiusKm: 20, url: "https://gtfsproxy.e-tam.fr/COMMON/VehiclePosition.pb", mode: 'Transit', license: "ODbL", licenseUrl: "https://transport.data.gouv.fr/datasets/offre-de-transport-tam-en-temps-reel-gtfs-rt-urbain-et-suburbain", attribution: "Montpellier Méditerranée Métropole (TaM)", speedUnit: 'km/h' },
  { id: "actv-venezia-bus", name: "Venice ACTV buses", region: "Venice, Italy", lat: 45.4, lon: 12.2, radiusKm: 38, url: "https://tpl.actv.it/aut/GTFSRT/vehiclePositions", mode: 'Bus', license: "ACTV open-data catalogue", licenseUrl: "https://actv.avmspa.it/it/content/catalogo-dei-dati-metadati-e-banche-dati-actv", attribution: "ACTV S.p.A." },
  { id: "actv-venezia-waterbus", name: "Venice ACTV waterbuses", region: "Venice, Italy", lat: 45.43, lon: 12.33, radiusKm: 15, url: "https://tpl.actv.it/nav/GTFSRT/vehiclePositions", mode: 'Ferry', license: "ACTV open-data catalogue", licenseUrl: "https://actv.avmspa.it/it/content/catalogo-dei-dati-metadati-e-banche-dati-actv", attribution: "ACTV S.p.A." },
  { id: "rtd-denver", name: "Denver RTD", region: "Denver, CO", lat: 39.75, lon: -104.99, radiusKm: 55, url: "https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb", mode: 'Transit', license: "RTD GTFS-realtime licence agreement", licenseUrl: "https://www.rtd-denver.com/business-center/open-spatial-data/gtfs-realtime-license-agreement", attribution: "Regional Transportation District (RTD)" },
  { id: "mpk-rzeszow", name: "Rzeszów city transport", region: "Rzeszów, Poland", lat: 50.04, lon: 22, radiusKm: 15, url: "https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb", mode: 'Bus', license: "MPK Rzeszów open data", licenseUrl: "https://www.mpkrzeszow.pl/otwartedane/", attribution: "MPK Rzeszów" },
  { id: "mybas-johor", name: "BAS.MY Johor Bahru", region: "Johor Bahru, Malaysia", lat: 1.51, lon: 103.75, radiusKm: 35, url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor/", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://developer.data.gov.my/realtime-api/gtfs-realtime", attribution: "BAS.MY / data.gov.my" },
  { id: "mybas-kota-bharu", name: "BAS.MY Kota Bharu", region: "Kota Bharu, Malaysia", lat: 6.06, lon: 102.22, radiusKm: 60, url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kota-bharu/", mode: 'Bus', license: "CC BY 4.0", licenseUrl: "https://developer.data.gov.my/realtime-api/gtfs-realtime", attribution: "BAS.MY / data.gov.my" },
  { id: "astuce-rouen", name: "Rouen Astuce", region: "Rouen, France", lat: 49.44, lon: 1.1, radiusKm: 20, url: "https://api.mrn.cityway.fr/dataflow/vehicle-tc-tr/download?provider=TCAR&dataFormat=gtfs-rt", mode: 'Transit', license: "Licence Ouverte 2.0", licenseUrl: "https://transport.data.gouv.fr/datasets/donnees-statiques-et-temps-reel-du-reseau-astuce-metropole-rouen-normandie", attribution: "Métropole Rouen Normandie (Astuce)" },
  { id: "mpm-toulon", name: "Toulon Mistral", region: "Toulon, France", lat: 43.12, lon: 5.94, radiusKm: 18, url: "https://feed-rdtpm-toulon.ratpdev.com/VehiclePosition/GTFS-RT", mode: 'Bus', license: "Licence Ouverte 2.0", licenseUrl: "https://transport.data.gouv.fr/datasets/reseau-de-transport-urbain-de-la-metropole-toulon-provence-mediterranee", attribution: "Métropole Toulon Provence Méditerranée (Mistral)", speedUnit: 'km/h' },
  { id: "lia-le-havre", name: "Le Havre LiA", region: "Le Havre, France", lat: 49.49, lon: 0.11, radiusKm: 18, url: "https://opendata.transports-lia.fr/gtfs-rt/VehiclePosition.pb", mode: 'Transit', license: "ODbL", licenseUrl: "https://transport.data.gouv.fr/datasets/reseau-de-transport-en-commun-lia-gtfs-siri", attribution: "Le Havre Seine Métropole (LiA)" },
  { id: "filbleu-tours", name: "Tours Fil Bleu", region: "Tours, France", lat: 47.39, lon: 0.69, radiusKm: 18, url: "https://data.filbleu.fr/ws-tr/gtfs-rt/opendata/vehicle-positions", mode: 'Transit', license: "Licence Ouverte 2.0", licenseUrl: "https://transport.data.gouv.fr/datasets/fil-bleu-syndicat-des-mobilites-gtfs-gtfs-rt", attribution: "Fil Bleu – Syndicat des Mobilités de Touraine" },
];

const KM_PER_DEG = 111.32;
const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLon = ((((bLon - aLon) % 360) + 540) % 360) - 180;
  return Math.hypot((bLat - aLat) * KM_PER_DEG, dLon * KM_PER_DEG * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)));
};

/** Above this camera height nothing is polled: city vehicles cannot be told apart from that far. */
export const TRANSIT_MAX_HEIGHT_M = 1_500_000;
const reach = (heightM: number) => Math.min(400, heightM / 1000);

export function transitFeedsForView(lat: number, lon: number, heightM: number): TransitFeed[] {
  if (!(heightM <= TRANSIT_MAX_HEIGHT_M)) return [];
  return TRANSIT_FEEDS.filter((f) => distKm(lat, lon, f.lat, f.lon) <= f.radiusKm + reach(heightM));
}

export function mbtaInView(lat: number, lon: number, heightM: number): boolean {
  return heightM <= TRANSIT_MAX_HEIGHT_M && distKm(lat, lon, MBTA_AREA.lat, MBTA_AREA.lon) <= MBTA_AREA.radiusKm + reach(heightM);
}

/** Positions older than this are not shown as current vehicles (some feeds keep parked vehicles for hours). */
export const TRANSIT_MAX_AGE_S = 10 * 60;
export const TRANSIT_MAX_PER_FEED = 6000;
/** Vehicles drawn at once (each is a labelled, trackable map entity). */
export const TRANSIT_MAX_SHOWN = 2500;

export function normalizeTransitGtfs(feed: TransitFeed, gtfs: GtfsFeed, nowMs: number): Normalized & { stale: number } {
  const records: GeoRecord[] = [];
  let stale = 0;
  for (const v of gtfs.vehicles) {
    if (records.length >= TRANSIT_MAX_PER_FEED) break;
    if (feed.excludeRoute && v.routeId && feed.excludeRoute.test(v.routeId)) continue;
    // Feeds without per-vehicle times are dated by the feed header: the age of the snapshot, not of the fix.
    const t = v.timestamp ?? gtfs.headerTimestamp;
    if (t !== null && nowMs / 1000 - t > TRANSIT_MAX_AGE_S) { stale++; continue; }
    // Some feeds park unassigned vehicles at 0,0.
    if (Math.abs(v.lat) < 0.01 && Math.abs(v.lon) < 0.01) continue;
    const key = (v.vehicleId ?? v.tripId ?? v.entityId).slice(0, 60);
    const mps = v.speedMps === null || v.speedMps < 0 ? null : feed.speedUnit === 'km/h' ? v.speedMps / 3.6 : v.speedMps;
    records.push({
      id: `${feed.id}:${key}`.slice(0, 100),
      lat: v.lat, lon: v.lon, altM: null,
      heading: v.bearing,
      speedKts: mps === null ? null : Math.round(mps * 1.943844 * 10) / 10,
      label: v.routeId ? `${feed.name} · ${v.routeId.slice(0, 30)}` : v.label ? `${feed.name} ${v.label.slice(0, 30)}` : feed.name,
      category: feed.mode,
      observedAt: t ? new Date(t * 1000).toISOString() : null,
      sourceUrl: feed.licenseUrl,
      source: feed.attribution,
      props: {
        operator: feed.name, serviceArea: feed.region, route: v.routeId, trip: v.tripId, vehicle: v.label ?? v.vehicleId, status: v.status, nextStopId: v.stopId,
        mode: feed.mode === 'Transit' ? 'not stated by the feed (bus, tram or metro)' : feed.mode,
        timeFrom: v.timestamp !== null ? 'vehicle report' : t !== null ? 'feed snapshot' : 'not given', license: feed.license,
      },
    });
  }
  return { records, skipped: gtfs.skipped, sourceUpdatedAt: gtfs.headerTimestamp ? new Date(gtfs.headerTimestamp * 1000).toISOString() : null, stale };
}
