import * as THREE from "three";
import type { Note } from "../types";
// Neon five-fret highway inspired by YARG, Clone Hero and Rock Band: scrolling
// fretboard, tempo grid, multiplier rails, hit flames and sparks. All geometry is
// pooled; per-frame work writes into preallocated buffers only.
export const laneColors = [0x3dff6e, 0xff2e4d, 0xffe03a, 0x2f8cff, 0xff8a1f];
const POWER = 0x38e8ff,
  PHRASE = 0xf2fbff;
// Rail colours by streak multiplier, as in Rock Band's meter.
const railColors = [0x8d8aa6, 0xff8a1f, 0x3dff6e, 0xc04bff];
const CAPACITY = 1400,
  SPARKS = 260,
  SPEED = 10,
  AHEAD = 3.4,
  LANE = 1.05,
  WIDTH = 5.65;
const laneX = (lane: number) => (lane - 2) * LANE;
export type Beat = { time: number; downbeat: boolean };
export type HighwayEffects = {
  power: boolean;
  lastHit: number;
  lanes: number[];
  tailActive: (index: number, lane: number) => boolean;
  streak?: number;
  /** Star Power meter, 0..1: drawn as the strip just below the frets. */
  meter?: number;
};
function canvasTexture(
  width: number,
  height: number,
  draw: (g: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const hex = (c: number, a = 1) =>
  `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
export function createHighway(
  canvas: HTMLCanvasElement,
  notes: Note[],
  beats: Beat[] = [],
  pixelRatio = 1.5,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07060c, 16, 40);
  const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 90);
  camera.position.set(0, 5.9, 7.5);
  camera.lookAt(0, 0, -10);
  scene.add(new THREE.HemisphereLight(0xc9d2ff, 0x1a0c22, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-2, 9, 5);
  scene.add(key);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(item: T) => {
    disposables.push(item);
    return item;
  };
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const m = new THREE.Mesh(own(geometry), own(material));
    scene.add(m);
    return m;
  };
  const glowMaterial = (map: THREE.Texture, color = 0xffffff, opacity = 1) =>
    new THREE.MeshBasicMaterial({
      map,
      color,
      opacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  const radial = own(
    canvasTexture(128, 128, (g) => {
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, "rgba(255,255,255,1)");
      r.addColorStop(0.35, "rgba(255,255,255,0.45)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
    }),
  );
  const flame = own(
    canvasTexture(64, 256, (g) => {
      const v = g.createLinearGradient(0, 256, 0, 0);
      v.addColorStop(0, "rgba(255,255,255,1)");
      v.addColorStop(0.3, "rgba(255,255,255,0.7)");
      v.addColorStop(1, "rgba(255,255,255,0)");
      const h = g.createLinearGradient(0, 0, 64, 0);
      h.addColorStop(0, "rgba(0,0,0,1)");
      h.addColorStop(0.5, "rgba(0,0,0,0)");
      h.addColorStop(1, "rgba(0,0,0,1)");
      g.fillStyle = v;
      g.fillRect(0, 0, 64, 256);
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = h;
      g.fillRect(0, 0, 64, 256);
    }),
  );

  // Stage: sweeping light beams behind the highway, fading toward the floor.
  const beam = own(
    canvasTexture(16, 256, (g) => {
      const v = g.createLinearGradient(0, 0, 0, 256);
      // Fade through alpha, not black: black still writes canvas alpha and
      // would hide the stage backdrop behind the beam.
      v.addColorStop(0, "rgba(255,255,255,1)");
      v.addColorStop(0.35, "rgba(255,255,255,0.35)");
      v.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = v;
      g.fillRect(0, 0, 16, 256);
    }),
  );
  const cones = [0xff2e88, 0x38e8ff, 0xffb02e, 0x9b4bff].map((color, i) => {
    const cone = mesh(
      new THREE.ConeGeometry(5, 40, 40, 1, true).translate(0, -20, 0),
      new THREE.MeshBasicMaterial({
        map: beam,
        color,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    // Apex at the rig; the beam hangs down from it.
    cone.position.set((i - 1.5) * 10, 24, -50);
    return cone;
  });

  // Fretboard: scrolling texture with lane tints, grit and separators.
  const board = own(
    canvasTexture(512, 512, (g) => {
      g.fillStyle = "#0c0a12";
      g.fillRect(0, 0, 512, 512);
      const lane = 512 / (WIDTH / LANE);
      const left = (512 - lane * 5) / 2;
      laneColors.forEach((c, i) => {
        const x = left + i * lane;
        const shade = g.createLinearGradient(x, 0, x + lane, 0);
        shade.addColorStop(0, hex(c, 0));
        shade.addColorStop(0.5, hex(c, 0.07));
        shade.addColorStop(1, hex(c, 0));
        g.fillStyle = shade;
        g.fillRect(x, 0, lane, 512);
      });
      let seed = 7;
      for (let i = 0; i < 2600; i++) {
        seed = (seed * 16807) % 2147483647;
        const x = seed % 512;
        seed = (seed * 16807) % 2147483647;
        g.fillStyle = `rgba(255,255,255,${0.015 + (seed % 100) / 4000})`;
        g.fillRect(x, seed % 512, 1 + (seed % 3), 1);
      }
      g.fillStyle = "rgba(255,255,255,0.09)";
      for (let i = 0; i <= 5; i++) g.fillRect(left + i * lane - 1, 0, 2, 512);
    }),
  );
  board.wrapS = board.wrapT = THREE.RepeatWrapping;
  board.repeat.set(1, 4);
  board.anisotropy = 4;
  const floor = mesh(
    new THREE.PlaneGeometry(WIDTH, 60),
    new THREE.MeshStandardMaterial({
      map: board,
      metalness: 0.35,
      roughness: 0.6,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -26;

  // Multiplier rails with a neon halo.
  const rails = [-1, 1].map((side) => {
    const rail = mesh(
      new THREE.BoxGeometry(0.13, 0.12, 60),
      new THREE.MeshBasicMaterial({ color: railColors[0] }),
    );
    rail.position.set((side * WIDTH) / 2, 0.06, -26);
    const halo = mesh(
      new THREE.PlaneGeometry(0.9, 60),
      glowMaterial(radial, railColors[0], 0.55),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set((side * WIDTH) / 2, 0.01, -26);
    halo.scale.set(1, 1, 1);
    return { rail, halo };
  });

  // Star Power meter: a strip just below the frets that fills with blue.
  const METER_Z = 0.72,
    METER_W = WIDTH - 0.5;
  const meterTrack = mesh(
    new THREE.BoxGeometry(METER_W, 0.02, 0.24),
    new THREE.MeshBasicMaterial({
      color: 0x6f6890,
      transparent: true,
      opacity: 0.55,
    }),
  );
  meterTrack.position.set(0, 0.03, METER_Z);
  // Grows from the left edge: geometry starts at x = 0.
  const meterFill = mesh(
    new THREE.BoxGeometry(METER_W, 0.03, 0.26).translate(METER_W / 2, 0, 0),
    new THREE.MeshBasicMaterial({ color: POWER }),
  );
  meterFill.position.set(-METER_W / 2, 0.04, METER_Z);
  meterFill.scale.x = 0.0001;
  const meterGlow = mesh(
    new THREE.PlaneGeometry(METER_W + 0.8, 0.9),
    glowMaterial(radial, POWER, 0),
  );
  meterGlow.rotation.x = -Math.PI / 2;
  meterGlow.position.set(0, 0.02, METER_Z);
  // Half full: enough to ignite.
  const meterMark = mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xece0d0 }),
  );
  meterMark.position.set(0, 0.05, METER_Z);

  // Strikeline and fret receptors.
  const strike = mesh(
    new THREE.BoxGeometry(WIDTH, 0.05, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  strike.position.y = 0.05;
  const strikeGlow = mesh(
    new THREE.PlaneGeometry(WIDTH + 1.2, 1.1),
    glowMaterial(radial, 0xff2e88, 0.5),
  );
  strikeGlow.rotation.x = -Math.PI / 2;
  strikeGlow.position.y = 0.02;
  const receptors = laneColors.map((color, lane) => {
    const x = laneX(lane);
    const base = mesh(
      new THREE.CylinderGeometry(0.48, 0.5, 0.08, 32),
      new THREE.MeshStandardMaterial({
        color: 0x16141c,
        metalness: 0.9,
        roughness: 0.35,
      }),
    );
    base.position.set(x, 0.05, 0);
    const ring = mesh(
      new THREE.TorusGeometry(0.42, 0.055, 10, 32),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.3,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.11, 0);
    const button = mesh(
      new THREE.CylinderGeometry(0.3, 0.33, 0.08, 28),
      new THREE.MeshStandardMaterial({
        color: 0x1d1a24,
        emissive: color,
        emissiveIntensity: 0,
        metalness: 0.4,
        roughness: 0.3,
      }),
    );
    button.position.set(x, 0.12, 0);
    const glow = mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      glowMaterial(radial, color, 0),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.03, 0);
    const fire = own(
      new THREE.SpriteMaterial({
        map: flame,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const sprite = new THREE.Sprite(fire);
    sprite.position.set(x, 0.9, 0);
    scene.add(sprite);
    return { ring, button, glow, sprite };
  });

  const pool = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity = CAPACITY,
  ) => {
    const m = new THREE.InstancedMesh(own(geometry), own(material), capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  };
  const lines = pool(
    new THREE.BoxGeometry(WIDTH - 0.3, 0.012, 1),
    new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    400,
  );
  const tails = pool(
    new THREE.BoxGeometry(0.16, 0.05, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }),
  );
  const glows = pool(
    new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2),
    glowMaterial(radial, 0xffffff, 0.75),
  );
  const rims = pool(
    new THREE.CylinderGeometry(0.42, 0.46, 0.13, 28),
    new THREE.MeshStandardMaterial({ metalness: 0.95, roughness: 0.22 }),
  );
  const gems = pool(
    new THREE.CylinderGeometry(0.33, 0.39, 0.19, 28),
    new THREE.MeshStandardMaterial({
      metalness: 0.15,
      roughness: 0.18,
      emissive: 0x222222,
    }),
  );
  const caps = pool(
    new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20),
    new THREE.MeshBasicMaterial(),
  );
  const opens = pool(
    new THREE.TorusGeometry(0.42, 0.06, 8, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  const sparks = pool(
    new THREE.BoxGeometry(0.07, 0.07, 0.07),
    new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    SPARKS,
  );
  const spark = {
    x: new Float32Array(SPARKS),
    y: new Float32Array(SPARKS),
    z: new Float32Array(SPARKS),
    vx: new Float32Array(SPARKS),
    vy: new Float32Array(SPARKS),
    vz: new Float32Array(SPARKS),
    life: new Float32Array(SPARKS),
    color: new Uint32Array(SPARKS),
    next: 0,
  };
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  let first = 0,
    firstBeat = 0,
    seenHit = -Infinity,
    lastFrame = performance.now(),
    lastTime = -Infinity,
    shownNotes = -1,
    lastTier = 0,
    tierFlash = 0,
    random = 12345;
  const rand = () => {
    random = (random * 1664525 + 1013904223) >>> 0;
    return random / 4294967296;
  };
  const put = (
    target: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hexColor: number,
    brightness = 1,
  ) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    target.setMatrixAt(index, dummy.matrix);
    target.setColorAt(index, color.setHex(hexColor).multiplyScalar(brightness));
  };
  const emit = (lane: number, hexColor: number) => {
    for (let k = 0; k < 12; k++) {
      const i = spark.next;
      spark.next = (spark.next + 1) % SPARKS;
      spark.x[i] = laneX(lane) + (rand() - 0.5) * 0.5;
      spark.y[i] = 0.25;
      spark.z[i] = (rand() - 0.5) * 0.3;
      spark.vx[i] = (rand() - 0.5) * 3.2;
      spark.vy[i] = 3 + rand() * 4;
      spark.vz[i] = 1 + rand() * 2.5;
      spark.life[i] = 0.35 + rand() * 0.3;
      spark.color[i] = hexColor;
    }
  };
  // Narrow multiplayer columns pull the camera back along its sightline, so the
  // whole board fits while the strikeline keeps its place near the bottom.
  const baseFov = 47,
    eye = camera.position.clone(),
    target = new THREE.Vector3(0, 0, -10),
    fog = scene.fog as THREE.Fog;
  const resize = () => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    const half = Math.tan((baseFov * Math.PI) / 360) * camera.aspect;
    const pull = Math.max(1, Math.tan((21 * Math.PI) / 180) / half);
    camera.position.copy(eye).sub(target).multiplyScalar(pull).add(target);
    camera.lookAt(target);
    camera.far = 90 * pull;
    fog.near = 16 * pull;
    fog.far = 40 * pull;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (pull > 1) {
      // Slide the frame so the strikeline sits near the bottom, as in solo play.
      camera.updateMatrixWorld();
      const strike = new THREE.Vector3(0, 0, 0.6).project(camera);
      camera.setViewOffset(w, h, 0, -((strike.y + 0.8) * h) / 2, w, h);
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return {
    reset() {
      first = 0;
      firstBeat = 0;
      lastTime = -Infinity;
      seenHit = -Infinity;
      spark.life.fill(0);
    },
    render(
      time: number,
      states: string[],
      held: boolean[],
      fx: HighwayEffects = {
        power: false,
        lastHit: -Infinity,
        lanes: [],
        tailActive: () => true,
      },
    ) {
      const now = performance.now(),
        dt = Math.min(0.05, (now - lastFrame) / 1000),
        seconds = now / 1000;
      lastFrame = now;
      // The pointers below only move forward; when the clock goes back (a
      // restart, or the rewind on resume) scan again from the start.
      if (time < lastTime - 0.001) first = firstBeat = 0;
      lastTime = time;
      board.offset.y = ((time * SPEED) / 15) % 1;
      cones.forEach((cone, i) => {
        cone.rotation.z = Math.sin(seconds * 0.45 + i * 1.7) * 0.45;
        cone.rotation.x = -0.3 + Math.sin(seconds * 0.3 + i) * 0.12;
        (cone.material as THREE.MeshBasicMaterial).opacity = fx.power
          ? 0.4
          : 0.22;
      });

      // Rails show the multiplier tier; flash when it rises.
      const tier = Math.min(3, Math.floor((fx.streak ?? 0) / 10));
      if (tier > lastTier) tierFlash = 1;
      lastTier = tier;
      tierFlash = Math.max(0, tierFlash - dt * 2.5);
      const rail = fx.power ? POWER : railColors[tier];
      for (const r of rails) {
        (r.rail.material as THREE.MeshBasicMaterial).color
          .setHex(rail)
          .lerp(color.setHex(0xffffff), tierFlash * 0.8);
        const halo = r.halo.material as THREE.MeshBasicMaterial;
        halo.color.setHex(rail);
        halo.opacity =
          0.35 + tier * 0.12 + tierFlash * 0.5 + (fx.power ? 0.3 : 0);
      }
      (strike.material as THREE.MeshBasicMaterial).color.setHex(
        fx.power ? POWER : 0xffffff,
      );
      (strikeGlow.material as THREE.MeshBasicMaterial).color.setHex(
        fx.power ? POWER : 0xff2e88,
      );
      // Star Power meter: fills with blue; glows once it can ignite and
      // pulses while it's live.
      const level = Math.max(0, Math.min(1, fx.meter ?? 0));
      meterFill.scale.x = Math.max(0.0001, level);
      const fill = meterFill.material as THREE.MeshBasicMaterial;
      fill.color.setHex(POWER);
      if (fx.power)
        fill.color.lerp(
          color.setHex(0xffffff),
          0.35 + 0.35 * Math.sin(seconds * 9),
        );
      (meterGlow.material as THREE.MeshBasicMaterial).opacity = fx.power
        ? 0.55 + 0.25 * Math.sin(seconds * 9)
        : level >= 0.5
          ? 0.35
          : level * 0.3;

      // Tempo grid.
      // Beat lines stop at the strike line, leaving the meter strip clear.
      while (firstBeat < beats.length && beats[firstBeat].time < time - 0.03)
        firstBeat++;
      let lineCount = 0;
      for (
        let i = firstBeat;
        i < beats.length && beats[i].time < time + AHEAD && lineCount < 400;
        i++
      ) {
        const b = beats[i];
        put(
          lines,
          lineCount++,
          0,
          0.012,
          -(b.time - time) * SPEED,
          1,
          1,
          b.downbeat ? 0.1 : 0.05,
          b.downbeat ? 0x6f6890 : 0x2c2838,
        );
      }

      while (
        first < notes.length &&
        notes[first].time + Math.max(0.2, notes[first].duration) < time - 0.5
      )
        first++;
      let count = 0,
        tailCount = 0,
        capCount = 0,
        glowCount = 0,
        openCount = 0;
      for (
        let i = first;
        i < notes.length &&
        notes[i].time < time + AHEAD &&
        count < CAPACITY - 5;
        i++
      ) {
        const n = notes[i];
        if (states[i] === "miss") continue;
        const z = -(n.time - time) * SPEED;
        const phrase = n.phrase !== undefined;
        for (const tail of n.tails ??
          n.lanes.map((lane) => ({ lane, duration: n.duration }))) {
          const live = states[i] === "hit" && fx.tailActive(i, tail.lane);
          if (states[i] === "hit" && !live) continue;
          if (
            tail.duration <= 0 ||
            n.time + tail.duration <= time ||
            tailCount >= CAPACITY
          )
            continue;
          const start = Math.max(0, (n.time - time) * SPEED),
            length = Math.min(
              tail.duration * SPEED,
              (n.time + tail.duration - time) * SPEED,
            );
          // Held sustains wobble and burn brighter, like a whammied note.
          const wobble = live
            ? 1.3 + Math.sin(seconds * 38 + tail.lane * 2) * 0.35
            : 1;
          put(
            tails,
            tailCount++,
            tail.lane < 0 ? 0 : laneX(tail.lane),
            0.06,
            -start - length / 2,
            tail.lane < 0 ? 26 : wobble,
            1,
            length,
            fx.power
              ? POWER
              : phrase
                ? PHRASE
                : (laneColors[tail.lane] ?? 0xc04bff),
            live ? 1.25 : 0.7,
          );
        }
        if (states[i] === "hit") continue;
        if (n.open && openCount < CAPACITY)
          put(
            opens,
            openCount++,
            0,
            0.2,
            z,
            5.8,
            1,
            0.65,
            fx.power ? POWER : phrase ? PHRASE : 0xc04bff,
          );
        for (const lane of n.lanes) {
          const x = laneX(lane),
            body = fx.power ? POWER : phrase ? PHRASE : laneColors[lane];
          put(rims, count, x, 0.14, z, 1, 1, 1, phrase ? 0xffffff : 0x3a3646);
          put(gems, count++, x, 0.27, z, 1, 1, 1, body);
          if (glowCount < CAPACITY)
            put(
              glows,
              glowCount++,
              x,
              0.03,
              z,
              1,
              1,
              1,
              phrase && !fx.power ? laneColors[lane] : body,
              phrase ? 1 : 0.8,
            );
          // White cap = HOPO; dark inset = tap.
          if (n.type === "hopo" || n.type === "tap")
            put(
              caps,
              capCount++,
              x,
              0.375,
              z,
              n.type === "tap" ? 1.35 : 1,
              1,
              n.type === "tap" ? 1.35 : 1,
              n.type === "tap" ? 0x0d0b12 : 0xffffff,
            );
        }
      }

      // Hit flames, sparks and receptor glow.
      if (fx.lastHit !== seenHit && Number.isFinite(fx.lastHit)) {
        seenHit = fx.lastHit;
        for (const lane of fx.lanes)
          emit(lane, fx.power ? POWER : laneColors[lane]);
      }
      const age = time - fx.lastHit;
      receptors.forEach((r, i) => {
        const burning = age >= 0 && age < 0.22 && fx.lanes.includes(i);
        const heat = burning ? 1 - age / 0.22 : 0;
        const fire = r.sprite.material;
        fire.opacity = heat;
        fire.color.setHex(fx.power ? POWER : laneColors[i]);
        const tall = 0.5 + heat * 1.9;
        r.sprite.scale.set(0.8 + heat * 0.4, tall, 1);
        r.sprite.position.y = 0.1 + tall / 2;
        (r.button.material as THREE.MeshStandardMaterial).emissiveIntensity =
          held[i] ? 1.4 : 0;
        r.button.position.y = held[i] ? 0.09 : 0.12;
        (r.ring.material as THREE.MeshStandardMaterial).emissiveIntensity =
          held[i] || burning ? 1.6 : 0.45;
        (r.glow.material as THREE.MeshBasicMaterial).opacity =
          (held[i] ? 0.55 : 0) + heat * 0.9;
      });
      let sparkCount = 0;
      for (let i = 0; i < SPARKS; i++) {
        if (spark.life[i] <= 0) continue;
        spark.life[i] -= dt;
        spark.vy[i] -= 14 * dt;
        spark.x[i] += spark.vx[i] * dt;
        spark.y[i] = Math.max(0.03, spark.y[i] + spark.vy[i] * dt);
        spark.z[i] += spark.vz[i] * dt;
        const s = Math.max(0, spark.life[i]) * 2;
        put(
          sparks,
          sparkCount++,
          spark.x[i],
          spark.y[i],
          spark.z[i],
          s,
          s,
          s,
          spark.color[i],
          1.5,
        );
      }
      // How many notes are on screen, for tests (set only when it changes).
      if (count !== shownNotes)
        canvas.dataset.notes = String((shownNotes = count));
      for (const [p, n] of [
        [lines, lineCount],
        [gems, count],
        [rims, count],
        [glows, glowCount],
        [tails, tailCount],
        [caps, capCount],
        [opens, openCount],
        [sparks, sparkCount],
      ] as const) {
        p.count = n;
        p.instanceMatrix.needsUpdate = true;
        if (p.instanceColor) p.instanceColor.needsUpdate = true;
      }
      const fov = baseFov + (fx.power ? 3 : 0);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
