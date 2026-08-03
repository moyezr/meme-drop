import { spawn } from "node:child_process";

const port = String(process.env.PORT || "3401");
const child = spawn(
  "uv",
  [
    "run",
    "uvicorn",
    "memedrop_api.main:app",
    "--app-dir",
    "src",
    "--host",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: new URL("../apps/api/", import.meta.url),
    env: {
      ...process.env,
      MEMEDROP_ENV: "development",
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://test",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      MEMEDROP_REQUIRE_INSTALL_ID: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let output = "";
let finished = false;
const timer = setTimeout(() => {
  if (!finished) child.kill("SIGTERM");
}, 8_000);

child.stdout.on("data", (chunk) => {
  output += String(chunk);
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += String(chunk);
  process.stderr.write(chunk);
  if (output.includes("Uvicorn running on")) child.kill("SIGTERM");
});

child.on("exit", (code, signal) => {
  finished = true;
  clearTimeout(timer);
  if (!output.includes("Uvicorn running on")) {
    console.error("[MemeDrop] FastAPI process did not report listening");
    process.exit(code || 1);
  }
  console.log(`[MemeDrop] FastAPI process smoke passed (${signal || code})`);
});
