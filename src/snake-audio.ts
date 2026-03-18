/**
 * snake-audio.ts — Audio for the Snake game.
 *
 * Background music: synthesizes a MIDI file to WAV via a self-contained
 * child script (snake-synth.mjs, ~1s), then streams it with afplay (macOS)
 * or aplay (Linux).
 * Zero runtime npm dependencies — pure Node.js + platform audio tools.
 *
 * Per-note tink: pre-generated sine-wave WAVs for the chord-per-tick overlay.
 * System sounds: macOS .aiff files (eat/die) on macOS; terminal bell on Linux.
 *
 * freemidi.org requires a two-step fetch:
 *   1. GET download page → grab PHPSESSID cookie
 *   2. GET getter URL with Cookie + Referer headers → raw MIDI bytes
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the synth script: dist/snake-synth.mjs (built) or scripts/snake-synth.mjs (dev)
const __dir = dirname(fileURLToPath(import.meta.url));
const _buildPath = join(__dir, '../snake-synth.mjs');
const _devPath   = join(__dir, '../scripts/snake-synth.mjs');
const SYNTH_SCRIPT = existsSync(_buildPath) ? _buildPath : _devPath;

function soundsDir(cacheDir?: string): string {
  return join(cacheDir ?? tmpdir(), 'snake-game-sounds');
}

function wavCachePath(midiUrl: string, cacheDir?: string): string {
  const name = midiUrl.split('/').pop()?.replace(/\W/g, '_') ?? 'midi';
  return join(cacheDir ?? tmpdir(), `snake-game-${name}.wav`);
}

// ── freemidi.org two-step MIDI fetch ─────────────────────────────────

/**
 * Fetch MIDI bytes from freemidi.org.
 * Step 1: GET the download page to obtain a PHPSESSID cookie.
 * Step 2: GET the getter URL with the cookie and Referer header.
 * Falls back to a direct fetch if no downloadPage is provided.
 */
async function fetchMidiBytes(midiUrl: string, downloadPage?: string): Promise<Buffer> {
  if (!downloadPage) {
    const res = await fetch(midiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${midiUrl}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Step 1: get session cookie
  const pageRes = await fetch(downloadPage, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  const setCookie = pageRes.headers.get('set-cookie') ?? '';
  const sessionMatch = /PHPSESSID=([^;,\s]+)/.exec(setCookie);
  const cookie = sessionMatch ? `PHPSESSID=${sessionMatch[1]}` : '';

  // Step 2: fetch the MIDI
  const midiRes = await fetch(midiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      ...(cookie ? { Cookie: cookie } : {}),
      Referer: downloadPage,
    },
    redirect: 'follow',
  });
  if (!midiRes.ok) throw new Error(`HTTP ${midiRes.status} fetching MIDI from ${midiUrl}`);
  return Buffer.from(await midiRes.arrayBuffer());
}

// ── Platform audio helpers ────────────────────────────────────────────

const PLATFORM = process.platform;

/** Spawn a WAV player appropriate for the current platform. Returns null if unsupported. */
function spawnWavPlayer(
  wavPath: string,
  volume: number,
  opts: { detached?: boolean } = {},
): ReturnType<typeof spawn> | null {
  if (PLATFORM === 'darwin') {
    return spawn('afplay', [wavPath, '-v', String(volume)], { stdio: 'ignore', ...opts });
  }
  if (PLATFORM === 'linux') {
    // aplay doesn't support volume; the system mixer controls output level
    return spawn('aplay', ['-q', wavPath], { stdio: 'ignore', ...opts });
  }
  return null;
}

// ── Background music ─────────────────────────────────────────────────

export interface BgMusicHandle {
  proc: ChildProcess;
  bpm: number;
  wavPath: string;
}

/**
 * Synthesize + play the given MIDI URL in the background.
 * WAV is cached in /tmp keyed to the URL — synthesis only runs once per URL.
 * Returns { proc, bpm } so the caller can kill playback and sync to the tempo.
 *
 * @param midiUrl      Direct URL or freemidi.org getter URL.
 * @param downloadPage freemidi.org download page URL (for cookie grab). Optional.
 */
export async function startBgMusic(
  midiUrl: string,
  downloadPage?: string,
  volume = 0.4,
  cacheDir?: string,
): Promise<BgMusicHandle | null> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'linux') return null;

  const wavPath = wavCachePath(midiUrl, cacheDir);
  let bpm = 120;

  try {
    if (!existsSync(wavPath)) {
      // Write MIDI to a temp file so snake-synth.mjs can read it
      const midiBytes = await fetchMidiBytes(midiUrl, downloadPage);
      const midiTmp = wavPath.replace(/\.wav$/, '.mid');
      writeFileSync(midiTmp, midiBytes);

      const meta = await new Promise<{ bpm: number }>((resolve, reject) => {
        let stdout = '';
        const proc = spawn('node', [SYNTH_SCRIPT, midiTmp, wavPath], { stdio: ['ignore', 'pipe', 'ignore'] });
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.on('exit', (code) => {
          if (code !== 0) { reject(new Error(`synth exited ${code ?? 'null'}`)); return; }
          try { resolve(JSON.parse(stdout) as { bpm: number }); } catch { resolve({ bpm: 120 }); }
        });
        proc.on('error', reject);
      });
      bpm = meta.bpm;
    }
    const proc = spawnWavPlayer(wavPath, volume);
    if (!proc) return null;
    return { proc, bpm, wavPath };
  } catch {
    return null;
  }
}

