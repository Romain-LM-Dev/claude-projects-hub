import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionSummary } from './transcript.ts';

export interface CacheEntry {
  size: number;
  mtimeMs: number;
  summary: SessionSummary;
}
export type SessionCache = Record<string, CacheEntry>;

/** Cache jetable : fichier absent ou illisible = cache vide. */
export async function loadCache(cachePath: string): Promise<SessionCache> {
  try {
    const o: unknown = JSON.parse(await readFile(cachePath, 'utf8'));
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as SessionCache) : {};
  } catch {
    return {};
  }
}

/** Écriture tmp + rename, sans verrou (le dernier écrivain gagne, le cache se reconstruit). */
export async function saveCache(cachePath: string, cache: SessionCache): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache));
  await rename(tmp, cachePath);
}

export function cachedSummary(cache: SessionCache, file: string, size: number, mtimeMs: number): SessionSummary | undefined {
  const e = cache[file];
  return e && e.size === size && e.mtimeMs === mtimeMs ? e.summary : undefined;
}
