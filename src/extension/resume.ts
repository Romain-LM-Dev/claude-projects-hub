import * as vscode from "vscode";
import { existsSync } from "node:fs";
import type { Node } from "./tree.ts";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerResume(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("claudeProjectsHub.resumeInClaude", async (n?: Node) => {
      if (n?.kind !== "session" || !ID.test(n.s.sessionId)) return;
      await vscode.env.openExternal(vscode.Uri.parse(`vscode://anthropic.claude-code/open?session=${n.s.sessionId}`));
    }),
    vscode.commands.registerCommand("claudeProjectsHub.resumeInTerminal", (n?: Node) => {
      if (n?.kind !== "session" || !ID.test(n.s.sessionId)) return;
      const cwd = n.p.info.cwd;
      if (!existsSync(cwd)) return void vscode.window.showErrorMessage(`Dossier introuvable : ${cwd}`);
      const t = vscode.window.createTerminal({ name: "Claude", cwd });
      t.show();
      t.sendText(`claude --resume ${n.s.sessionId}`);
    }),
    vscode.commands.registerCommand("claudeProjectsHub.openFolder", async (n?: Node) => {
      if (n?.kind !== "project") return;
      if (!existsSync(n.p.info.cwd)) return void vscode.window.showErrorMessage(`Dossier introuvable : ${n.p.info.cwd}`);
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(n.p.info.cwd), { forceNewWindow: true });
    }),
  ];
}
