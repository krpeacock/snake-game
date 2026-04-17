# snake-game

Playable Snake in the terminal with MIDI music synthesis.

## Requirements

- Node.js 18+
- pnpm (for development)
- Audio playback:
  - **macOS** — `afplay` (built-in, supports volume)
  - **Linux** — one of `paplay` (`pulseaudio-utils`), `ffplay` (`ffmpeg`), or `aplay` (`alsa-utils`). `paplay` / `ffplay` are preferred — they support per-stream volume. `aplay` works but ignores volume settings (output level is controlled by the system mixer).
  - Other platforms fall back to the terminal bell for system sounds and disable background music.

## Running

### From source

```bash
pnpm install
pnpm try          # run with tsx (no build step)
```

### After building

```bash
pnpm build
pnpm start        # node dist/bin.js
```

### As a global CLI

```bash
pnpm build:link   # build + pnpm link --global
snake-game
```

### As a library

Install in your own project:

```bash
npm install @pavus/snake-game
```

Embed in an Ink app:

```tsx
import { SnakeGame } from '@pavus/snake-game';

<SnakeGame onExit={() => process.exit(0)} />
```

Or launch imperatively from any CLI:

```ts
import { runSnakeGame } from '@pavus/snake-game';

await runSnakeGame({ music: false });
```

## Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` or arrow keys | Move |
| `Space` | Pause / unpause |
| `R` | Restart |
| `M` | Open music settings |
| `[` | Previous track |
| `]` | Next track (random) |
| `L` | Toggle loop |
| `Q` | Quit |

## Music settings (`M`)

- **Tracks tab** — search and select from 58 curated MIDI tracks
- **Volumes tab** — adjust BGM, tink, and SFX volumes independently; toggle loop

The game remembers your last played track and loop preference across sessions (stored in `~/.snake-game.json`).

## Options

```tsx
<SnakeGame
  music={true}           // enable/disable all audio (default: true)
  width={20}             // grid width in cells (default: 20)
  height={10}            // grid height in cells (default: 10)
  cacheDir="/tmp"        // where to cache synthesized WAV files
  settingsFile="~/.snake-game.json"  // path for persistent settings
  tracks={myTrackList}   // custom MidiTrack[] list
  colors={{ head: '#ff0000', accent: '#00ff00' }}
  keybindings={{ quit: ['escape'] }}
  onExit={() => process.exit(0)}
/>
```
