// Draws a protective plan on the existing globe: the site, observation points and cameras (with modelled field-of-view
// outlines), the modelled coverage grid, user-aligned floor plans, mapped emergency facilities and an inspected
// building outline. Everything lives in one data source plus one imagery layer, removed with the plan.
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  HeightReference,
  ImageMaterialProperty,
  ImageryLayer,
  LabelStyle,
  Math as CMath,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  Rectangle,
  HorizontalOrigin,
  SingleTileImageryProvider,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  VerticalOrigin,
  type CesiumWidget,
} from 'cesium';
import { FACILITY_LABEL, type Facility, type FloorPlan, type PlanObserver } from '../../shared/protectivePlan';
import { groundHeightAt } from './siteGeometry';

export interface PlanOverlayState {
  site: { lat: number; lon: number; name: string } | null;
  radiusM: number;
  observers: PlanObserver[];
  selectedObserverId: string | null;
  /** The coverage picture: `n` pixels per side over `bounds`. */
  coverage: { rgba: Uint8ClampedArray; n: number; bounds: { west: number; south: number; east: number; north: number } } | null;
  coverageOpacity: number;
  showCoverage: boolean;
  floorPlans: FloorPlan[];
  facilities: Facility[];
  building: [number, number][] | null;
  /** Rooftops with a modelled clear line to the subject: outline rings at roof height (terrain + building height). */
  roofs?: { lat: number; lon: number; groundM: number; heightM: number; distanceM: number; rings: { ring: [number, number][]; heightM: number }[] }[];
  /** Where sight lines to rooftops start (subject eye, metres above sea level), or null. */
  subjectEye?: { lat: number; lon: number; heightM: number } | null;
  routeOptions?: { points: [number, number][]; color: string; selected: boolean }[];
  routeEnds?: { a: { lat: number; lon: number } | null; b: { lat: number; lon: number } | null };
  /** 'site': dark site view (lit sight lines, vantage markers, range rings); 'classic': colour classes. */
  look?: 'site' | 'classic';
}

const SITE = Color.fromCssColorString('#ffd166');
const OBS = Color.fromCssColorString('#56b4e9');
const CAM = Color.fromCssColorString('#cc79a7');
const FAC = Color.fromCssColorString('#e05d5d');
/** Okabe–Ito vermillion: rooftops with a modelled clear line to the subject. */
const ROOF = Color.fromCssColorString('#D55E00');
/** Site view: magenta for rooftops with a clear line, white for the subject, routes and rings. */
const MAG = Color.fromCssColorString('#ff2bd6');

/** Boxed label (white on near-black), as used for vantage points, ring distances and route ends in the site view. */
const boxLabel = (text: string) => ({
  text,
  font: '700 12px "Segoe UI", sans-serif',
  fillColor: Color.WHITE,
  showBackground: true,
  backgroundColor: Color.fromCssColorString('#0b0d10').withAlpha(0.88),
  backgroundPadding: new Cartesian2(7, 4),
  style: LabelStyle.FILL,
  verticalOrigin: VerticalOrigin.TOP,
  pixelOffset: new Cartesian2(0, 18),
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
});

