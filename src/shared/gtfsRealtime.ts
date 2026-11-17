// Minimal GTFS-Realtime reader: vehicle positions only (FeedMessage → FeedEntity → VehiclePosition), decoded straight
// from the protobuf wire format. Unknown fields are skipped by wire type, so newer feed versions still read.
// Field numbers: https://gtfs.org/documentation/realtime/proto/

export interface GtfsVehicle {
  entityId: string;
  tripId: string | null;
  routeId: string | null;
  vehicleId: string | null;
  label: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  /** Metres per second, as GTFS-RT defines it. */
  speedMps: number | null;
  /** Seconds since the epoch; null when the vehicle carries no timestamp. */
  timestamp: number | null;
  stopId: string | null;
  status: 'incoming' | 'stopped' | 'in-transit' | null;
}

export interface GtfsFeed { headerTimestamp: number | null; vehicles: GtfsVehicle[]; skipped: number }

/** Feeds above this many entities are refused (the largest rail feeds carry a few thousand). */
export const GTFS_MAX_ENTITIES = 50_000;

class Reader {
  pos: number;
  constructor(readonly b: Uint8Array, start: number, readonly end: number) { this.pos = start; }
  done(): boolean { return this.pos >= this.end; }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('GTFS-RT varint runs past its message');
      const byte = this.b[this.pos++];
      // Above 2^53 precision is lost; GTFS-RT varints are timestamps, enums and lengths.
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Error('GTFS-RT varint is too long');
    }
  }
  bytes(): { start: number; end: number } {
    const len = this.varint();
    const start = this.pos;
    const end = start + len;
    if (end > this.end) throw new Error('GTFS-RT field runs past its message');
    this.pos = end;
    return { start, end };
  }
  float(): number {
    if (this.pos + 4 > this.end) throw new Error('GTFS-RT float runs past its message');
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return v;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`GTFS-RT wire type ${wire} is not supported`);
    if (this.pos > this.end) throw new Error('GTFS-RT field runs past its message');
  }
  /** Iterates the fields of this message. */
  *fields(): Generator<{ field: number; wire: number }> {
    while (!this.done()) {
      const key = this.varint();
      yield { field: Math.floor(key / 8), wire: key & 7 };
    }
  }
}

const utf8 = new TextDecoder('utf-8');
const text = (r: Reader, max = 120): string | null => {
  const { start, end } = r.bytes();
  const s = utf8.decode(r.b.subarray(start, end)).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : null;
};

function readTrip(b: Uint8Array, s: number, e: number): { tripId: string | null; routeId: string | null } {
  const r = new Reader(b, s, e);
  let tripId: string | null = null;
  let routeId: string | null = null;
  for (const { field, wire } of r.fields()) {
    if (field === 1 && wire === 2) tripId = text(r);
    else if (field === 5 && wire === 2) routeId = text(r);
    else r.skip(wire);
  }
  return { tripId, routeId };
}

function readVehicle(b: Uint8Array, s: number, e: number, entityId: string): GtfsVehicle | null {
  const r = new Reader(b, s, e);
  const v: GtfsVehicle = { entityId, tripId: null, routeId: null, vehicleId: null, label: null, lat: NaN, lon: NaN, bearing: null, speedMps: null, timestamp: null, stopId: null, status: null };
  for (const { field, wire } of r.fields()) {
    if (field === 1 && wire === 2) { const t = r.bytes(); Object.assign(v, readTrip(b, t.start, t.end)); }
    else if (field === 2 && wire === 2) {
      const p = r.bytes();
      const pr = new Reader(b, p.start, p.end);
      for (const f of pr.fields()) {
        if (f.wire === 5 && f.field === 1) v.lat = pr.float();
        else if (f.wire === 5 && f.field === 2) v.lon = pr.float();
        else if (f.wire === 5 && f.field === 3) { const x = pr.float(); v.bearing = Number.isFinite(x) && x >= 0 && x < 360 ? x : null; }
        else if (f.wire === 5 && f.field === 5) { const x = pr.float(); v.speedMps = Number.isFinite(x) && x >= 0 && x < 200 ? x : null; }
        else pr.skip(f.wire);
      }
    } else if (field === 4 && wire === 0) {
      const st = r.varint();
      v.status = st === 0 ? 'incoming' : st === 1 ? 'stopped' : st === 2 ? 'in-transit' : null;
    } else if (field === 5 && wire === 0) { const t = r.varint(); v.timestamp = t > 0 ? t : null; }
    else if (field === 7 && wire === 2) v.stopId = text(r, 60);
    else if (field === 8 && wire === 2) {
      const d = r.bytes();
      const dr = new Reader(b, d.start, d.end);
      for (const f of dr.fields()) {
        if (f.field === 1 && f.wire === 2) v.vehicleId = text(dr, 60);
        else if (f.field === 2 && f.wire === 2) v.label = text(dr, 60);
        else dr.skip(f.wire);
      }
    } else r.skip(wire);
  }
  // A position must be present and real: (0, 0) is how some feeds say "no fix".
  if (!(Math.abs(v.lat) <= 90 && Math.abs(v.lon) <= 180) || (v.lat === 0 && v.lon === 0)) return null;
  return v;
}

export function decodeGtfsVehicles(bytes: Uint8Array): GtfsFeed {
  const r = new Reader(bytes, 0, bytes.length);
  let headerTimestamp: number | null = null;
  const vehicles: GtfsVehicle[] = [];
  let skipped = 0;
  let entities = 0;
  for (const { field, wire } of r.fields()) {
    if (field === 1 && wire === 2) {
      const h = r.bytes();
      const hr = new Reader(bytes, h.start, h.end);
      for (const f of hr.fields()) {
        if (f.field === 3 && f.wire === 0) headerTimestamp = hr.varint() || null;
        else hr.skip(f.wire);
      }
    } else if (field === 2 && wire === 2) {
      if (++entities > GTFS_MAX_ENTITIES) throw new Error('GTFS-RT feed has too many entities');
      const en = r.bytes();
      const er = new Reader(bytes, en.start, en.end);
      let id = '';
      let veh: { start: number; end: number } | null = null;
      for (const f of er.fields()) {
        if (f.field === 1 && f.wire === 2) id = text(er, 80) ?? '';
        else if (f.field === 4 && f.wire === 2) veh = er.bytes();
        else er.skip(f.wire);
      }
      if (!veh) continue; // trip updates and alerts share the feed format
      const v = readVehicle(bytes, veh.start, veh.end, id);
      if (v) vehicles.push(v);
      else skipped++;
    } else r.skip(wire);
  }
  return { headerTimestamp, vehicles, skipped };
}
