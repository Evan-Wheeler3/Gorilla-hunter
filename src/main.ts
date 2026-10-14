import './style.css';
import { Game } from './app/game';
import { GORILLA_STYLES, HUNTER_OUTFITS, type GorillaStyle, type HunterOutfit } from './render/characters';
import type { Team } from './game/types';
import type { Weather } from './game/match';
import { generateIsland, type Island } from './world/island';

const app = document.getElementById('app')!;
let island: Island | null = null;
let game: Game | null = null;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked: the setting just won't be remembered */
    }
  },
};
let quality: 'high' | 'low' = (storage.get('pr-quality') as 'high' | 'low' | null) ?? (isTouch ? 'low' : 'high');
let gorillaStyle: GorillaStyle = GORILLA_STYLES.find((g) => g.id === storage.get('pr-gorilla'))?.id ?? 'silverback';
let hunterOutfit: HunterOutfit = HUNTER_OUTFITS.find((h) => h.id === storage.get('pr-hunter'))?.id ?? 'safari';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function startPractice(team: Team, weather?: Weather): Promise<void> {
  app.innerHTML = '<div class="loading"><div class="logo">PRIMAL RAID</div><p>Growing the jungle…</p></div>';
  await nextFrame();
  island ??= generateIsland(1234);
  app.innerHTML = '';
  const players =
    team === 'hunter'
      ? [
          { id: 1, name: 'You', team: 'hunter' as const },
          { id: 2, name: 'Bonzo', team: 'gorilla' as const },
          { id: 3, name: 'Kong Jr', team: 'gorilla' as const },
          { id: 4, name: 'Mabel', team: 'gorilla' as const },
        ]
      : [
          { id: 1, name: 'You', team: 'gorilla' as const },
          { id: 2, name: 'Hank', team: 'hunter' as const },
          { id: 3, name: 'Bonzo', team: 'gorilla' as const },
          { id: 4, name: 'Mabel', team: 'gorilla' as const },
        ];
  const styles = new Map([[1, { gorilla: gorillaStyle, hunter: hunterOutfit }]]);
  game = new Game(app, { island, match: { practice: true, players, weather }, localId: 1, quality, styles });
  game.onExit = () => {
    game?.dispose();
    game = null;
    showMenu();
  };
  game.start();
}

function showMenu(): void {
  app.innerHTML = `
    <div class="menu">
      <div class="logo">PRIMAL RAID</div>
      <p class="tagline">Gorillas vs hunters. One dart drops a gorilla. One swipe ends a hunter.</p>
      <div class="menu-buttons">
        <button class="btn" data-play="hunter">🎯 Practice as hunter</button>
        <button class="btn" data-play="gorilla">🦍 Practice as gorilla</button>
        <button class="btn secondary" disabled>Host a game · coming next</button>
        <button class="btn secondary" disabled>Join with code · coming next</button>
      </div>
      <div class="looks">
        <div class="look"><span>Your gorilla</span>${GORILLA_STYLES.map((g) => `<button class="chip${g.id === gorillaStyle ? ' on' : ''}" data-gorilla="${g.id}">${g.name}</button>`).join('')}</div>
        <div class="look"><span>Your hunter</span>${HUNTER_OUTFITS.map((h) => `<button class="chip${h.id === hunterOutfit ? ' on' : ''}" data-hunter="${h.id}">${h.name}</button>`).join('')}</div>
      </div>
      <button class="quality">Graphics: <b>${quality === 'high' ? 'High' : 'Fast'}</b></button>
      <div class="howto">${
        isTouch
          ? 'Left thumb: move (past half-way runs) · Right thumb: look · Buttons: act · SWIPE in the air from high up: ground pound'
          : 'WASD move · Mouse look · Space jump · Shift sprint/dash · Click fire/swipe (hold near vines to swing, click in the air to ground pound) · Right click aim · E grab · Q net · R flare'
      }</div>
    </div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) => (b.onclick = () => startPractice(b.dataset.play as Team)));
  app.querySelectorAll<HTMLButtonElement>('[data-gorilla]').forEach(
    (b) =>
      (b.onclick = () => {
        gorillaStyle = b.dataset.gorilla as GorillaStyle;
        storage.set('pr-gorilla', gorillaStyle);
        showMenu();
      }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-hunter]').forEach(
    (b) =>
      (b.onclick = () => {
        hunterOutfit = b.dataset.hunter as HunterOutfit;
        storage.set('pr-hunter', hunterOutfit);
        showMenu();
      }),
  );
  app.querySelector<HTMLButtonElement>('.quality')!.onclick = () => {
    quality = quality === 'high' ? 'low' : 'high';
    storage.set('pr-quality', quality);
    showMenu();
  };
}

showMenu();
// Debug/test hook: lets automated browser tests drive the game.
(window as unknown as { primalRaid: unknown }).primalRaid = { startPractice, get game() { return game; } };
