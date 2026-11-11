import { build } from "esbuild";
import { existsSync } from "node:fs";

const entries = [
  { in: "src/extension/extension.ts", out: "dist/extension.js", external: ["vscode"] },
  { in: "test/extension/suite.ts", out: "dist/test-suite.js", external: ["vscode"] },
  { in: "src/hook/main.ts", out: "claude-plugin/projects-hub/dist/hook.js" },
  { in: "src/mcp/main.ts", out: "claude-plugin/projects-hub/dist/mcp.js" },
];

for (const e of entries) {
  if (!existsSync(e.in)) {
    console.log(`entrée absente, sautée : ${e.in}`);
    continue;
  }
  await build({
    entryPoints: [e.in],
    outfile: e.out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: e.external ?? [],
    sourcemap: false,
    logLevel: "info",
  });
}
