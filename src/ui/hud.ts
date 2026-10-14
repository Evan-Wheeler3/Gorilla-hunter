import type { Match } from '../game/match';
import type { Gorilla } from '../game/gorilla';
import type { Hunter } from '../game/hunter';

/** Screen-space position for labels; null when behind the camera. */
export type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;

const el = (parent: HTMLElement, cls: string, tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
};

/** DOM overlay HUD: round bar, prompts, meters, labels over gorillas, finisher banner, results. */
export class Hud {
  readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly announce: HTMLElement;
  private readonly center: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly reload: SVGCircleElement;
  private readonly stamina: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly results: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly badges: HTMLElement;
  private readonly heatGlow: HTMLElement;
  private readonly replayTag: HTMLElement;
  private readonly toolLabels = new Map<string, HTMLElement>();
  private labelPool: HTMLElement[] = [];
  onPlayAgain: () => void = () => {};
  onMenu: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el(parent, 'hud');
    this.bar = el(this.root, 'round-bar');
    this.announce = el(this.root, 'announce');
    this.center = el(this.root, 'center-msg');
    this.prompt = el(this.root, 'prompt');
    this.labels = el(this.root, 'labels');
    this.crosshair = el(this.root, 'crosshair');
    this.crosshair.innerHTML =
      '<svg viewBox="0 0 40 40"><circle class="ring-bg" cx="20" cy="20" r="14"/><circle class="ring" cx="20" cy="20" r="14"/>' +
      '<path d="M20 9v6M20 25v6M9 20h6M25 20h6"/></svg>';
    this.reload = this.crosshair.querySelector('.ring') as SVGCircleElement;
    this.stamina = el(this.root, 'stamina');
    this.staminaFill = el(this.stamina, 'fill');
    this.vignette = el(this.root, 'vignette');
    this.arrow = el(this.root, 'boat-arrow');
    this.arrow.textContent = '➤';
    this.hint = el(this.root, 'hint');
    this.badges = el(this.root, 'badges');
    this.heatGlow = el(this.root, 'heat-glow');
    this.results = el(this.root, 'results');
    this.replayTag = el(this.root, 'replay-tag');
    this.replayTag.style.display = 'none';
  }

  /** Over the best-kill replay on the results screen. */
  setReplay(text: string | null): void {
    this.replayTag.textContent = text ?? '';
    this.replayTag.style.display = text ? '' : 'none';
  }

  /** Cooldown text on a touch button (NET / FLARE), found by class. */
  setToolLabel(cls: string, text: string, ready: boolean): void {
    let b = this.toolLabels.get(cls);
    if (!b) {
      const found = this.root.parentElement?.querySelector(`.${cls}`) as HTMLElement | null;
      if (!found) return;
      b = found;
      this.toolLabels.set(cls, b);
    }
    if (b.textContent !== text) b.textContent = text;
    b.classList.toggle('cooling', !ready);
  }

  private setBadges(items: [string, string][]): void {
    const html = items.map(([cls, text]) => `<span class="badge ${cls}">${text}</span>`).join('');
    if (this.badges.innerHTML !== html) this.badges.innerHTML = html;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
    this.hint.style.display = text ? '' : 'none';
  }

  /** Crosshair turns pink while it is over a gorilla. */
  setOnTarget(on: boolean): void {
    this.crosshair.classList.toggle('on-target', on);
  }

  update(match: Match, me: Gorilla | Hunter | undefined, project: Project, _now: number): void {
    const r = match.round;
    const t = r.timeRemaining;
    const clock = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const weather = match.weather === 'storm' ? '⛈' : match.weather === 'mist' ? '🌫' : '🌅';
    const fire = match.wildfire.active ? '<span class="fire">🔥</span>' : '';
    const html =
      `<span class="clock">${clock}</span>${fire}` +
      `<span>🦍 ${r.gorillas.size}</span><span>🎯 ${r.aliveHunters.size}</span><span>❤ ${r.livesRemaining}</span><span>${weather}</span>`;
    if (this.bar.innerHTML !== html) this.bar.innerHTML = html;

    // The fire: an orange glow that builds the longer you stand in it, and an arrow to safety.
    const heat = me ? match.heat.get(me.id) ?? 0 : 0;
    this.heatGlow.style.opacity = `${Math.min(1, heat / 3)}`;

    const showAnnounce = match.time < match.announcementUntil && r.phase !== 'ended';
    this.announce.textContent = showAnnounce ? match.announcement : '';
    this.announce.style.opacity = showAnnounce ? '1' : '0';

    // Round over.
    if (r.phase === 'ended') {
      if (this.results.style.display !== 'flex') {
        this.results.innerHTML = `<h1>${r.result === 'huntersWin' ? 'HUNTERS WIN' : 'GORILLAS WIN'}</h1><p>${match.announcement.split(': ')[1] ?? ''}</p>`;
        const again = el(this.results, 'btn', 'button');
        again.textContent = 'Play again';
        again.onclick = () => this.onPlayAgain();
        const menu = el(this.results, 'btn secondary', 'button');
        menu.textContent = 'Menu';
        menu.onclick = () => this.onMenu();
        this.results.style.display = 'flex';
      }
    } else {
      this.results.style.display = 'none';
    }

    this.updateLabels(match, me, project);
    if (!me) return;

    if (me.team === 'gorilla') this.updateGorilla(match, me, project);
    else this.updateHunter(match, me, project);

    const outside = match.wildfire.active && Math.hypot(me.body.x - match.wildfire.center.x, me.body.z - match.wildfire.center.z) > match.fireRadius - 3;
    const alive = me.team === 'gorilla' ? !me.sedation.isDown : !me.dead;
    if (outside && alive) {
      if (heat > 0) this.center.textContent = 'IN THE FIRE! Get inside the ring';
      this.pointTo(match.wildfire.center.x, 1, match.wildfire.center.z, me, project, '🔥');
    }
  }

  private updateGorilla(match: Match, g: Gorilla, _project: Project): void {
    this.crosshair.style.display = 'none';
    this.stamina.style.display = '';
    this.staminaFill.style.width = `${(g.stamina / 100) * 100}%`;
    this.stamina.classList.toggle('rage', g.rage);
    const down = g.sedation.isDown;
    this.vignette.style.opacity = down ? '1' : `${g.sedation.normalized * 0.7}`;
    this.arrow.style.display = 'none';
    const t = match.ctx.time;
    const badges: [string, string][] = [];
    if (g.chain > 0) badges.push(['chain', `CHAIN ×${g.chain + 1}`]);
    if (t < g.streakRageUntil) badges.push(['rage', `RAMPAGE ${Math.ceil(g.streakRageUntil - t)}s`]);
    else if (g.lastStand) badges.push(['rage', 'LAST STAND']);
    else if (g.streak > 0) badges.push(['streak', `${g.streak}/3 kills`]);
    if (g.wakeRoarReady) badges.push(['roar', 'WAKE ROAR ready']);
    if (g.netted(t)) badges.push(['net', 'NETTED!']);
    if (t < g.revealedUntil) badges.push(['seen', 'SPOTTED']);
    this.setBadges(badges);
    if (down && g.draggedBy !== null) {
      this.center.textContent = `BEING DRAGGED!  Mash SWIPE to struggle  ${Math.ceil(g.sedation.remainingDowntime)}s`;
      this.prompt.textContent = 'Your gorillas can charge him to make him drop you';
    } else if (down) {
      this.center.textContent = `KNOCKED OUT  ${Math.ceil(g.sedation.remainingDowntime)}s${g.draggedBy !== null ? ' - being dragged!' : ''}`;
      this.prompt.textContent = 'Your gorillas can slap you awake';
    } else {
      this.center.textContent = g.held ? 'Wait in the nest...' : '';
      const vine = g.vineInRange(match.ctx);
      const high = !g.body.onGround && g.state === 'ground' && match.ctx.world.raycast(g.body.x, g.body.y + 0.1, g.body.z, 0, -1, 0, 40) !== -1 && match.ctx.world.raycast(g.body.x, g.body.y + 0.1, g.body.z, 0, -1, 0, 3) === -1;
      this.prompt.textContent = vine
        ? g.body.onGround ? 'Hold SWIPE to grab the vine' : 'Hold SWIPE: catch the next vine!'
        : g.state === 'swing' ? 'Let go of SWIPE to launch'
        : g.state === 'climb' ? 'Climbing: SPACE/JUMP to leap off'
        : high ? 'SWIPE in the air: GROUND POUND' : '';
    }
  }

  private updateHunter(match: Match, h: Hunter, project: Project): void {
    this.stamina.style.display = 'none';
    this.vignette.style.opacity = '0';
    const t = match.ctx.time;
    const badges: [string, string][] = [];
    if (t < h.revealedUntil) badges.push(['seen', 'SPOTTED']);
    this.setBadges(badges);
    this.setToolLabel('btn-net', h.netCooldown > 0 ? `${Math.ceil(h.netCooldown)}` : 'NET', h.netCooldown <= 0);
    this.setToolLabel('btn-flare', h.flareCooldown > 0 ? `${Math.ceil(h.flareCooldown)}` : 'FLARE', h.flareCooldown <= 0);
    if (h.dead) {
      this.crosshair.style.display = 'none';
      this.arrow.style.display = 'none';
      const left = match.round.respawnRemaining(h.id);
      this.center.textContent = match.round.isRespawning(h.id) ? `TORN APART!  Back in ${left.toFixed(1)}s` : 'TORN APART! No lives left.';
      this.prompt.textContent = '';
      return;
    }
    this.crosshair.style.display = '';
    this.crosshair.classList.toggle('aiming', h.aiming);
    const circumference = 2 * Math.PI * 14;
    this.reload.style.strokeDasharray = `${circumference}`;
    this.reload.style.strokeDashoffset = `${circumference * (1 - h.reloadProgress)}`;
    this.crosshair.classList.toggle('loaded', h.loaded);
    this.center.textContent = h.stunned ? 'THROWN OFF!' : h.held ? 'Get ready...' : '';

    if (h.dragging !== null) {
      const g = match.gorillas.get(h.dragging);
      this.prompt.textContent = `Drag him to a yellow beam!  Wakes in ${Math.ceil(g?.sedation.remainingDowntime ?? 0)}s  ·  GRAB/E: drop`;
      this.pointToNearestBoat(match, h, project);
    } else {
      this.arrow.style.display = 'none';
      if (h.interactTarget !== null) {
        const g = match.gorillas.get(h.interactTarget);
        this.prompt.textContent = g?.sedation.state === 'bound' ? 'Tap GRAB / E to drag (tied up)' : 'Tap GRAB / E to drag  ·  hold to tie up';
        if (h.bindProgress > 0) this.prompt.textContent = `Tying up... ${Math.round(h.bindProgress * 100)}%`;
      } else {
        this.prompt.textContent = '';
      }
    }
  }

  /** An arrow toward a world point: over it when on screen, at the screen edge when not. */
  private pointTo(x: number, y: number, z: number, me: Gorilla | Hunter, project: Project, icon: string): void {
    const p = project(x, y + 2, z);
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const tx = p ? p.x : cx, ty = p ? p.y : innerHeight;
    const angle = Math.atan2(ty - cy, tx - cx);
    const onScreen = p && p.x > 40 && p.x < innerWidth - 40 && p.y > 40 && p.y < innerHeight - 40;
    const d = Math.round(Math.hypot(x - me.body.x, z - me.body.z));
    this.arrow.style.display = '';
    this.arrow.textContent = onScreen ? `${icon} ${d}m` : '➤';
    if (onScreen) this.arrow.style.transform = `translate(${p!.x}px, ${p!.y - 40}px) translate(-50%, -50%)`;
    else {
      const r = Math.min(innerWidth, innerHeight) * 0.38;
      this.arrow.style.transform = `translate(${cx + Math.cos(angle) * r}px, ${cy + Math.sin(angle) * r}px) translate(-50%, -50%) rotate(${angle}rad)`;
    }
  }

  private pointToNearestBoat(match: Match, h: Hunter, project: Project): void {
    let best = match.island.docks[0];
    let bestD = Infinity;
    for (const d of match.island.docks) {
      const dist = Math.hypot(d.zone.x - h.body.x, d.zone.z - h.body.z);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    const p = project(best.zone.x, best.zone.y + 2, best.zone.z);
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const tx = p ? p.x : cx, ty = p ? p.y : innerHeight;
    const angle = Math.atan2(ty - cy, tx - cx);
    const onScreen = p && p.x > 40 && p.x < innerWidth - 40 && p.y > 40 && p.y < innerHeight - 40;
    this.arrow.style.display = '';
    this.arrow.textContent = onScreen ? `▼ ${Math.round(bestD)}m` : '➤';
    if (onScreen) {
      this.arrow.style.transform = `translate(${p!.x}px, ${p!.y - 40}px) translate(-50%, -50%)`;
    } else {
      const r = Math.min(innerWidth, innerHeight) * 0.38;
      this.arrow.style.transform = `translate(${cx + Math.cos(angle) * r}px, ${cy + Math.sin(angle) * r}px) translate(-50%, -50%) rotate(${angle}rad)`;
    }
  }

  /** Knockout timers over downed gorillas; names over everyone else nearby. */
  private updateLabels(match: Match, me: Gorilla | Hunter | undefined, project: Project): void {
    let used = 0;
    const label = (x: number, y: number, z: number, text: string, cls: string) => {
      const p = project(x, y, z);
      if (!p) return;
      let e = this.labelPool[used];
      if (!e) {
        e = el(this.labels, 'label');
        this.labelPool.push(e);
      }
      used++;
      e.className = `label ${cls}`;
      e.textContent = text;
      e.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      e.style.display = '';
    };
    for (const g of match.gorillas.values()) {
      if (g === me) continue;
      if (g.sedation.isDown) {
        const tied = g.sedation.state === 'bound' ? ' tied' : '';
        label(g.body.x, g.body.y + 1.6, g.body.z, `💤 ${Math.ceil(g.sedation.remainingDowntime)}s${tied}`, 'down');
      } else label(g.body.x, g.body.y + g.body.height + 0.5, g.body.z, g.name, g.rage ? 'gorilla rage' : 'gorilla');
    }
    for (const h of match.hunters.values()) {
      if (h === me || h.dead) continue;
      label(h.body.x, h.body.y + h.body.height + 0.5, h.body.z, h.name, 'hunter');
    }
    for (let i = used; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }
}
