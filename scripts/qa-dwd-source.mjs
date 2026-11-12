// Independent acceptance reader. It does not import the application's DWD parser.
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
function boundedCapEntries(bytes) {
  assert(bytes.length <= 2 * 1024 * 1024, "QA snapshot exceeds compressed bound");
  let count = 0;
  let declared = 0;
  const files = unzipSync(bytes, { filter: (entry) => {
    count++;
    declared += entry.originalSize;
    assert(count <= 2e3 && entry.originalSize <= 4 * 1024 * 1024 && declared <= 64 * 1024 * 1024, "QA ZIP expansion bound exceeded");
    return /\.xml$/i.test(entry.name);
  } });
  let expanded = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return Object.entries(files).map(([name, value]) => {
    expanded += value.length;
    assert(value.length <= 4 * 1024 * 1024 && expanded <= 64 * 1024 * 1024, "QA actual expansion bound exceeded");
    const xml = decoder.decode(value);
    assert(!/<!DOCTYPE|<!ENTITY/i.test(xml), "External XML declarations are outside this QA reader");
    return { name, xml };
  });
}
// This function is serialized into Chromium. All XML values come from a same-run official ZIP.
function readCapFacts(entries) {
  const children = (parent, name) => [...parent.children].filter((child) => child.localName === name);
  const text = (parent, name) => children(parent, name)[0]?.textContent.trim() || null;
  const time = (value) => value ? new Date(value).toISOString() : null;
  const coordinates = (value) => value.trim().split(/\s+/).map((pair) => {
    const values = pair.split(",").map(Number);
    if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error("Invalid raw CAP coordinate");
    return [values[1], values[0]];
  });
  return entries.map((entry) => {
    const document = new DOMParser().parseFromString(entry.xml, "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error("Independent XML parse failed: " + entry.name);
    const root = document.documentElement;
    if (root.localName !== "alert" || root.namespaceURI !== "urn:oasis:names:tc:emergency:cap:1.2") throw new Error("Unexpected CAP root");
    const referenceText = text(root, "references") ?? "";
    return {
      file: entry.name,
      identifier: text(root, "identifier"),
      sender: text(root, "sender"),
      sent: time(text(root, "sent")),
      status: text(root, "status"),
      scope: text(root, "scope"),
      messageType: text(root, "msgType"),
      references: referenceText ? referenceText.split(/\s+/).map((reference) => {
        const [sender, identifier, sent] = reference.split(",");
        return { sender, identifier, sent: time(sent) };
      }) : [],
      infos: children(root, "info").map((info) => ({
        language: text(info, "language"),
        event: text(info, "event"),
        headline: text(info, "headline"),
        description: text(info, "description"),
        instruction: text(info, "instruction"),
        severity: text(info, "severity"),
        urgency: text(info, "urgency"),
        certainty: text(info, "certainty"),
        effective: time(text(info, "effective")),
        onset: time(text(info, "onset")),
        expires: time(text(info, "expires")),
        responseTypes: children(info, "responseType").map((value) => value.textContent.trim()),
        parameters: children(info, "parameter").map((parameter) => ({ name: text(parameter, "valueName"), value: text(parameter, "value") })),
        areas: children(info, "area").map((area) => {
          const geocodes = children(area, "geocode").map((code) => ({ name: text(code, "valueName"), value: text(code, "value") }));
          return {
            description: text(area, "areaDesc"),
            geocodes,
            polygons: children(area, "polygon").map((polygon) => coordinates(polygon.textContent)),
            exclusions: geocodes.filter((code) => code.name === "EXCLUDE_POLYGON").map((code) => coordinates(code.value)),
            altitude: text(area, "altitude"),
            ceiling: text(area, "ceiling")
          };
        })
      }))
    };
  });
}
const tuple = (value) => JSON.stringify([value.sender, value.identifier ?? value.capIdentifier, value.sent]);
const compact = (value) => value?.replaceAll("\r\n", "\n").trim() ?? null;
const positionKey = (point) => Number(point[0]) + "," + Number(point[1]);
const rings = (geometry) => geometry?.type === "Polygon" ? geometry.coordinates : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
function verifyDwdWarnings(warnings, facts) {
  const byIdentity = new Map(facts.map((message) => [tuple(message), message]));
  const ids = new Set();
  let coordinateChecks = 0;
  let geocodeChecks = 0;
  let areaChecks = 0;
  let sourcePolygons = 0;
  let sourceExclusionRings = 0;
  const records = [];
  for (const warning of warnings) {
    assert(!ids.has(warning.id), "Duplicate application warning ID");
    ids.add(warning.id);
    const message = byIdentity.get(tuple(warning));
    assert(message, "Returned warning identity absent from actual same-run CAP");
    assert.equal(message.status, "Actual");
    assert.equal(message.scope, "Public");
    assert.equal(warning.messageType, message.messageType);
    assert.deepEqual(warning.references.map((reference) => ({ sender: reference.sender, identifier: reference.identifier, sent: reference.sent })), message.references, "Publisher replacement references changed");
    assert.equal(warning.country, "DE");
    assert.equal(warning.source, "Deutscher Wetterdienst");
    assert.equal(warning.license, "CC BY 4.0");
    const info = message.infos.find((info2) => info2.language === warning.language);
    assert(info && ["de", "de-DE"].includes(info.language), "German source language was not retained");
    for (const field of ["event", "headline", "description", "instruction", "severity", "urgency", "certainty", "effective", "onset", "expires"]) {
      assert.equal(compact(warning[field]), compact(info[field]), "Original CAP value changed: " + field);
    }
    assert.equal(warning.areas.length, info.areas.length, "A named source area was lost");
    areaChecks += info.areas.length;
    sourcePolygons += info.areas.reduce((count,area)=>count+area.polygons.length,0);
    sourceExclusionRings += info.areas.reduce((count,area)=>count+area.exclusions.length,0);
    const areaKey = (area) => JSON.stringify([compact(area.description), area.geocodes]);
    const remainingAreas = new Map();
    for (const area of info.areas) remainingAreas.set(areaKey(area), (remainingAreas.get(areaKey(area)) ?? 0) + 1);
    const sourcePositions = new Set();
    for (const area of info.areas) for (const ring of [...area.polygons, ...area.exclusions]) for (const point of ring) sourcePositions.add(positionKey(point));
    for (const area of warning.areas) {
      const key = areaKey(area), remaining = remainingAreas.get(key) ?? 0;
      assert(remaining > 0, "An area description or geocode changed");
      remainingAreas.set(key, remaining - 1);
      geocodeChecks += area.geocodes.length;
      for (const ring of rings(area.geometry)) for (const point of ring) {
        assert(sourcePositions.has(positionKey(point)), "A converted area coordinate was not supplied by CAP");
        coordinateChecks++;
      }
    }
    for (const ring of rings(warning.geometry)) for (const point of ring) {
      assert(sourcePositions.has(positionKey(point)), "A converted warning coordinate was not supplied by CAP");
      coordinateChecks++;
    }
    if (!sourcePositions.size) assert.equal(warning.geometry, null, "Geocodes were converted into an invented shape");
    records.push({
      id: warning.id,
      capIdentifier: warning.capIdentifier,
      sender: warning.sender,
      sent: warning.sent,
      language: warning.language,
      event: warning.event,
      areaCount: warning.areas.length,
      geometryStatus: warning.geometryStatus,
      mapped: !!warning.geometry
    });
  }
  return { returnedWarningsChecked: warnings.length, independentCapMessages: facts.length, areaChecks, sourcePolygons, sourceExclusionRings, coordinateChecks, geocodeChecks, records };
}
// Independent CAP endpoint membership calculation; no application identity/hash/parser helper is used.
function expectedDwdMembers(facts, at) {
  const messages = new Map();
  for (const message of facts) {
    if (message.status !== "Actual" || message.scope !== "Public") continue;
    const info = message.infos.find((info2) => ["de", "de-DE"].includes(info2.language));
    if (!info && message.messageType !== "Cancel") continue;
    messages.set(tuple(message), { message, info });
  }
  const replaced = new Set();
  for (const { message, info } of messages.values()) if (["Update", "Cancel"].includes(message.messageType) || info?.responseTypes.includes("AllClear")) {
    for (const reference of message.references) replaced.add(tuple(reference));
  }
  return [...messages.entries()].filter(
    ([key, { message, info }]) => ["Alert", "Update"].includes(message.messageType) && info && !info.responseTypes.includes("AllClear") && (!info.expires || Date.parse(info.expires) > Date.parse(at)) && !replaced.has(key)
  ).map(([, value]) => ({ sender: value.message.sender, identifier: value.message.identifier, sent: value.message.sent }));
}
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [u, v] = ring[j];
    if (y > point[1] !== v > point[1] && point[0] < (u - x) * (point[1] - y) / (v - y) + x) inside = !inside;
  }
  return inside;
}
function containsPoint(geometry, point) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some((rings2) => inRing(point, rings2[0]) && !rings2.slice(1).some((ring) => inRing(point, ring)));
}
function mappedInterior(warnings, excludedPoints = []) {
  // Bound grid work independently of source polygon complexity.
  let candidates = 0;
  for (const warning of warnings) {
    const polygons = warning.geometry?.type === "Polygon" ? [warning.geometry.coordinates] : warning.geometry?.type === "MultiPolygon" ? warning.geometry.coordinates : [];
    for (const polygon of polygons.slice(0, 8)) {
      const xs = polygon[0].map((point) => point[0]), ys = polygon[0].map((point) => point[1]);
      const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
      if (east - west > 180) continue;
      for (let row = 1; row < 5; row++) for (let column = 1; column < 5; column++) {
        if (++candidates > 2e3) return null;
        const point = [west + (east - west) * column / 5, south + (north - south) * row / 5];
          if (excludedPoints.some(excluded => Math.abs(point[0] - excluded[0]) < 0.02 && Math.abs(point[1] - excluded[1]) < 0.02)) continue;
        if (containsPoint(warning.geometry, point)) return { id: warning.id, point };
      }
    }
  }
  return null;
}
export {
  boundedCapEntries,
  containsPoint,
  expectedDwdMembers,
  mappedInterior,
  readCapFacts,
  verifyDwdWarnings
};
