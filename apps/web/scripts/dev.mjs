import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const appDirectory = resolve(import.meta.dirname, "..");
const environment = { ...process.env };

// The repository .env is the shared local source. An app-local file may override it.
for (const path of [resolve(appDirectory, "../..", ".env"), resolve(appDirectory, ".env.local")]) {
  if (existsSync(path)) {
    Object.assign(environment, parseEnv(readFileSync(path, "utf8")));
  }
}

const next = resolve(appDirectory, "../../node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", ...process.argv.slice(2)], {
  cwd: appDirectory,
  env: environment,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`Unable to start the MemeDrop web app: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
