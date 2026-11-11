import * as vscode from "vscode";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Api {
  projects: { getChildren(n?: any): Promise<any[]> };
  globalMemory: { getChildren(n?: any): Promise<any[]> };
  relocation: { lastMerges: unknown[] };
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

  await relocationSuite(api);
  await installSuite();
}

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR!;
const hubHome = () => process.env.CLAUDE_PROJECTS_HUB_HOME!;
const lc = (p: string) => p.toLowerCase();
const git = (dir: string, ...args: string[]) =>
  void execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args], { stdio: "pipe" });

function mkRepo(dir: string, n: number, remote: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(join(dir, "f.txt"), "contenu " + n);
  git(dir, "add", ".");
  // distinct root commit per repo: different content and date
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = `2026-01-0${n}T10:00:00Z`;
  git(dir, "commit", "-q", "-m", "init " + n);
  delete process.env.GIT_AUTHOR_DATE;
  delete process.env.GIT_COMMITTER_DATE;
  git(dir, "remote", "add", "origin", remote);
}
const encode = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");
function session(cwd: string, id: string) {
  const d = join(claudeHome(), "projects", encode(cwd));
  mkdirSync(d, { recursive: true });
  const line = { type: "user", isSidechain: false, cwd, sessionId: id, timestamp: new Date().toISOString(), message: { role: "user", content: "prompt " + id } };
  writeFileSync(join(d, id + ".jsonl"), JSON.stringify(line) + "\n");
}
const registry = () => JSON.parse(readFileSync(join(hubHome(), "registry.json"), "utf8")) as { projects: Record<string, { paths: string[]; formerPaths: string[] }> };
const idsAt = (dir: string) => Object.entries(registry().projects).filter(([, e]) => e.paths.some((p) => lc(p) === lc(dir))).map(([id]) => id);

async function relocationSuite(api: Api) {
  // Outside tmpdir (excluded, §7.3) and git-ignored.
  const base = process.env.TEST_RELOC_DIR!;
  mkdirSync(base, { recursive: true });
  const rescan = async () => { await vscode.commands.executeCommand("claudeProjectsHub.refresh"); return api.projects.getChildren(); };
  try {
    // A. repo without marker moved: session at the new folder + scan = certain merge, then Annuler.
    const oldA = join(base, "a1", "proj-alpha");
    const newA = join(base, "a2", "proj-alpha2");
    mkRepo(oldA, 1, "https://example.com/alpha.git");
    session(oldA, "sa1");
    await rescan();
    const [idA] = idsAt(oldA);
    assert.ok(idA, "projet d'origine non enregistré");
    mkdirSync(join(base, "a2"), { recursive: true });
    renameSync(oldA, newA);
    session(newA, "sa2");
    await rescan();
    assert.equal(api.relocation.lastMerges.length, 1, "fusion attendue");
    assert.deepEqual(idsAt(newA), [idA], "le projet d'origine doit porter le nouveau dossier");
    assert.ok(registry().projects[idA]!.formerPaths.some((p) => lc(p) === lc(oldA)));

    // auto-memory copy from the old Claude folder to the new one (confirmation short-circuited)
    const mem = join(claudeHome(), "projects", encode(oldA), "memory");
    mkdirSync(mem, { recursive: true });
    writeFileSync(join(mem, "n.md"), "---\nname: n\ndescription: d\ntype: project\n---\ncorps\n");
    writeFileSync(join(mem, "MEMORY.md"), "- [n](n.md) - d\n");
    const nodeA = (await rescan()).find((n) => n.kind === "project" && lc(n.p.info.cwd) === lc(newA));
    assert.ok(nodeA, "noeud du projet déplacé absent");
    await vscode.commands.executeCommand("claudeProjectsHub.copyAutoMemory", nodeA, { confirm: true });
    assert.ok(existsSync(join(claudeHome(), "projects", encode(newA), "memory", "n.md")), "auto-mémoire non copiée");

    const idC = (api.relocation.lastMerges[0] as { removedId: string }).removedId;
    await vscode.commands.executeCommand("claudeProjectsHub.undoMerge");
    assert.deepEqual(idsAt(newA), [idC], "le nouveau dossier appartient à nouveau à son projet d'origine (C)");
    assert.notEqual(idC, idA);
    await rescan(); // the refusal is durable: no second merge
    assert.equal(api.relocation.lastMerges.length, 0, "Annuler doit être durable : pas de nouvelle fusion");
    assert.deepEqual(idsAt(newA), [idC]);

    // preview identical to the bundled hook's additionalContext
    const uri = (await vscode.commands.executeCommand("claudeProjectsHub.previewInjection", newA)) as vscode.Uri;
    const preview = (await vscode.workspace.openTextDocument(uri)).getText();
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.CLAUDE_PROJECT_DIR;
    const hookJs = join(process.env.TEST_ROOT!, "claude-plugin", "projects-hub", "dist", "hook.js");
    const out = execFileSync(process.execPath, [hookJs], { input: JSON.stringify({ cwd: newA }), env }).toString();
    const hook = (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    assert.ok(hook.length > 0);
    assert.equal(preview, hook, "aperçu différent du hook");

    // B. probable proposal (same root commit, other remote): Ignorer ce candidat, not proposed again.
    const oldB = join(base, "b1", "proj-beta");
    const newB = join(base, "b2", "proj-beta2");
    mkRepo(oldB, 2, "https://example.com/beta-a.git");
    session(oldB, "sb1");
    await rescan();
    mkdirSync(join(base, "b2"), { recursive: true });
    renameSync(oldB, newB);
    git(newB, "remote", "set-url", "origin", "https://example.com/beta-b.git");
    session(newB, "sb2");
    let roots = await rescan();
    const props = roots.find((n) => n.kind === "proposals");
    assert.ok(props, "nœud « À rattacher » absent");
    const prop = (await api.projects.getChildren(props)).find((n) => n.orphan === "proj-beta" && n.candidate === "proj-beta2");
    assert.ok(prop, "proposition attendue");
    await vscode.commands.executeCommand("claudeProjectsHub.dismissCandidate", prop);
    roots = await rescan();
    const proposedAgain = async () => {
      const p = roots.find((n) => n.kind === "proposals");
      return !!p && (await api.projects.getChildren(p)).some((n) => n.orphan === "proj-beta");
    };
    assert.ok(!(await proposedAgain()), "candidat ignoré reproposé");
    const orphan = (await api.projects.getChildren(roots.find((n) => n.kind === "orphans"))).find((n) => n.name === "proj-beta");
    assert.ok(orphan, "orphelin attendu dans « Orphelins »");
    await vscode.commands.executeCommand("claudeProjectsHub.dismissOrphan", orphan);
    roots = await rescan();
    const orphansNode = roots.find((n) => n.kind === "orphans");
    assert.ok(!orphansNode || !(await api.projects.getChildren(orphansNode)).some((n) => n.name === "proj-beta"), "orphelin ignoré toujours affiché");

    // detach: the folder gets a fresh identity
    const before = idsAt(newB)[0];
    const nodeB = roots.find((n) => n.kind === "project" && lc(n.p.info.cwd) === lc(newB));
    assert.ok(nodeB, "noeud du projet B absent");
    await vscode.commands.executeCommand("claudeProjectsHub.detachDir", nodeB);
    assert.notEqual(idsAt(newB)[0], before, "identité inchangée après Détacher");
  } finally {
    try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold the folder while VS Code watches it: run.ts removes it afterwards */ }
  }
}

