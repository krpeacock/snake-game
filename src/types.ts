export interface SnakeKeybindings {
  /** Keys to move up (default: ['w', 'up']) */
  up?: string[];
  /** Keys to move down (default: ['s', 'down']) */
  down?: string[];
  /** Keys to move left (default: ['a', 'left']) */
  left?: string[];
  /** Keys to move right (default: ['d', 'right']) */
  right?: string[];
  /** Keys to pause (default: [' ']) */
  pause?: string[];
  /** Keys to restart (default: ['r']) */
  restart?: string[];
  /** Keys to open music settings (default: ['m']) */
  music?: string[];
  /** Keys to quit (default: ['q']) */
  quit?: string[];
  /** Keys to skip to next track (default: [']']) */
  nextTrack?: string[];
  /** Keys to skip to previous track (default: ['[']) */
  prevTrack?: string[];
  /** Keys to toggle track loop (default: ['l']) */
  loopTrack?: string[];
}

export const DEFAULT_KEYBINDINGS: Required<SnakeKeybindings> = {
  up:        ['w', 'up'],
  down:      ['s', 'down'],
  left:      ['a', 'left'],
  right:     ['d', 'right'],
  pause:     [' '],
  restart:   ['r'],
  music:     ['m'],
  quit:      ['q'],
  nextTrack: [']'],
  prevTrack: ['['],
  loopTrack: ['l'],
};

export function resolveKeybindings(kb?: SnakeKeybindings): Required<SnakeKeybindings> {
  if (!kb) return DEFAULT_KEYBINDINGS;
  return {
    up:      kb.up      ?? DEFAULT_KEYBINDINGS.up,
    down:    kb.down    ?? DEFAULT_KEYBINDINGS.down,
    left:    kb.left    ?? DEFAULT_KEYBINDINGS.left,
    right:   kb.right   ?? DEFAULT_KEYBINDINGS.right,
    pause:   kb.pause   ?? DEFAULT_KEYBINDINGS.pause,
    restart: kb.restart ?? DEFAULT_KEYBINDINGS.restart,
    music:     kb.music     ?? DEFAULT_KEYBINDINGS.music,
    quit:      kb.quit      ?? DEFAULT_KEYBINDINGS.quit,
    nextTrack: kb.nextTrack ?? DEFAULT_KEYBINDINGS.nextTrack,
    prevTrack: kb.prevTrack ?? DEFAULT_KEYBINDINGS.prevTrack,
    loopTrack: kb.loopTrack ?? DEFAULT_KEYBINDINGS.loopTrack,
  };
}

export interface SnakeColors {
  /** UI accent color — title, score labels, controls (default: '#1e61f0') */
  accent?: string;
  /** Snake head color (default: '#f7a8b8') */
  head?: string;
  /** Snake body color (default: '#ffffff') */
  body?: string;
  /** Food color (default: '#55cdfc') */
  food?: string;
  /** Beat visualizer colors for beats 1–4 (default: trans pride palette) */
  beat?: [string, string, string, string];
}

export const DEFAULT_COLORS = {
  accent: '#1e61f0',
  head:   '#f7a8b8',
  body:   '#ffffff',
  food:   '#55cdfc',
  beat:   ['#55cdfc', '#ffffff', '#f7a8b8', '#ffffff'] as [string, string, string, string],
} as const;

export function resolveColors(colors?: SnakeColors): Required<SnakeColors> {
  return {
    accent: colors?.accent ?? DEFAULT_COLORS.accent,
    head:   colors?.head   ?? DEFAULT_COLORS.head,
    body:   colors?.body   ?? DEFAULT_COLORS.body,
    food:   colors?.food   ?? DEFAULT_COLORS.food,
    beat:   colors?.beat   ?? DEFAULT_COLORS.beat,
  };
}
