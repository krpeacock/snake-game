/**
 * SnakeGame — Playable Snake in the terminal.
 *
 * Controls: WASD to move · Space to pause · R to restart · M to change music
 *
 * Uses a ref-backed game state with a single persistent interval so
 * the game loop never captures stale closure values.
 */

import { Box, Text, useInput, type Key } from 'ink';
import { useReducer, useRef, useEffect, useState } from 'react';
import {
  getSnakeHighScore,
  setSnakeHighScore,
  getSnakeMusicVolume,
  setSnakeMusicVolume,
  getSnakeTinkVolume,
  setSnakeTinkVolume,
  getSnakeSfxVolume,
  setSnakeSfxVolume,
} from './settings.js';
import {
  warmNotes, playNote, playSystemSound, SYSTEM_SOUNDS,
  startBgMusic, stopBgMusic, setMusicVolume, type BgMusicHandle,
} from './snake-audio.js';
import { MusicSettings, type MusicConfig, type SelectedTrack } from './MusicSettings.js';
import { MIDI_CATALOG, DEFAULT_TRACK_ID, freemidiUrls, type MidiTrack } from './freemidi-catalog.js';
import { type SnakeColors, resolveColors, type SnakeKeybindings, resolveKeybindings } from './types.js';

export type { SnakeColors, SnakeKeybindings };

const DEFAULT_BPM = 120;

// Maps keybinding token strings to Ink Key property names
const ARROW_KEY_MAP: Record<string, keyof Key> = {
  up: 'upArrow', down: 'downArrow', left: 'leftArrow', right: 'rightArrow',
  return: 'return', escape: 'escape', tab: 'tab',
};

function pressed(bindings: string[], input: string, key: Key): boolean {
  return bindings.some((b) => {
    const prop = ARROW_KEY_MAP[b];
    return prop ? (key[prop] as boolean) === true : input === b;
  });
}

const KEY_LABELS: Record<string, string> = {
  up: '↑', down: '↓', left: '←', right: '→',
  return: '↵', escape: 'Esc', tab: 'Tab', ' ': 'Space',
};
function randomOtherTrack(catalog: MidiTrack[], currentUrl: string): MidiTrack | null {
  const others = catalog.filter((t) => freemidiUrls(t).getter !== currentUrl);
  return others.length > 0 ? (others[Math.floor(Math.random() * others.length)] ?? null) : null;
}

function displayKey(k: string): string {
  return KEY_LABELS[k] ?? k.toUpperCase();
}

function resolveDefaultTrack(catalog: MidiTrack[]): SelectedTrack {
  const entry = catalog.find((t) => t.id === DEFAULT_TRACK_ID) ?? catalog[0];
  if (!entry) return { title: 'No tracks', artist: '', url: '' };
  const urls = freemidiUrls(entry);
  return { title: entry.title, artist: entry.artist, url: urls.getter, downloadPage: urls.downloadPage };
}

// ── Music visualizer ──────────────────────────────────────────────────

function MusicVisualizer({
  beatPhase,
  active,
  beatColors,
}: {
  beatPhase: number;
  active: boolean;
  beatColors: [string, string, string, string];
}) {
  const beat = Math.floor(beatPhase / 4) % 4;

  return (
    <Box>
      {([0, 1, 2, 3] as const).map((b) => {
        const isCurrent = active && b === beat;
        return (
          <Text key={b} color={isCurrent ? beatColors[b] : undefined} dimColor={!isCurrent}>
            {isCurrent ? '●' : '○'}{' '}
          </Text>
        );
      })}
    </Box>
  );
}

type Point = { x: number; y: number };
type Dir = { dx: number; dy: number };

const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
} as const;

function randomFood(snake: Point[], w: number, h: number): Point {
  const free: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) {
        free.push({ x, y });
      }
    }
  }
  return free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

type GameState = {
  snake: Point[];
  dir: Dir;
  dirQueue: Dir[];
  food: Point;
  score: number;
  gameOver: boolean;
  paused: boolean;
  started: boolean;
};

function makeInitial(w: number, h: number): GameState {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  return {
    snake,
    dir: DIRS.right,
    dirQueue: [],
    food: randomFood(snake, w, h),
    score: 0,
    gameOver: false,
    paused: false,
    started: false,
  };
}

