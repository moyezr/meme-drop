import { spawnSync } from "node:child_process";

const image = process.env.MEMEDROP_BACKEND_IMAGE || "memedrop-backend:local";
const container = `memedrop-backend-smoke-${process.pid}`;
const hostPort = process.env.MEMEDROP_BACKEND_SMOKE_PORT || "3402";

run("docker", [
  "run",
  "--rm",
  "-d",
  "--name",
  container,
  "-p",
  `${hostPort}:3001`,
  "-e",
  "MEMEDROP_ENV=development",
  "-e",
  "DATABASE_URL=postgresql://test",
  "-e",
  "OPENROUTER_API_KEY=test-key",
  "-e",
  "MEMEDROP_REQUIRE_INSTALL_ID=false",
  image,
]);

let passed = false;
try {
  await waitForLive();
  passed = true;
  console.log(`[MemeDrop] backend image smoke passed (${image})`);
} finally {
  spawnSync("docker", ["logs", container, "--tail", "20"], {
    encoding: "utf8",
    stdio: passed ? "ignore" : "inherit",
  });
  spawnSync("docker", ["stop", container], {
    encoding: "utf8",
    stdio: "ignore",
  });
}

async function waitForLive() {
  const deadline = Date.now() + 8_000;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${hostPort}/live`);
      if (response.ok) return;
    } catch {
      // Keep polling until the server starts or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("backend image did not pass /live smoke check");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  if (result.stdout) process.stdout.write(result.stdout);
}
