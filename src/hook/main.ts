import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hubHome } from '../core/paths.ts';
import { injectionFor } from './context.ts';

const LOG_MAX = 1_000_000;

function makeLog(hub: string) {
  return (msg: string) => {
    try {
      const file = join(hub, 'logs', 'hook.log');
      mkdirSync(join(hub, 'logs'), { recursive: true });
      try { if (statSync(file).size > LOG_MAX) { const t = readFileSync(file); writeFileSync(file, t.subarray(t.length >> 1)); } } catch { /* no log yet */ }
      appendFileSync(file, `${new Date().toISOString()} ${msg.replace(/\s+/g, ' ')}\n`);
    } catch { /* logging must never break the session */ }
  };
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const done = () => { clearTimeout(timer); process.stdin.pause(); resolve(data); };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding('utf8').on('data', (c) => { data += c; }).on('end', done).on('error', done);
  });
}

async function main() {
  const hub = hubHome();
  const log = makeLog(hub);
  try {
    let input: unknown;
    try { input = JSON.parse((await readStdin(1000)).replace(/^﻿/, '')); } catch { return; }
    if (!input || typeof input !== 'object') return;
    const cwd = (input as { cwd?: unknown }).cwd;
    const dir = process.env.CLAUDE_PROJECT_DIR || (typeof cwd === 'string' && cwd ? cwd : '');
    if (!dir) return;

    const text = await injectionFor(dir, { hubHome: hub, ensure: true, log });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch (e) {
    log(`hook: ${(e as Error).message}`);
  }
}

void main(); // no top-level await: the bundle is CJS
