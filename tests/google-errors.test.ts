// Wording for failed Google Map Tiles requests: refusals, quota, server errors and no answer stay distinct.
import { describe, expect, it } from 'vitest';
import { googleRefusal, googleStatus } from '../src/shared/googleErrors';

describe('Google Map Tiles failures', () => {
  it('reads the status from Cesium request errors and messages', () => {
    expect(googleStatus({ statusCode: 403 })).toBe(403);
    expect(googleStatus(new Error('Request has failed. Status Code: 429'))).toBe(429);
    expect(googleStatus(new Error('Failed to fetch'))).toBeNull();
    expect(googleStatus({ toString: () => 'Request has failed.' })).toBeNull();
  });
  it('says refused, quota, server error or no answer, and never "did not respond" for a refusal', () => {
    expect(googleRefusal('Photoreal 3D', { statusCode: 403 })).toMatch(/refused the key \(HTTP 403\).*referrer/);
    expect(googleRefusal('Photoreal 3D', { statusCode: 404 })).toMatch(/not found/);
    expect(googleRefusal('Photoreal 3D', { statusCode: 429 })).toMatch(/quota/);
    expect(googleRefusal('Photoreal 3D', { statusCode: 503 })).toMatch(/server error \(HTTP 503\)/);
    expect(googleRefusal('Photoreal 3D', new Error('Failed to fetch'))).toMatch(/No answer from Google.*tile\.googleapis\.com/);
  });
});
