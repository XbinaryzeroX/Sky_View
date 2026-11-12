import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelPack } from '../../shared/modelPack';
import { currentModelPack, loadModelPack } from '../map/modelPack';
import { aircraftAppearance, vesselAppearance } from '../map/vehicleAppearance';

/** Keep the preview and its viewing angle through feed refreshes that leave the vehicle's shape unchanged. */
export function useVehiclePreview(kind: 'aircraft' | 'ship', type: string | null, category: string | null,
  military: boolean, shipType: number | null = null, lengthM?: unknown, beamM?: unknown) {
  const [pack, setPack] = useState<ModelPack | null>(currentModelPack);
  const [failedVariants, setFailedVariants] = useState<string[]>([]);
  useEffect(() => {
    let mounted = true;
    void loadModelPack().then(value => { if (mounted) setPack(value); });
    return () => { mounted = false; };
  }, []);
  const model = useMemo(() => {
    const failed = (variant: string) => failedVariants.includes(variant);
    const appearance = kind === 'ship' ? vesselAppearance(pack, shipType, lengthM, beamM, failed)
      : aircraftAppearance(pack, type, category, military, failed);
    return failed(appearance.variant) ? null : appearance;
  }, [kind, type, category, military, shipType, lengthM, beamM, pack, failedVariants]);
  const onError = useCallback(() => {
    if (model) setFailedVariants(current => current.includes(model.variant) ? current : [...current, model.variant]);
  }, [model]);
  return { model, onError };
}
