import { CLASS_DEFAULTS, VESSEL_DEFAULTS, aircraftShape, aircraftVariant, vesselShape } from '../../shared/vehicleDims';
import { packForAircraft, packForVessel, packScale, type ModelPack, type PackModel } from '../../shared/modelPack';
import { buildAircraft, buildVessel, type VehicleModelSpec } from './vehicleMeshes';
import { packModelUrl } from './modelPack';

export interface VehicleAppearance {
  variant: string;
  url?: string;
  spec?: () => VehicleModelSpec;
  scale: [number, number, number];
  lengthM: number;
  widthM: number;
  pack: PackModel | null;
}

function packed(model: PackModel, lengthM: number, widthM: number, uniform = false): VehicleAppearance {
  const sx = lengthM / model.lengthM;
  return { variant: 'pack:' + model.id, pack: model, url: packModelUrl(model),
    scale: uniform ? [sx, sx, sx] : packScale(model, lengthM, widthM), lengthM, widthM };
}

export function aircraftAppearance(pack: ModelPack | null, type: string | null, category: string | null,
  military: boolean, failed: (variant: string) => boolean): VehicleAppearance {
  const shape = aircraftShape(type, category, military);
  const model = packForAircraft(pack, type, military);
  // A parked two-blade rotor may point fore and aft. Its mesh width is then the cabin, not the rotor diameter.
  if (model && !failed('pack:' + model.id)) return packed(model, shape.lengthM, shape.spanM, shape.cls === 'helicopter');
  const base = CLASS_DEFAULTS[shape.cls];
  const sx = shape.lengthM / base.lengthM;
  return { variant: aircraftVariant(shape), spec: () => buildAircraft(shape), pack: null,
    scale: [sx, shape.spanM / base.spanM, sx], lengthM: shape.lengthM, widthM: shape.spanM };
}

export function vesselAppearance(pack: ModelPack | null, shipType: number | null, lengthM: unknown,
  beamM: unknown, failed: (variant: string) => boolean): VehicleAppearance {
  const shape = vesselShape(shipType, lengthM, beamM);
  const model = packForVessel(pack, shape.cls);
  if (model && !failed('pack:' + model.id)) return packed(model, shape.lengthM, shape.beamM);
  const base = VESSEL_DEFAULTS[shape.cls];
  const sx = shape.lengthM / base.lengthM, sy = shape.beamM / base.beamM;
  return { variant: 'sea:' + shape.cls, spec: () => buildVessel(shape.cls), pack: null,
    scale: [sx, sy, (sx + sy) / 2], lengthM: shape.lengthM, widthM: shape.beamM };
}
