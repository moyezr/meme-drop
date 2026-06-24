import { spawn } from "node:child_process";

const port = String(process.env.PORT || "3401");
const child = spawn(process.execPath, ["backend/dist/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://test",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "test-key",
    MEMEDROP_REQUIRE_INSTALL_ID: process.env.MEMEDROP_REQUIRE_INSTALL_ID || "false",
    PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let finished = false;
const timer = setTimeout(() => {
  if (!finished) child.kill("SIGTERM");
}, 2500);

child.stdout.on("data", (chunk) => {
  const text = String(chunk);
  output += text;
  process.stdout.write(chunk);
  if (text.includes("Server listening")) {
    child.kill("SIGTERM");
  }
});

child.stderr.on("data", (chunk) => {
  output += String(chunk);
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  finished = true;
  clearTimeout(timer);
  if (!output.includes("Server listening")) {
    console.error("[MemeDrop] compiled backend did not report listening");
    process.exit(code || 1);
  }
  console.log(`[MemeDrop] compiled backend start smoke passed (${signal || code})`);
});
