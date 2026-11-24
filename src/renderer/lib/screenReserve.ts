// Screen boxes that HTML overlays (camera cards and tags) currently occupy over the globe, so map-drawn labels such as
// the simulated-traffic tags can keep clear of them. Pixel boxes in canvas coordinates; owners replace their own set.

export interface ScreenBox { left: number; top: number; right: number; bottom: number }

const owners = new Map<string, ScreenBox[]>();

export function setReservedBoxes(owner: string, boxes: ScreenBox[]): void {
  if (boxes.length) owners.set(owner, boxes);
  else owners.delete(owner);
}

export function reservedBoxes(): ScreenBox[] {
  return [...owners.values()].flat();
}
