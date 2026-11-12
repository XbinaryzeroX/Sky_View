import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AisStreamClient } from '../src/main/layers/aisstream';

class Socket {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  opened = false;
  sent: string[] = [];
  close = vi.fn();
  send(data: string) {
    if (!this.opened) throw new Error('Socket is still connecting');
    this.sent.push(data);
  }
  open() { this.opened = true; this.onopen?.(); }
}

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const VIEW: [number, number, number, number] = [-10, 45, 10, 60];

function setup() {
  const sockets: Socket[] = [];
  const change = vi.fn();
  const client = new AisStreamClient(() => 'test-key', change, () => {
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  return { client, sockets, change };
}

function position(mmsi = 211000001, time = NOW, latitude = 51.9) {
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: mmsi, time_utc: new Date(time).toISOString() },
    Message: { PositionReport: { Valid: true, Latitude: latitude, Longitude: 4, Sog: 12, Cog: 90, TrueHeading: 511 } },
  };
}

function shipStatic(mmsi: number, name: string) {
  return { MessageType: 'ShipStaticData', MetaData: { MMSI: mmsi }, Message: { ShipStaticData: { Name: name, Type: 71 } } };
}

describe('AISStream connection lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('waits for open, requests binary frames, and subscribes to the latest antimeridian view', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    expect(sockets[0].binaryType).toBe('arraybuffer');
    client.start([170, -30, -170, 30]);
    expect(sockets[0].sent).toHaveLength(0);
    sockets[0].open();
    const subscription = JSON.parse(sockets[0].sent[0]);
    expect(subscription.BoundingBoxes).toEqual([[[-30, 170], [30, 180]], [[-30, -180], [30, -170]]]);
    expect(subscription.FilterMessageTypes).toContain('StaticDataReport');
    expect(subscription.FilterMessageTypes).toContain('ExtendedClassBPositionReport');
    client.stop();
  });

  it('coalesces rapid pans to one replacement per second and includes cumulative small pans', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    sockets[0].open();
    vi.advanceTimersByTime(100);
    client.start([-9.97, 45, 10.03, 60]);
    client.start([-9.94, 45, 10.06, 60]);
    client.start([-9, 45, 11, 60]);
    expect(sockets[0].sent).toHaveLength(1);
    vi.advanceTimersByTime(900);
    expect(sockets[0].sent).toHaveLength(2);
    expect(JSON.parse(sockets[0].sent[1]).BoundingBoxes).toEqual([[[45, -9], [60, 11]]]);
    client.stop();
    vi.advanceTimersByTime(5000);
    expect(sockets[0].sent).toHaveLength(2);
  });

  it('does not reconnect early when view changes during backoff, and stop cancels retries', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    sockets[0].onclose?.({ code: 1006 });
    client.start([-11, 45, 10, 60]);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(4999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].onclose?.({ code: 1006 });
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('ignores callbacks and messages from a socket replaced after stop', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    const old = sockets[0];
    client.stop();
    client.start(VIEW);
    sockets[1].open();
    old.onopen?.();
    old.onmessage?.({ data: JSON.stringify(position()) });
    old.onerror?.({});
    old.onclose?.({ code: 1006 });
    expect(client.status).toMatchObject({ connected: true, error: null });
    expect(client.records(NOW)).toHaveLength(0);
    expect(old.sent).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it('increases backoff across accepted handshakes that never produce usable AIS data', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    for (let attempt = 0; attempt < 3; attempt++) {
      sockets[attempt].open();
      sockets[attempt].onmessage?.({ data: JSON.stringify({ error: 'Invalid API key' }) });
      sockets[attempt].onclose?.({ code: 1008 });
      const delay = 5000 * 2 ** attempt;
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(attempt + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(attempt + 2);
    }
    // Real data, rather than the handshake, restores the ordinary reconnect delay.
    sockets[3].open();
    sockets[3].onmessage?.({ data: JSON.stringify(position(211000001, Date.now())) });
    sockets[3].onclose?.({ code: 1006 });
    vi.advanceTimersByTime(4999);
    expect(sockets).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(5);
    client.stop();
  });

  it('does not open or reschedule a socket after the key is removed during backoff', () => {
    let key: string | null = 'test-key';
    const makeSocket = vi.fn(() => new Socket());
    const client = new AisStreamClient(() => key, () => {}, makeSocket);
    client.start(VIEW);
    makeSocket.mock.results[0].value.onclose?.({ code: 1006 });
    key = null;
    vi.advanceTimersByTime(5000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(client.status).toMatchObject({ connected: false, error: 'No AISStream key configured' });
    vi.advanceTimersByTime(60_000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it('decodes a real binary UTF-8 frame and ignores malformed JSON', () => {
    const { client, sockets } = setup();
    client.start(VIEW);
    sockets[0].open();
    sockets[0].onmessage?.({ data: new TextEncoder().encode(JSON.stringify(position())).buffer });
    sockets[0].onmessage?.({ data: new TextEncoder().encode('{bad json').buffer });
    expect(client.records(NOW)).toHaveLength(1);
    client.stop();
  });
});

describe('AISStream observation integrity and bounded retention', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('keeps the newest position and rejects expired, invalid, future and unsupported messages', () => {
    const { client } = setup();
    client.handle(position());
    client.handle(position(211000001, NOW - 1000, 52));
    client.handle(position(211000002, NOW - 61 * 60_000));
    client.handle(position(211000003, NOW + 6 * 60_000));
    const invalid = position(211000004);
    invalid.Message.PositionReport.Valid = false;
    client.handle(invalid);
    const unsupported = position(211000005);
    client.handle({ ...unsupported, MessageType: 'AidsToNavigationReport', Message: { AidsToNavigationReport: unsupported.Message.PositionReport } });
    client.handle(position(Number.NaN));
    expect(client.records(NOW)).toHaveLength(1);
    expect(client.records(NOW)[0]).toMatchObject({ lat: 51.9, observedAt: new Date(NOW).toISOString() });
    expect(client.records(NOW + 61 * 60_000)).toHaveLength(0);
  });

  it('merges Class B identity parts without replacing observed position time', () => {
    const { client } = setup();
    client.handle(position());
    vi.advanceTimersByTime(1000);
    client.handle({ MessageType: 'StaticDataReport', MetaData: { MMSI: 211000001 }, Message: { StaticDataReport: { ReportA: { Valid: true, Name: 'TEST FERRY' }, ReportB: { Valid: false } } } });
    client.handle({ MessageType: 'StaticDataReport', MetaData: { MMSI: 211000001 }, Message: { StaticDataReport: { ReportA: { Valid: false }, ReportB: { Valid: true, ShipType: 60, CallSign: 'FERRY1', Dimension: { A: 30, B: 10, C: 4, D: 4 } } } } });
    client.handle({ MessageType: 'StaticDataReport', MetaData: { MMSI: 211000001 }, Message: { StaticDataReport: { ReportA: { Valid: true, Name: 'TEST FERRY' } } } });
    expect(client.records(Date.now())[0]).toMatchObject({
      label: 'TEST FERRY', category: 'Passenger', observedAt: new Date(NOW).toISOString(),
      props: { callSign: 'FERRY1', lengthM: 40, beamM: 8 },
    });
  });

  it('does not overwrite newer voyage information with delayed static data', () => {
    const { client } = setup();
    const recent = shipStatic(211000001, 'CURRENT');
    client.handle({ ...recent, MetaData: { MMSI: 211000001, time_utc: new Date(NOW).toISOString() } });
    const old = shipStatic(211000001, 'OLD');
    client.handle({ ...old, MetaData: { MMSI: 211000001, time_utc: new Date(NOW - 1000).toISOString() } });
    client.handle(position());
    expect(client.records(NOW)[0].label).toBe('CURRENT');
  });

  it('bounds metadata and expires old identity before merging with a new position', () => {
    const { client } = setup();
    for (let i = 0; i <= 20_000; i++) client.handle(shipStatic(211000001 + i, `SHIP ${i}`));
    client.handle(position());
    expect(client.records(NOW)[0].label).toBe('MMSI 211000001');
    client.handle(position(211020001));
    expect(client.records(NOW).find((r) => r.id === '211020001')?.label).toBe('SHIP 20000');
    vi.advanceTimersByTime(25 * 60 * 60_000);
    client.handle(position(211020001, Date.now()));
    expect(client.records(Date.now())[0].label).toBe('MMSI 211020001');
  });
});
