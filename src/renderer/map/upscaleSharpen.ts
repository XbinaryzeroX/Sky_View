// Sharpening pass used when the globe is drawn below full resolution (see shared/renderScale.ts). The filter
// is contrast-adaptive: it strengthens edges less where the neighbourhood is already near black or white, so
// it does not ring on coastlines and labels. It runs on the reduced image; the window then stretches it.

import { PostProcessStage, type Scene } from 'cesium';

const SHADER = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main() {
  vec2 px = 1.0 / czm_viewport.zw;
  vec4 centre = texture(colorTexture, v_textureCoordinates);
  vec3 c = centre.rgb;
  vec3 n = texture(colorTexture, v_textureCoordinates + vec2(0.0, px.y)).rgb;
  vec3 s = texture(colorTexture, v_textureCoordinates - vec2(0.0, px.y)).rgb;
  vec3 e = texture(colorTexture, v_textureCoordinates + vec2(px.x, 0.0)).rgb;
  vec3 w = texture(colorTexture, v_textureCoordinates - vec2(px.x, 0.0)).rgb;
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  vec3 amount = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, vec3(0.0001)), 0.0, 1.0));
  vec3 weight = amount * (-1.0 / 6.0);
  out_FragColor = vec4(clamp((c + (n + s + e + w) * weight) / (1.0 + 4.0 * weight), 0.0, 1.0), centre.a);
}`;

/** Adds or removes the sharpening stage; returns the stage now in use (null when off). */
export function applyUpscaleSharpen(scene: Scene, current: PostProcessStage | null, on: boolean): PostProcessStage | null {
  if (on === !!current) return current;
  if (current) {
    scene.postProcessStages.remove(current);
    return null;
  }
  const stage = new PostProcessStage({ fragmentShader: SHADER, name: 'atlas-upscale-sharpen' });
  scene.postProcessStages.add(stage);
  return stage;
}
