import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { hubHome } from '../core/paths.ts';
import { createServer, sessionDir } from './tools.ts';

const LOG_MAX = 1_000_000;

function makeLog(hub: string) {
  return (msg: string) => {
    try {
      const file = join(hub, 'logs', 'mcp.log');
      mkdirSync(join(hub, 'logs'), { recursive: true });
      try { if (statSync(file).size > LOG_MAX) { const t = readFileSync(file); writeFileSync(file, t.subarray(t.length >> 1)); } } catch { /* no log yet */ }
      appendFileSync(file, `${new Date().toISOString()} ${msg.replace(/\s+/g, ' ')}\n`);
    } catch { /* logging must never break the server */ }
  };
}

const hub = hubHome();
const log = makeLog(hub);
createServer({ hubHome: hub, projectDir: sessionDir(process.env, process.cwd()), log })
  .connect(new StdioServerTransport())
  .catch((e: Error) => { log(`connect: ${e.message}`); process.exit(1); });
