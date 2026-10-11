import * as THREE from "three";
import {
  defaultGear,
  moodFor,
  presetFor,
  type Gear,
  type Instrument,
  type Look,
  type Mood,
  type Preset,
} from "../core/avatars";
// The band on stage: chibi 3D performers in a comic-book style (toon bands,
// halftone shadows, ink outlines). Poses are computed 30 times a second and the
// stage renders only then, on its own small canvas, so it costs little next to
// the highway. Arms are two-bone chains that reach for real targets: the fret
// for the note just hit, the strings, or the drum that matches the note.
const STEP = 1 / 30;
const INK = new THREE.Vector3(0.03, 0.02, 0.06);
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  );
};
const toonVertex = /* glsl */ `
  varying vec3 vN; varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const toonFragment = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uRim; uniform float uDots; uniform float uGlow;
  varying vec3 vN; varying vec3 vView;
  void main() {
    vec3 n = normalize(vN);
    float d = dot(n, normalize(vec3(-0.4, 0.8, 0.6)));
    // Three flat bands instead of smooth shading.
    float band = d > 0.42 ? 1.0 : d > -0.12 ? 0.74 : 0.5;
    vec3 col = uColor * band;
    // Screen-space halftone dots, denser where the form turns away.
    vec2 cell = fract(gl_FragCoord.xy / uDots) - 0.5;
    float shade = clamp(0.5 - d, 0.0, 1.0);
    if (d < 0.42 && length(cell) < shade * 0.55) col *= 0.62;
    // Hard rim light from the stage lights behind.
    float rim = 1.0 - max(dot(n, normalize(vView)), 0.0);
    col += uRim * step(0.62, rim) * 0.75;
    if (d > 0.88) col += 0.07;
    gl_FragColor = vec4(col + uRim * uGlow * step(0.45, rim) * 0.25, 1.0);
  }`;
const outlineVertex = /* glsl */ `
  uniform float uWidth;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uWidth, 1.0);
  }`;
const outlineFragment = /* glsl */ `
  uniform vec3 uInk;
  void main() { gl_FragColor = vec4(uInk, 1.0); }`;
type Shared = {
  rim: { value: THREE.Vector3 };
  dots: { value: number };
  glow: { value: number };
};
function materials(shared: Shared) {
  const cache = new Map<string, THREE.ShaderMaterial>();
  const outline = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: 0.035 }, uInk: { value: INK } },
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  });
  return {
    outline,
    toon(hex: string) {
      let m = cache.get(hex);
      if (!m) {
        m = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: rgb(hex) },
            uRim: shared.rim,
            uDots: shared.dots,
            uGlow: shared.glow,
          },
          vertexShader: toonVertex,
          fragmentShader: toonFragment,
        });
        cache.set(hex, m);
      }
      return m;
    },
    dispose() {
      cache.forEach((m) => m.dispose());
      outline.dispose();
    },
  };
}
type Mats = ReturnType<typeof materials>;
/** A toon mesh with its ink outline. */
function part(
  mats: Mats,
  geometry: THREE.BufferGeometry,
  color: string,
  outlined = true,
) {
  const mesh = new THREE.Mesh(geometry, mats.toon(color));
  if (outlined) mesh.add(new THREE.Mesh(geometry, mats.outline));
  return mesh;
}
const sphere = (r: number) => new THREE.SphereGeometry(r, 18, 14);
const capsule = (r: number, l: number) =>
  new THREE.CapsuleGeometry(r, l, 4, 12);
const cylinder = (rt: number, rb: number, h: number) =>
  new THREE.CylinderGeometry(rt, rb, h, 18);
