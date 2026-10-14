import * as THREE from 'three';
import { config } from '../core/config';
import type { Weather } from '../game/match';
import type { Island, Vine } from '../world/island';
import { CHUNK, meshChunk } from '../world/mesher';

/**
 * Static scene: voxel terrain chunks, sky dome, animated water, sun with shadows, vines under
 * the canopy, and glowing beacons over the boat zones.
 */
export class WorldView {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly water: THREE.Mesh;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly beacons: THREE.Mesh[] = [];
  readonly anchorMarker: THREE.Mesh;
  private readonly vineMesh: THREE.InstancedMesh;
  private readonly vineIndex = new Map<Vine, number>();
  private readonly vineMatrices: THREE.Matrix4[] = [];
  private hiddenVine: Vine | null = null;
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly hemi: THREE.HemisphereLight;
  private readonly terrainMat: THREE.MeshLambertMaterial;
  private readonly chunks = new Map<string, THREE.Mesh>();
  private readonly island: Island;
  private readonly quality: 'high' | 'low';
  private readonly windUniform = { value: 0 };
  readonly vineMat: THREE.MeshLambertMaterial;
  private weather: Preset = PRESETS.sunset;
  /** 0..1 how far the wildfire has turned the sky. */
  private fireGlow = 0;
  private flash = 0;
  private readonly fireWall: THREE.Mesh;
  private readonly fireWallMat: THREE.ShaderMaterial;
  private readonly rain: THREE.LineSegments;
  private readonly bolt: THREE.Line;
  private boltLife = 0;

