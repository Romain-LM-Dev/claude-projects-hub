import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..", "..");
execFileSync(process.execPath, ["esbuild.mjs"], { cwd: root, stdio: "inherit" });

// An inherited ELECTRON_RUN_AS_NODE makes Code.exe behave as plain node ("bad option").
delete process.env.ELECTRON_RUN_AS_NODE;
const hub = mkdtempSync(join(tmpdir(), "hub-test-"));
const userData = mkdtempSync(join(tmpdir(), "vscode-user-"));
try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "dist", "test-suite.js"),
    launchArgs: ["--user-data-dir", userData, "--disable-workspace-trust", "--disable-extensions"],
    extensionTestsEnv: {
      CLAUDE_CONFIG_DIR: join(root, "test", "fixtures", "claude-home"),
      CLAUDE_PROJECTS_HUB_HOME: hub,
    },
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
