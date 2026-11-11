import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;
export interface InstallOpts { exec?: Exec; silent?: boolean }
export type InstallResult = "installed" | "no-claude" | "node-old" | "failed" | "removed";

const PLUGIN = "projects-hub@projects-hub-local";
const KEY = "installedVersion";
const ASKED = "integrationProposed";

// On Windows the npm shim is claude.cmd, which execFile cannot run without a shell: use the exe it wraps.
function resolveCmd(cmd: string): string {
  if (cmd !== "claude" || process.platform !== "win32") return cmd;
  for (const d of (process.env.PATH ?? "").split(delimiter)) {
    if (existsSync(join(d, "claude.exe"))) return join(d, "claude.exe");
    const exe = join(d, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(join(d, "claude.cmd")) && existsSync(exe)) return exe;
  }
  return cmd;
}

const realExec: Exec = (cmd, args) => new Promise((res, rej) =>
  execFile(resolveCmd(cmd), args, { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) =>
    err ? rej(Object.assign(err, { stdout, stderr })) : res({ stdout })));

const missing = (e: unknown) => (e as { code?: string }).code === "ENOENT";
const text = (e: unknown) => `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}${(e as Error).message}`;

function copyPlugin(ctx: vscode.ExtensionContext, hubHome: string): string {
  const dest = join(hubHome, "marketplace");
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(ctx.extensionPath, "claude-plugin"), dest, { recursive: true });
  return dest;
}

export async function installIntegration(ctx: vscode.ExtensionContext, hubHome: string, o: InstallOpts = {}): Promise<InstallResult> {
  const exec = o.exec ?? realExec;
  const say = (m: string, error = false) => { if (!o.silent) void (error ? vscode.window.showErrorMessage(m) : vscode.window.showInformationMessage(m)); };
  try {
    const v = (await exec("node", ["--version"])).stdout.trim();
    if (Number(/^v?(\d+)/.exec(v)?.[1]) < 20) { say(`Node ${v} détecté : Node 20 ou plus est requis par le hook et le serveur MCP.`, true); return "node-old"; }
  } catch { say("Node 20 ou plus est requis (`node --version` a échoué).", true); return "node-old"; }

  const dest = copyPlugin(ctx, hubHome);
  try {
    await run(exec, ["plugin", "marketplace", "add", dest, "--json"]);
    await run(exec, ["plugin", "install", PLUGIN, "--json"]);
  } catch (e) {
    if (missing(e)) {
      say(`Claude Code (\`claude\`) est introuvable. Dans Claude Code, tape :\n/plugin marketplace add ${dest}\n/plugin install ${PLUGIN}`, true);
      return "no-claude";
    }
    say(`Installation échouée : ${text(e).slice(0, 300)}`, true);
    return "failed";
  }
  await ctx.globalState.update(KEY, ctx.extension.packageJSON.version);
  say("Intégration Claude installée. Redémarre les sessions Claude ouvertes.");
  return "installed";
}

// "already installed / already added" is a success.
async function run(exec: Exec, args: string[]) {
  try { await exec("claude", args); } catch (e) { if (!missing(e) && /already/i.test(text(e))) return; throw e; }
}

export async function removeIntegration(ctx: vscode.ExtensionContext, o: InstallOpts = {}): Promise<InstallResult> {
  const say = (m: string, error = false) => { if (!o.silent) void (error ? vscode.window.showErrorMessage(m) : vscode.window.showInformationMessage(m)); };
  try {
    await (o.exec ?? realExec)("claude", ["plugin", "uninstall", PLUGIN, "--json"]);
  } catch (e) {
    if (missing(e)) { say(`Claude Code (\`claude\`) est introuvable. Dans Claude Code, tape :\n/plugin uninstall ${PLUGIN}`, true); return "no-claude"; }
    say(`Retrait échoué : ${text(e).slice(0, 300)}`, true);
    return "failed";
  }
  await ctx.globalState.update(KEY, undefined);
  say("Intégration Claude retirée.");
  return "removed";
}

export function registerInstall(ctx: vscode.ExtensionContext, hubHome: string): vscode.Disposable[] {
  const version = ctx.extension.packageJSON.version as string;
  if (ctx.extensionMode !== vscode.ExtensionMode.Test) {
    const done = ctx.globalState.get<string>(KEY);
    if (done && done !== version) {
      // New extension version: refresh the local marketplace copy only; the plugin is then updated by Claude Code.
      try { copyPlugin(ctx, hubHome); void ctx.globalState.update(KEY, version); } catch { /* best effort */ }
    } else if (!done && !ctx.globalState.get(ASKED)) {
      void ctx.globalState.update(ASKED, true);
      void vscode.window.showInformationMessage("Installer l'intégration Claude (hook et serveur MCP du hub) ?", "Installer").then((c) => {
        if (c) return installIntegration(ctx, hubHome);
      });
    }
  }
  return [
    vscode.commands.registerCommand("claudeProjectsHub.installIntegration", (o?: InstallOpts) => installIntegration(ctx, hubHome, o)),
    vscode.commands.registerCommand("claudeProjectsHub.removeIntegration", (o?: InstallOpts) => removeIntegration(ctx, o)),
  ];
}
