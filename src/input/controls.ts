import { config } from '../core/config';
import type { Team } from '../game/types';

export interface ControlState {
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  dash: boolean;
  primary: boolean;
  primaryHeld: boolean;
  aim: boolean;
  interact: boolean;
  interactHeld: boolean;
}

type ButtonId = 'jump' | 'action' | 'grab' | 'dash' | 'aim';

const PITCH_MIN = -1.1, PITCH_MAX = 0.9;
const HAS_POINTER = typeof window !== 'undefined' && 'PointerEvent' in window;

/**
 * Unified desktop + touch controls. Desktop: WASD, mouse look (pointer lock), Space, Shift,
 * left/right mouse, E. Touch: a floating joystick on the left half, drag-to-look on the right,
 * and big buttons whose labels follow the player's team.
 */
export class Controls {
  yaw = 0;
  pitch = -0.15;
  readonly isTouch: boolean;
  /** Set by the game each frame: on touch, pushing the stick past half-way runs. */
  team: Team = 'hunter';

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private touchButtons = new Map<ButtonId, { held: boolean; pressed: boolean }>();
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly buttonEls = new Map<ButtonId, HTMLElement>();
  enabled = true;
  private requeued: Partial<ControlState> = {};
  /** Look sensitivity multiplier, set by the game each frame (lower while aiming, near a target). */
  lookScale = 1;
  private aimLatched = false;
  private aimDownAt = 0;
  private actionLook = { id: -1, x: 0, y: 0 };
  /** Test hook: values merged into every read (automated browser tests drive the game with it). */
  override: Partial<ControlState> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLElement,
  ) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch || !this.enabled) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
      }
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => (this.mouseDown[e.button] = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const s = config.controls.mouseSensitivity * this.lookScale;
      this.turn(e.movementX * s, e.movementY * s);
    });

    // Touch UI.
    this.stickBase = div(overlay, 'stick-base');
    this.stickKnob = div(this.stickBase, 'stick-knob');
    const buttons: [ButtonId, string][] = [
      ['action', 'btn-action'],
      ['jump', 'btn-jump'],
      ['grab', 'btn-grab'],
      ['dash', 'btn-dash'],
      ['aim', 'btn-aim'],
    ];
    for (const [id, cls] of buttons) {
      const el = div(overlay, `touch-btn ${cls}`);
      this.buttonEls.set(id, el);
      this.touchButtons.set(id, { held: false, pressed: false });
      const down = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        if (e instanceof PointerEvent) el.setPointerCapture?.(e.pointerId);
        const b = this.touchButtons.get(id)!;
        b.pressed = true;
        if (id === 'aim') {
          // Hold to aim, or tap to lock aim on (tap again to drop it) so the thumb can go back to the stick.
          if (this.aimLatched) {
            this.aimLatched = false;
            b.held = false;
            b.pressed = false;
          } else {
            b.held = true;
            this.aimDownAt = performance.now();
          }
        } else b.held = true;
        if (id === 'action' && e instanceof PointerEvent) this.actionLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
        else if (id === 'action' && e instanceof TouchEvent && e.changedTouches[0]) this.actionLook = { id: e.changedTouches[0].identifier, x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        el.classList.toggle('down', b.held);
      };
      const up = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const b = this.touchButtons.get(id)!;
        if (id === 'action') this.actionLook.id = -1;
        if (id === 'aim' && b.held && performance.now() - this.aimDownAt < 250) {
          this.aimLatched = true; // a quick tap: stay aimed
          return;
        }
        b.held = false;
        el.classList.remove('down');
      };
      // The fire button doubles as a look pad: slide the thumb to steer the shot.
      const move = (id2: number, x: number, y: number) => {
        if (id !== 'action' || id2 !== this.actionLook.id) return;
        const s = config.controls.touchSensitivity * this.lookScale;
        this.turn((x - this.actionLook.x) * s, (y - this.actionLook.y) * s);
        this.actionLook.x = x;
        this.actionLook.y = y;
      };
      if (HAS_POINTER) {
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointermove', (e) => {
          e.stopPropagation();
          move(e.pointerId, e.clientX, e.clientY);
        });
      } else {
        el.addEventListener('touchmove', (e) => {
          e.preventDefault();
          e.stopPropagation();
          for (const t of Array.from(e.changedTouches)) move(t.identifier, t.clientX, t.clientY);
        }, { passive: false });
        el.addEventListener('touchstart', down, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
      }
    }
    overlay.classList.toggle('touch', this.isTouch);

    // Joystick and look. Pointer Events are the most reliable in embedded web views (the
    // Claude app, in-app browsers); old browsers fall back to Touch Events.
    if (HAS_POINTER) {
      overlay.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        overlay.setPointerCapture?.(e.pointerId);
        this.fingerDown(e.pointerId, e.clientX, e.clientY);
      });
      overlay.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        this.fingerMove(e.pointerId, e.clientX, e.clientY);
      });
      const end = (e: PointerEvent) => this.fingerUp(e.pointerId);
      overlay.addEventListener('pointerup', end);
      overlay.addEventListener('pointercancel', end);
      overlay.addEventListener('lostpointercapture', end);
    } else {
      overlay.addEventListener('touchstart', (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) this.fingerDown(t.identifier, t.clientX, t.clientY);
      }, { passive: false });
      overlay.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) this.fingerMove(t.identifier, t.clientX, t.clientY);
      }, { passive: false });
      const end = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) this.fingerUp(t.identifier);
      };
      overlay.addEventListener('touchend', end, { passive: false });
      overlay.addEventListener('touchcancel', end, { passive: false });
    }
    // Stop the page itself from scrolling, zooming or bouncing under the thumbs.
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Relabels the touch buttons for the player's role. */
  setTeam(team: Team): void {
    this.team = team;
    const label = (id: ButtonId, text: string, show = true) => {
      const el = this.buttonEls.get(id)!;
      el.textContent = text;
      el.style.display = show ? '' : 'none';
    };
    label('action', team === 'gorilla' ? 'SWIPE\nhold: swing' : 'FIRE');
    label('jump', 'JUMP');
    label('grab', 'GRAB', team === 'hunter');
    label('dash', 'DASH', team === 'gorilla');
    label('aim', 'AIM', team === 'hunter');
    if (team !== 'hunter') this.dropAim();
  }

  /** Lets go of aim (after a shot is not needed; used when the role changes). */
  dropAim(): void {
    this.aimLatched = false;
    const b = this.touchButtons.get('aim')!;
    b.held = false;
    this.buttonEls.get('aim')!.classList.remove('down');
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private turn(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy));
  }

  private fingerDown(id: number, x: number, y: number): void {
    if (!this.enabled) return;
    if (x < innerWidth * 0.45 && this.stick.id < 0) {
      this.stick = { id, ox: x, oy: y, x: 0, y: 0 };
      this.stickBase.style.left = `${x}px`;
      this.stickBase.style.top = `${y}px`;
      this.stickBase.classList.add('active');
    } else if (this.look.id < 0 && this.stick.id !== id) {
      this.look = { id, x, y };
    }
  }

  private fingerMove(id: number, x: number, y: number): void {
    const radius = 55;
    if (id === this.stick.id) {
      let dx = x - this.stick.ox, dy = y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > radius) {
        dx *= radius / d;
        dy *= radius / d;
      }
      this.stick.x = dx / radius;
      this.stick.y = -dy / radius;
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (id === this.look.id) {
      const s = config.controls.touchSensitivity * this.lookScale;
      this.turn((x - this.look.x) * s, (y - this.look.y) * s);
      this.look.x = x;
      this.look.y = y;
    }
  }

  private fingerUp(id: number): void {
    if (id === this.stick.id) {
      this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      this.stickKnob.style.transform = '';
      this.stickBase.classList.remove('active');
    }
    if (id === this.look.id) this.look.id = -1;
  }

  /** Test hook: queue one-shot presses (jump, dash, primary, interact) for the next read. */
  press(s: Partial<ControlState>): void {
    Object.assign(this.requeued, s);
  }

  /** Keeps one-shot presses for the next read (used when a frame ran no simulation step). */
  requeue(s: ControlState): void {
    this.requeued = { jump: s.jump, dash: s.dash, primary: s.primary, interact: s.interact };
  }

  /** Snapshot of this frame's controls; clears one-frame "pressed" flags. */
  read(): ControlState {
    const k = (c: string) => this.keys.has(c);
    const p = (c: string) => this.pressed.has(c);
    const tb = (id: ButtonId) => this.touchButtons.get(id)!;

    let moveX = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let moveY = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    let sprint = k('ShiftLeft') || k('ShiftRight');
    if (this.stick.id >= 0) {
      // A small dead zone, full speed from just past half-way out, and run whenever the stick
      // is past half-way: thumbs rarely hold the stick right at the edge.
      const mag = Math.hypot(this.stick.x, this.stick.y);
      const scale = mag < 0.12 ? 0 : Math.min(1, (mag - 0.12) / 0.4) / mag;
      moveX = this.stick.x * scale;
      moveY = this.stick.y * scale;
      sprint = mag > 0.5;
    }

    const state: ControlState = {
      moveX,
      moveY,
      yaw: this.yaw,
      pitch: this.pitch,
      jump: p('Space') || tb('jump').pressed,
      sprint,
      dash: p('ShiftLeft') || p('ShiftRight') || tb('dash').pressed,
      primary: this.mousePressed[0] || tb('action').pressed,
      primaryHeld: this.mouseDown[0] || tb('action').held,
      aim: this.mouseDown[2] || tb('aim').held,
      interact: p('KeyE') || p('KeyF') || tb('grab').pressed,
      interactHeld: k('KeyE') || k('KeyF') || tb('grab').held,
    };
    state.jump ||= !!this.requeued.jump;
    state.dash ||= !!this.requeued.dash;
    state.primary ||= !!this.requeued.primary;
    state.interact ||= !!this.requeued.interact;
    this.requeued = {};
    if (this.override) {
      Object.assign(state, this.override);
      if (this.override.yaw !== undefined) this.yaw = this.override.yaw;
      if (this.override.pitch !== undefined) this.pitch = this.override.pitch;
    }
    this.pressed.clear();
    this.mousePressed = [false, false, false];
    for (const b of this.touchButtons.values()) b.pressed = false;
    return state;
  }
}

function div(parent: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  return el;
}
