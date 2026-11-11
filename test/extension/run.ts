import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..", "..");
execFileSync(process.execPath, ["esbuild.mjs"], { cwd: root, stdio: "inherit" });

// An inherited ELECTRON_RUN_AS_NODE makes Code.exe behave as plain node ("bad option").
delete process.env.ELECTRON_RUN_AS_NODE;
// Writable copy of the versioned fixture: the suite adds generated transcripts to it. Relocation repos live outside tmpdir (excluded, 7.3).
const claudeHome = join(root, ".vscode-test", "claude-home");
const relocDir = join(root, ".vscode-test", "reloc");
rmSync(claudeHome, { recursive: true, force: true });
rmSync(relocDir, { recursive: true, force: true });
cpSync(join(root, "test", "fixtures", "claude-home"), claudeHome, { recursive: true });
const hub = mkdtempSync(join(tmpdir(), "hub-test-"));
const userData = mkdtempSync(join(tmpdir(), "vscode-user-"));
try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "dist", "test-suite.js"),
    launchArgs: ["--user-data-dir", userData, "--disable-workspace-trust", "--disable-extensions"],
    extensionTestsEnv: {
      CLAUDE_CONFIG_DIR: claudeHome,
      TEST_RELOC_DIR: relocDir,
      TEST_ROOT: root,
      CLAUDE_PROJECTS_HUB_HOME: hub,
    },
  });
} catch (e) {
  console.error(e);
  rmSync(relocDir, { recursive: true, force: true });
  process.exit(1);
} finally {
  rmSync(relocDir, { recursive: true, force: true });
}
