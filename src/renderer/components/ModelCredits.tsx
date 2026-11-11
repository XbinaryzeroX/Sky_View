import { useEffect, useState } from 'react';
import { loadModelPack } from '../map/modelPack';
import type { ModelPack } from '../../shared/modelPack';

/** Attribution for the 3D vehicle models in the model pack (CC BY requires the author, licence, source and changes). */
export function ModelCredits() {
  const [pack, setPack] = useState<ModelPack | null>(null);
  useEffect(() => {
    let alive = true;
    void loadModelPack().then((p) => {
      if (alive) setPack(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!pack?.models.length) return null;
  return (
    <div className="model-credits">
      <h3 className="sub">3D vehicle models (from Sketchfab)</h3>
      <ul className="small">
        {pack.models.map((m) => (
          <li key={m.id}>
            <a href={m.sourceUrl} target="_blank" rel="noreferrer">
              {m.title}
            </a>{' '}
            by {m.author} ·{' '}
            <a href={m.licenseUrl} target="_blank" rel="noreferrer">
              {m.license}
            </a>
          </li>
        ))}
      </ul>
      <p className="muted small">Converted for Atlas Watch: re-oriented, scaled, simplified, textures resized. Each model stands for its aircraft type or ship category; paint and details may differ from the real vehicle.</p>
    </div>
  );
}
