// Render resolution choices for the globe. A scale below 1 draws the scene with fewer pixels and the window
// stretches the result to full size; a sharpening pass restores some edge contrast. This is plain spatial
// upscaling. It is not DLSS, FSR 2 or any other temporal or learned reconstruction.

export const RENDER_SCALES = [1, 0.85, 0.75, 0.67, 0.5] as const;
export type RenderScale = (typeof RENDER_SCALES)[number];

export function isRenderScale(value: unknown): value is RenderScale {
  return typeof value === 'number' && (RENDER_SCALES as readonly number[]).includes(value);
}

/** Share of the full pixel count that is actually drawn, in whole percent (0.67 → 45). */
export function renderedPixelShare(scale: RenderScale): number {
  return Math.round(scale * scale * 100);
}

export function renderScaleLabel(scale: RenderScale): string {
  if (scale === 1) return 'Full resolution (100%)';
  return `${Math.round(scale * 100)}% per side, sharpened (draws ${renderedPixelShare(scale)}% of the pixels)`;
}