type Call = [string, string[]];
async function installSuite() {
  const calls: Call[] = [];
  const fake = (fail?: (c: string, a: string[]) => Error | undefined) => async (c: string, a: string[]) => {
    calls.push([c, a]);
    const e = fail?.(c, a);
    if (e) throw e;
    return { stdout: c === "node" ? "v24.0.0" : "{}" };
  };
  const run = (id: string, o: object) => vscode.commands.executeCommand(id, { silent: true, ...o });
  const dest = join(hubHome(), "marketplace");
  writeFileSync(join(hubHome(), "stale.txt"), "x");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "stale.txt"), "x");

  assert.equal(await run("claudeProjectsHub.installIntegration", { exec: fake() }), "installed");
  assert.ok(existsSync(join(dest, ".claude-plugin", "marketplace.json")) && existsSync(join(dest, "projects-hub", "dist", "mcp.js")), "copie vers marketplace");
  assert.ok(!existsSync(join(dest, "stale.txt")), "remplacement complet");
  assert.deepEqual(calls, [
    ["node", ["--version"]],
    ["claude", ["plugin", "marketplace", "add", dest, "--json"]],
    ["claude", ["plugin", "install", "projects-hub@projects-hub-local", "--json"]],
  ]);

  const already = fake((c) => (c === "claude" ? new Error("Plugin already installed") : undefined));
  assert.equal(await run("claudeProjectsHub.installIntegration", { exec: already }), "installed", "déjà installé = succès");

  const noClaude = fake((c) => (c === "claude" ? Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) : undefined));
  assert.equal(await run("claudeProjectsHub.installIntegration", { exec: noClaude }), "no-claude");

  const oldNode = async () => ({ stdout: "v18.0.0" });
  assert.equal(await run("claudeProjectsHub.installIntegration", { exec: oldNode }), "node-old");

  calls.length = 0;
  assert.equal(await run("claudeProjectsHub.removeIntegration", { exec: fake() }), "removed");
  assert.deepEqual(calls, [["claude", ["plugin", "uninstall", "projects-hub@projects-hub-local", "--json"]]]);
  assert.equal(await run("claudeProjectsHub.removeIntegration", { exec: noClaude }), "no-claude");
}
