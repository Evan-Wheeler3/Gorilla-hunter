import * as THREE from 'three';
import { config } from '../core/config';
import type { Island } from '../world/island';
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
  private readonly sky: THREE.Mesh;

  constructor(scene: THREE.Scene, island: Island, quality: 'high' | 'low') {
    scene.add(this.group);
    const world = island.world;

    // Terrain.
    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let cy = 0; cy < Math.ceil(world.sy / CHUNK); cy++)
      for (let cz = 0; cz < Math.ceil(world.sz / CHUNK); cz++)
        for (let cx = 0; cx < Math.ceil(world.sx / CHUNK); cx++) {
          const m = meshChunk(world, cx, cy, cz);
          if (!m) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
          geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, terrainMat);
          mesh.castShadow = quality === 'high';
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }

    // Sky: a gradient dome, warm at the horizon.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a8ee6) },
        horizon: { value: new THREE.Color(0xf6d9b0) },
        sunDir: { value: new THREE.Vector3(0.55, 0.42, -0.72).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.85,0.6) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25);
          if (vDir.y < 0.0) c = horizon * 0.9; gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // Light: warm late-afternoon sun plus sky/ground bounce.
    this.group.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a5a3a, 1.3));
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

    // Vines: hang from each anchor up into the crown, with a leafy knot at the bottom.
    const vineMat = new THREE.MeshLambertMaterial({ color: 0x3f7a2a });
    const knotMat = new THREE.MeshLambertMaterial({ color: 0x5aa83a });
    const vineGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    const knotGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const vines = new THREE.InstancedMesh(vineGeo, vineMat, island.anchors.length);
    const knots = new THREE.InstancedMesh(knotGeo, knotMat, island.anchors.length);
    const m4 = new THREE.Matrix4();
    island.anchors.forEach((a, i) => {
      let top = a.y;
      while (top < a.y + 4 && !world.solidAt(a.x, top + 0.25, a.z)) top += 0.25;
      const len = Math.max(0.5, top - a.y + 0.25);
      m4.compose(new THREE.Vector3(a.x, a.y + len / 2, a.z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1));
      vines.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, i, 0.2)), new THREE.Vector3(1, 1, 1));
      knots.setMatrixAt(i, m4);
    });
    vines.castShadow = knots.castShadow = true;
    this.group.add(vines, knots);

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
  }

  /** Per-frame: waves, beacon pulse, shadows that follow the player. */
  update(time: number, focus: THREE.Vector3, cameraPosition: THREE.Vector3): void {
    this.waterMaterial.uniforms.time.value = time;
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