// Faces are drawn on a canvas and wrapped on the front of the head, one texture
// per expression, so changing mood only swaps a texture.
type Face = Mood | "blink";
function drawFace(face: Face, photo?: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  const ink = "#160d1c";
  g.lineCap = g.lineJoin = "round";
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = 9;
  if (photo) {
    g.save();
    g.beginPath();
    g.ellipse(128, 80, 92, 78, 0, 0, Math.PI * 2);
    g.clip();
    const side = Math.min(photo.width, photo.height);
    g.drawImage(
      photo,
      (photo.width - side) / 2,
      (photo.height - side) / 2,
      side,
      side,
      36,
      -12,
      184,
      184,
    );
    g.restore();
    g.beginPath();
    g.ellipse(128, 80, 92, 78, 0, 0, Math.PI * 2);
    g.lineWidth = 7;
    g.strokeStyle = "#ff2e88";
    g.stroke();
  }
  const eye = (x: number) => {
    if (photo) return;
    if (face === "blink") {
      g.beginPath();
      g.moveTo(x - 20, 64);
      g.quadraticCurveTo(x, 72, x + 20, 64);
      g.stroke();
    } else if (face === "hyped") {
      g.beginPath();
      g.moveTo(x - 20, 70);
      g.quadraticCurveTo(x, 44, x + 20, 70);
      g.stroke();
    } else if (face === "miss") {
      // Dizzy spiral eyes.
      g.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const r = 2 + a * 1.4;
        g.lineTo(x + Math.cos(a) * r, 62 + Math.sin(a) * r);
      }
      g.lineWidth = 5;
      g.stroke();
      g.lineWidth = 9;
    } else if (face === "power") {
      g.fillStyle = "#ffe03a";
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 11 : 26,
          a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(x + Math.cos(a) * r, 62 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.lineWidth = 4;
      g.stroke();
      g.lineWidth = 9;
      g.fillStyle = ink;
    } else {
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(x, 62, 19, 24, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = ink;
      g.beginPath();
      g.ellipse(x + 3, 66, 11, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(x + 7, 59, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ink;
      g.lineWidth = 9;
    }
  };
  eye(90);
  eye(166);
  if (!photo) {
    // Blush.
    g.fillStyle = "#ff7aa877";
    g.beginPath();
    g.ellipse(64, 96, 16, 9, 0, 0, Math.PI * 2);
    g.ellipse(192, 96, 16, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink;
    g.beginPath();
    if (face === "miss") {
      // Wobbly "oops" mouth.
      g.moveTo(100, 112);
      for (let x = 100; x <= 156; x += 4)
        g.lineTo(x, 112 + Math.sin((x - 100) / 5) * 5);
      g.lineWidth = 6;
      g.stroke();
    } else if (face === "power") {
      g.ellipse(128, 112, 22, 26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ff5a6e";
      g.beginPath();
      g.ellipse(128, 124, 12, 8, 0, 0, Math.PI * 2);
      g.fill();
    } else if (face === "hyped") {
      g.moveTo(96, 100);
      g.quadraticCurveTo(128, 146, 160, 100);
      g.closePath();
      g.fill();
      g.fillStyle = "#ff5a6e";
      g.beginPath();
      g.ellipse(136, 120, 11, 9, 0.3, 0, Math.PI * 2);
      g.fill();
    } else {
      g.moveTo(108, 104);
      g.quadraticCurveTo(128, 120, 148, 104);
      g.lineWidth = 7;
      g.stroke();
    }
  } else {
    // Photo faces keep the person's own face; comic marks add the mood.
    g.lineWidth = 6;
    if (face === "miss") {
      g.fillStyle = "#7fd8ff";
      g.beginPath();
      g.moveTo(222, 20);
      g.quadraticCurveTo(240, 50, 222, 56);
      g.quadraticCurveTo(204, 50, 222, 20);
      g.fill();
      g.stroke();
    } else if (face === "power" || face === "hyped") {
      g.fillStyle = face === "power" ? "#ffe03a" : "#ff7aa8";
      for (const [x, y] of [
        [26, 30],
        [230, 26],
        [236, 132],
      ]) {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 6 : 14,
            a = -Math.PI / 2 + (i * Math.PI) / 5;
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function hair(mats: Mats, p: Preset) {
  const g = new THREE.Group();
  const c = p.hair;
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (p.style) {
    case "spikes":
      for (let i = 0; i < 7; i++) {
        const a = -1.1 + (i * 2.2) / 6;
        const s = add(
          part(mats, new THREE.ConeGeometry(0.2, 0.62, 8), c),
          Math.sin(a) * 0.5,
          0.62,
          -0.05 + Math.cos(a) * 0.1,
        );
        s.rotation.z = -a * 0.7;
      }
      add(part(mats, sphere(0.74), c, false), 0, 0.14, -0.08).scale.set(
        1,
        0.72,
        1,
      );
      break;
    case "mohawk":
      for (let i = 0; i < 5; i++) {
        const s = add(
          part(mats, new THREE.ConeGeometry(0.16, 0.7, 8), c),
          0,
          0.72 - Math.abs(i - 2) * 0.06,
          0.4 - i * 0.22,
        );
        s.rotation.x = -0.5 + i * 0.25;
      }
      break;
    case "long":
      add(part(mats, sphere(0.8), c), 0, 0.1, -0.12).scale.set(1, 0.85, 1);
      add(part(mats, capsule(0.62, 0.7), c), 0, -0.5, -0.3).scale.set(
        1.05,
        1,
        0.55,
      );
      break;
    case "bob":
      add(part(mats, sphere(0.82), c), 0, 0.02, -0.1).scale.set(1.05, 0.9, 1);
      break;
    case "buzz":
      add(part(mats, sphere(0.77), c), 0, 0.18, -0.05).scale.set(1, 0.65, 1);
      break;
    case "afro":
      add(part(mats, sphere(0.98), c), 0, 0.4, -0.42);
      break;
    case "bun":
      add(part(mats, sphere(0.77), c), 0, 0.16, -0.06).scale.set(1, 0.7, 1);
      add(part(mats, sphere(0.32), c), 0, 0.86, -0.12);
      break;
    case "cap": {
      add(part(mats, sphere(0.78), c), 0, 0.2, -0.02).scale.set(1, 0.6, 1);
      const brim = add(part(mats, cylinder(0.55, 0.55, 0.06), c), 0, 0.3, 0.6);
      brim.scale.set(1, 1, 0.6);
      break;
    }
    case "pony":
      add(part(mats, sphere(0.77), c), 0, 0.16, -0.06).scale.set(1, 0.7, 1);
      add(part(mats, capsule(0.24, 0.8), c), 0.05, -0.15, -0.85).rotation.x =
        0.5;
      break;
    case "swoop": {
      add(part(mats, sphere(0.77), c), 0, 0.18, -0.06).scale.set(1, 0.68, 1);
      const s = add(part(mats, capsule(0.3, 0.7), c), 0.2, 0.5, 0.35);
      s.rotation.z = 1.2;
      break;
    }
  }
  return g;
}
function extra(mats: Mats, p: Preset) {
  const g = new THREE.Group();
  if (p.extra === "shades") {
    for (const x of [-0.27, 0.27]) {
      const lens = part(
        mats,
        new THREE.BoxGeometry(0.42, 0.26, 0.08),
        "#07060b",
        false,
      );
      lens.position.set(x, 0.16, 0.66);
      g.add(lens);
    }
  } else if (p.extra === "visor") {
    const v = part(
      mats,
      new THREE.TorusGeometry(0.72, 0.07, 6, 24, Math.PI),
      p.accent,
    );
    v.position.set(0, 0.17, 0.1);
    v.rotation.x = Math.PI / 2;
    g.add(v);
  } else if (p.extra === "headphones") {
    const band = part(
      mats,
      new THREE.TorusGeometry(0.8, 0.07, 6, 24, Math.PI),
      "#14121c",
    );
    band.position.y = 0.05;
    g.add(band);
    for (const x of [-0.8, 0.8]) {
      const cup = part(mats, cylinder(0.24, 0.24, 0.2), p.accent);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(x, 0, 0);
      g.add(cup);
    }
  } else if (p.extra === "bandana") {
    const b = part(mats, new THREE.TorusGeometry(0.74, 0.08, 6, 28), p.accent);
    b.rotation.x = Math.PI / 2 - 0.25;
    b.position.y = 0.3;
    g.add(b);
  }
  return g;
}
// Guitar bodies: outlines in the guitar's plane, neck pointing to +x. Rounded
// styles pass through a spline; the Arrow keeps its points sharp.
const OUTLINES: Record<string, [number, number][]> = {
  "classic-s": [
    [0.42, 0.12],
    [0.6, 0.3],
    [0.66, 0.42],
    [0.52, 0.42],
    [0.3, 0.3],
    [0.05, 0.35],
    [-0.3, 0.46],
    [-0.56, 0.34],
    [-0.63, 0],
    [-0.56, -0.34],
    [-0.3, -0.46],
    [0.05, -0.36],
    [0.3, -0.3],
    [0.5, -0.34],
    [0.54, -0.24],
    [0.42, -0.12],
  ],
  "classic-t": [
    [0.42, 0.12],
    [0.3, 0.3],
    [0.0, 0.36],
    [-0.35, 0.42],
    [-0.58, 0.3],
    [-0.62, 0],
    [-0.58, -0.3],
    [-0.35, -0.44],
    [0.05, -0.38],
    [0.35, -0.36],
    [0.52, -0.3],
    [0.5, -0.18],
    [0.42, -0.12],
  ],
  "single-cut": [
    [0.42, 0.12],
    [0.32, 0.32],
    [0.05, 0.33],
    [-0.25, 0.45],
    [-0.56, 0.36],
    [-0.67, 0],
    [-0.56, -0.4],
    [-0.2, -0.49],
    [0.15, -0.4],
    [0.42, -0.35],
    [0.52, -0.26],
    [0.46, -0.14],
  ],
  "double-cut": [
    [0.42, 0.12],
    [0.56, 0.28],
    [0.56, 0.4],
    [0.38, 0.36],
    [0.1, 0.37],
    [-0.3, 0.46],
    [-0.6, 0.32],
    [-0.66, 0],
    [-0.6, -0.32],
    [-0.3, -0.46],
    [0.1, -0.37],
    [0.36, -0.34],
    [0.54, -0.38],
    [0.58, -0.26],
    [0.42, -0.12],
  ],
  arrow: [
    [0.42, 0.12],
    [-0.72, 0.56],
    [-0.82, 0.4],
    [-0.28, 0],
    [-0.82, -0.4],
    [-0.72, -0.56],
    [0.42, -0.12],
  ],
};
function outline(style: string, scale = 1) {
  const pts = (OUTLINES[style] ?? OUTLINES["classic-s"]).map(
    ([x, y]) => new THREE.Vector2(x * scale, y * scale),
  );
  return new THREE.Shape(
    style === "arrow"
      ? pts
      : new THREE.SplineCurve([...pts, pts[0]]).getPoints(72),
  );
}
const light = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 520;
};
type GuitarInfo = { neckStart: number; neckLength: number };
function guitar(mats: Mats, style: string, finish: string, bass: boolean) {
  const g = new THREE.Group();
  const scale = bass ? 1.12 : 1;
  const depth = 0.14;
  const body = new THREE.ExtrudeGeometry(outline(style, scale), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 2,
    curveSegments: 4,
  });
  body.translate(0, 0, -depth / 2);
  g.add(part(mats, body, finish));
  // Pickguard on the slab styles, a smaller echo of the body.
  if (
    style === "classic-s" ||
    style === "classic-t" ||
    style === "double-cut"
  ) {
    const guard = new THREE.ShapeGeometry(outline(style, scale * 0.66));
    const mesh = new THREE.Mesh(
      guard,
      mats.toon(light(finish) ? "#14121c" : "#f5f0ff"),
    );
    mesh.position.set(0.12, -0.05, depth / 2 + 0.04);
    g.add(mesh);
  }
  const pickups = style === "classic-s" ? 3 : 2;
  for (let i = 0; i < pickups; i++) {
    const p = part(
      mats,
      new THREE.BoxGeometry(0.08, 0.24, 0.04),
      "#14121c",
      false,
    );
    p.position.set(0.2 - i * 0.17, 0, depth / 2 + 0.06);
    g.add(p);
  }
  const bridge = part(
    mats,
    new THREE.BoxGeometry(0.07, 0.3, 0.05),
    "#c9c4d6",
    false,
  );
  bridge.position.set(-0.32, 0, depth / 2 + 0.06);
  g.add(bridge);
  for (let i = 0; i < (style === "single-cut" ? 4 : 2); i++) {
    const k = part(mats, cylinder(0.04, 0.04, 0.05), "#ffe03a", false);
    k.rotation.x = Math.PI / 2;
    k.position.set(
      -0.28 - (i % 2) * 0.13,
      -0.28 - Math.floor(i / 2) * 0.1,
      depth / 2 + 0.05,
    );
    g.add(k);
  }
  const neckStart = 0.4 * scale,
    neckLength = bass ? 2.05 : 1.55;
  const neck = part(
    mats,
    new THREE.BoxGeometry(neckLength, 0.15, 0.09),
    "#c98e5a",
  );
  neck.position.set(neckStart + neckLength / 2, 0, 0);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(neckLength, 0.15, 0.02),
    mats.toon("#2b1a12"),
  );
  board.position.set(neckStart + neckLength / 2, 0, 0.055);
  g.add(neck, board);
  // Headstock: a paddle with inline pegs on the S/T styles, wider otherwise.
  const inline = style === "classic-s" || style === "classic-t";
  const headstock = part(
    mats,
    new THREE.BoxGeometry(inline ? 0.42 : 0.32, inline ? 0.16 : 0.26, 0.08),
    style === "arrow" ? finish : "#2b1a12",
  );
  headstock.position.set(
    neckStart + neckLength + (inline ? 0.2 : 0.15),
    inline ? 0.05 : 0,
    0,
  );
  headstock.rotation.z = inline ? 0.08 : 0;
  g.add(headstock);
  const strings = bass ? 4 : 6;
  for (let i = 0; i < strings; i++) {
    const peg = part(mats, cylinder(0.022, 0.022, 0.07), "#c9c4d6", false);
    peg.rotation.x = Math.PI / 2;
    peg.position.set(
      neckStart +
        neckLength +
        0.06 +
        (inline ? i * 0.055 : (i % (strings / 2)) * 0.08),
      inline ? 0.11 : i < strings / 2 ? 0.15 : -0.15,
      0.05,
    );
    g.add(peg);
  }
  // Strings: one line segment set, from bridge to nut.
  const verts: number[] = [];
  for (let i = 0; i < strings; i++) {
    const y = (i - (strings - 1) / 2) * 0.022;
    verts.push(
      -0.32,
      y * 1.6,
      depth / 2 + 0.09,
      neckStart + neckLength,
      y,
      0.07,
    );
  }
  const wire = new THREE.BufferGeometry();
  wire.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.add(
    new THREE.LineSegments(
      wire,
      new THREE.LineBasicMaterial({ color: 0xe8e5f2 }),
    ),
  );
  return { group: g, info: { neckStart, neckLength } as GuitarInfo };
}
type Role = "kick" | "snare" | "hihat" | "tom" | "cymbal";
type Piece = { role: Role; top: THREE.Vector3; mesh: THREE.Object3D };
type KitSpec = {
  role: Role;
  kind: "kick" | "drum" | "cymbal" | "pad";
  at: [number, number, number];
  r: number;
}[];
// The drummer faces the audience, so their left hand (hi-hat, snare) is on
// screen right (+x).
const KITS: Record<string, KitSpec> = {
  rock: [
    { role: "kick", kind: "kick", at: [0, 0.45, 1.0], r: 0.45 },
    { role: "snare", kind: "drum", at: [0.7, 0.95, 0.72], r: 0.28 },
    { role: "hihat", kind: "cymbal", at: [1.15, 1.3, 0.55], r: 0.3 },
    { role: "tom", kind: "drum", at: [0.25, 1.32, 0.92], r: 0.22 },
    { role: "tom", kind: "drum", at: [-0.25, 1.32, 0.92], r: 0.24 },
    { role: "tom", kind: "drum", at: [-0.85, 0.85, 0.66], r: 0.32 },
    { role: "cymbal", kind: "cymbal", at: [0.9, 1.95, 0.4], r: 0.45 },
    { role: "cymbal", kind: "cymbal", at: [-1.2, 1.65, 0.45], r: 0.48 },
  ],
  compact: [
    { role: "kick", kind: "kick", at: [0, 0.4, 1.0], r: 0.38 },
    { role: "snare", kind: "drum", at: [0.6, 0.92, 0.72], r: 0.28 },
    { role: "hihat", kind: "cymbal", at: [1.05, 1.25, 0.55], r: 0.28 },
    { role: "cymbal", kind: "cymbal", at: [-0.9, 1.75, 0.5], r: 0.42 },
  ],
  "double-kick": [
    { role: "kick", kind: "kick", at: [-0.38, 0.42, 1.0], r: 0.38 },
    { role: "kick", kind: "kick", at: [0.38, 0.42, 1.0], r: 0.38 },
    { role: "snare", kind: "drum", at: [0.78, 0.98, 0.7], r: 0.27 },
    { role: "hihat", kind: "cymbal", at: [1.2, 1.32, 0.52], r: 0.28 },
    { role: "tom", kind: "drum", at: [0.38, 1.38, 0.9], r: 0.2 },
    { role: "tom", kind: "drum", at: [0, 1.42, 0.95], r: 0.21 },
    { role: "tom", kind: "drum", at: [-0.38, 1.38, 0.9], r: 0.22 },
    { role: "tom", kind: "drum", at: [-0.9, 0.88, 0.65], r: 0.32 },
    { role: "cymbal", kind: "cymbal", at: [1.05, 2.0, 0.35], r: 0.42 },
    { role: "cymbal", kind: "cymbal", at: [-1.05, 2.0, 0.35], r: 0.42 },
  ],
  electronic: [
    { role: "kick", kind: "pad", at: [0, 0.5, 1.0], r: 0.26 },
    { role: "snare", kind: "pad", at: [0.6, 0.98, 0.75], r: 0.27 },
    { role: "hihat", kind: "pad", at: [1.05, 1.28, 0.6], r: 0.25 },
    { role: "tom", kind: "pad", at: [0.15, 1.3, 0.92], r: 0.22 },
    { role: "tom", kind: "pad", at: [-0.45, 1.25, 0.88], r: 0.22 },
    { role: "cymbal", kind: "pad", at: [-1.0, 1.6, 0.55], r: 0.3 },
  ],
};
function drumKit(mats: Mats, kit: string, color: string) {
  const g = new THREE.Group();
  const pieces: Piece[] = [];
  const neon = ["#ff2e88", "#38e8ff", "#ffe03a", "#3dff6e", "#c04bff"];
  (KITS[kit] ?? KITS.rock).forEach((p, i) => {
    const [x, y, z] = p.at;
    const piece = new THREE.Group();
    piece.position.set(x, y, z);
    let top = new THREE.Vector3(x, y, z);
    if (p.kind === "kick") {
      const shell = part(mats, cylinder(p.r, p.r, 0.42), color);
      shell.rotation.x = Math.PI / 2;
      const face = part(
        mats,
        cylinder(p.r * 0.86, p.r * 0.86, 0.02),
        "#f5f0ff",
        false,
      );
      face.rotation.x = Math.PI / 2;
      face.position.z = 0.22;
      const logo = part(
        mats,
        new THREE.TorusGeometry(p.r * 0.45, 0.03, 6, 24),
        color,
        false,
      );
      logo.position.z = 0.235;
      piece.add(shell, face, logo);
      top = new THREE.Vector3(x, y + p.r, z);
    } else if (p.kind === "drum") {
      const shell = part(mats, cylinder(p.r, p.r, p.r * 0.8), color);
      const skin = part(
        mats,
        cylinder(p.r * 0.92, p.r * 0.92, 0.02),
        "#f5f0ff",
        false,
      );
      skin.position.y = p.r * 0.41;
      piece.add(shell, skin);
      piece.rotation.x = 0.3;
      top = new THREE.Vector3(x, y + p.r * 0.4, z + 0.05);
    } else if (p.kind === "cymbal") {
      const plate = part(mats, cylinder(p.r * 0.1, p.r, 0.05), "#ffd23a");
      piece.add(plate);
      piece.rotation.set(0.35, 0, x > 0 ? -0.2 : 0.2);
      top = new THREE.Vector3(x - Math.sign(x) * p.r * 0.4, y, z + 0.1);
    } else {
      const pad = part(
        mats,
        new THREE.CylinderGeometry(p.r, p.r, 0.08, 6),
        neon[i % neon.length],
      );
      const rim = part(
        mats,
        new THREE.CylinderGeometry(p.r * 1.08, p.r * 1.08, 0.05, 6),
        "#14121c",
        false,
      );
      rim.position.y = -0.04;
      piece.add(pad, rim);
      piece.rotation.x = p.role === "kick" ? 1.2 : 0.35;
      top = new THREE.Vector3(x, y + 0.05, z);
    }
    // Stand to the floor.
    if (p.kind !== "kick" || kit === "electronic") {
      const stand = part(mats, cylinder(0.025, 0.025, y), "#6d6880", false);
      stand.position.set(x, y / 2, z - 0.05);
      g.add(stand);
    }
    g.add(piece);
    pieces.push({ role: p.role, top, mesh: piece });
  });
  return { group: g, pieces };
}
type Arm = {
  shoulder: THREE.Vector3;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
  stick?: THREE.Mesh;
  side: 1 | -1;
  /** Smoothed hand target, so moves between targets ease. */
  at: THREE.Vector3;
};
const UPPER = 0.5,
  FORE = 0.48,
  Y = new THREE.Vector3(0, 1, 0);
/** Two-bone arm: places the elbow so the hand reaches `target`, bending away
 * from the body and slightly down. */
function reach(arm: Arm, target: THREE.Vector3) {
  const s = arm.shoulder;
  const d = target.clone().sub(s);
  const dist = Math.min(Math.max(d.length(), 0.08), UPPER + FORE - 0.002);
  const dir = d.normalize();
  const a = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const pole = new THREE.Vector3(arm.side * 0.7, -1, -0.5);
  pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = s.clone().addScaledVector(dir, a).addScaledVector(pole, h);
  const hand = s.clone().addScaledVector(dir, dist);
  const place = (mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, to.clone().sub(from).normalize());
  };
  place(arm.upper, s, elbow);
  place(arm.fore, elbow, hand);
  arm.hand.position.copy(hand);
  return hand;
}
type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  arms: { strum: Arm; fret: Arm };
  footR: THREE.Mesh;
  instrument: THREE.Group;
  guitar?: GuitarInfo;
  pieces: Piece[];
  face: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  faces: Record<Face, THREE.Texture>;
  aura: THREE.Mesh;
  kind: Instrument;
};
/** One chibi performer: big head, small body, mitten hands, elbows. */
function performer(
  mats: Mats,
  look: Look,
  instrument: Instrument,
  gear: Gear,
  photo?: HTMLImageElement,
): Rig {
  const p = presetFor(look.kind === "preset" ? look.id : "");
  const skin = photo ? "#f1c7a8" : p.skin,
    outfit = photo ? "#1b1530" : p.outfit,
    accent = photo ? "#ff2e88" : p.accent;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let footR!: THREE.Mesh;
  for (const x of [-0.24, 0.24]) {
    const leg = part(mats, capsule(0.17, 0.45), "#14121c");
    leg.position.set(x, 0.42, 0);
    const shoe = part(mats, sphere(0.22), accent);
    shoe.scale.set(1, 0.6, 1.4);
    shoe.position.set(x, 0.1, 0.08);
    if (x < 0) footR = shoe;
    root.add(leg, shoe);
  }
  const torso = part(mats, capsule(0.46, 0.5), outfit);
  torso.position.y = 1.2;
  const stripe = part(
    mats,
    new THREE.TorusGeometry(0.47, 0.05, 6, 24),
    accent,
    false,
  );
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 1.05;
  body.add(torso, stripe);
  const head = new THREE.Group();
  head.position.y = 2.3;
  body.add(head);
  head.add(part(mats, sphere(0.75), skin));
  const faces = {} as Record<Face, THREE.Texture>;
  for (const f of ["groove", "hyped", "miss", "power", "blink"] as Face[])
    faces[f] = drawFace(f, photo);
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.76, 24, 16, Math.PI / 2 - 0.95, 1.9, 0.95, 1.05),
    new THREE.MeshBasicMaterial({ map: faces.groove, transparent: true }),
  );
  head.add(face);
  if (!photo) {
    head.add(hair(mats, p));
    head.add(extra(mats, p));
  }
  const drums = instrument === "drums";
  const arm = (side: 1 | -1): Arm => {
    const shoulder = new THREE.Vector3(side * 0.48, 1.55, 0.05);
    const ball = part(mats, sphere(0.15), outfit);
    ball.position.copy(shoulder);
    const upper = part(mats, capsule(0.12, UPPER - 0.12), skin);
    const fore = part(mats, capsule(0.11, FORE - 0.12), skin);
    const hand = part(mats, sphere(0.16), skin);
    body.add(ball, upper, fore, hand);
    let stick: THREE.Mesh | undefined;
    if (drums) {
      stick = part(mats, cylinder(0.025, 0.035, 0.8), "#f0d9a8");
      body.add(stick);
    }
    return {
      shoulder,
      upper,
      fore,
      hand,
      stick,
      side,
      at: shoulder.clone().add(new THREE.Vector3(0, -0.6, 0.4)),
    };
  };
  // Facing the audience, the figure's right (strumming) arm is on screen left.
  const arms = { strum: arm(-1), fret: arm(1) };
  let inst: THREE.Group,
    info: GuitarInfo | undefined,
    pieces: Piece[] = [];
  if (drums) {
    const kit = drumKit(mats, gear.kit, accent);
    inst = kit.group;
    pieces = kit.pieces;
    root.add(inst);
  } else {
    const made = guitar(mats, gear.guitar, gear.finish, instrument === "bass");
    inst = made.group;
    info = made.info;
    inst.position.set(-0.3, 1.0, 0.5);
    inst.rotation.z = 0.38;
    body.add(inst);
  }
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.55, 40),
    new THREE.MeshBasicMaterial({
      color: 0x38e8ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  aura.position.set(0, 1.6, -0.6);
  aura.visible = false;
  root.add(aura);
  return {
    root,
    body,
    torso,
    head,
    arms,
    footR,
    instrument: inst,
    guitar: info,
    pieces,
    face,
    faces,
    aura,
    kind: instrument,
  };
}
export type PerformerInit = { look: Look; instrument: Instrument; gear?: Gear };
export type PerformerState = {
  hits: number;
  misses: number;
  combo: number;
  powerActive: boolean;
  /** Lanes of the last note hit: picks the fret or the drum. */
  lanes?: number[];
};
const loadPhoto = (src: string) =>
  new Promise<HTMLImageElement | undefined>((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(undefined);
    img.src = src;
  });
const LANE_ROLE: Role[] = ["kick", "snare", "hihat", "tom", "cymbal"];
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
/** A stage of performers on a transparent canvas. `frame` may be called every
 * animation frame; it renders only when the next 1/30 s pose is due. */
export async function createStage(
  canvas: HTMLCanvasElement,
  cast: PerformerInit[],
  options: { pixelRatio?: number; portrait?: boolean } = {},
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: !!options.portrait,
  });
  const ratio = Math.min(devicePixelRatio, options.pixelRatio ?? 1.25);
  renderer.setPixelRatio(ratio);
  renderer.setClearColor(0x000000, 0);
  const shared: Shared = {
    rim: { value: new THREE.Vector3(1, 0.18, 0.53) },
    dots: { value: 7 * ratio },
    glow: { value: 0 },
  };
  const mats = materials(shared);
  const scene = new THREE.Scene();
  const photos = await Promise.all(
    cast.map((c) =>
      c.look.kind === "photo" ? loadPhoto(c.look.image) : undefined,
    ),
  );
  const spacing = 3.6;
  const rigs = cast.map((c, i) => {
    const rig = performer(
      mats,
      c.look,
      c.instrument,
      c.gear ?? defaultGear(i),
      photos[i],
    );
    rig.root.position.x = (i - (cast.length - 1) / 2) * spacing;
    // Turned a little toward the centre of the stage, like a real band.
    rig.root.rotation.y =
      cast.length > 1 ? -Math.sign(rig.root.position.x) * 0.18 : 0;
    scene.add(rig.root);
    if (!options.portrait) {
      // A spotlight cone and floor pool for each performer.
      const color = [0xff2e88, 0x38e8ff, 0xffe03a, 0xc04bff][i % 4];
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 2.1, 7, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.09,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      cone.position.set(rig.root.position.x, 3.5, -0.4);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(1.7, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(rig.root.position.x, 0.01, 0);
      scene.add(cone, pool);
    }
    return rig;
  });
  const camera = new THREE.PerspectiveCamera(
    options.portrait ? 24 : 30,
    1,
    0.1,
    100,
  );
  const resize = () => {
    const w = canvas.clientWidth || canvas.width,
      h = canvas.clientHeight || canvas.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    if (options.portrait) {
      camera.position.set(0, 2.25, 6.2);
      camera.lookAt(0, 1.85, 0);
    } else {
      // Fit the whole band, whatever the canvas shape.
      const width = cast.length * spacing + 1;
      const fitH = 4.0 / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const fitW =
        width / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      const z = Math.max(fitH, fitW);
      camera.position.set(0, 2.1, z);
      camera.lookAt(0, 1.75, 0);
    }
    camera.updateProjectionMatrix();
  };
  resize();
  const seen = cast.map(() => ({
    hits: 0,
    misses: 0,
    hitAt: -1,
    missAt: -1,
    stroke: 1,
    lanes: [0] as number[],
    raise: 0,
    piece: { L: null as Piece | null, R: null as Piece | null },
    struck: { L: -1, R: -1, kick: -1 },
    tom: 0,
  }));
  let last = -1;
  const moods: Mood[] = cast.map(() => "groove");
  const local = new THREE.Vector3();
  const pose = (
    rig: Rig,
    i: number,
    t: number,
    s: PerformerState,
    playing: boolean,
    beat: number,
  ) => {
    const memo = seen[i];
    const hit = s.hits > memo.hits;
    if (hit) {
      memo.hitAt = t;
      memo.stroke = -memo.stroke; // alternate down and up strokes
      memo.lanes = s.lanes?.length ? s.lanes : memo.lanes;
    }
    if (s.misses > memo.misses) memo.missAt = t;
    // A restart resets the counters.
    if (s.hits < memo.hits || s.misses < memo.misses)
      memo.hitAt = memo.missAt = -1;
    memo.hits = s.hits;
    memo.misses = s.misses;
    const mood = (moods[i] = moodFor({
      powerActive: s.powerActive,
      combo: s.combo,
      missedRecently: memo.missAt >= 0 && t - memo.missAt < 0.7,
    }));
    const big = mood === "hyped" || mood === "power";
    // Groove: dip on the beat, sway over two beats, head follows a moment late.
    const phase = playing ? t / beat : t * 0.6;
    const dip = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
    rig.body.position.y = -(big ? 0.11 : playing ? 0.06 : 0.02) * dip;
    rig.body.rotation.z = Math.sin(Math.PI * phase) * (playing ? 0.045 : 0.02);
    rig.body.rotation.x = mood === "hyped" ? -0.07 : 0;
    rig.torso.scale.set(1, 1 + 0.02 * Math.sin(t * 2.2), 1);
    const nod = 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - 0.12));
    rig.head.rotation.x =
      (mood === "hyped" ? 0.38 : big ? 0.22 : playing ? 0.12 : 0.04) * nod -
      0.06;
    rig.head.rotation.z = Math.sin(Math.PI * (phase - 0.15)) * 0.07;
    rig.head.rotation.y = 0;
    rig.root.position.y =
      mood === "power" ? 0.28 * Math.abs(Math.sin(Math.PI * phase)) : 0;
    // Miss: a no-no head shake and a shrug.
    const sinceMiss = t - memo.missAt;
    if (memo.missAt >= 0 && sinceMiss < 0.7) {
      const fade = 1 - sinceMiss / 0.7;
      rig.head.rotation.y = Math.sin(sinceMiss * 26) * 0.35 * fade;
      rig.head.rotation.z += Math.sin(sinceMiss * 19) * 0.12 * fade;
      rig.body.position.y += 0.07 * fade;
    }
    const since = memo.hitAt >= 0 ? t - memo.hitAt : 99;
    if (rig.kind === "drums") {
      if (hit) {
        for (const lane of memo.lanes) {
          const role = LANE_ROLE[lane] ?? "snare";
          if (role === "kick") {
            memo.struck.kick = t;
            continue;
          }
          const options = rig.pieces.filter((p) => p.role === role);
          const pool = options.length
            ? options
            : rig.pieces.filter((p) => p.role !== "kick");
          const piece = pool[memo.tom++ % pool.length];
          // Hand on the side of the piece plays it.
          const side = piece.top.x > 0 ? "L" : "R";
          memo.piece[side] = piece;
          memo.struck[side] = t;
        }
      }
      for (const [side, arm] of [
        ["L", rig.arms.fret],
        ["R", rig.arms.strum],
      ] as const) {
        const piece =
          memo.piece[side] ??
          rig.pieces.find((p) =>
            side === "L" ? p.role === "snare" : p.role === "tom" && p.top.x < 0,
          ) ??
          rig.pieces[1];
        // Stick tip lands on the piece, then rebounds; idle sticks keep time.
        const dt = t - memo.struck[side];
        const lift =
          memo.struck[side] >= 0 && dt < 0.35
            ? 0.45 * ease(dt / 0.25)
            : 0.45 - (playing ? 0.12 * dip : 0);
        const tip = piece.top.clone();
        tip.y += lift;
        const handTarget = tip
          .clone()
          .add(new THREE.Vector3(-arm.side * 0.12, 0.22, -0.55));
        arm.at.lerp(handTarget, 0.55);
        const hand = reach(arm, arm.at);
        if (arm.stick) {
          const dir = tip.clone().sub(hand).normalize();
          arm.stick.position.copy(hand).addScaledVector(dir, 0.38);
          arm.stick.quaternion.setFromUnitVectors(Y, dir);
        }
      }
      const kickDt = t - memo.struck.kick;
      rig.footR.position.y =
        0.1 +
        (memo.struck.kick >= 0 && kickDt < 0.18
          ? 0.14 * (1 - kickDt / 0.18)
          : 0);
    } else if (rig.guitar) {
      // Star Power raises the guitar; the fretting hand follows the neck.
      memo.raise += ((mood === "power" ? 1 : 0) - memo.raise) * 0.2;
      rig.instrument.rotation.z = 0.38 + memo.raise * 0.55;
      rig.instrument.position.y = 1.0 + memo.raise * 0.15;
      rig.instrument.updateMatrix();
      const { neckStart, neckLength } = rig.guitar;
      // Lower lanes sit nearer the headstock.
      const lane = Math.min(...memo.lanes);
      local.set(neckStart + neckLength * (0.78 - lane * 0.13), -0.02, 0.16);
      const fret = local.clone().applyMatrix4(rig.instrument.matrix);
      rig.arms.fret.at.lerp(fret, 0.45);
      reach(rig.arms.fret, rig.arms.fret.at);
      // Strum: a quick stroke through the strings, alternating down and up.
      const stroke = since < 0.3 ? ease(since / 0.09) : 1;
      const sweep =
        since < 0.3
          ? memo.stroke * (0.24 - 0.48 * stroke)
          : 0.1 + (playing ? 0.05 * dip : 0);
      local.set(-0.02, sweep, 0.28);
      const strum = local.clone().applyMatrix4(rig.instrument.matrix);
      rig.arms.strum.at.lerp(strum, since < 0.3 ? 0.9 : 0.3);
      reach(rig.arms.strum, rig.arms.strum.at);
    }
    // Faces: an occasional blink keeps performers alive.
    const blink = mood === "groove" && Math.floor(t / STEP) % 110 >= 107;
    const face: Face = blink ? "blink" : mood;
    if (rig.face.material.map !== rig.faces[face]) {
      rig.face.material.map = rig.faces[face];
      rig.face.material.needsUpdate = true;
    }
    rig.aura.visible = mood === "power";
    rig.aura.rotation.z = t * 2;
  };
  return {
    /** Advances to the pose for time `t` (seconds). */
    frame(
      t: number,
      states: PerformerState[],
      playing: boolean,
      beat = 0.5,
      force = false,
    ) {
      const step = Math.floor(t / STEP);
      if (!force && step === last) return false;
      last = step;
      const quantized = step * STEP;
      let power = false;
      rigs.forEach((rig, i) => {
        pose(rig, i, quantized, states[i], playing, beat);
        power ||= moods[i] === "power";
      });
      shared.glow.value = power ? 1 : 0;
      shared.rim.value.set(
        power ? 0.22 : 1,
        power ? 0.9 : 0.18,
        power ? 1 : 0.53,
      );
      renderer.render(scene, camera);
      return true;
    },
    /** Each performer's current expression. */
    moods,
    /** Where each performer stands, as fractions of the canvas (head top). */
    anchors() {
      return rigs.map((r) => {
        const v = new THREE.Vector3(r.root.position.x, 3.3, 0).project(camera);
        return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
      });
    },
    resize,
    snapshot: () => canvas.toDataURL("image/png"),
    dispose() {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          if (
            o.material instanceof THREE.MeshBasicMaterial ||
            o.material instanceof THREE.LineBasicMaterial
          ) {
            if ("map" in o.material) o.material.map?.dispose();
            o.material.dispose();
          }
        }
      });
      rigs.forEach((r) => Object.values(r.faces).forEach((f) => f.dispose()));
      mats.dispose();
      renderer.dispose();
      // Portraits are one-offs: free their GL context right away.
      if (options.portrait) renderer.forceContextLoss();
    },
  };
}
export type Stage = Awaited<ReturnType<typeof createStage>>;
