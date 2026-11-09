// Display styles applied as post-processing over the rendered image.
// These are VISUAL EFFECTS ONLY: "thermal" maps on-screen brightness to a
// color ramp; it is not thermal sensor data. "Night vision" is a green tint.

import { PostProcessStage, type Scene } from 'cesium';

export type VisualMode = 'normal' | 'crt' | 'nvg' | 'thermal' | 'anime' | 'noir' | 'snow';

export const VISUAL_MODE_LABEL: Record<VisualMode, string> = {
  normal: 'Normal',
  crt: 'CRT',
  nvg: 'NVG',
  thermal: 'FLIR',
  anime: 'Anime',
  noir: 'Noir',
  snow: 'Snow',
};

/** What each display style actually does (shown in the Style tab). */
export const VISUAL_MODE_NOTE: Record<VisualMode, string> = {
  normal: 'Unfiltered imagery and data.',
  crt: 'Scanlines and a vignette, like an old monitor.',
  nvg: 'Green monochrome look. It is not night-vision sensor data.',
  thermal: 'Maps on-screen brightness to a heat-style color ramp. It is not thermal (FLIR) sensor data: bright = light-colored, not hot.',
  anime: 'Flattened colors with dark edges (cel-shaded look).',
  noir: 'High-contrast grayscale.',
  snow: 'Cold, whitened palette. It does not show observed snow cover (use Imagery → Water / ice for that).',
};

const HEAD = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const SHADERS: Record<Exclude<VisualMode, 'normal'>, string> = {
  nvg: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = pow(luma(c), 0.8) * 1.35;
  float n = fract(sin(dot(v_textureCoordinates * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 d = v_textureCoordinates - 0.5;
  float vig = smoothstep(0.85, 0.35, length(d));
  out_FragColor = vec4(vec3(0.1, 1.0, 0.25) * (l * 0.92 + n * 0.08) * vig, 1.0);
}`,
  thermal: `${HEAD}
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0, 0.0, 0.0), b = vec3(0.35, 0.0, 0.55), c = vec3(0.9, 0.15, 0.1), d = vec3(1.0, 0.75, 0.0), e = vec3(1.0, 1.0, 0.9);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  out_FragColor = vec4(ramp(luma(c) * 1.1), 1.0);
}`,
  crt: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float scan = 0.82 + 0.18 * sin(v_textureCoordinates.y * 900.0);
  vec2 d = v_textureCoordinates - 0.5;
  float vig = smoothstep(0.9, 0.4, length(d));
  out_FragColor = vec4(c * scan * vig * vec3(0.95, 1.05, 1.0), 1.0);
}`,
  anime: `${HEAD}
void main() {
  vec2 px = 1.0 / vec2(textureSize(colorTexture, 0));
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l0 = luma(c);
  float gx = luma(texture(colorTexture, v_textureCoordinates + vec2(px.x, 0.0)).rgb) - luma(texture(colorTexture, v_textureCoordinates - vec2(px.x, 0.0)).rgb);
  float gy = luma(texture(colorTexture, v_textureCoordinates + vec2(0.0, px.y)).rgb) - luma(texture(colorTexture, v_textureCoordinates - vec2(0.0, px.y)).rgb);
  float edge = smoothstep(0.12, 0.3, length(vec2(gx, gy)));
  vec3 q = floor(c * 5.0 + 0.5) / 5.0;
  q = mix(vec3(l0), q, 1.35);
  out_FragColor = vec4(mix(clamp(q, 0.0, 1.0), vec3(0.05, 0.05, 0.1), edge * 0.85), 1.0);
}`,
  snow: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = luma(c);
  vec3 cold = mix(vec3(l), c, 0.35) * vec3(0.92, 0.98, 1.08);
  out_FragColor = vec4(clamp(mix(cold, vec3(0.93, 0.96, 1.0), 0.35 + 0.25 * smoothstep(0.2, 0.7, l)), 0.0, 1.0), 1.0);
}`,
  noir: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = smoothstep(0.08, 0.9, luma(c));
  out_FragColor = vec4(vec3(l), 1.0);
}`,
};

/** Replaces the current visual-mode stage; returns the new stage (or null for normal). */
export function applyVisualMode(scene: Scene, current: PostProcessStage | null, mode: VisualMode): PostProcessStage | null {
  if (current) {
    scene.postProcessStages.remove(current);
  }
  if (mode === 'normal') return null;
  const stage = new PostProcessStage({ fragmentShader: SHADERS[mode], name: `atlas-visual-${mode}` });
  scene.postProcessStages.add(stage);
  return stage;
}
