import * as THREE from "three";
import {
  moodFor,
  presetFor,
  type Instrument,
  type Look,
  type Mood,
  type Preset,
} from "../core/avatars";
// The band on stage: chibi 3D performers in a comic-book style (toon bands,
// halftone shadows, ink outlines) animated "on twos" at 12 poses a second.
// Stepped posing is the look, and it means the stage only renders 12 times a
// second, so it costs little next to the highway.
const STEP = 1 / 12;
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
function guitar(mats: Mats, color: string, bass: boolean) {
  const g = new THREE.Group();
  const body = part(mats, sphere(0.55), color);
  body.scale.set(1, 0.85, 0.32);
  const upper = part(mats, sphere(0.42), color);
  upper.scale.set(1, 0.85, 0.32);
  upper.position.set(0.45, 0.06, 0);
  const hole = part(mats, cylinder(0.14, 0.14, 0.04), "#07060b", false);
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0.1, 0, 0.17);
  const length = bass ? 2.1 : 1.6;
  const neck = part(mats, new THREE.BoxGeometry(length, 0.16, 0.1), "#3a2a20");
  neck.position.set(0.5 + length / 2, 0.1, 0);
  const head = part(mats, new THREE.BoxGeometry(0.34, 0.26, 0.12), "#14121c");
  head.position.set(0.5 + length + 0.15, 0.12, 0);
  g.add(body, upper, hole, neck, head);
  return g;
}
function drumKit(mats: Mats, color: string) {
  const g = new THREE.Group();
  // Low and spread out so the drummer's body and sticks stay visible.
  const kick = part(mats, cylinder(0.45, 0.45, 0.4), color);
  kick.rotation.x = Math.PI / 2;
  kick.position.set(0, 0.45, 0.95);
  const head = part(mats, cylinder(0.37, 0.37, 0.02), "#f5f0ff", false);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.45, 1.16);
  const snare = part(mats, cylinder(0.3, 0.3, 0.18), "#e8e5f2");
  snare.position.set(-0.8, 0.95, 0.75);
  snare.rotation.x = 0.35;
  const tom = part(mats, cylinder(0.26, 0.26, 0.22), color);
  tom.position.set(0.8, 1.0, 0.75);
  tom.rotation.x = 0.4;
  const cymbal = part(mats, cylinder(0.45, 0.45, 0.03), "#ffe03a");
  cymbal.position.set(1.3, 1.8, 0.4);
  cymbal.rotation.set(0.5, 0, -0.3);
  g.add(kick, head, snare, tom, cymbal);
  return g;
}
type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  instrument: THREE.Group;
  face: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  faces: Record<Face, THREE.Texture>;
  aura: THREE.Mesh;
  drums: boolean;
};
/** One chibi performer: big head, small body, mitten hands. */
function performer(
  mats: Mats,
  look: Look,
  instrument: Instrument,
  photo?: HTMLImageElement,
): Rig {
  const p = presetFor(look.kind === "preset" ? look.id : "");
  const skin = photo ? "#f1c7a8" : p.skin,
    outfit = photo ? "#1b1530" : p.outfit,
    accent = photo ? "#ff2e88" : p.accent;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const drums = instrument === "drums";
  for (const x of [-0.24, 0.24]) {
    const leg = part(mats, capsule(0.17, 0.45), "#14121c");
    leg.position.set(x, 0.42, 0);
    const shoe = part(mats, sphere(0.22), accent);
    shoe.scale.set(1, 0.6, 1.4);
    shoe.position.set(x, 0.1, 0.08);
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
  const arm = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5, 1.5, 0);
    const upper = part(mats, capsule(0.13, 0.5), skin);
    upper.position.y = -0.32;
    const hand = part(mats, sphere(0.17), skin);
    hand.position.y = -0.68;
    pivot.add(upper, hand);
    if (drums) {
      const stick = part(mats, cylinder(0.03, 0.04, 0.9), "#f0d9a8");
      stick.position.set(0, -0.72, 0.35);
      stick.rotation.x = Math.PI / 2.3;
      pivot.add(stick);
    }
    body.add(pivot);
    return pivot;
  };
  // Facing the audience, the figure's right arm is on screen left.
  const armR = arm(-1),
    armL = arm(1);
  const inst = drums
    ? drumKit(mats, accent)
    : guitar(
        mats,
        instrument === "bass" ? "#2f8cff" : accent,
        instrument === "bass",
      );
  if (drums) root.add(inst);
  else {
    inst.position.set(-0.35, 1.0, 0.55);
    inst.rotation.z = 0.42;
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
    head,
    armL,
    armR,
    instrument: inst,
    face,
    faces,
    aura,
    drums,
  };
}
export type PerformerInit = { look: Look; instrument: Instrument };
export type PerformerState = {
  hits: number;
  misses: number;
  combo: number;
  powerActive: boolean;
};
const loadPhoto = (src: string) =>
  new Promise<HTMLImageElement | undefined>((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(undefined);
    img.src = src;
  });