const icons = new Map<string, HTMLCanvasElement>();
function icon(kind: 'subject' | 'vantage'): HTMLCanvasElement {
  const hit = icons.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (kind === 'subject') {
    // A ring with a dot: the protected person or place.
    c.width = c.height = 34;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(17, 17, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(17, 17, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(17, 17, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // A diamond with a crosshair: an elevated vantage point with a clear line to the subject.
    c.width = c.height = 36;
    ctx.translate(18, 18);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#0b0d10';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeRect(-11, -11, 22, 22);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(18, 18, 5.5, 0, Math.PI * 2);
    ctx.moveTo(18, 9.5);
    ctx.lineTo(18, 13.5);
    ctx.moveTo(18, 22.5);
    ctx.lineTo(18, 26.5);
    ctx.moveTo(9.5, 18);
    ctx.lineTo(13.5, 18);
    ctx.moveTo(22.5, 18);
    ctx.lineTo(26.5, 18);
    ctx.stroke();
  }
  icons.set(kind, c);
  return c;
}

/** Ring spacing for the site view: about four rings across the analysis radius, at round distances. */
export function ringStepM(radiusM: number): number {
  return [25, 50, 100, 200, 250, 500, 1000, 2000].find((s) => radiusM / s <= 4) ?? 2500;
}
const label = (text: string) => ({
  text,
  font: '600 12px "Segoe UI", sans-serif',
  fillColor: Color.WHITE,
  outlineColor: Color.BLACK,
  outlineWidth: 3,
  style: LabelStyle.FILL_AND_OUTLINE,
  verticalOrigin: VerticalOrigin.BOTTOM,
  pixelOffset: new Cartesian2(0, -12),
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
  translucencyByDistance: new NearFarScalar(2e4, 1, 6e4, 0),
});

/** Points along a sector outline (camera field of view), as degrees [lon, lat, ...]. */
export function sectorOutline(lat: number, lon: number, headingDeg: number, fovDeg: number, rangeM: number, steps = 24): number[] {
  const m = 111_320;
  const out = [lon, lat];
  const start = headingDeg - fovDeg / 2;
  for (let i = 0; i <= steps; i++) {
    const b = CMath.toRadians(start + (fovDeg * i) / steps);
    out.push(lon + (Math.sin(b) * rangeM) / (m * Math.cos(CMath.toRadians(lat))), lat + (Math.cos(b) * rangeM) / m);
  }
  out.push(lon, lat);
  return out;
}

function circle(lat: number, lon: number, r: number, steps = 72): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const b = (2 * Math.PI * i) / steps;
    out.push(lon + (Math.sin(b) * r) / (111_320 * Math.cos(CMath.toRadians(lat))), lat + (Math.cos(b) * r) / 111_320);
  }
  return out;
}

export function rgbaToDataUrl(rgba: Uint8ClampedArray, n: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), n, n), 0, 0);
  return canvas.toDataURL('image/png');
}

export class PlanningOverlay {
  private source = new CustomDataSource('protective-plan');
  private coverageLayer: ImageryLayer | null = null;
  private coverageKey: Uint8ClampedArray | null = null;
  /** Terrain height at a floor plan's centre: NaN while sampling, null when unavailable (retried). */
  private groundAt = new Map<string, number | null>();
  private last: PlanOverlayState | null = null;
  private destroyed = false;

  constructor(private readonly widget: CesiumWidget) {
    void widget.dataSources.add(this.source);
  }

  /** The coverage image as a PNG (one pixel per cell), for the briefing. */
  coverageImage(): string | null {
    const c = this.last?.coverage;
    return c ? rgbaToDataUrl(c.rgba, c.n) : null;
  }

