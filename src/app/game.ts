import * as THREE from 'three';
import { config } from '../core/config';
import type { Gorilla } from '../game/gorilla';
import type { Hunter } from '../game/hunter';
import { Match, type MatchOptions } from '../game/match';
import { forwardOf, rightOf, type InputFrame } from '../game/types';
import { Controls } from '../input/controls';
import { GorillaRig, HunterRig } from '../render/characters';
import { Effects } from '../render/effects';
import { FinisherDirector } from '../render/finishers';
import { WorldView } from '../render/worldView';
import { Hud } from '../ui/hud';
import type { Island } from '../world/island';

const SIM_DT = 1 / 60;
const C = config.controls;

export interface GameOptions {
  island: Island;
  match: MatchOptions;
  localId: number;
  quality: 'high' | 'low';
}

/**
 * Runs one match on this device: fixed-step simulation, third-person camera, character rigs,
 * effects and HUD. (Networked sessions plug in at step(): remote inputs in, snapshots out.)
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);
  readonly controls: Controls;
  readonly hud: Hud;
  match: Match;

  private readonly world: WorldView;
  private readonly effects: Effects;
  private readonly finishers: FinisherDirector;
  private readonly rigs = new Map<number, { team: string; rig: GorillaRig | HunterRig }>();
  private readonly ropes = new Map<number, THREE.Mesh>();
  private readonly ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  private readonly ropeMat = new THREE.MeshLambertMaterial({ color: 0x4d8a2e });
  private readonly clock = new THREE.Clock();
  private accumulator = 0;
  /** Each character's position before the latest sim step, for smooth in-between rendering. */
  private readonly prevPos = new Map<number, { x: number; y: number; z: number }>();
  private alpha = 1;
  private running = false;
  private slowMo = 0; // real seconds of slow motion left
  private sleepPuffTimer = 0;
  private dustTimer = 0;
  private camPos = new THREE.Vector3();
  private camInit = false;
  private time = 0;
  private resizeHandler = () => this.resize();
  onExit: () => void = () => {};
  /** Test hook: a fixed camera (used by automated screenshots). */
  debugView: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: GameOptions,
  ) {
    const quality = options.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    container.appendChild(overlay);
    this.controls = new Controls(this.renderer.domElement, overlay);
    this.hud = new Hud(overlay);
    this.hud.onPlayAgain = () => this.restart();
    this.hud.onMenu = () => this.onExit();

    this.world = new WorldView(this.scene, options.island, quality);
    this.effects = new Effects(this.scene, options.island.world);
    this.finishers = new FinisherDirector(this.scene, this.effects);
    this.finishers.onClimax = (involvesLocal) => {
      if (involvesLocal) this.slowMo = 0.5;
    };
    this.match = new Match(options.island, options.match);
    this.resetCameraToPlayer();

    addEventListener('resize', this.resizeHandler);
    this.resize();
  }

  get me(): Gorilla | Hunter | undefined {
    return this.match.character(this.options.localId);
  }

  start(): void {
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    removeEventListener('resize', this.resizeHandler);
    if (document.pointerLockElement) document.exitPointerLock();
    for (const { rig } of this.rigs.values()) rig.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }

  restart(): void {
    for (const { rig } of this.rigs.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.rigs.clear();
    this.match = new Match(this.options.island, this.options.match);
    this.resetCameraToPlayer();
  }

  private resetCameraToPlayer(): void {
    const me = this.me;
    if (me) this.controls.yaw = me.yaw;
    this.controls.pitch = -0.15;
    this.camInit = false;
  }

  private resize(): void {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Wider view on tall phone screens so the action still fits.
    this.camera.fov = w < h ? 82 : 70;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ Frame

  private frame(): void {
    const realDt = Math.min(0.1, this.clock.getDelta());
    this.slowMo = Math.max(0, this.slowMo - realDt);
    const dt = realDt * (this.slowMo > 0 ? 0.25 : 1);
    this.time += dt;

    const me = this.me;
    if (me) this.controls.setTeam(me.team);
    const control = this.controls.read();

    // Fixed-step simulation; the local player's input applies to the first step only for one-shot buttons.
    this.accumulator += dt;
    let first = true;
    while (this.accumulator >= SIM_DT) {
      const input: InputFrame = {
        moveX: control.moveX,
        moveY: control.moveY,
        yaw: control.yaw,
        pitch: control.pitch,
        jump: first && control.jump,
        sprint: control.sprint,
        dash: first && control.dash,
        primary: first && control.primary,
        primaryHeld: control.primaryHeld,
        aim: control.aim,
        interact: first && control.interact,
        interactHeld: control.interactHeld,
        aimPoint: first && control.primary ? this.aimPoint() : null,
      };
      for (const c of [...this.match.gorillas.values(), ...this.match.hunters.values()]) this.prevPos.set(c.id, { x: c.body.x, y: c.body.y, z: c.body.z });
      this.match.step(SIM_DT, new Map([[this.options.localId, input]]));
      this.accumulator -= SIM_DT;
      first = false;
    }
    if (first && (control.jump || control.dash || control.primary || control.interact)) {
      // A frame without a sim step: keep one-shot presses for the next frame.
      this.controls.requeue(control);
    }

    this.alpha = Math.min(1, this.accumulator / SIM_DT);
    this.consumeEffects();
    this.syncRigs(dt);
    this.finishers.update(dt, this.time);
    this.updateCamera(realDt);
    this.effects.update(dt, this.match.darts);
    const focus = me ? new THREE.Vector3(me.body.x, 0, me.body.z) : this.camera.position;
    this.world.update(this.time, focus, this.camera.position);
    this.updateAnchorMarker();

    const project = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(this.camera);
      if (v.z > 1) return null;
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    };
    this.hud.setHint(!this.controls.isTouch && !this.controls.pointerLocked ? 'Click to play  ·  Esc frees the mouse' : '');
    this.hud.update(this.match, this.me, project, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private consumeEffects(): void {
    const id = this.options.localId;
    for (const e of this.match.effects.splice(0)) {
      switch (e.type) {
        case 'kill': {
          const rig = this.rigs.get(e.killer)?.rig;
          if (e.dash) this.finishers.dashKill({ ...e, dash: e.dash }, id);
          else if (e.finisher && rig instanceof GorillaRig) this.finishers.start(e, rig, id);
          else this.effects.hunterKilled(e.at, e.yaw, e.pick); // a second hunter caught in the same swipe
          break;
        }
        case 'dartHit':
          this.effects.dartHit(e.at, e.target !== null);
          break;
        case 'knockout': {
          const g = this.match.gorillas.get(e.gorilla);
          if (g) this.effects.knockout({ x: g.body.x, y: g.body.y, z: g.body.z });
          break;
        }
        case 'slap':
          this.effects.slap(e.at);
          break;
        case 'convert':
          this.effects.confetti(e.at);
          break;
        case 'thrownOff':
          if (e.hunter === id) this.effects.shake = 0.5;
          break;
        case 'shot':
          if (e.hunter === id) this.effects.shake = Math.max(this.effects.shake, 0.08);
          break;
      }
    }
  }

  private syncRigs(dt: number): void {
    const alive = new Set<number>();
    const all: (Gorilla | Hunter)[] = [...this.match.gorillas.values(), ...this.match.hunters.values()];
    this.sleepPuffTimer -= dt;
    this.dustTimer -= dt;
    for (const c of all) {
      alive.add(c.id);
      let entry = this.rigs.get(c.id);
      if (entry && entry.team !== c.team) {
        this.scene.remove(entry.rig.root);
        entry.rig.dispose();
        entry = undefined;
      }
      if (!entry) {
        entry = { team: c.team, rig: c.team === 'gorilla' ? new GorillaRig() : new HunterRig() };
        this.scene.add(entry.rig.root);
        this.rigs.set(c.id, entry);
      }
      if (c.team === 'gorilla') {
        (entry.rig as GorillaRig).update(c, dt, this.time, this.finishers.poseFor(c.id));
        entry.rig.root.position.copy(this.renderPos(c));
        this.updateRope(c, entry.rig as GorillaRig);
        if (c.sedation.isDown && this.sleepPuffTimer <= 0) this.effects.sleepPuff(c.body);
        if (c.body.onGround && Math.hypot(c.vel.x, c.vel.z) > 6 && this.dustTimer <= 0) this.effects.dust(c.body, 2);
      } else {
        (entry.rig as HunterRig).update(c, dt, this.time);
        entry.rig.root.position.copy(this.renderPos(c));
      }
    }
    if (this.sleepPuffTimer <= 0) this.sleepPuffTimer = 0.5;
    if (this.dustTimer <= 0) this.dustTimer = 0.06;
    for (const [rid, entry] of this.rigs)
      if (!alive.has(rid)) {
        this.scene.remove(entry.rig.root);
        entry.rig.dispose();
        this.rigs.delete(rid);
      }
  }

  /** Where to draw a character: between its last two sim positions, so motion is smooth at any frame rate. */
  private renderPos(c: Gorilla | Hunter): THREE.Vector3 {
    const cur = c.body, prev = this.prevPos.get(c.id);
    if (!prev || Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z) > 3) return new THREE.Vector3(cur.x, cur.y, cur.z); // teleported
    const a = this.alpha;
    return new THREE.Vector3(prev.x + (cur.x - prev.x) * a, prev.y + (cur.y - prev.y) * a, prev.z + (cur.z - prev.z) * a);
  }

  /** The vine a gorilla is swinging on, drawn from its raised hand to the anchor. */
  private updateRope(g: Gorilla, rig: GorillaRig): void {
    let rope = this.ropes.get(g.id);
    if (!g.swingPivot || g.state !== 'swing') {
      if (rope) rope.visible = false;
      return;
    }
    if (!rope) {
      rope = new THREE.Mesh(this.ropeGeo, this.ropeMat);
      rope.castShadow = true;
      this.scene.add(rope);
      this.ropes.set(g.id, rope);
    }
    const hand = rig.hand(1);
    const a = new THREE.Vector3(g.swingPivot.x, g.swingPivot.y, g.swingPivot.z);
    rope.visible = true;
    rope.position.copy(hand).add(a).multiplyScalar(0.5);
    rope.scale.set(1, hand.distanceTo(a), 1);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.sub(hand).normalize());
  }

  // ------------------------------------------------------------------ Camera and aiming

  private cameraPivot(): { pivot: THREE.Vector3; distance: number; fov: number } {
    const me = this.me;
    const yaw = this.controls.yaw;
    const baseFov = this.camera.aspect < 1 ? 82 : 70;
    if (!me) return { pivot: new THREE.Vector3(0, 10, 0), distance: 10, fov: baseFov };
    const at = this.renderPos(me);
    if (me.team === 'gorilla') {
      const down = me.sedation.isDown;
      // Swinging happens right under the canopy: keep the camera at body height so it stays below the leaves.
      const height = down ? 1.6 : me.state === 'swing' ? 1.5 : C.cameraHeightGorilla;
      return {
        pivot: new THREE.Vector3(at.x, at.y + height, at.z),
        distance: down ? 8 : me.state === 'swing' ? 7.5 : me.inFinisher ? C.cameraDistanceGorilla + 2.5 : C.cameraDistanceGorilla,
        fov: baseFov + (me.dashing ? 10 : 0) + Math.min(8, Math.hypot(me.vel.x, me.vel.z) * 0.4),
      };
    }
    const r = rightOf(yaw);
    const aiming = me.aiming;
    const dragging = me.dragging !== null;
    const shoulder = aiming ? 0.95 : C.cameraShoulderHunter;
    return {
      pivot: new THREE.Vector3(at.x + r.x * shoulder, at.y + C.cameraHeightHunter + (dragging ? 1.2 : aiming ? 0.1 : 0), at.z + r.z * shoulder),
      distance: me.dead ? 7 : aiming ? 2.3 : dragging ? 5.5 : C.cameraDistanceHunter,
      fov: aiming ? baseFov * 0.65 : baseFov + (me.sprinting ? 6 : 0),
    };
  }

  private viewDir(): THREE.Vector3 {
    const f = forwardOf(this.controls.yaw);
    const cp = Math.cos(this.controls.pitch);
    return new THREE.Vector3(f.x * cp, Math.sin(this.controls.pitch), f.z * cp);
  }

  private updateCamera(dt: number): void {
    if (this.debugView) {
      const { from, to } = this.debugView;
      this.camera.position.set(from.x, from.y, from.z);
      this.camera.lookAt(to.x, to.y, to.z);
      return;
    }
    const { pivot, distance, fov } = this.cameraPivot();
    const dir = this.viewDir();
    // Pull in if the view behind the pivot is blocked by terrain or trees.
    const hit = this.options.island.world.raycast(pivot.x, pivot.y, pivot.z, -dir.x, -dir.y, -dir.z, distance);
    const d = hit >= 0 ? Math.max(0.6, hit - 0.35) : distance;
    const target = pivot.clone().addScaledVector(dir, -d);
    if (!this.camInit) {
      this.camPos.copy(target);
      this.camInit = true;
    }
    this.camPos.lerp(target, 1 - Math.exp(-18 * dt));
    this.camera.position.copy(this.camPos);
    if (this.effects.shake > 0) {
      const s = this.effects.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(pivot.clone().addScaledVector(dir, 20));
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-10 * dt));
    this.camera.updateProjectionMatrix();
  }

  /** World point under the crosshair (with gentle aim assist on touch screens). */
  private aimPoint(): { x: number; y: number; z: number } {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const world = this.options.island.world;

    if (this.controls.isTouch) {
      let best: Gorilla | null = null, bestDot = Math.cos(THREE.MathUtils.degToRad(6));
      for (const g of this.match.gorillas.values()) {
        if (g.sedation.isDown) continue;
        const c = new THREE.Vector3(g.body.x, g.body.y + 1.4, g.body.z);
        const to = c.clone().sub(origin);
        const dist = to.length();
        const dot = to.normalize().dot(dir);
        const blocked = world.raycast(origin.x, origin.y, origin.z, to.x, to.y, to.z, dist - 1) >= 0;
        if (dot > bestDot && !blocked) {
          bestDot = dot;
          best = g;
        }
      }
      if (best) return { x: best.body.x, y: best.body.y + 1.4, z: best.body.z };
    }

    const t = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 250);
    const dist = t >= 0 ? t : 250;
    return { x: origin.x + dir.x * dist, y: origin.y + dir.y * dist, z: origin.z + dir.z * dist };
  }

  private updateAnchorMarker(): void {
    const me = this.me;
    const marker = this.world.anchorMarker;
    const vine = me && me.team === 'gorilla' ? me.vineInRange(this.match.ctx) : null;
    this.world.hideVine(me && me.team === 'gorilla' ? me.swingVine : null);
    marker.visible = !!vine;
    if (vine && me) {
      const y = Math.max(vine.bottom, Math.min(vine.top, me.body.y + 2.6));
      marker.position.set(vine.x, y, vine.z);
      marker.lookAt(this.camera.position);
      const s = 1 + 0.15 * Math.sin(this.time * 8);
      marker.scale.set(s, s, s);
    }
  }
}
