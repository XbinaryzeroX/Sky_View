// Stylized window façades for OSM building extrusions.
//
// DECORATIVE ONLY: the window grid is generated from each wall's size (about
// 3.2 m bays, 3.4 m floors, solid ground floor). It is not derived from the
// real building and must not be read as its appearance, window count or
// floor count. Settings → "Stylized window façades" turns it off.
//
// Walls are built per tile as one custom geometry whose texture coordinates
// are in metres (s = distance along the wall, t = height above ground), so the
// shader can draw evenly spaced windows on any wall length. The pattern fades
// to an average tone with distance (screen-space derivatives) to avoid moiré.

import {
  Appearance,
  BoundingSphere,
  Cartesian3,
  Color,
  ComponentDatatype,
  Ellipsoid,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  Primitive,
  PrimitiveType,
} from 'cesium';

const VS = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();
    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_st = st;
    v_color = color;
    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const FS = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec2 v_st;
in vec4 v_color;

float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main()
{
    vec3 positionToEyeEC = -v_positionEC;
    vec3 normalEC = normalize(v_normalEC);
    // Wall normals follow ring winding; light the side that faces the viewer.
    if (dot(normalEC, positionToEyeEC) < 0.0) normalEC = -normalEC;

    vec2 g = vec2(v_st.x / 3.2, v_st.y / 3.4);   // bays, floors
    vec2 f = fract(g);
    vec2 cell = floor(g);
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.30, f.y) * step(f.y, 0.80);
    win *= step(1.0, cell.y);                      // solid ground floor
    vec2 w = fwidth(g);
    float detail = 1.0 - smoothstep(0.22, 0.55, max(w.x, w.y));

    float shade = facadeHash(cell + v_color.rg * 37.0);
    vec3 glass = mix(vec3(0.10, 0.13, 0.18), vec3(0.30, 0.37, 0.46), shade);
    vec3 wall = v_color.rgb;
    vec3 far = mix(wall, vec3(0.18, 0.22, 0.28), 0.28);   // average tone when windows are too small to draw
    vec3 diffuse = mix(far, mix(wall, glass, win), detail);

    czm_materialInput materialInput;
    materialInput.normalEC = normalEC;
    materialInput.positionToEyeEC = positionToEyeEC;
    czm_material material = czm_getDefaultMaterial(materialInput);
    material.diffuse = czm_gammaCorrect(vec4(diffuse, 1.0)).rgb;
    material.specular = win * detail * 0.25;
    material.shininess = 20.0;
    material.alpha = 1.0;
    out_FragColor = czm_phong(normalize(positionToEyeEC), material, czm_lightDirectionEC);
}
`;

let appearance: Appearance | null = null;
function facadeAppearance(): Appearance {
  appearance ??= new Appearance({
    vertexShaderSource: VS,
    fragmentShaderSource: FS,
    translucent: false,
    closed: false,
    renderState: { depthTest: { enabled: true }, depthMask: true },
  });
  return appearance;
}

/** Accumulates the walls of many buildings into one geometry. */
export class FacadeBatch {
  private pos: number[] = [];
  private nrm: number[] = [];
  private st: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private readonly up = new Cartesian3();
  walls = 0;

  /** Adds the walls of one ring ([lon, lat] in degrees, closed or open) between two absolute heights. */
  addRing(ring: [number, number][], bottom: number, top: number, color: Color, groundOffset: number): void {
    if (ring.length < 3 || !(top > bottom)) return;
    const pts = ring.map(([lon, lat]) => [Cartesian3.fromDegrees(lon, lat, bottom), Cartesian3.fromDegrees(lon, lat, top)] as const);
    const closed = Cartesian3.equalsEpsilon(pts[0][0], pts[pts.length - 1][0], 0, 0.01);
    const n = closed ? pts.length - 1 : pts.length;
    let s = 0;
    const r = Math.round(color.red * 255);
    const g = Math.round(color.green * 255);
    const b = Math.round(color.blue * 255);
    const t0 = bottom - groundOffset;
    const t1 = top - groundOffset;
    for (let i = 0; i < n; i++) {
      const [a0, a1] = pts[i];
      const [b0, b1] = pts[(i + 1) % pts.length];
      const len = Cartesian3.distance(a0, b0);
      if (len < 0.05) continue;
      Ellipsoid.WGS84.geodeticSurfaceNormal(a0, this.up);
      const along = Cartesian3.normalize(Cartesian3.subtract(b0, a0, new Cartesian3()), new Cartesian3());
      const normal = Cartesian3.normalize(Cartesian3.cross(along, this.up, new Cartesian3()), new Cartesian3());
      const base = this.pos.length / 3;
      for (const [p, ss, tt] of [
        [a0, s, t0],
        [b0, s + len, t0],
        [a1, s, t1],
        [b1, s + len, t1],
      ] as const) {
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(normal.x, normal.y, normal.z);
        this.st.push(ss, tt);
        this.col.push(r, g, b, 255);
      }
      this.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
      s += len;
      this.walls++;
    }
  }

  /** One primitive for all walls, or null if there are none. */
  build(): Primitive | null {
    if (this.idx.length === 0) return null;
    const positions = new Float64Array(this.pos);
    const geometry = new Geometry({
      attributes: {
        position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
        normal: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(this.nrm) }),
        st: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(this.st) }),
        color: new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(this.col) }),
      } as never,
      indices: positions.length / 3 > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positions as unknown as number[]),
    });
    return new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: facadeAppearance(),
      // Pre-built geometry cannot be sent to Cesium's geometry workers.
      asynchronous: false,
      compressVertices: false,
      allowPicking: false,
      releaseGeometryInstances: true,
    });
  }
}