interface SnakeGameProps {
  onExit?: () => void;
  /** Enable or disable all audio (default: true) */
  music?: boolean;
  /** Override any of the game's colors */
  colors?: SnakeColors;
  /**
   * Directory for cached audio files (synthesized WAVs and per-note tinks).
   * Defaults to the OS temp directory.
   */
  cacheDir?: string;
  /**
   * Path to the JSON file used to persist settings (high score, volumes).
   * Defaults to ~/.snake-game.json
   */
  settingsFile?: string;
  /** Grid width in cells (default: 20) */
  width?: number;
  /** Grid height in cells (default: 10) */
  height?: number;
  /**
   * Track list shown in the music browser.
   * Defaults to the built-in MIDI_CATALOG from freemidi.org.
   */
  tracks?: MidiTrack[];
  /**
   * Override individual key bindings.
   * Each action accepts an array of keys. Use plain characters ('w', ' ', 'r')
   * or arrow-key tokens: 'up', 'down', 'left', 'right', 'return', 'escape'.
   * Defaults include both WASD and arrow keys for movement.
   */
  keybindings?: SnakeKeybindings;
}

export const SnakeGame = ({
  onExit,
  music = true,
  colors,
  cacheDir,
  settingsFile,
  width = 20,
  height = 10,
  tracks,
  keybindings,
}: SnakeGameProps = {}) => {
  const c = resolveColors(colors);
  const kb = resolveKeybindings(keybindings);
  const catalog = tracks ?? MIDI_CATALOG;

  const stateRef = useRef<GameState>(makeInitial(width, height));
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const highScoreRef = useRef(0);
  const [highScore, setHighScore] = useState(0);
  const bgMusic = useRef<BgMusicHandle | null>(null);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [track, setTrack] = useState<SelectedTrack>(() => resolveDefaultTrack(catalog));
  const [showSettings, setShowSettings] = useState(false);
  const autoPlayRef = useRef(true);
  const nextTrackRef = useRef<() => void>(() => {});
  const [beatPhase, setBeatPhase] = useState(0);
  const [musicVolume, setMusicVolumeState] = useState(() => getSnakeMusicVolume(settingsFile));
  const [tinkVolume,  setTinkVolumeState]  = useState(() => getSnakeTinkVolume(settingsFile));
  const [sfxVolume,   setSfxVolumeState]   = useState(() => getSnakeSfxVolume(settingsFile));

  // Keep nextTrackRef pointed at a stable "advance to next track" callback
  useEffect(() => {
    nextTrackRef.current = () => {
      const entry = randomOtherTrack(catalog, track.url);
      if (entry) {
        const urls = freemidiUrls(entry);
        setTrack({ title: entry.title, artist: entry.artist, url: urls.getter, downloadPage: urls.downloadPage });
      }
    };
  }, [track, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!music) return;
    warmNotes([69], cacheDir);
    stopBgMusic(bgMusic.current);
    bgMusic.current = null;
    setBpm(DEFAULT_BPM);
    autoPlayRef.current = true;
    let cancelled = false;
    void startBgMusic(track.url, track.downloadPage, musicVolume, cacheDir).then((handle) => {
      if (cancelled) { stopBgMusic(handle); return; }
      bgMusic.current = handle;
      if (handle) {
        setBpm(handle.bpm);
        handle.proc.on('exit', (_code, signal) => {
          if (signal == null && autoPlayRef.current) nextTrackRef.current();
        });
      }
    });
    return () => {
      cancelled = true;
      autoPlayRef.current = false;
      stopBgMusic(bgMusic.current);
      bgMusic.current = null;
    };
  }, [track, music]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const saved = getSnakeHighScore(settingsFile);
    highScoreRef.current = saved;
    setHighScore(saved);
  }, []);

  const reset = () => {
    stateRef.current = { ...makeInitial(width, height), started: true };
    forceUpdate();
  };

  // Beat phase for music visualizer — runs independently of game state
  useEffect(() => {
    if (!music) return;
    const tickMs = Math.round((60_000 / bpm) / 4);
    const id = setInterval(() => setBeatPhase((p) => (p + 1) % 16), tickMs);
    return () => clearInterval(id);
  }, [bpm, music]);

  // Game loop — interval recreates when bpm changes (once synthesis completes)
  useEffect(() => {
    const tickMs = Math.round((60_000 / bpm) / 4); // one 16th note
    const id = setInterval(() => {
      const g = stateRef.current;
      if (!g.started || g.gameOver || g.paused) return;

      const [nextDir, ...restQueue] = g.dirQueue.length > 0 ? g.dirQueue : [g.dir];
      const dir = nextDir;
      const head = { x: g.snake[0].x + dir.dx, y: g.snake[0].y + dir.dy };

      if (
        head.x < 0 ||
        head.x >= width ||
        head.y < 0 ||
        head.y >= height ||
        g.snake.some((s) => s.x === head.x && s.y === head.y)
      ) {
        stateRef.current = { ...g, dir, dirQueue: restQueue, gameOver: true };
        if (music) playSystemSound(SYSTEM_SOUNDS.die, sfxVolume);
        forceUpdate();
        return;
      }

      const ate = head.x === g.food.x && head.y === g.food.y;
      const snake = ate ? [head, ...g.snake] : [head, ...g.snake.slice(0, -1)];
      const newScore = ate ? g.score + 1 : g.score;

      if (ate) {
        if (newScore > highScoreRef.current) {
          highScoreRef.current = newScore;
          setSnakeHighScore(newScore, settingsFile);
          setHighScore(newScore);
        }
        if (music) playSystemSound(SYSTEM_SOUNDS.eat, sfxVolume);
      } else {
        if (music) playNote(69, tinkVolume, cacheDir);
      }

      stateRef.current = {
        ...g,
        snake,
        dir,
        dirQueue: restQueue,
        food: ate ? randomFood(snake, width, height) : g.food,
        score: newScore,
      };
      forceUpdate();
    }, tickMs);

    return () => clearInterval(id);
  }, [bpm]);

  useInput((input, key) => {
    if (showSettings) return;

    const g = stateRef.current;

    if (pressed(kb.quit, input, key) && onExit) { onExit(); return; }

    if (pressed(kb.music, input, key) && music) {
      if (g.started && !g.gameOver && !g.paused) {
        stateRef.current = { ...g, paused: true };
        forceUpdate();
      }
      setShowSettings(true);
      return;
    }

    if (music) {
      const goToTrack = (entry: MidiTrack) => {
        const urls = freemidiUrls(entry);
        setTrack({ title: entry.title, artist: entry.artist, url: urls.getter, downloadPage: urls.downloadPage });
      };
      if (pressed(kb.nextTrack, input, key)) {
        const entry = randomOtherTrack(catalog, track.url);
        if (entry) goToTrack(entry);
        return;
      }
      if (pressed(kb.prevTrack, input, key)) {
        const idx = catalog.findIndex((t) => freemidiUrls(t).getter === track.url);
        const entry = catalog[(idx - 1 + catalog.length) % catalog.length];
        if (entry) goToTrack(entry);
        return;
      }
    }

    if (!g.started || g.gameOver) {
      if (pressed(kb.restart, input, key) || pressed(kb.pause, input, key)) reset();
      return;
    }

    if (pressed(kb.pause, input, key)) { stateRef.current = { ...g, paused: !g.paused }; forceUpdate(); return; }
    if (pressed(kb.restart, input, key)) { reset(); return; }

    const lastDir = g.dirQueue[g.dirQueue.length - 1] ?? g.dir;
    let next: Dir | null = null;
    if (pressed(kb.up, input, key) && lastDir.dy !== 1)       next = DIRS.up;
    else if (pressed(kb.down, input, key) && lastDir.dy !== -1)  next = DIRS.down;
    else if (pressed(kb.left, input, key) && lastDir.dx !== 1)   next = DIRS.left;
    else if (pressed(kb.right, input, key) && lastDir.dx !== -1) next = DIRS.right;
    if (next && g.dirQueue.length < 2) {
      stateRef.current = { ...g, dirQueue: [...g.dirQueue, next] };
    }
  });

  if (showSettings) {
    return (
      <MusicSettings
        initial={{ track, musicVolume, tinkVolume, sfxVolume }}
        accentColor={c.accent}
        tracks={catalog}
        onApply={(cfg: MusicConfig) => {
          if (cfg.musicVolume !== musicVolume && bgMusic.current) {
            bgMusic.current = setMusicVolume(bgMusic.current, cfg.musicVolume);
            bgMusic.current.proc.on('exit', (_code, signal) => {
              if (signal == null && autoPlayRef.current) nextTrackRef.current();
            });
          }
          if (cfg.musicVolume !== musicVolume) {
            setSnakeMusicVolume(cfg.musicVolume, settingsFile);
            setMusicVolumeState(cfg.musicVolume);
          }
          if (cfg.tinkVolume !== tinkVolume) {
            setSnakeTinkVolume(cfg.tinkVolume, settingsFile);
            setTinkVolumeState(cfg.tinkVolume);
          }
          if (cfg.sfxVolume !== sfxVolume) {
            setSnakeSfxVolume(cfg.sfxVolume, settingsFile);
            setSfxVolumeState(cfg.sfxVolume);
          }
          if (cfg.track.url !== track.url) setTrack(cfg.track);
          setShowSettings(false);
        }}
        onCancel={() => setShowSettings(false)}
      />
    );
  }

  const { snake, food, score, gameOver, paused, started } = stateRef.current;

  const cells = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === snake[0]?.x && y === snake[0]?.y) return 'head';
      if (snake.some((s) => s.x === x && s.y === y)) return 'body';
      if (x === food.x && y === food.y) return 'food';
      return 'empty';
    }),
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2}>
        <Text bold color={c.accent}>Snake</Text>
        <Text color="white">Score: <Text bold>{score}</Text></Text>
        {highScore > 0 && <Text color="white">Best: <Text bold>{highScore}</Text></Text>}
        {paused && <Text color="yellow"> PAUSED</Text>}
      </Box>
      {music && (
        <>
          <Box gap={1}>
            <Text dimColor>♪</Text>
            <Text dimColor>{track.title}</Text>
            <Text dimColor>—</Text>
            <Text dimColor>{track.artist}</Text>
          </Box>
          <MusicVisualizer beatPhase={beatPhase} active={started && !paused && !gameOver} beatColors={c.beat} />
        </>
      )}
      <Box height={1} />
      <Box flexDirection="column">
        <Text dimColor>{'┌' + '──'.repeat(width) + '┐'}</Text>
        {cells.map((row, y) => (
          <Box key={y}>
            <Text dimColor>│</Text>
            {row.map((cell, x) => {
              if (cell === 'head') return <Text key={x} color={c.head} bold>{'● '}</Text>;
              if (cell === 'body') return <Text key={x} color={c.body}>{'● '}</Text>;
              if (cell === 'food') return <Text key={x} color={c.food}>{'◆ '}</Text>;
              return <Text key={x} dimColor>{'· '}</Text>;
            })}
            <Text dimColor>│</Text>
          </Box>
        ))}
        <Text dimColor>{'└' + '──'.repeat(width) + '┘'}</Text>
      </Box>
      <Box height={1} />
      {!started && (
        <Text dimColor>
          Press <Text bold color={c.accent}>Space</Text> or{' '}
          <Text bold color={c.accent}>R</Text> to start
        </Text>
      )}
      {gameOver && (
        <Text>
          <Text color="red">Game over! </Text>
          <Text dimColor>Press </Text>
          <Text bold color={c.accent}>R</Text>
          <Text dimColor> to restart</Text>
        </Text>
      )}
      {started && !gameOver && (
        <Text dimColor>
          {displayKey(kb.up[0]!)}/{displayKey(kb.down[0]!)}/{displayKey(kb.left[0]!)}/{displayKey(kb.right[0]!)} to move
          {' · '}{displayKey(kb.pause[0]!)} to pause
          {' · '}{displayKey(kb.restart[0]!)} to restart
          {music ? ` · ${displayKey(kb.music[0]!)} menu` : ''}
        </Text>
      )}
      {!started && music && <Text dimColor>{displayKey(kb.music[0]!)} to change music</Text>}
      {onExit && <Text dimColor>Press <Text bold>{displayKey(kb.quit[0]!)}</Text> to exit</Text>}
    </Box>
  );
};
