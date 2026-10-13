import './style.css';
import { Game } from './app/game';
import type { Team } from './game/types';
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

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function startPractice(team: Team): Promise<void> {
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
  game = new Game(app, { island, match: { practice: true, players }, localId: 1, quality });
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
      <button class="quality">Graphics: <b>${quality === 'high' ? 'High' : 'Fast'}</b></button>
      <div class="howto">${
        isTouch
          ? 'Left thumb: move (push all the way to run) · Right thumb: look · Buttons: act'
          : 'WASD move · Mouse look · Space jump · Shift sprint/dash · Click fire/swipe (hold near vines to swing) · Right click aim · E grab'
      }</div>
    </div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) => (b.onclick = () => startPractice(b.dataset.play as Team)));
  app.querySelector<HTMLButtonElement>('.quality')!.onclick = () => {
    quality = quality === 'high' ? 'low' : 'high';
    storage.set('pr-quality', quality);
    showMenu();
  };
}

showMenu();
// Debug/test hook: lets automated browser tests drive the game.
(window as unknown as { primalRaid: unknown }).primalRaid = { startPractice, get game() { return game; } };
