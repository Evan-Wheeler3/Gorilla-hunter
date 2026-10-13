import * as THREE from 'three';
import { config } from '../core/config';
import type { Gorilla } from '../game/gorilla';
import type { Hunter } from '../game/hunter';
import { Match, type MatchOptions } from '../game/match';
import { forwardOf, rightOf, type InputFrame } from '../game/types';
import { rayBox } from '../game/match';
import { Bots } from '../game/bots';
import { sound } from '../audio/sound';
import { Controls } from '../input/controls';
import { GorillaRig, HunterRig } from '../render/characters';
import { Effects } from '../render/effects';
import { FinisherDirector } from '../render/finishers';
import { WorldView } from '../render/worldView';
import { Hud } from '../ui/hud';
import type { Island } from '../world/island';

const SIM_DT = 1 / 60;
const C = config.controls;
const H = config.hunter;

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
  private readonly aimArc = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff4fa0, transparent: true, opacity: 0.75, depthWrite: false }),
    18,
  );
  private readonly aimImpact = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.32, 20),
    new THREE.MeshBasicMaterial({ color: 0xff4fa0, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
  );
  private bots = new Bots();
  private hitStop = 0; // real seconds the action freezes on a big hit
  private lastGoreSound = -1;
  private readonly audioState = new Map<number, { stride: number; dashing: boolean; loaded: boolean }>();
  private lastBeep = -1;
  /** Red ring under the hunter a gorilla would kill right now (swipe or dash). */
  private readonly killRing = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 1.0, 28),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  );
  private camAnchor = new THREE.Vector3();
  private camShape = { height: 0, shoulder: 0, distance: 0 };
  private camBlock = 6;
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
      if (involvesLocal) this.hitStop = 0.07;
    };
    this.finishers.onVoice = (kind, at) => (kind === 'roar' ? sound.roar(at, true) : sound.scream(at));
    this.effects.onGore = (at, count) => {
      if (this.time - this.lastGoreSound < 0.07) return;
      this.lastGoreSound = this.time;
      sound.splat(at, count >= 40);
    };
    this.match = new Match(options.island, options.match);
    this.resetCameraToPlayer();
    this.aimArc.frustumCulled = false;
    this.aimImpact.renderOrder = 10;
    this.scene.add(this.aimArc, this.aimImpact, this.killRing);
    this.killRing.rotation.x = -Math.PI / 2;
    this.killRing.renderOrder = 10;

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
    this.bots = new Bots();
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
    // Hit-stop: a few frames of freeze on a big hit, then slow motion if it was ours.
    const frozen = this.hitStop > 0;
    this.hitStop = Math.max(0, this.hitStop - realDt);
    const dt = frozen ? 0 : realDt * (this.slowMo > 0 ? 0.25 : 1);
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
      const inputs = this.bots.inputs(this.match, SIM_DT, new Set([this.options.localId]));
      inputs.set(this.options.localId, input);
      this.match.step(SIM_DT, inputs);
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
    this.updateLookScale();
    this.updateAimArc();
    this.updateAudio();
    this.updateKillRing();
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
          if (e.dash) {
            this.finishers.dashKill({ ...e, dash: e.dash }, id);
            if (e.killer === id || e.victim === id) this.hitStop = 0.09;
          }
          else if (e.finisher && rig instanceof GorillaRig) this.finishers.start(e, rig, id);
          else this.effects.hunterKilled(e.at, e.yaw, e.pick); // a second hunter caught in the same swipe
          break;
        }
        case 'dartHit':
          this.effects.dartHit(e.at, e.target !== null);
          sound.dartHit(e.at, e.target !== null);
          if (e.target === id) this.effects.shake = Math.max(this.effects.shake, 0.3);
          break;
        case 'knockout': {
          const g = this.match.gorillas.get(e.gorilla);
          if (g) {
            this.effects.knockout({ x: g.body.x, y: g.body.y, z: g.body.z });
            sound.knockout(g.body);
          }
          break;
        }
        case 'slap':
          this.effects.slap(e.at);
          sound.slap(e.at);
          break;
        case 'convert':
          this.effects.confetti(e.at);
          sound.convert(e.at);
          break;
        case 'swipe': {
          const g = this.match.gorillas.get(e.gorilla);
          if (g) sound.swipe(g.body);
          break;
        }
        case 'roundEnd': {
          const me = this.me;
          const won = !!me && ((e.result === 'huntersWin') === (me.team === 'hunter'));
          sound.jingle(won);
          break;
        }
        case 'thrownOff':
          if (e.hunter === id) this.effects.shake = 0.5;
          break;
        case 'shot': {
          if (e.hunter === id) this.effects.shake = Math.max(this.effects.shake, 0.08);
          const h = this.match.hunters.get(e.hunter);
          sound.shot(e.hunter === id || !h ? null : h.body);
          break;
        }
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
        (entry.rig as GorillaRig).update(c, dt, this.simTime, this.finishers.poseFor(c.id));
        entry.rig.root.position.copy(this.renderPos(c));
        this.updateRope(c, entry.rig as GorillaRig);
        if (c.sedation.isDown && this.sleepPuffTimer <= 0) this.effects.sleepPuff(c.body);
        if (c.body.onGround && Math.hypot(c.vel.x, c.vel.z) > 6 && this.dustTimer <= 0) this.effects.dust(c.body, 2);
        if (c.dashing) this.effects.streak(c.body, c.vel.x, c.vel.z);
      } else {
        (entry.rig as HunterRig).update(c, dt, this.simTime);
        (entry.rig as HunterRig).setGhost(c.id === this.options.localId && c.aiming); // see through yourself while aiming
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

  /** Match time at this frame (between sim steps): character timestamps are on this clock. */
  private get simTime(): number {
    return this.match.ctx.time - (1 - this.alpha) * SIM_DT;
  }

  private updateKillRing(): void {
    const me = this.me;
    this.killRing.visible = false;
    if (!me || me.team !== 'gorilla' || me.sedation.isDown || me.inFinisher || this.debugView) return;
    const f = forwardOf(this.controls.yaw);
    const G = config.gorilla;
    let best: Hunter | null = null, bestD = Infinity, dashOnly = false;
    for (const h of this.match.hunters.values()) {
      if (h.dead) continue;
      const dx = h.body.x - me.body.x, dz = h.body.z - me.body.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(h.body.y - me.body.y) > 2.5 || d > 7 || d >= bestD) continue;
      const ahead = (dx * f.x + dz * f.z) / (d || 1);
      if (d < G.swipeRange + 0.6 && ahead > 0.3) {
        best = h;
        bestD = d;
        dashOnly = false;
      } else if (ahead > 0.92 && d < G.dashSpeed * G.dashDuration + 1.5) {
        best = h;
        bestD = d;
        dashOnly = true;
      }
    }
    if (!best) return;
    const p = this.renderPos(best);
    this.killRing.visible = true;
    this.killRing.position.set(p.x, p.y + 0.06, p.z);
    const s = 1 + 0.12 * Math.sin(this.time * 12);
    this.killRing.scale.set(s, s, s);
    (this.killRing.material as THREE.MeshBasicMaterial).color.setHex(dashOnly ? 0xffb020 : 0xff3b3b);
  }

  /** Listener follows the camera; footsteps, dashes, reloads and the final countdown. */
  private updateAudio(): void {
    sound.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.controls.yaw);
    sound.update();
    for (const c of [...this.match.gorillas.values(), ...this.match.hunters.values()]) {
      let st = this.audioState.get(c.id);
      if (!st) {
        st = { stride: c.stride, dashing: false, loaded: true };
        this.audioState.set(c.id, st);
      }
      const gorilla = c.team === 'gorilla';
      const stepLen = gorilla ? 1.2 : c.team === 'hunter' && c.sprinting ? 0.95 : 0.75;
      if (Math.floor(c.stride / stepLen) !== Math.floor(st.stride / stepLen) && c.body.onGround) sound.footstep(c.body, gorilla);
      st.stride = c.stride;
      if (c.team === 'gorilla') {
        if (c.dashing && !st.dashing) {
          sound.dash(c.body);
          if (c.id !== this.options.localId || Math.random() < 0.5) sound.roar(c.body);
        }
        st.dashing = c.dashing;
      } else {
        if (c.id === this.options.localId && c.loaded && !st.loaded) sound.reloaded();
        st.loaded = c.loaded;
      }
    }
    // Final ten seconds of the round.
    const left = Math.ceil(this.match.round.timeRemaining);
    if (this.match.round.phase === 'hunt' && left <= 10 && left > 0 && left !== this.lastBeep) {
      this.lastBeep = left;
      sound.beep(left <= 3);
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

  /** Where the camera wants to be relative to the player; composed with the live view direction. */
  private cameraRig(): { anchor: THREE.Vector3; height: number; shoulder: number; distance: number; fov: number } {
    const me = this.me;
    const baseFov = this.camera.aspect < 1 ? 82 : 70;
    if (!me) return { anchor: new THREE.Vector3(0, 0, 0), height: 10, shoulder: 0, distance: 10, fov: baseFov };
    const anchor = this.renderPos(me);
    if (me.team === 'gorilla') {
      const down = me.sedation.isDown;
      // Swinging happens right under the canopy: keep the camera at body height so it stays below the leaves.
      return {
        anchor,
        height: down ? 1.6 : me.state === 'swing' ? 1.5 : me.state === 'climb' ? 2.2 : C.cameraHeightGorilla,
        shoulder: 0,
        distance: down ? 8 : me.state === 'swing' ? 7.5 : me.inFinisher ? C.cameraDistanceGorilla + 2.5 : C.cameraDistanceGorilla,
        fov: baseFov + (me.dashing ? 10 : 0) + Math.min(8, Math.hypot(me.vel.x, me.vel.z) * 0.4),
      };
    }
    const aiming = me.aiming;
    const dragging = me.dragging !== null;
    return {
      anchor,
      height: C.cameraHeightHunter + (dragging ? 1.0 : aiming ? 0.05 : 0),
      // Aiming: tight over the right shoulder, far enough out that the head stays clear of the crosshair.
      shoulder: me.dead ? 0 : aiming ? 1.1 : C.cameraShoulderHunter,
      distance: me.dead ? 7 : aiming ? 2.6 : dragging ? 5.5 : C.cameraDistanceHunter,
      fov: aiming ? baseFov * 0.7 : baseFov + (me.sprinting ? 5 : 0),
    };
  }

  private viewDir(): THREE.Vector3 {
    const f = forwardOf(this.controls.yaw);
    const cp = Math.cos(this.controls.pitch);
    return new THREE.Vector3(f.x * cp, Math.sin(this.controls.pitch), f.z * cp);
  }

  /** Shortest clear distance behind the pivot, probing a small box so the near plane does not clip leaves. */
  private clearDistance(pivot: THREE.Vector3, dir: THREE.Vector3, distance: number): number {
    const world = this.options.island.world;
    const r = rightOf(this.controls.yaw);
    let best = distance;
    for (const [ox, oy] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const x = pivot.x + r.x * ox, y = pivot.y + oy, z = pivot.z + r.z * ox;
      const hit = world.raycast(x, y, z, -dir.x, -dir.y, -dir.z, distance);
      if (hit >= 0) best = Math.min(best, hit - 0.3);
    }
    return Math.max(0.5, best);
  }

  private updateCamera(dt: number): void {
    if (this.debugView) {
      const { from, to } = this.debugView;
      this.camera.position.set(from.x, from.y, from.z);
      this.camera.lookAt(to.x, to.y, to.z);
      return;
    }
    const rig = this.cameraRig();
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    if (!this.camInit) {
      this.camAnchor.copy(rig.anchor);
      this.camShape = { height: rig.height, shoulder: rig.shoulder, distance: rig.distance };
      this.camInit = true;
    }
    // Follow the body tightly sideways and a little softer vertically (step-ups, landings); the
    // view direction itself is never smoothed, so turning always feels direct.
    this.camAnchor.x += (rig.anchor.x - this.camAnchor.x) * k(30);
    this.camAnchor.z += (rig.anchor.z - this.camAnchor.z) * k(30);
    this.camAnchor.y += (rig.anchor.y - this.camAnchor.y) * k(14);
    const shape = this.camShape;
    shape.height += (rig.height - shape.height) * k(10);
    shape.shoulder += (rig.shoulder - shape.shoulder) * k(12);
    shape.distance += (rig.distance - shape.distance) * k(10);

    const dir = this.viewDir();
    const r = rightOf(this.controls.yaw);
    const pivot = this.camAnchor.clone().add(new THREE.Vector3(r.x * shape.shoulder, shape.height, r.z * shape.shoulder));
    // Snap in when something blocks the view, ease back out once it clears.
    const clear = this.clearDistance(pivot, dir, shape.distance);
    this.camBlock = clear < this.camBlock ? clear : this.camBlock + (clear - this.camBlock) * k(5);
    this.camera.position.copy(pivot).addScaledVector(dir, -this.camBlock);
    if (this.effects.shake > 0) {
      const s = this.effects.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(pivot.clone().addScaledVector(dir, 20));
    this.camera.fov += (rig.fov - this.camera.fov) * k(10);
    this.camera.updateProjectionMatrix();
  }

  /**
   * On touch screens, the gorilla nearest the crosshair inside a small cone, if any. Returns where
   * to aim to hit it: leading its movement and lifting for dart drop.
   */
  private assistTarget(coneDeg: number): { g: Gorilla; point: THREE.Vector3 } | null {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const world = this.options.island.world;
    let best: { g: Gorilla; point: THREE.Vector3 } | null = null, bestDot = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    for (const g of this.match.gorillas.values()) {
      if (g.sedation.isDown) continue;
      const c = new THREE.Vector3(g.body.x, g.body.y + 1.4, g.body.z);
      const to = c.clone().sub(origin);
      const dist = to.length();
      const dot = to.clone().normalize().dot(dir);
      if (dot <= bestDot) continue;
      if (world.raycast(origin.x, origin.y, origin.z, to.x / dist, to.y / dist, to.z / dist, dist - 1) >= 0) continue;
      bestDot = dot;
      const t = dist / H.dartSpeed;
      const point = c.clone().add(new THREE.Vector3(g.vel.x * t, g.vel.y * t * 0.5, g.vel.z * t));
      point.y += 0.5 * H.dartGravity * t * t;
      best = { g, point };
    }
    return best;
  }

  /** World point under the crosshair (with gentle aim assist on touch screens). */
  private aimPoint(): { x: number; y: number; z: number } {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (this.controls.isTouch) {
      const a = this.assistTarget(6);
      if (a) return a.point;
    }
    const t = this.options.island.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 250);
    const dist = t >= 0 ? t : 250;
    return { x: origin.x + dir.x * dist, y: origin.y + dir.y * dist, z: origin.z + dir.z * dist };
  }

  /** Slower look while aiming, and a touch of "sticky" aim when the crosshair passes over a gorilla. */
  private updateLookScale(): void {
    const me = this.me;
    let scale = 1;
    if (me && me.team === 'hunter' && !me.dead) {
      if (me.aiming) scale *= 0.55;
      if (this.controls.isTouch && this.assistTarget(9)) scale *= 0.6;
    }
    this.controls.lookScale = scale;
    this.hud.setOnTarget(!!me && me.team === 'hunter' && !!this.assistTarget(this.controls.isTouch ? 6 : 2.5));
  }

  /** While aiming, dots trace the dart's drop and a ring marks where it will land. */
  private updateAimArc(): void {
    const me = this.me;
    const show = !!me && me.team === 'hunter' && me.aiming && me.loaded && !me.dead && !this.debugView;
    this.aimArc.visible = show;
    this.aimImpact.visible = show;
    if (!show || !me || me.team !== 'hunter') return;
    const from = me.muzzle;
    const target = this.aimPoint();
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    let x = from.x, y = from.y, z = from.z;
    let vx = (dx / len) * H.dartSpeed, vy = (dy / len) * H.dartSpeed, vz = (dz / len) * H.dartSpeed;
    const world = this.options.island.world;
    const pts: THREE.Vector3[] = [];
    const h = 1 / 60;
    let hit = false;
    for (let i = 0; i < 60 * 4 && !hit; i++) {
      vy -= H.dartGravity * h;
      const sl = Math.hypot(vx, vy, vz) * h;
      const nx = (vx * h) / sl, ny = (vy * h) / sl, nz = (vz * h) / sl;
      let t = world.raycast(x, y, z, nx, ny, nz, sl);
      for (const g of this.match.gorillas.values()) {
        const b = g.body;
        const gt = rayBox(x, y, z, nx, ny, nz, b.x - b.halfWidth, b.y, b.z - b.halfWidth, b.x + b.halfWidth, b.y + b.height, b.z + b.halfWidth);
        if (gt >= 0 && gt <= sl && (t < 0 || gt < t)) t = gt;
      }
      if (t >= 0) {
        x += nx * t;
        y += ny * t;
        z += nz * t;
        hit = true;
      } else {
        x += vx * h;
        y += vy * h;
        z += vz * h;
      }
      pts.push(new THREE.Vector3(x, y, z));
    }
    // Only the far half of the flight: close dots would clutter the view.
    const n = this.aimArc.count;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const p = pts[Math.min(pts.length - 1, Math.floor(pts.length * (0.35 + 0.65 * (i / (n - 1)))))];
      const s = 0.6 + (i / n) * 0.8;
      m4.makeScale(s, s, s).setPosition(p);
      this.aimArc.setMatrixAt(i, m4);
    }
    this.aimArc.instanceMatrix.needsUpdate = true;
    this.aimImpact.position.set(x, y, z);
    this.aimImpact.lookAt(this.camera.position);
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
