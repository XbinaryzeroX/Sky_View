// Render resolution setting: allowed values, labels, and the settings schema.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, IPC, ipcArgSchemas } from '../src/shared/ipc';
import { isRenderScale, RENDER_SCALES, renderedPixelShare, renderScaleLabel } from '../src/shared/renderScale';

describe('render scale', () => {
  it('accepts only the listed scales', () => {
    for (const s of RENDER_SCALES) expect(isRenderScale(s)).toBe(true);
    for (const v of [0, 0.4, 0.66, 1.5, -1, NaN, Infinity, '0.5', null]) expect(isRenderScale(v)).toBe(false);
  });
  it('states the share of pixels drawn and never calls the upscaling DLSS', () => {
    expect(renderedPixelShare(0.5)).toBe(25);
    expect(renderedPixelShare(0.67)).toBe(45);
    expect(renderScaleLabel(1)).toBe('Full resolution (100%)');
    expect(renderScaleLabel(0.75)).toBe('75% per side, sharpened (draws 56% of the pixels)');
    for (const s of RENDER_SCALES) expect(renderScaleLabel(s)).not.toMatch(/dlss|fsr/i);
  });
  it('defaults to full resolution and rejects other numbers in settings', () => {
    const schema = ipcArgSchemas[IPC.settingsUpdate];
    expect(DEFAULT_SETTINGS.renderScale).toBe(1);
    expect(schema.safeParse([{ renderScale: 0.67 }]).success).toBe(true);
    expect(schema.safeParse([{ renderScale: 0.1 }]).success).toBe(false);
    expect(schema.safeParse([{ renderScale: '0.5' }]).success).toBe(false);
  });
});
