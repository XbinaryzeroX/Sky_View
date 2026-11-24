// Drives the startup screen defined in index.html (#boot): status text while loading, then a fade-out and removal.
// With reduced motion it is removed at once.

const FADE_MS = 700;

export function setSplashStatus(text: string): void {
  const el = document.getElementById('boot-status');
  if (el && el.textContent !== text) el.textContent = text;
}

export function dismissSplash(reducedMotion: boolean): void {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('boot-done')) return;
  const reduce = reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { boot.remove(); return; }
  boot.classList.add('boot-done');
  boot.setAttribute('aria-busy', 'false');
  window.setTimeout(() => boot.remove(), FADE_MS);
}
