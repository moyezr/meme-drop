import { readFile } from "node:fs/promises";

import { runSmokeAgent, SmokeAgentError } from "./smoke-agent.js";

const DEFAULT_INPUT = "We deployed on Friday and immediately broke checkout";

interface Arguments {
  confirmGeneration: boolean;
  inputFile?: string;
  stdin: boolean;
  direction?: string;
  count?: 1 | 2 | 3 | 4 | 5;
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (!args.confirmGeneration) {
    fail(
      "confirmation_required",
      "Pass --confirm-generation because each durable returned meme consumes one credit.",
    );
  }
  const apiBaseUrl = process.env.MEMEDROP_API_BASE_URL?.trim();
  const apiKey = process.env.MEMEDROP_API_KEY?.trim();
  if (!apiBaseUrl) fail("missing_api_base_url", "Set MEMEDROP_API_BASE_URL to the API origin.");
  if (!apiKey) fail("missing_api_key", "Set MEMEDROP_API_KEY to an issued agent credential.");

  const input = await resolveInput(args);
  try {
    const report = await runSmokeAgent({
      apiBaseUrl,
      apiKey,
      input,
      direction: args.direction,
      count: args.count,
      idempotencyKey: args.idempotencyKey,
      timeoutMs: args.timeoutMs,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (error instanceof SmokeAgentError) {
      process.stderr.write(
        `${JSON.stringify({
          status: "failed",
          step: error.step,
          code: error.code,
          http_status: error.httpStatus ?? null,
        })}\n`,
      );
      process.exitCode = 1;
      return;
    }
    fail("unexpected_failure", "Smoke agent failed unexpectedly.");
  }
}

function parseArguments(argv: string[]): Arguments {
  const result: Arguments = { confirmGeneration: false, stdin: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-generation") {
      result.confirmGeneration = true;
      continue;
    }
    if (argument === "--stdin") {
      result.stdin = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("invalid_arguments", `${argument} requires a value.`);
    if (argument === "--input-file") result.inputFile = value;
    else if (argument === "--direction") result.direction = value;
    else if (argument === "--idempotency-key") result.idempotencyKey = value;
    else if (argument === "--count") result.count = parseCount(value);
    else if (argument === "--timeout-ms") result.timeoutMs = parseTimeout(value);
    else fail("invalid_arguments", `Unknown argument: ${argument}`);
    index += 1;
  }
  if (result.stdin && result.inputFile) {
    fail("invalid_arguments", "Choose either --stdin or --input-file, not both.");
  }
  return result;
}

async function resolveInput(args: Arguments): Promise<string> {
  if (args.stdin) return readStdin();
  if (args.inputFile) return readFile(args.inputFile, "utf8");
  return DEFAULT_INPUT;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function parseCount(value: string): 1 | 2 | 3 | 4 | 5 {
  const count = Number(value);
  if (![1, 2, 3, 4, 5].includes(count)) fail("invalid_arguments", "--count must be 1 through 5.");
  return count as 1 | 2 | 3 | 4 | 5;
}

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000) {
    fail("invalid_arguments", "--timeout-ms must be an integer from 1000 through 300000.");
  }
  return timeout;
}

function fail(code: string, message: string): never {
  process.stderr.write(`${JSON.stringify({ status: "failed", step: "configuration", code })}\n`);
  process.stderr.write(`[MemeDrop smoke agent] ${message}\n`);
  process.exit(1);
}

await main();
