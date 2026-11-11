import * as vscode from "vscode";
import assert from "node:assert/strict";

interface Api {
  projects: { getChildren(n?: any): Promise<any[]> };
  globalMemory: { getChildren(n?: any): Promise<any[]> };
}

// Built by esbuild to dist/test-suite.js and loaded by the VS Code host (see run.ts).
export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>("romain-lm-dev.claude-projects-hub");
  assert.ok(ext, "extension introuvable");
  const api = await ext.activate();
  assert.ok(ext.isActive, "activation");

  const roots = await api.projects.getChildren();
  const proj = roots.find((n) => n.kind === "project" && n.p.name === "a");
  assert.ok(proj, `projet de la fixture absent : ${JSON.stringify(roots.map((n) => n.kind))}`);
  const groups = await api.projects.getChildren(proj);
  const sessions = await api.projects.getChildren(groups.find((g) => g.kind === "sessions"));
  assert.ok(sessions.length >= 3, `sessions : ${sessions.length}`);

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("claude-session:/C--proj-a/aaaa0001.md?page=1"));
  assert.match(doc.getText(), /Premier prompt reel/);

  await vscode.commands.executeCommand("claudeProjectsHub.newTopic", undefined, { slug: "essai", title: "Essai", summary: "Topic d'essai" });
  const topics = await api.globalMemory.getChildren();
  assert.ok(topics.some((n) => n.kind === "topic" && n.entry.ref === "global:essai"), "topic créé absent de la vue");
}
