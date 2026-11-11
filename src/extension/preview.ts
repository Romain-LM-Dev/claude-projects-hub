import * as vscode from "vscode";
import { injectionFor } from "../hook/context.ts";
import type { Hub, Node } from "./tree.ts";

const SCHEME = "claude-injection";

/** Read-only document holding what the SessionStart hook would inject for a folder (same function, `ensure: false`). */
export function registerPreview(hub: Hub): vscode.Disposable[] {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent: (uri) => injectionFor(new URLSearchParams(uri.query).get("dir") ?? "", { hubHome: hub.hubHome, ensure: false, log: hub.log }),
  };
  return [
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand("claudeProjectsHub.previewInjection", async (arg?: Node | string) => {
      const dir = typeof arg === "string" ? arg : arg?.kind === "project" ? arg.p.info.cwd : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!dir) { void vscode.window.showInformationMessage("Claude Hub : ouvrez un dossier ou choisissez un projet."); return; }
      const uri = vscode.Uri.from({ scheme: SCHEME, path: "/Aperçu de l'injection.md", query: new URLSearchParams({ dir, t: String(Date.now()) }).toString() });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
      return uri;
    }),
  ];
}
