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

/**
 * Unified desktop + touch controls. Desktop: WASD, mouse look (pointer lock), Space, Shift,
 * left/right mouse, E. Touch: a floating joystick on the left half, drag-to-look on the right,
 * and big buttons whose labels follow the player's team.
 */
export class Controls {
  yaw = 0;
  pitch = -0.15;
  readonly isTouch: boolean;
  /** Set by the game each frame: hunters on touch sprint when the stick is pushed fully. */
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
      this.turn(e.movementX * config.controls.mouseSensitivity, e.movementY * config.controls.mouseSensitivity);
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
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = this.touchButtons.get(id)!;
        if (id === 'aim') b.held = !b.held; // aim is a toggle on touch
        else b.held = true;
        b.pressed = true;
        el.classList.toggle('down', b.held);
      }, { passive: false });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (id === 'aim') return;
        this.touchButtons.get(id)!.held = false;
        el.classList.remove('down');
      }, { passive: false });
    }
    overlay.classList.toggle('touch', this.isTouch);

    overlay.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    overlay.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    overlay.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    overlay.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
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
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private turn(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy));
  }

  private onTouchStart(e: TouchEvent): void {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.45 && this.stick.id < 0) {
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
        this.stickBase.style.left = `${t.clientX}px`;
        this.stickBase.style.top = `${t.clientY}px`;
        this.stickBase.classList.add('active');
      } else if (this.look.id < 0) {
        this.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const radius = 55;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stick.id) {
        let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > radius) {
          dx *= radius / d;
          dy *= radius / d;
        }
        this.stick.x = dx / radius;
        this.stick.y = -dy / radius;
        this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (t.identifier === this.look.id) {
        const s = config.controls.touchSensitivity;
        this.turn((t.clientX - this.look.x) * s, (t.clientY - this.look.y) * s);
        this.look.x = t.clientX;
        this.look.y = t.clientY;
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stick.id) {
        this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
        this.stickKnob.style.transform = '';
        this.stickBase.classList.remove('active');
      }
      if (t.identifier === this.look.id) this.look.id = -1;
    }
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
      moveX = this.stick.x;
      moveY = this.stick.y;
      sprint = Math.hypot(moveX, moveY) > 0.92; // push the stick all the way to run
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
