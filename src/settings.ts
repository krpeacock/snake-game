/**
 * settings.ts — Persistent settings for snake-game stored in ~/.snake-game.json
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CONFIG_PATH = path.join(os.homedir(), '.snake-game.json');

function readConfig(configPath = CONFIG_PATH): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(data: Record<string, unknown>, configPath = CONFIG_PATH): void {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

function clampVol(v: unknown, def: number): number {
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : def;
}

export function getSnakeHighScore(configPath?: string): number {
  const config = readConfig(configPath);
  const score = config['high_score'];
  return typeof score === 'number' ? score : 0;
}

export function setSnakeHighScore(score: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['high_score'] = score;
  writeConfig(config, configPath);
}

export function getSnakeMusicVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['music_volume'], 0.8);
}

export function setSnakeMusicVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['music_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}

export function getSnakeTinkVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['tink_volume'], 0.05);
}

export function setSnakeTinkVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['tink_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}

export function getSnakeSfxVolume(configPath?: string): number {
  return clampVol(readConfig(configPath)['sfx_volume'], 0.8);
}

export function setSnakeSfxVolume(volume: number, configPath?: string): void {
  const config = readConfig(configPath);
  config['sfx_volume'] = Math.max(0, Math.min(1, volume));
  writeConfig(config, configPath);
}

export function getSnakeLoopEnabled(configPath?: string): boolean {
  return readConfig(configPath)['loop_enabled'] === true;
}

export function setSnakeLoopEnabled(enabled: boolean, configPath?: string): void {
  const config = readConfig(configPath);
  config['loop_enabled'] = enabled;
  writeConfig(config, configPath);
}

export interface LastTrack {
  title: string;
  artist: string;
  url: string;
  downloadPage?: string;
}

export function getSnakeLastTrack(configPath?: string): LastTrack | null {
  const t = readConfig(configPath)['last_track'];
  if (!t || typeof t !== 'object') return null;
  const track = t as Record<string, unknown>;
  if (typeof track['url'] !== 'string' || !track['url']) return null;
  return {
    title: typeof track['title'] === 'string' ? track['title'] : '',
    artist: typeof track['artist'] === 'string' ? track['artist'] : '',
    url: track['url'],
    downloadPage: typeof track['downloadPage'] === 'string' ? track['downloadPage'] : undefined,
  };
}

export function setSnakeLastTrack(track: LastTrack, configPath?: string): void {
  const config = readConfig(configPath);
  config['last_track'] = track;
  writeConfig(config, configPath);
}
