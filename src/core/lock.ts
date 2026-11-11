import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HubError } from './paths.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LockOptions {
  /** How long to wait for the lock (default 2000 ms; the hook uses 500). */
  timeoutMs?: number;
  /** Age after which a lock is stale and taken over (default 10 000 ms). */
  staleMs?: number;
}

/** Runs `fn` holding `<file>.lock` (created with `wx`, retried every 25 ms). Released in `finally`. */
export async function withLock<T>(file: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const { timeoutMs = 2000, staleMs = 10_000 } = opts;
  const lockPath = `${file}.lock`;
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(file), { recursive: true });
  for (;;) {
    try {
      const h = await open(lockPath, 'wx');
      try { await h.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } finally { await h.close(); }
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // Windows answers EPERM/EACCES while another process is deleting the lock: wait, as for EEXIST.
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw new HubError('io', `verrou impossible : ${(e as Error).message}`);
    }
    try {
      // shortcut: two processes taking over the same stale lock can race, acceptable at 10 s staleness.
      if (Date.now() - (await stat(lockPath)).mtimeMs > staleMs) { await unlink(lockPath).catch(() => {}); continue; }
    } catch { /* lock vanished or unreadable: fall through, so the deadline still applies */ }
    if (Date.now() >= deadline) throw new HubError('io', `verrou occupé : ${lockPath}`);
    await sleep(25);
  }
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

/** Writes `<file>.<pid>.<random>.tmp` then renames over `file`; retries EPERM/EBUSY/EACCES (50..800 ms). */
export async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content);
    for (const delay of [50, 100, 200, 400, 800, 0]) {
      try { return await rename(tmp, file); } catch (e) {
        const c = (e as NodeJS.ErrnoException).code;
        if (!delay || (c !== 'EPERM' && c !== 'EBUSY' && c !== 'EACCES')) throw e;
        await sleep(delay);
      }
    }
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw new HubError('io', `écriture impossible : ${(e as Error).message}`);
  }
}