  constructor(
    private readonly scene: THREE.Scene,
    island: Island,
    quality: 'high' | 'low',
  ) {
    scene.add(this.group);
    this.island = island;
    this.quality = quality;
    const world = island.world;

    // Terrain. Foliage vertices sway in the wind (phase from world position, so faces stay joined).
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const wind = this.windUniform;
    this.terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.wind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float wind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = wind * 1.7 + position.x * 0.31 + position.z * 0.23;
          transformed.x += sin(ph) * 0.07 * sway;
          transformed.z += cos(ph * 0.8) * 0.05 * sway;
          transformed.y += sin(ph * 1.3) * 0.02 * sway;`,
        );
    };
    world.dirtyChunks.clear();
    for (let cy = 0; cy < Math.ceil(world.sy / CHUNK); cy++)
      for (let cz = 0; cz < Math.ceil(world.sz / CHUNK); cz++)
        for (let cx = 0; cx < Math.ceil(world.sx / CHUNK); cx++) this.buildChunk(cx, cy, cz);

    // Sky: a gradient dome, warm at the horizon.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a8ee6) },
        horizon: { value: new THREE.Color(0xf6d9b0) },
        sunDir: { value: new THREE.Vector3(0.55, 0.42, -0.72).normalize() },
        sunAmount: { value: 1 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float sunAmount; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.85,0.6) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25) * sunAmount;
          if (vDir.y < 0.0) c = horizon * 0.9; gl_FragColor = vec4(c, 1.0); }`,
    });
    this.skyMat = skyMat;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // Light: warm late-afternoon sun plus sky/ground bounce.
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a5a3a, 1.3);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    this.sun.position.set(0.55, 0.42, -0.72).multiplyScalar(80);
    this.sun.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = -32;
    cam.right = 32;
    cam.top = 32;
    cam.bottom = -32;
    cam.near = 1;
    cam.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // Water with gentle animated waves and sun glints.
    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { time: { value: 0 }, sunDir: { value: new THREE.Vector3(0.55, 0.42, -0.72).normalize() } },
      vertexShader: `uniform float time; varying vec3 vWorld; varying vec3 vNormal;
        void main(){ vec3 p = position; float w = sin(p.x*0.35+time*1.3)*0.06 + sin(p.y*0.5+time*0.9)*0.05; p.z += w;
          vec4 world = modelMatrix * vec4(p,1.0); vWorld = world.xyz;
          vNormal = normalize(vec3(-cos(p.x*0.35+time*1.3)*0.02, 1.0, -cos(p.y*0.5+time*0.9)*0.025));
          gl_Position = projectionMatrix * viewMatrix * world; }`,
      fragmentShader: `uniform vec3 sunDir; uniform float time; varying vec3 vWorld; varying vec3 vNormal;
        void main(){ vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(view, vec3(0.0,1.0,0.0)), 0.0), 3.0);
          vec3 deep = vec3(0.05,0.32,0.55), shallow = vec3(0.18,0.62,0.72);
          vec3 c = mix(shallow, deep, clamp(length(vWorld.xz)/90.0, 0.0, 1.0));
          c = mix(c, vec3(0.75,0.85,0.95), fres*0.6);
          vec3 h = normalize(sunDir + view); float spec = pow(max(dot(normalize(vNormal), h), 0.0), 180.0);
          c += vec3(1.0,0.9,0.7) * spec * 1.5;
          gl_FragColor = vec4(c, 0.82 + fres*0.15); }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800, 160, 160), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = config.world.waterLevel - 0.15;
    this.group.add(this.water);

    // Vines: long ropes from the canopy almost to the ground, with leaf tufts along them.
    const vineMat = new THREE.MeshLambertMaterial({ color: 0x3f7a2a });
    // Vines drift gently, more toward their free ends.
    vineMat.onBeforeCompile = (shader) => {
      shader.uniforms.wind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float wind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float vph = wind * 1.1 + instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.3;
          float free = 0.5 - position.y;
          transformed.x += sin(vph) * free * 0.16;
          transformed.z += cos(vph * 0.7) * free * 0.12;`,
        );
    };
    this.vineMat = vineMat;
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x5aa83a });
    this.vineMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1, 0.14), vineMat, island.vines.length);
    const tufts: THREE.Matrix4[] = [];
    island.vines.forEach((v, i) => {
      this.vineIndex.set(v, i);
      const len = v.top - v.bottom;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(v.x, v.bottom + len / 2, v.z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1));
      this.vineMatrices.push(m);
      this.vineMesh.setMatrixAt(i, m);
      for (let y = v.bottom; y < v.top; y += 1.6 + (i % 3) * 0.3)
        tufts.push(new THREE.Matrix4().compose(
          new THREE.Vector3(v.x + Math.sin(y * 3 + i) * 0.12, y, v.z + Math.cos(y * 2 + i) * 0.12),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, y * 1.7 + i, 0.3)),
          new THREE.Vector3(1, 1, 1),
        ));
    });
    const tuftMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), leafMat, tufts.length);
    tufts.forEach((m, i) => tuftMesh.setMatrixAt(i, m));
    this.vineMesh.castShadow = tuftMesh.castShadow = true;
    this.group.add(this.vineMesh, tuftMesh);

    // Highlight ring for the vine the local gorilla can grab.
    this.anchorMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.06, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.anchorMarker.renderOrder = 10;
    this.anchorMarker.visible = false;
    this.group.add(this.anchorMarker);

    // Boat beacons: tall soft beams of light that are visible across the island.
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const dock of island.docks) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 60, 16, 1, true), beamMat);
      beam.position.set(dock.zone.x, dock.zone.y + 30, dock.zone.z);
      this.beacons.push(beam);
      this.group.add(beam);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(config.match.boatZoneRadius - 0.3, config.match.boatZoneRadius, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(dock.zone.x, dock.zone.y + 0.08, dock.zone.z);
      this.group.add(ring);
    }

    scene.fog = new THREE.Fog(0xe9d8bf, 70, 230);

    // The wildfire: a wall of flickering flame around the safe circle.
    this.fireWallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float time; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vec2(vUv.x * 160.0, vUv.y * 4.0 - time * 1.6);
          float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.4;
          float body = smoothstep(1.0, 0.0, vUv.y) * (0.55 + n);
          float tongues = smoothstep(0.35, 0.95, n - vUv.y * 0.9);
          float a = clamp(body * 0.55 + tongues, 0.0, 1.0) * smoothstep(1.0, 0.75, vUv.y);
          vec3 c = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.85,0.3), clamp(tongues + (1.0 - vUv.y) * 0.3, 0.0, 1.0));
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    this.fireWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), this.fireWallMat);
    this.fireWall.visible = false;
    this.fireWall.frustumCulled = false;
    this.group.add(this.fireWall);

    // Rain: streaks that follow the camera.
    const drops = quality === 'high' ? 1400 : 700;
    const rainPos = new Float32Array(drops * 6);
    for (let i = 0; i < drops; i++) {
      const x = (Math.random() - 0.5) * 50, y = Math.random() * 30, z = (Math.random() - 0.5) * 50;
      rainPos.set([x, y, z, x + 0.06, y - 0.7, z + 0.03], i * 6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // A lightning bolt, redrawn for each strike.
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
  }

  private buildChunk(cx: number, cy: number, cz: number): void {
    const key = `${cx},${cy},${cz}`;
    const old = this.chunks.get(key);
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.chunks.delete(key);
    }
    const world = this.island.world;
    if (cx < 0 || cy < 0 || cz < 0 || cx * CHUNK >= world.sx || cy * CHUNK >= world.sy || cz * CHUNK >= world.sz) return;
    const m = meshChunk(world, cx, cy, cz);
    if (!m) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
    geo.setAttribute('sway', new THREE.BufferAttribute(m.sway, 1));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.chunks.set(key, mesh);
  }

  /** Rebuilds chunks the match changed (craters, smashed leaves, fire), a few per frame. */
  refreshChunks(max = 4): void {
    const dirty = this.island.world.dirtyChunks;
    let n = 0;
    for (const key of dirty) {
      if (n++ >= max) break;
      dirty.delete(key);
      const [cx, cy, cz] = key.split(',').map(Number);
      this.buildChunk(cx, cy, cz);
    }
  }

  /** Sets the round's look: sky, sun, fog and rain. */
  setWeather(w: Weather): void {
    this.weather = PRESETS[w];
    this.rain.visible = w === 'storm';
    this.applyLook();
  }

  /** A lightning strike: the sky flashes and a bolt forks down at `at`. */
  lightning(at: { x: number; y: number; z: number }): void {
    this.flash = 1;
    this.boltLife = 0.25;
    const p = this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
    let x = at.x, z = at.z;
    for (let i = 0; i < 16; i++) {
      const y = 90 - (i / 15) * 90;
      p.setXYZ(i, x, y, z);
      x += (Math.random() - 0.5) * 6;
      z += (Math.random() - 0.5) * 6;
    }
    p.needsUpdate = true;
    this.bolt.visible = true;
  }

  private applyLook(): void {
    const w = this.weather, f = this.fireGlow, fl = this.flash;
    const fireSky = new THREE.Color(0x8a3a1c), fireHorizon = new THREE.Color(0xff8a3c);
    (this.skyMat.uniforms.top.value as THREE.Color).copy(w.top).lerp(fireSky, f * 0.7).lerp(new THREE.Color(0xdfe8ff), fl * 0.8);
    (this.skyMat.uniforms.horizon.value as THREE.Color).copy(w.horizon).lerp(fireHorizon, f * 0.6).lerp(new THREE.Color(0xffffff), fl * 0.8);
    this.skyMat.uniforms.sunAmount.value = w.sunAmount;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(w.fog).lerp(new THREE.Color(0xc0764a), f * 0.5).lerp(new THREE.Color(0xe8eeff), fl * 0.6);
    fog.near = w.fogNear * (1 - f * 0.3);
    fog.far = w.fogFar * (1 - f * 0.25);
    this.sun.color.copy(w.sun).lerp(new THREE.Color(0xff9a5a), f * 0.5);
    this.sun.intensity = w.sunIntensity;
    this.hemi.intensity = w.hemi + fl * 2.5;
    this.hemi.color.copy(w.hemiSky).lerp(new THREE.Color(0xffb27a), f * 0.4);
  }

  /** Hides the hanging vine the local gorilla is swinging on (the rope is drawn instead). */
  hideVine(vine: Vine | null): void {
    if (vine === this.hiddenVine) return;
    const restore = this.hiddenVine !== null ? this.vineIndex.get(this.hiddenVine) : undefined;
    if (restore !== undefined) this.vineMesh.setMatrixAt(restore, this.vineMatrices[restore]);
    const hide = vine ? this.vineIndex.get(vine) : undefined;
    if (hide !== undefined) this.vineMesh.setMatrixAt(hide, new THREE.Matrix4().makeScale(0, 0, 0));
    this.hiddenVine = vine;
    this.vineMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Per-frame: waves, wind, beacon pulse, shadows that follow the player, and the fire wall
   * (`fireRadius` Infinity before the fire, `fireCenter` its middle).
   */
  update(time: number, focus: THREE.Vector3, cameraPosition: THREE.Vector3, fire?: { center: { x: number; z: number }; radius: number; progress: number }): void {
    this.waterMaterial.uniforms.time.value = time;
    this.windUniform.value = time * (this.weather === PRESETS.storm ? 2.2 : 1);
    this.refreshChunks(this.quality === 'high' ? 4 : 2);

    // Fire wall and the burning sky.
    const burning = !!fire && Number.isFinite(fire.radius);
    this.fireWall.visible = burning;
    if (fire && burning) {
      this.fireWall.position.set(fire.center.x, 7, fire.center.z);
      this.fireWall.scale.set(fire.radius, 16, fire.radius);
      this.fireWallMat.uniforms.time.value = time;
    }
    const glow = burning && fire ? 0.35 + 0.65 * fire.progress : 0;
    this.fireGlow += (glow - this.fireGlow) * 0.02;

    // Rain falls around the camera; lightning fades.
    if (this.rain.visible) {
      // The 30 m column of drops slides down and wraps every 15 m, always around the camera.
      const fall = (time * 22) % 15;
      this.rain.position.set(cameraPosition.x, cameraPosition.y - 8 - fall, cameraPosition.z);
    }
    this.flash = Math.max(0, this.flash - 0.06);
    this.boltLife -= 1 / 60;
    if (this.boltLife <= 0) this.bolt.visible = false;
    this.applyLook();
    this.sky.position.copy(cameraPosition);
    const pulse = 0.25 + 0.1 * Math.sin(time * 2.5);
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).opacity = pulse;
    // Keep the shadow map centred on the action, snapped to texels to avoid shimmering.
    const snap = 64 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + 0.55 * 80, 0.42 * 80, fz - 0.72 * 80);
  }
}

