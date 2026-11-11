import * as vscode from "vscode";
import { open } from "node:fs/promises";
import { scanClaudeData } from "../core/claudeData.ts";
import type { ScanStats } from "../core/transcript.ts";
import type { Hub } from "./tree.ts";

async function tail(file: string, lines = 3): Promise<string[]> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, 4096);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8").split("\n").filter(Boolean).slice(-lines).map((l) => l.slice(0, 300));
  } finally { await fh.close(); }
}

export function setupDiagnostics(hub: Hub): vscode.Disposable[] {
  const out = vscode.window.createOutputChannel("Claude Hub");
  hub.log = (m) => out.appendLine(`[${new Date().toISOString()}] ${m}`);
  const cmd = vscode.commands.registerCommand("claudeProjectsHub.diagnostics", async () => {
    out.show(true);
    const stats: ScanStats = { types: {}, bytesRead: 0 };
    const t0 = Date.now();
    const { sessions, dirCount } = await scanClaudeData(hub.claudeHome, { cachePath: hub.cachePath, stats });
    hub.log(`diagnostic : ${dirCount} dossiers, ${sessions.length} sessions, ${stats.bytesRead} octets lus, ${Date.now() - t0} ms`);
    hub.log(`types de lignes : ${JSON.stringify(stats.types)}`);
    for (const s of sessions.filter((x) => x.parseErrors > 0)) hub.log(`lignes illisibles : ${s.parseErrors} dans ${s.file}`);
    const latest = sessions.reduce<(typeof sessions)[number] | undefined>((a, s) => (!a || s.mtimeMs > a.mtimeMs ? s : a), undefined);
    if (latest) for (const l of await tail(latest.file)) hub.log(`fin de ${latest.sessionId} : ${l}`);
  });
  return [out, cmd];
}
