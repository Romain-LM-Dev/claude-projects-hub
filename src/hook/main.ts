import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureProject, resolveProject } from '../core/identity.ts';
import { hubHome } from '../core/paths.ts';
import { readRegistry } from '../core/registry.ts';
import { listTopics } from '../core/store.ts';
import { HOOK_BUDGET, PROJECT_NONE, PROJECT_UNREGISTERED, buildHeader, buildInjection, projectLabel } from './injection.ts';

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

    let id: string | undefined;
    let excluded = false;
    try {
      const p = await ensureProject(dir, { hubHome: hub, git: false, log, lockTimeoutMs: 500 });
      if (p) id = p.id; else excluded = true;
    } catch (e) {
      log(`ensureProject: ${(e as Error).message}`);
      try {
        const r = await resolveProject(dir, { hubHome: hub });
        if (r.status === 'resolved') id = r.id; else excluded = r.status === 'excluded';
      } catch (e2) { log(`resolveProject: ${(e2 as Error).message}`); }
    }

    let project = excluded ? PROJECT_NONE : PROJECT_UNREGISTERED;
    if (id) {
      let name = id;
      try { name = (await readRegistry(hub)).reg.projects[id]?.name ?? id; } catch (e) { log(`registre: ${(e as Error).message}`); }
      project = projectLabel(name);
    }
    const valid = (await listTopics({ hubHome: hub, projectId: id }, 'all')).flatMap((t) => (t.valid ? [t] : []));
    const text = buildInjection(buildHeader(project), valid.filter((t) => t.ref.startsWith('project:')), valid.filter((t) => t.ref.startsWith('global:')), HOOK_BUDGET);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch (e) {
    log(`hook: ${(e as Error).message}`);
  }
}

void main(); // no top-level await: the bundle is CJS