interface Preset {
  top: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  sun: THREE.Color;
  sunIntensity: number;
  sunAmount: number;
  hemi: number;
  hemiSky: THREE.Color;
}

/** The three looks a round can have. */
const PRESETS: Record<Weather, Preset> = {
  sunset: {
    top: new THREE.Color(0x3a8ee6),
    horizon: new THREE.Color(0xf6d9b0),
    fog: new THREE.Color(0xe9d8bf),
    fogNear: 70,
    fogFar: 230,
    sun: new THREE.Color(0xffe2b8),
    sunIntensity: 2.4,
    sunAmount: 1,
    hemi: 1.3,
    hemiSky: new THREE.Color(0xcfe3ff),
  },
  // Misty dawn: soft, cool and close. Long shots disappear into the haze.
  mist: {
    top: new THREE.Color(0x9fb3c4),
    horizon: new THREE.Color(0xe3e1d6),
    fog: new THREE.Color(0xd9dcd4),
    fogNear: 8,
    fogFar: 58,
    sun: new THREE.Color(0xfff0d8),
    sunIntensity: 1.2,
    sunAmount: 0.3,
    hemi: 1.6,
    hemiSky: new THREE.Color(0xe8eef2),
  },
  // Rainstorm: dark and blue-grey, lit by lightning.
  storm: {
    top: new THREE.Color(0x2c3540),
    horizon: new THREE.Color(0x5d6670),
    fog: new THREE.Color(0x4c545c),
    fogNear: 25,
    fogFar: 130,
    sun: new THREE.Color(0xb8c4d4),
    sunIntensity: 0.7,
    sunAmount: 0,
    hemi: 1.05,
    hemiSky: new THREE.Color(0x9fb0c4),
  },
};
