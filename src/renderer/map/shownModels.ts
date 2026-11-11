// Which 3D model each vehicle is actually showing right now (ready models only), keyed like the map's
// pick ids ('rec|layer|id'). Written by VehicleModelLayer; read by the details panel so its model credit
// always matches what is drawn (pack model, app-built model, or none while the vehicle is an icon).

const shown = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Records the variant now shown for `key`, or null when the vehicle has no ready model. */
export function setShownModel(key: string, variant: string | null): void {
  if ((shown.get(key) ?? null) === variant) return;
  if (variant) shown.set(key, variant);
  else shown.delete(key);
  notify();
}

export function clearShownModels(keys: Iterable<string>): void {
  let changed = false;
  for (const k of keys) changed = shown.delete(k) || changed;
  if (changed) notify();
}

/** Variant shown for this vehicle ('pack:<id>' for a model-pack model), or null. */
export function shownModelVariant(key: string): string | null {
  return shown.get(key) ?? null;
}

export function subscribeShownModels(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Model-pack id from a variant, or null for app-built variants. */
export function packIdOf(variant: string | null): string | null {
  return variant?.startsWith('pack:') ? variant.slice(5) : null;
}
