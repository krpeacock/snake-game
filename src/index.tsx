/**
 * snake-game — public API
 *
 * Embed the game in an existing Ink app:
 *   import { SnakeGame } from 'snake-game';
 *   <SnakeGame onExit={() => { ... }} />
 *
 * Or launch it imperatively from any CLI and await completion:
 *   import { runSnakeGame } from 'snake-game';
 *   await runSnakeGame();
 */

export { SnakeGame } from './SnakeGame.js';
export type { SelectedTrack, MusicConfig } from './MusicSettings.js';
export type { MidiTrack } from './freemidi-catalog.js';
export { MIDI_CATALOG, DEFAULT_TRACK_ID, FALLBACK_TRACK, freemidiUrls } from './freemidi-catalog.js';

import { render } from 'ink';
import { SnakeGame } from './SnakeGame.js';

/**
 * Launch Snake in the current terminal and resolve when the user exits.
 * Safe to call from any CLI — manages its own Ink render lifecycle.
 */
export function runSnakeGame(): Promise<void> {
  return new Promise((resolve) => {
    const app = render(
      <SnakeGame
        onExit={() => {
          app.unmount();
          resolve();
        }}
      />,
    );
  });
}
