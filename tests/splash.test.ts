import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPLASH_MAX_MS, splashDone, splashStatus, type SplashProgress } from '../src/shared/splash';

const base: SplashProgress = { stateLoaded: false, globeReady: false, tilesLoaded: false, failed: false };

describe('startup screen', () => {
  it('stays until state, globe and first tiles are all in', () => {
    expect(splashDone(base, 0)).toBe(false);
    expect(splashDone({ ...base, stateLoaded: true, globeReady: true }, 1000)).toBe(false);
    expect(splashDone({ ...base, stateLoaded: true, globeReady: true, tilesLoaded: true }, 1000)).toBe(true);
  });

  it('never traps the user: it goes after the time limit or at once on a startup error', () => {
    expect(splashDone(base, SPLASH_MAX_MS - 1)).toBe(false);
    expect(splashDone(base, SPLASH_MAX_MS)).toBe(true);
    expect(splashDone({ ...base, failed: true }, 0)).toBe(true);
  });

  it('says what is still loading', () => {
    expect(splashStatus(base)).toBe('Loading your settings…');
    expect(splashStatus({ ...base, stateLoaded: true })).toBe('Building the globe…');
    expect(splashStatus({ ...base, stateLoaded: true, globeReady: true })).toBe('Loading map tiles…');
    expect(splashStatus({ ...base, failed: true })).toBe('Sky_View could not start.');
  });

  it('keeps the markup the renderer drives, with a reduced-motion rule and no remote assets', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="boot"');
    expect(html).toContain('id="boot-status"');
    expect(html).toContain('.boot-done');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
