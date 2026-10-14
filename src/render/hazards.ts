import * as THREE from 'three';
import type { Match } from '../game/match';
import type { Effects } from './effects';

/**
 * Draws the match's hazards and tools: net traps (flat on the ground, then wrapped round a caught
 * gorilla), flares with their red light, the fire's embers and smoke near the camera, flames on
 * anyone caught in the fire, and markers that show revealed players through walls.
 */
export class HazardView {
  private readonly nets = new Map<number, THREE.Group>();
  private readonly netMat = new THREE.MeshLambertMaterial({ color: 0xd8c99a });
  private readonly flareMeshes: { mesh: THREE.Mesh; light: THREE.PointLight }[] = [];
  private readonly flareMat = new THREE.MeshBasicMaterial({ color: 0xff3b2b });
  private readonly markers: THREE.Mesh[] = [];
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly markerGeo = new THREE.OctahedronGeometry(0.35);
  private emberTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly effects: Effects,
  ) {}

  /** A net: a square of rope voxels, lifted into a dome when it springs. */
  private buildNet(): THREE.Group {
    const g = new THREE.Group();
    const strand = new THREE.BoxGeometry(2.0, 0.05, 0.05);
    for (let i = -4; i <= 4; i++) {
      const a = new THREE.Mesh(strand, this.netMat);
      a.position.z = i * 0.25;
      const b = new THREE.Mesh(strand, this.netMat);
      b.rotation.y = Math.PI / 2;
      b.position.x = i * 0.25;
      g.add(a, b);
    }
    return g;
  }

  update(match: Match, localTeam: 'gorilla' | 'hunter' | null, localId: number, camera: THREE.Camera, time: number, dt: number): void {
    const t = match.ctx.time;

    // Nets.
    const live = new Set<number>();
    for (const n of match.nets) {
      live.add(n.id);
      let g = this.nets.get(n.id);
      if (!g) {
        g = this.buildNet();
        this.scene.add(g);
        this.nets.set(n.id, g);
      }
      // Gorillas only see a waiting net when they are right on top of it.
      const near = localTeam !== 'gorilla' || match.gorillas.get(localId) === undefined
        ? true
        : Math.hypot(match.gorillas.get(localId)!.body.x - n.x, match.gorillas.get(localId)!.body.z - n.z) < 4;
      if (n.caught !== null) {
        const gor = match.gorillas.get(n.caught);
        g.visible = true;
        g.position.set(gor?.body.x ?? n.x, (gor?.body.y ?? n.y) + 1.4, gor?.body.z ?? n.z);
        g.scale.set(1, 1, 1);
        // Wrapped: tilt the strands into a cage and shiver.
        g.rotation.set(Math.sin(time * 30) * 0.05, time * 0.5, Math.PI / 2 + Math.sin(time * 27) * 0.05);
      } else {
        g.visible = near;
        g.position.set(n.x, n.y + 0.04, n.z);
        g.rotation.set(0, 0, 0);
        g.scale.set(1, 1, 1);
      }
    }
    for (const [id, g] of this.nets)
      if (!live.has(id)) {
        g.removeFromParent();
        this.nets.delete(id);
      }

    // Flares: a red ball of light drifting down, trailing smoke.
    while (this.flareMeshes.length < match.flares.length) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.flareMat);
      const light = new THREE.PointLight(0xff4a2a, 40, 45, 1.6);
      mesh.add(light);
      this.scene.add(mesh);
      this.flareMeshes.push({ mesh, light });
    }
    this.flareMeshes.forEach((f, i) => {
      const fl = match.flares[i];
      f.mesh.visible = !!fl;
      if (!fl) return;
      f.mesh.position.set(fl.x, fl.y, fl.z);
      const age = t - fl.born;
      f.light.intensity = (age < 0.6 ? age / 0.6 : Math.max(0, 1 - (age - 6) / 2)) * (35 + Math.sin(time * 40) * 6);
      if (Math.random() < 0.5) this.effects.smoke({ x: fl.x, y: fl.y, z: fl.z });
      if (Math.random() < 0.6) this.effects.flame({ x: fl.x, y: fl.y - 0.2, z: fl.z }, 0.2, 1);
    });

    // Fire: embers and smoke along the stretch of the ring nearest the camera; flames on anyone burning.
    this.emberTimer -= dt;
    const r = match.fireRadius;
    if (Number.isFinite(r) && this.emberTimer <= 0) {
      this.emberTimer = 0.05;
      const c = match.wildfire.center;
      const cam = camera.position;
      const base = Math.atan2(cam.z - c.z, cam.x - c.x);
      for (let i = 0; i < 4; i++) {
        const a = base + (Math.random() - 0.5) * 1.4;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (Math.hypot(x - cam.x, z - cam.z) > 70) continue;
        const y = match.ctx.world.surfaceHeight(x, z);
        this.effects.flame({ x, y, z }, 1.5, 3);
        if (Math.random() < 0.35) this.effects.smoke({ x, y: y + 1, z });
      }
    }
    for (const ch of [...match.gorillas.values(), ...match.hunters.values()]) {
      const heat = match.heat.get(ch.id) ?? 0;
      if (heat <= 0 || (ch.team === 'hunter' && ch.dead)) continue;
      if (Math.random() < 0.6) this.effects.flame({ x: ch.body.x, y: ch.body.y + Math.random() * ch.body.height, z: ch.body.z }, 0.8, 2);
    }

    // Revealed enemies: a red marker above them, drawn through everything.
    let n = 0;
    const enemies = localTeam === 'hunter' ? [...match.gorillas.values()] : localTeam === 'gorilla' ? [...match.hunters.values()].filter((h) => !h.dead) : [];
    for (const e of enemies) {
      if (t >= e.revealedUntil) continue;
      let m = this.markers[n];
      if (!m) {
        m = new THREE.Mesh(this.markerGeo, this.markerMat);
        m.renderOrder = 20;
        this.scene.add(m);
        this.markers.push(m);
      }
      m.visible = true;
      m.position.set(e.body.x, e.body.y + e.body.height + 0.8 + Math.sin(time * 6) * 0.1, e.body.z);
      m.rotation.y = time * 3;
      n++;
    }
    for (let i = n; i < this.markers.length; i++) this.markers[i].visible = false;
  }

  dispose(): void {
    for (const g of this.nets.values()) g.removeFromParent();
    for (const f of this.flareMeshes) f.mesh.removeFromParent();
    for (const m of this.markers) m.removeFromParent();
  }
}
