import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

process.env.DATABASE_URL ||= "postgresql://test";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");
const importerPath = path.join(rootDir, "tools", "template-tools", "scripts", "import-benchmark-cases.ts");
const productionBenchmarkPath = path.join(rootDir, "tools", "template-tools", "evals", "suggestion-benchmark.json");

test("benchmark importer validates and writes edited pending-template cases", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  const outPath = path.join(tmpDir, "next-benchmark.json");
  await fs.copyFile(productionBenchmarkPath, benchmarkPath);
  await writeCasePack(packPath, {
    cases: [validPendingCase()],
  });

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      importerPath,
      "--file",
      packPath,
      "--benchmark",
      benchmarkPath,
      "--out",
      outPath,
    ],
    { cwd: rootDir }
  );

  const nextBenchmark = JSON.parse(await fs.readFile(outPath, "utf8")) as {
    cases: Array<{ id: string }>;
  };

  assert.match(stdout, /errors=0/);
  assert.equal(nextBenchmark.cases.at(-1)?.id, "absolute-cinema-dramatic-verdict");
});

test("benchmark importer dry-runs by default without writing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await fs.copyFile(productionBenchmarkPath, benchmarkPath);
  await writeCasePack(packPath, {
    cases: [validPendingCase()],
  });

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      importerPath,
      "--file",
      packPath,
      "--benchmark",
      benchmarkPath,
    ],
    { cwd: rootDir }
  );

  assert.match(stdout, /dry run only/);
});

test("benchmark importer rejects unedited placeholder stubs", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await fs.copyFile(productionBenchmarkPath, benchmarkPath);
  await writeCasePack(packPath, {
    cases: [
      {
        ...validPendingCase(),
        tweet: "Replace this with a real tweet where Absolute Cinema is a top-tier reply, not just a keyword match.",
        rejected_memes: [
          {
            name: "This Is Fine",
            reason: "Replace with a verified meme family that would be tempting but wrong for this joke shape.",
          },
        ],
      },
    ],
  });

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", importerPath, "--file", packPath, "--benchmark", benchmarkPath],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /tweet still contains benchmark-stub placeholder text/);
      assert.match(err.stdout || "", /rejected meme reason still has placeholder text/);
      return true;
    }
  );
});

test("benchmark importer rejects duplicate existing case ids", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await fs.copyFile(productionBenchmarkPath, benchmarkPath);
  await writeCasePack(packPath, {
    cases: [
      {
        ...validPendingCase(),
        id: "prod-fire-calm",
      },
    ],
  });

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", importerPath, "--file", packPath, "--benchmark", benchmarkPath],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /case id already exists in benchmark/);
      return true;
    }
  );
});

test("benchmark importer requires non-pending meme families to be verified", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await fs.copyFile(productionBenchmarkPath, benchmarkPath);
  await writeCasePack(packPath, {
    cases: [
      {
        ...validPendingCase(),
        expected_memes: ["Absolute Cinema", "Not A Real Meme", "Change My Mind"],
      },
    ],
  });

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", importerPath, "--file", packPath, "--benchmark", benchmarkPath],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /missing verified template for expected meme: Not A Real Meme/);
      return true;
    }
  );
});

test("benchmark importer rejects imports that skew merged family balance", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-import-"));
  const packPath = path.join(tmpDir, "case-pack.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await fs.writeFile(
    benchmarkPath,
    `${JSON.stringify(
      {
        cases: [
          {
            id: "existing-one",
            expected_memes: ["This Is Fine"],
            rejected_memes: [{ name: "Oprah You Get A" }],
          },
          {
            id: "existing-two",
            expected_memes: ["Hide the Pain Harold"],
            rejected_memes: [{ name: "Trade Offer" }],
          },
        ],
      },
      null,
      2
    )}\n`
  );
  await writeCasePack(packPath, {
    cases: [
      validPendingCase(),
      {
        ...validPendingCase(),
        id: "absolute-cinema-second-verdict",
        tweet: "The tiny cleanup somehow added a permissions system, three queues, and a billing migration.",
      },
    ],
  });

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        importerPath,
        "--file",
        packPath,
        "--benchmark",
        benchmarkPath,
        "--max-expected-family-share",
        "0.4",
        "--max-rejected-family-share",
        "1",
      ],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /expected meme family "Absolute Cinema" appears in 50%/);
      assert.match(err.stdout || "", /expected meme family "Change My Mind" appears in 50%/);
      return true;
    }
  );
});

async function writeCasePack(
  packPath: string,
  overrides: {
    cases: unknown[];
  }
) {
  await fs.writeFile(
    packPath,
    `${JSON.stringify(
      {
        source_templates: [
          {
            template_id: "absolute-cinema",
            name: "Absolute Cinema",
          },
        ],
        ...overrides,
      },
      null,
      2
    )}\n`
  );
}

function validPendingCase() {
  return {
    id: "absolute-cinema-dramatic-verdict",
    category: "dramatic verdict",
    tweet: "The release notes called this a tiny cleanup, but it rewrote half the billing system.",
    expected_memes: ["Absolute Cinema", "Change My Mind", "Surprised Pikachu"],
    keywords: ["release", "cleanup", "billing"],
    rejected_memes: [
      {
        name: "This Is Fine",
        reason: "Passive disaster acceptance misses the dramatic masterpiece verdict.",
      },
    ],
  };
}
