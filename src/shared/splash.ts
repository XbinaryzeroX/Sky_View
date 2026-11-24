// When the startup screen may go, and what it says meanwhile. It stays until the app state has arrived, the globe
// is built and its first visible tiles have loaded. A slow or offline network must not trap the user behind it,
// so it also goes after SPLASH_MAX_MS; a startup error removes it at once so the error can be read.

export const SPLASH_MAX_MS = 15_000;

export interface SplashProgress {
  stateLoaded: boolean;
  globeReady: boolean;
  tilesLoaded: boolean;
  failed: boolean;
}

export function splashDone(p: SplashProgress, elapsedMs: number): boolean {
  if (p.failed) return true;
  if (p.stateLoaded && p.globeReady && p.tilesLoaded) return true;
  return elapsedMs >= SPLASH_MAX_MS;
}

export function splashStatus(p: SplashProgress): string {
  if (p.failed) return 'Sky_View could not start.';
  if (!p.stateLoaded) return 'Loading your settings…';
  if (!p.globeReady) return 'Building the globe…';
  if (!p.tilesLoaded) return 'Loading map tiles…';
  return 'Ready';
}
