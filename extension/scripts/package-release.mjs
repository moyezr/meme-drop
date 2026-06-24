import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import extensionPackage from "../package.json" with { type: "json" };

const repoRoot = resolve(import.meta.dirname, "../..");
const extensionDir = resolve(repoRoot, "extension");
const distDir = resolve(extensionDir, "dist");
const outputPath = resolve(
  repoRoot,
  ".memedrop",
  `memedrop-extension-v${extensionPackage.version}.zip`
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!process.env.VITE_API_BASE_URL) {
  console.error("VITE_API_BASE_URL is required for release packaging.");
  process.exit(1);
}

run("npm", ["run", "build:release"], { cwd: extensionDir });
run("npm", ["run", "validate:release-metadata"], { cwd: extensionDir });

if (!existsSync(distDir)) {
  console.error("Extension dist directory was not created.");
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
rmSync(outputPath, { force: true });

run("zip", ["-r", outputPath, "."], { cwd: distDir });
run("node", ["scripts/validate-release-package.mjs", "--zip", outputPath], { cwd: extensionDir });

console.log(`Packaged ${outputPath}`);
