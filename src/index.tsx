/**
 * snake-game — public API
 *
 * Embed the game in an existing Ink app:
 *   import { SnakeGame } from 'snake-game';
 *   <SnakeGame onExit={() => { ... }} colors={{ head: '#ff0000' }} music={false} />
 *
 * Or launch it imperatively from any CLI and await completion:
 *   import { runSnakeGame } from 'snake-game';
 *   await runSnakeGame({ music: false, colors: { accent: '#00ff00' } });
 */

export { SnakeGame } from './SnakeGame.js';
export type { SnakeColors } from './types.js';
export { DEFAULT_COLORS } from './types.js';
export type { SelectedTrack, MusicConfig } from './MusicSettings.js';
export type { MidiTrack } from './freemidi-catalog.js';
export { MIDI_CATALOG, DEFAULT_TRACK_ID, FALLBACK_TRACK, freemidiUrls } from './freemidi-catalog.js';

import { render } from 'ink';
import { SnakeGame } from './SnakeGame.js';
import type { SnakeColors } from './types.js';
import type { MidiTrack } from './freemidi-catalog.js';

interface RunSnakeGameOptions {
  music?: boolean;
  colors?: SnakeColors;
  cacheDir?: string;
  settingsFile?: string;
  width?: number;
  height?: number;
  tracks?: MidiTrack[];
}

/**
 * Launch Snake in the current terminal and resolve when the user exits.
 * Safe to call from any CLI — manages its own Ink render lifecycle.
 */
export function runSnakeGame(options: RunSnakeGameOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const app = render(
      <SnakeGame
        music={options.music}
        colors={options.colors}
        cacheDir={options.cacheDir}
        settingsFile={options.settingsFile}
        width={options.width}
        height={options.height}
        tracks={options.tracks}
        onExit={() => {
          app.unmount();
          resolve();
        }}
      />,
    );
  });
}
