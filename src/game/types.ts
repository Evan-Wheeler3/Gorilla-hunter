import type { VoxelWorld } from '../world/voxelWorld';
import type { Vec3, Vine } from '../world/island';

/** One frame of player intent, from keyboard/mouse, touch, the network or a bot. */
export interface InputFrame {
  moveX: number; // strafe, -1..1 (positive = right)
  moveY: number; // forward, -1..1
  yaw: number; // camera heading (radians); forward = (sin yaw, 0, cos yaw)
  pitch: number; // camera pitch (radians), positive looks up
  jump: boolean; // pressed this frame
  sprint: boolean; // held (hunter sprint)
  dash: boolean; // pressed this frame (gorilla)
  primary: boolean; // pressed this frame
  primaryHeld: boolean;
  aim: boolean; // held (hunter aims down sights)
  interact: boolean; // pressed this frame
  interactHeld: boolean;
  /** Hunter tools, pressed this frame: lay a net trap, fire a flare. */
  net: boolean;
  flare: boolean;
  /** Where the crosshair points in the world (hunter darts fly toward it). */
  aimPoint: Vec3 | null;
}

export const emptyInput = (yaw = 0, pitch = 0): InputFrame => ({
  moveX: 0,
  moveY: 0,
  yaw,
  pitch,
  jump: false,
  sprint: false,
  dash: false,
  primary: false,
  primaryHeld: false,
  aim: false,
  interact: false,
  interactHeld: false,
  net: false,
  flare: false,
  aimPoint: null,
});

export type Team = 'gorilla' | 'hunter';

/** What a character controller may ask of the match while it updates. */
export interface SimContext {
  world: VoxelWorld;
  vines: Vine[];
  time: number;
}

export const forwardOf = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
/** Screen-right for a heading: forward rotated a quarter turn clockwise from above. */
export const rightOf = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
