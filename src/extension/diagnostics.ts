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
    hub.log(vscode.l10n.t("diagnostics: {0} folders, {1} sessions, {2} bytes read, {3} ms", dirCount, sessions.length, stats.bytesRead, Date.now() - t0));
    hub.log(vscode.l10n.t("line types: {0}", JSON.stringify(stats.types)));
    for (const s of sessions.filter((x) => x.parseErrors > 0)) hub.log(vscode.l10n.t("unreadable lines: {0} in {1}", s.parseErrors, s.file));
    const latest = sessions.reduce<(typeof sessions)[number] | undefined>((a, s) => (!a || s.mtimeMs > a.mtimeMs ? s : a), undefined);
    if (latest) for (const l of await tail(latest.file)) hub.log(vscode.l10n.t("end of {0}: {1}", latest.sessionId, l));
  });
  return [out, cmd];
}