/** A stage of performers on a transparent canvas. `frame` may be called every
 * animation frame; it renders only when the next 1/12 s pose is due. */
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
    const rig = performer(mats, c.look, c.instrument, photos[i]);
    rig.root.position.x = (i - (cast.length - 1) / 2) * spacing;
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
    hits2: 0,
  }));
  let last = -1;
  const moods: Mood[] = cast.map(() => "groove");
  const pose = (
    rig: Rig,
    i: number,
    t: number,
    s: PerformerState,
    playing: boolean,
    beat: number,
  ) => {
    const memo = seen[i];
    if (s.hits > memo.hits) {
      memo.hitAt = t;
      memo.hits2 = s.hits;
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
    const phase = playing ? (t / beat) % 1 : 0;
    const bounce = Math.abs(Math.sin(phase * Math.PI));
    const big = mood === "hyped" || mood === "power";
    rig.body.position.y = -bounce * (big ? 0.16 : 0.08);
    rig.head.rotation.x = playing ? (big ? 0.35 : 0.12) * bounce - 0.05 : 0;
    rig.head.rotation.z = 0;
    rig.root.rotation.y = 0;
    rig.root.position.y =
      mood === "power" ? Math.max(0, Math.sin(phase * Math.PI)) * 0.35 : 0;
    // Miss: a funny wobble for half a second.
    const sinceMiss = t - memo.missAt;
    if (memo.missAt >= 0 && sinceMiss < 0.6) {
      rig.head.rotation.z =
        Math.sin(sinceMiss * 30) * 0.3 * (1 - sinceMiss / 0.6);
      rig.body.rotation.z = Math.sin(sinceMiss * 24) * 0.08;
    } else
      rig.body.rotation.z = playing ? Math.sin(phase * Math.PI * 2) * 0.05 : 0;
    // Hits: snappy strike for two poses, then settle.
    const sinceHit = memo.hitAt >= 0 ? Math.floor((t - memo.hitAt) / STEP) : 99;
    const strike =
      sinceHit === 0 ? 1 : sinceHit === 1 ? 0.55 : sinceHit === 2 ? 0.2 : 0;
    if (rig.drums) {
      const left = memo.hits2 % 2 === 1;
      rig.armR.rotation.set(
        -0.9 + (!left ? strike * 0.9 : -0.25 * bounce),
        0,
        -0.25,
      );
      rig.armL.rotation.set(
        -0.9 + (left ? strike * 0.9 : -0.25 * bounce),
        0,
        0.25,
      );
    } else {
      // Strumming arm swings down through the strings; fretting arm reaches
      // along the neck and slides a little with each hit.
      rig.armR.rotation.set(-0.5 - strike * 0.7, 0, -0.55 + strike * 0.5);
      // In Star Power the guitar goes up, and the fretting hand with it.
      if (mood === "power") rig.armL.rotation.set(-0.7, 0, 2.3);
      else rig.armL.rotation.set(-1.15, 0, 1.2 + ((memo.hits2 % 3) - 1) * 0.08);
      rig.instrument.rotation.z = mood === "power" ? 0.95 : 0.42;
    }
    // Faces: an occasional blink keeps idle performers alive.
    const blink =
      !playing || mood === "groove" ? Math.floor(t / STEP) % 40 === 39 : false;
    const face: Face = blink ? "blink" : mood;
    if (rig.face.material.map !== rig.faces[face]) {
      rig.face.material.map = rig.faces[face];
      rig.face.material.needsUpdate = true;
    }
    rig.aura.visible = mood === "power";
    rig.aura.rotation.z = t * 2;
  };
  return {
    /** Advances to the pose for song time `t` (seconds). */
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
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.MeshBasicMaterial) {
            o.material.map?.dispose();
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
