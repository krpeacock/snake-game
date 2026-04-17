/**
 * snake-audio.ts — Audio for the Snake game.
 *
 * Background music: synthesizes a MIDI file to WAV via a self-contained
 * child script (snake-synth.mjs, ~1s), then streams it with the best
 * available WAV player for the platform.
 *
 * Playback:
 *   macOS  — afplay (built-in, supports volume)
 *   Linux  — paplay > ffplay > aplay (detected once, first with volume wins)
 *
 * Per-note tink & system sounds (eat/die) are synthesized as short sine-wave
 * WAVs at runtime and played through the same player. No platform-specific
 * audio files are bundled, so the eat/die sounds work on every platform
 * that has a supported WAV player.
 *
 * freemidi.org requires a two-step fetch:
 *   1. GET download page → grab PHPSESSID cookie
 *   2. GET getter URL with Cookie + Referer headers → raw MIDI bytes
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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

type LinuxPlayer = 'paplay' | 'ffplay' | 'aplay' | null;
let linuxPlayerCache: LinuxPlayer | undefined;

function commandExists(cmd: string): boolean {
  const r = spawnSync('which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * Detect the best available Linux audio player, once per process.
 * Preference order:
 *   paplay — PulseAudio / PipeWire, ubiquitous on desktop Linux, volume via --volume
 *   ffplay — ffmpeg, common in dev envs, volume via -volume
 *   aplay  — ALSA, always available but no per-stream volume
 */
function detectLinuxPlayer(): LinuxPlayer {
  if (linuxPlayerCache !== undefined) return linuxPlayerCache;
  if (commandExists('paplay')) linuxPlayerCache = 'paplay';
  else if (commandExists('ffplay')) linuxPlayerCache = 'ffplay';
  else if (commandExists('aplay')) linuxPlayerCache = 'aplay';
  else linuxPlayerCache = null;
  return linuxPlayerCache;
}

function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Spawn a WAV player appropriate for the current platform. Returns null if unsupported. */
function spawnWavPlayer(
  wavPath: string,
  volume: number,
  opts: { detached?: boolean } = {},
): ReturnType<typeof spawn> | null {
  const v = clampVolume(volume);
  if (PLATFORM === 'darwin') {
    return spawn('afplay', [wavPath, '-v', String(v)], { stdio: 'ignore', ...opts });
  }
  if (PLATFORM === 'linux') {
    const player = detectLinuxPlayer();
    if (player === 'paplay') {
      // paplay volume is a linear 0-65536 scale (65536 = 100%)
      const vol = Math.round(v * 65536);
      return spawn('paplay', [`--volume=${vol}`, wavPath], { stdio: 'ignore', ...opts });
    }
    if (player === 'ffplay') {
      const vol = Math.round(v * 100);
      return spawn(
        'ffplay',
        ['-autoexit', '-nodisp', '-loglevel', 'quiet', '-volume', String(vol), wavPath],
        { stdio: 'ignore', ...opts },
      );
    }
    if (player === 'aplay') {
      // aplay has no volume flag; relies on the system mixer
      return spawn('aplay', ['-q', wavPath], { stdio: 'ignore', ...opts });
    }
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

// ── Sine-wave synthesis (tinks + system sounds) ───────────────────────

const SAMPLE_RATE = 44100;
const DURATION_S  = 0.09;

interface NoteSpec {
  /** MIDI note number (e.g. 69 = A4) */
  note: number;
  /** Duration in seconds */
  duration: number;
}

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function writeWavHeader(buf: Buffer, dataSize: number): void {
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
}

/** Render a sequence of notes played one after another, each with a short fade. */
function buildSequenceWav(specs: NoteSpec[]): Buffer {
  const segments = specs.map((s) => ({
    freq: midiToFreq(s.note),
    numSamples: Math.floor(SAMPLE_RATE * s.duration),
  }));
  const totalSamples = segments.reduce((sum, s) => sum + s.numSamples, 0);
  const dataSize = totalSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  writeWavHeader(buf, dataSize);

  let offset = 0;
  for (const seg of segments) {
    const fadeIn  = Math.min(Math.floor(SAMPLE_RATE * 0.005), Math.floor(seg.numSamples / 4));
    const fadeOut = Math.min(Math.floor(SAMPLE_RATE * 0.02),  Math.floor(seg.numSamples / 2));
    for (let i = 0; i < seg.numSamples; i++) {
      const env = Math.min(i / fadeIn, 1) * Math.min((seg.numSamples - i) / fadeOut, 1);
      buf.writeInt16LE(
        Math.round(28000 * env * Math.sin((2 * Math.PI * seg.freq * i) / SAMPLE_RATE)),
        44 + (offset + i) * 2,
      );
    }
    offset += seg.numSamples;
  }
  return buf;
}

function buildNoteWav(note: number): Buffer {
  return buildSequenceWav([{ note, duration: DURATION_S }]);
}

function noteFile(note: number, cacheDir?: string): string {
  return join(soundsDir(cacheDir), `note-${note}.wav`);
}

export function warmNotes(notes: number[], cacheDir?: string): void {
  const dir = soundsDir(cacheDir);
  mkdirSync(dir, { recursive: true });
  for (const note of [...new Set(notes)]) {
    const path = noteFile(note, cacheDir);
    if (!existsSync(path)) writeFileSync(path, buildNoteWav(note));
  }
}

export function playNote(note: number, volume = 1, cacheDir?: string): void {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'linux') { process.stdout.write('\x07'); return; }
  const dir = soundsDir(cacheDir);
  const path = noteFile(note, cacheDir);
  if (!existsSync(path)) { mkdirSync(dir, { recursive: true }); writeFileSync(path, buildNoteWav(note)); }
  spawnWavPlayer(path, volume, { detached: true })?.unref();
}

// ── System sounds ─────────────────────────────────────────────────────

export const SYSTEM_SOUNDS = {
  eat: 'eat',
  die: 'die',
} as const;

export type SystemSoundKey = typeof SYSTEM_SOUNDS[keyof typeof SYSTEM_SOUNDS];

const SYSTEM_SOUND_SPECS: Record<SystemSoundKey, NoteSpec[]> = {
  // Ascending major triad — short, upbeat "yum"
  eat: [
    { note: 72, duration: 0.05 }, // C5
    { note: 76, duration: 0.05 }, // E5
    { note: 79, duration: 0.10 }, // G5
  ],
  // Descending minor triad — somber "game over"
  die: [
    { note: 67, duration: 0.10 }, // G4
    { note: 63, duration: 0.10 }, // Eb4
    { note: 60, duration: 0.25 }, // C4
  ],
};

function systemSoundFile(key: SystemSoundKey, cacheDir?: string): string {
  return join(soundsDir(cacheDir), `system-${key}.wav`);
}

function ensureSystemSound(key: SystemSoundKey, cacheDir?: string): string {
  const path = systemSoundFile(key, cacheDir);
  if (!existsSync(path)) {
    mkdirSync(soundsDir(cacheDir), { recursive: true });
    writeFileSync(path, buildSequenceWav(SYSTEM_SOUND_SPECS[key]));
  }
  return path;
}

export function playSystemSound(key: string, volume = 1, cacheDir?: string): void {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'linux') { process.stdout.write('\x07'); return; }
  if (!(key in SYSTEM_SOUND_SPECS)) return;
  const path = ensureSystemSound(key as SystemSoundKey, cacheDir);
  spawnWavPlayer(path, volume, { detached: true })?.unref();
}
