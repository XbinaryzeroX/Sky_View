import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('optimized cockpit asset', () => {
  it('makes the cockpit windshield materials transparent', () => {
    const glb = readFileSync('public/interior-models/boeing-757-cockpit-fast.glb');
    const length = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + length).toString('utf8'));
    for (const name of ['generic_glass', 'glass_t1']) {
      const material = json.materials.find((m: { name?: string }) => m.name === name);
      expect(material).toBeDefined();
      expect(material.alphaMode).toBe('BLEND');
      expect(material.pbrMetallicRoughness.baseColorFactor[3]).toBe(0);
    }
  });
});