  update(s: PlanOverlayState): void {
    if (this.destroyed || this.widget.isDestroyed()) return;
    this.last = s;
    const ents = this.source.entities;
    // Flush the removal before re-adding: an entity removed and re-added under the same id while events are suspended
    // is reported to the map as unchanged, so it kept drawing the old object (a dragged marker stayed where it was).
    ents.removeAll();
    ents.suspendEvents();
    const siteLook = s.look === 'site';
    if (s.site && siteLook) {
      ents.add({ id: 'plan|site', position: Cartesian3.fromDegrees(s.site.lon, s.site.lat), billboard: { image: icon('subject'), heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { ...boxLabel(s.site.name), pixelOffset: new Cartesian2(0, 22) } });
      // Range rings at round distances out to the analysis radius, each with its distance.
      const step = ringStepM(s.radiusM);
      const rings: number[] = [];
      for (let r = step; r < s.radiusM - step / 4; r += step) rings.push(r);
      rings.push(s.radiusM); // the edge of the analysed area
      for (const r of rings) {
        ents.add({ id: `plan|ring|${r}`, polyline: { positions: Cartesian3.fromDegreesArray(circle(s.site.lat, s.site.lon, r)), width: 1.5, clampToGround: true, material: new PolylineDashMaterialProperty({ color: Color.WHITE.withAlpha(r >= s.radiusM - 0.5 ? 0.7 : 0.4), dashLength: 10 }) } });
        const e = circle(s.site.lat, s.site.lon, r, 8)[4]; // east point
        ents.add({ id: `plan|ringlabel|${r}`, position: Cartesian3.fromDegrees(e, s.site.lat), label: { ...boxLabel(r >= 1000 ? `${Math.round(r / 100) / 10} km` : `${Math.round(r)} m`), font: '700 11px "Segoe UI", sans-serif', verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.CENTER, pixelOffset: new Cartesian2(0, 0), heightReference: HeightReference.CLAMP_TO_GROUND } });
      }
    } else if (s.site) {
      // Site label below its marker, so an observation point at the same place keeps its own label above.
      ents.add({ id: 'plan|site', position: Cartesian3.fromDegrees(s.site.lon, s.site.lat), point: { pixelSize: 11, color: SITE, outlineColor: Color.BLACK, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { ...label(s.site.name), verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 12) } });
      ents.add({ id: 'plan|radius', polyline: { positions: Cartesian3.fromDegreesArray(circle(s.site.lat, s.site.lon, s.radiusM)), width: 1.5, clampToGround: true, material: SITE.withAlpha(0.7) } });
    }
    for (const o of s.observers) {
      const color = o.kind === 'camera' ? CAM : OBS;
      const sel = o.id === s.selectedObserverId;
      ents.add({ id: `plan|obs|${o.id}`, position: Cartesian3.fromDegrees(o.lon, o.lat), point: { pixelSize: sel ? 13 : 10, color, outlineColor: sel ? Color.WHITE : Color.BLACK, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: label(`${o.name} · ${o.heightM} m`) });
      if (o.headingDeg !== null && o.fovDeg !== null && o.fovDeg < 360)
        ents.add({ id: `plan|fov|${o.id}`, polyline: { positions: Cartesian3.fromDegreesArray(sectorOutline(o.lat, o.lon, o.headingDeg, o.fovDeg, o.rangeM)), width: sel ? 2.5 : 1.5, clampToGround: true, material: color.withAlpha(0.9) } });
    }
    for (const f of s.facilities)
      ents.add({ id: `plan|fac|${f.osmType}/${f.osmId}`, position: Cartesian3.fromDegrees(f.lon, f.lat), point: { pixelSize: 8, color: FAC, outlineColor: Color.WHITE, outlineWidth: 1.5, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: label(`${f.name ?? FACILITY_LABEL[f.kind]}`) });
    if (s.building && s.building.length > 2)
      ents.add({ id: 'plan|building', polyline: { positions: Cartesian3.fromDegreesArray(s.building.flat()), width: 3, clampToGround: true, material: SITE } });
    for (const fp of s.floorPlans) this.addFloorPlan(fp);
    this.addRoofs(s);
    this.addRoutes(s);
    ents.resumeEvents();
    this.setCoverage(s.showCoverage ? s.coverage : null, s.coverageOpacity);
    this.widget.scene.requestRender();
    // The map renders only on request; markers clamped to the ground settle a frame after they move (while dragging).
    requestAnimationFrame(() => !this.destroyed && !this.widget.isDestroyed() && this.widget.scene.requestRender());
  }

  private addRoofs(s: PlanOverlayState): void {
    const ents = this.source.entities;
    const siteLook = s.look === 'site';
    const ROOFC = siteLook ? MAG : ROOF;
    // Labels for the four nearest vantage points that are not on top of the subject (labels cannot avoid each other).
    const labelled = new Set((s.roofs ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.distanceM >= 20).slice(0, 4).map(({ i }) => i));
    (s.roofs ?? []).forEach((r, i) => {
      // Outlines sit at the mapped roof height; where 3D buildings or terrain hide them they still show, dimmed.
      r.rings.forEach((f, j) => {
        if (f.ring.length < 3) return;
        const h = r.groundM + f.heightM + 0.4;
        ents.add({
          id: `plan|roof|${i}|${j}`,
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights(f.ring.flatMap(([lo, la]) => [lo, la, h])),
            width: i < 10 ? 3 : 2,
            material: new ColorMaterialProperty(ROOFC),
            depthFailMaterial: new ColorMaterialProperty(ROOFC.withAlpha(0.45)),
          },
        });
      });
      const top = r.groundM + r.heightM;
      if (siteLook) {
        // Nearest vantage points get a marker and a boxed label; a glowing line joins each of the nearest to the subject.
        if (i < 10)
          ents.add({ id: `plan|roofpt|${i}`, position: Cartesian3.fromDegrees(r.lon, r.lat, top + 1), billboard: { image: icon('vantage'), disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: labelled.has(i) ? { ...boxLabel(`Vantage point · ${Math.round(r.distanceM)} m`), pixelOffset: new Cartesian2(0, 20) } : undefined });
        else ents.add({ id: `plan|roofpt|${i}`, position: Cartesian3.fromDegrees(r.lon, r.lat, top + 1), point: { pixelSize: 6, color: MAG, outlineColor: Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        if (s.subjectEye && i < 8)
          ents.add({
            id: `plan|sight|${i}`,
            polyline: {
              positions: [Cartesian3.fromDegrees(s.subjectEye.lon, s.subjectEye.lat, s.subjectEye.heightM), Cartesian3.fromDegrees(r.lon, r.lat, top + 1.5)],
              width: 6,
              material: new PolylineGlowMaterialProperty({ color: MAG, glowPower: 0.22 }),
              depthFailMaterial: new PolylineGlowMaterialProperty({ color: MAG.withAlpha(0.4), glowPower: 0.22 }),
            },
          });
        return;
      }
      ents.add({
        id: `plan|roofpt|${i}`,
        position: Cartesian3.fromDegrees(r.lon, r.lat, top + 1),
        point: { pixelSize: 7, color: ROOF, outlineColor: Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: i < 12 ? { ...label(`${Math.round(r.distanceM)} m · roof ${Math.round(r.heightM)} m`), font: '600 11px "Segoe UI", sans-serif' } : undefined,
      });
      // Sight lines for the nearest roofs: dashed, from the subject's eye to the eye of a person on that roof.
      if (s.subjectEye && i < 12)
        ents.add({
          id: `plan|sight|${i}`,
          polyline: {
            positions: [Cartesian3.fromDegrees(s.subjectEye.lon, s.subjectEye.lat, s.subjectEye.heightM), Cartesian3.fromDegrees(r.lon, r.lat, top + 1.5)],
            width: 1.5,
            material: new PolylineDashMaterialProperty({ color: ROOF.withAlpha(0.9), dashLength: 12 }),
            depthFailMaterial: new PolylineDashMaterialProperty({ color: ROOF.withAlpha(0.35), dashLength: 12 }),
          },
        });
    });
  }

  private addRoutes(s: PlanOverlayState): void {
    const ents = this.source.entities;
    // Unselected options first, so the selected one draws on top.
    const opts = (s.routeOptions ?? []).map((o, i) => ({ o, i })).sort((a, b) => Number(a.o.selected) - Number(b.o.selected));
    const siteLook = s.look === 'site';
    for (const { o, i } of opts) {
      if (o.points.length < 2) continue;
      // Site view: the chosen route in white, the others faint; numbers and colours stay in the panel.
      const c = siteLook ? (o.selected ? Color.WHITE : Color.WHITE.withAlpha(0.55)) : Color.fromCssColorString(o.color);
      ents.add({ id: `plan|routeopt|${i}`, polyline: { positions: Cartesian3.fromDegreesArray(o.points.flat()), width: o.selected ? 6 : 3.5, clampToGround: true, material: c.withAlpha(o.selected ? 0.95 : 0.6) } });
    }
    const ends = s.routeEnds;
    for (const [end, at] of [['a', ends?.a], ['b', ends?.b]] as const) {
      if (!at) continue;
      ents.add({
        id: `plan|route|${end}`,
        position: Cartesian3.fromDegrees(at.lon, at.lat),
        point: { pixelSize: 13, color: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: siteLook ? { ...boxLabel(end === 'a' ? 'Start' : 'Destination'), pixelOffset: new Cartesian2(0, 14) } : { ...label(end === 'a' ? 'Start' : 'Destination'), translucencyByDistance: undefined },
      });
    }
  }

  private addFloorPlan(fp: FloorPlan): void {
    const key = `${fp.lat.toFixed(6)},${fp.lon.toFixed(6)}`;
    const ground = this.groundAt.get(key);
    if (ground === undefined) {
      // Floor height is relative to the surface at the plan's centre, resolved exactly as the analysis and the
      // camera resolve it (mapped sea = sea level; other below-sea-level or missing terrain = unavailable).
      this.groundAt.set(key, Number.NaN);
      void groundHeightAt(fp.lat, fp.lon)
        .then((g) => {
          this.groundAt.set(key, g);
          if (g === null)
            // unavailable: not drawn, retried later
            setTimeout(() => {
              if (this.groundAt.get(key) === null) this.groundAt.delete(key);
              if (!this.destroyed && this.last) this.update(this.last);
            }, 30_000);
        })
        .finally(() => !this.destroyed && this.last && this.update(this.last));
      return;
    }
    if (ground === null || Number.isNaN(ground)) return; // still sampling, or terrain height unavailable
    const dLat = fp.heightM / 2 / 111_320;
    const dLon = fp.widthM / 2 / (111_320 * Math.cos(CMath.toRadians(fp.lat)));
    const rot = CMath.toRadians(-fp.rotationDeg);
    this.source.entities.add({
      id: `plan|floor|${fp.id}`,
      rectangle: {
        coordinates: Rectangle.fromDegrees(fp.lon - dLon, fp.lat - dLat, fp.lon + dLon, fp.lat + dLat),
        height: ground + fp.elevationM,
        rotation: rot,
        stRotation: rot,
        material: new ImageMaterialProperty({ image: fp.image, transparent: true, color: Color.WHITE.withAlpha(fp.opacity) }),
      },
    });
  }

  private setCoverage(c: PlanOverlayState['coverage'], opacity: number): void {
    const layers = this.widget.imageryLayers;
    if (!c) {
      if (this.coverageLayer) layers.remove(this.coverageLayer, true);
      this.coverageLayer = null;
      this.coverageKey = null;
      return;
    }
    if (this.coverageLayer && this.coverageKey === c.rgba) {
      this.coverageLayer.alpha = opacity;
      return;
    }
    if (this.coverageLayer) layers.remove(this.coverageLayer, true);
    const { west, south, east, north } = c.bounds;
    this.coverageLayer = layers.addImageryProvider(new SingleTileImageryProvider({ url: rgbaToDataUrl(c.rgba, c.n), rectangle: Rectangle.fromDegrees(west, south, east, north), tileWidth: c.n, tileHeight: c.n }));
    this.coverageLayer.alpha = opacity;
    // Kept at full brightness when the site view dims the map.
    (this.coverageLayer as unknown as { atlasPlanCoverage: boolean }).atlasPlanCoverage = true;
    // The picture is traced finer than the cells (sub-metre pixels), so linear sampling only softens pixel steps
    // when zoomed right in; it does not blend whole cells.
    this.coverageLayer.magnificationFilter = TextureMagnificationFilter.LINEAR;
    this.coverageLayer.minificationFilter = TextureMinificationFilter.LINEAR;
    this.coverageKey = c.rgba;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.widget.isDestroyed()) return;
    this.setCoverage(null, 0);
    void this.widget.dataSources.remove(this.source, true);
  }
}