export function stopBgMusic(handle: BgMusicHandle | null): void {
  handle?.proc.kill();
}

/**
 * Change playback volume without re-synthesizing.
 * Kills the current afplay process and restarts it at the new volume.
 */
export function setMusicVolume(handle: BgMusicHandle, volume: number): BgMusicHandle {
  handle.proc.kill();
  const proc = spawnWavPlayer(handle.wavPath, volume) ?? handle.proc;
  return { ...handle, proc };
}

// ── Per-note fallback (sine-wave WAVs via afplay) ─────────────────────

const SAMPLE_RATE = 44100;
const DURATION_S  = 0.09;

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function buildWav(freq: number): Buffer {
  const numSamples = Math.floor(SAMPLE_RATE * DURATION_S);
  const dataSize   = numSamples * 2;
  const buf        = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);

  const fadeIn  = Math.floor(SAMPLE_RATE * 0.005);
  const fadeOut = Math.floor(SAMPLE_RATE * 0.02);
  for (let i = 0; i < numSamples; i++) {
    const env = Math.min(i / fadeIn, 1) * Math.min((numSamples - i) / fadeOut, 1);
    buf.writeInt16LE(Math.round(28000 * env * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)), 44 + i * 2);
  }
  return buf;
}

function noteFile(note: number, cacheDir?: string): string {
  return join(soundsDir(cacheDir), `note-${note}.wav`);
}

export function warmNotes(notes: number[], cacheDir?: string): void {
  const dir = soundsDir(cacheDir);
  mkdirSync(dir, { recursive: true });
  for (const note of [...new Set(notes)]) {
    const path = noteFile(note, cacheDir);
    if (!existsSync(path)) writeFileSync(path, buildWav(midiToFreq(note)));
  }
}

export function playNote(note: number, volume = 1, cacheDir?: string): void {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'linux') { process.stdout.write('\x07'); return; }
  const dir = soundsDir(cacheDir);
  const path = noteFile(note, cacheDir);
  if (!existsSync(path)) { mkdirSync(dir, { recursive: true }); writeFileSync(path, buildWav(midiToFreq(note))); }
  spawnWavPlayer(path, volume, { detached: true })?.unref();
}

// ── System sounds ─────────────────────────────────────────────────────

export function playSystemSound(file: string, volume = 1): void {
  if (PLATFORM === 'darwin') {
    spawn('afplay', [file, '-v', String(volume)], { detached: true, stdio: 'ignore' }).unref();
  } else {
    process.stdout.write('\x07');
  }
}

export const SYSTEM_SOUNDS = {
  eat: '/System/Library/Sounds/Glass.aiff',
  die: '/System/Library/Sounds/Funk.aiff',
};
