import * as THREE from "three";
import type { Note } from "../types";
const colors = [0x54ea69, 0xff4055, 0xffd338, 0x32a5ff, 0xff8d28];
const CAPACITY = 1400;
export function createHighway(canvas: HTMLCanvasElement, notes: Note[]) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x100e10, 14, 42);
  const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 80);
  camera.position.set(0, 5.9, 7.5);
  camera.lookAt(0, 0, -10);
  scene.add(new THREE.HemisphereLight(0xdce4ff, 0x28130c, 2));
  const light = new THREE.DirectionalLight(0xffedcf, 3);
  light.position.set(-3, 8, 3);
  scene.add(light);
  const geometries: THREE.BufferGeometry[] = [],
    materials: THREE.Material[] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    geometries.push(geometry);
    materials.push(material);
    const m = new THREE.Mesh(geometry, material);
    scene.add(m);
    return m;
  };
  const floor = mesh(
    new THREE.PlaneGeometry(5.65, 50),
    new THREE.MeshStandardMaterial({
      color: 0x181719,
      metalness: 0.6,
      roughness: 0.72,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -20;
  for (let i = 0; i < 6; i++) {
    const rail = mesh(
      new THREE.BoxGeometry(i === 0 || i === 5 ? 0.1 : 0.016, 0.055, 48),
      new THREE.MeshStandardMaterial({
        color: i === 0 || i === 5 ? 0xaaa19a : 0x57545a,
        metalness: 0.85,
        roughness: 0.3,
      }),
    );
    rail.position.set(i * 1.05 - 2.625, 0.02, -20);
  }
  // Fret wires and rivets provide depth without textures or per-frame allocation.
  for (let i = 0; i < 26; i++) {
    const wire = mesh(
      new THREE.BoxGeometry(5.2, 0.025, 0.025),
      new THREE.MeshBasicMaterial({ color: 0x484048 }),
    );
    wire.position.set(0, 0.02, -i * 1.75);
  }
  const hit = mesh(
    new THREE.BoxGeometry(5.65, 0.05, 0.09),
    new THREE.MeshBasicMaterial({ color: 0xffd28d }),
  );
  hit.position.y = 0.04;
  const pads = colors.map((color, lane) => {
    const base = mesh(
      new THREE.CylinderGeometry(0.47, 0.49, 0.1, 24),
      new THREE.MeshStandardMaterial({
        color: 0x777177,
        metalness: 0.9,
        roughness: 0.3,
      }),
    );
    base.position.set((lane - 2) * 1.05, 0.07, 0);
    const pad = mesh(
      new THREE.CylinderGeometry(0.34, 0.39, 0.1, 24),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.15,
        metalness: 0.3,
        roughness: 0.3,
      }),
    );
    pad.position.set((lane - 2) * 1.05, 0.14, 0);
    return pad;
  });
  const bursts = colors.map((color, lane) => {
    const m = mesh(
      new THREE.TorusGeometry(0.36, 0.045, 6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((lane - 2) * 1.05, 0.2, 0);
    return m;
  });
  const pool = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    geometries.push(geo);
    materials.push(mat);
    const m = new THREE.InstancedMesh(geo, mat, CAPACITY);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const rims = pool(
    new THREE.CylinderGeometry(0.405, 0.44, 0.12, 20),
    new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.25 }),
  );
  const gems = pool(
    new THREE.CylinderGeometry(0.32, 0.38, 0.17, 20),
    new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.23 }),
  );
  const caps = pool(
    new THREE.CylinderGeometry(0.17, 0.17, 0.018, 16),
    new THREE.MeshBasicMaterial(),
  );
  const halos = pool(
    new THREE.TorusGeometry(0.46, 0.035, 6, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  const tails = pool(
    new THREE.BoxGeometry(0.12, 0.045, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 }),
  );
  const opens = pool(
    new THREE.TorusGeometry(0.42, 0.055, 8, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  let first = 0;
  const put = (
    pool: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
  ) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    pool.setMatrixAt(index, dummy.matrix);
    pool.setColorAt(index, color.setHex(hex));
  };
  const resize = () => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return {
    render(
      time: number,
      states: string[],
      held: boolean[],
      fx = {
        power: false,
        lastHit: -Infinity,
        lanes: [] as number[],
        tailActive: (_index: number, _lane: number) => true,
      },
    ) {
      while (
        first < notes.length &&
        notes[first].time + Math.max(0.2, notes[first].duration) < time - 0.5
      )
        first++;
      let count = 0,
        tailCount = 0,
        capCount = 0,
        haloCount = 0,
        openCount = 0;
      for (
        let i = first;
        i < notes.length && notes[i].time < time + 3.4 && count < CAPACITY - 5;
        i++
      ) {
        const n = notes[i];
        if (states[i] === "miss") continue;
        const z = -(n.time - time) * 10;
        for (const tail of n.tails ??
          n.lanes.map((lane) => ({ lane, duration: n.duration }))) {
          if (states[i] === "hit" && !fx.tailActive(i, tail.lane)) continue;
          if (
            tail.duration <= 0 ||
            n.time + tail.duration <= time ||
            tailCount >= CAPACITY
          )
            continue;
          const start = Math.max(0, (n.time - time) * 10),
            length = Math.min(
              tail.duration * 10,
              (n.time + tail.duration - time) * 10,
            );
          put(
            tails,
            tailCount++,
            tail.lane < 0 ? 0 : (tail.lane - 2) * 1.05,
            0.05,
            -start - length / 2,
            tail.lane < 0 ? 22 : 1,
            1,
            length,
            fx.power ? 0x77edff : (colors[tail.lane] ?? 0xbd81ff),
          );
        }
        if (states[i] === "hit") continue;
        if (n.open && openCount < CAPACITY)
          put(
            opens,
            openCount++,
            0,
            0.18,
            z,
            5.8,
            1,
            0.65,
            fx.power ? 0x77edff : 0xc587ff,
          );
        for (const lane of n.lanes) {
          const x = (lane - 2) * 1.05,
            hex = fx.power ? 0x67eaff : colors[lane];
          put(
            rims,
            count,
            x,
            0.14,
            z,
            1,
            1,
            1,
            n.phrase !== undefined ? 0xffe5a6 : 0xbbb8c0,
          );
          put(gems, count++, x, 0.26, z, 1, 1, 1, hex);
          // Solid pale cap = HOPO; black inset with bright rim = tap.
          if (n.type === "hopo" || n.type === "tap")
            put(
              caps,
              capCount++,
              x,
              0.355,
              z,
              n.type === "tap" ? 1.35 : 1,
              1,
              n.type === "tap" ? 1.35 : 1,
              n.type === "tap" ? 0x15131b : 0xfff6df,
            );
          if (n.phrase !== undefined)
            put(halos, haloCount++, x, 0.19, z, 1, 1, 1, 0xffe2a0);
        }
      }
      for (const [p, n] of [
        [gems, count],
        [rims, count],
        [tails, tailCount],
        [caps, capCount],
        [halos, haloCount],
        [opens, openCount],
      ] as const) {
        p.count = n;
        p.instanceMatrix.needsUpdate = true;
        if (p.instanceColor) p.instanceColor.needsUpdate = true;
      }
      const age = time - fx.lastHit;
      pads.forEach((pad, i) => {
        const material = pad.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = held[i] ? 0.9 : 0.12;
        pad.position.y = held[i] ? 0.1 : 0.14;
        const burst = bursts[i],
          visible = age >= 0 && age < 0.25 && fx.lanes.includes(i);
        (burst.material as THREE.MeshBasicMaterial).opacity = visible
          ? 1 - age / 0.25
          : 0;
        burst.scale.setScalar(1 + Math.max(0, Math.min(age, 0.25)) * 5);
      });
      (hit.material as THREE.MeshBasicMaterial).color.setHex(
        fx.power ? 0x67eaff : 0xffd28d,
      );
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
