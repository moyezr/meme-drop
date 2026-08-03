import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");

test("store listing initializer writes a launch listing with real contact fields", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-store-listing-"));
  const outPath = path.join(tmpDir, "store-listing.json");

  const { stdout } = await execFileAsync(
    "node",
    [
      "scripts/init-store-listing.mjs",
      "--out",
      outPath,
      "--privacy-policy-url",
      "https://memedrop.app/privacy",
      "--support-email",
      "support@memedrop.app",
    ],
    { cwd: path.join(rootDir, "apps/extension") }
  );

  const listing = JSON.parse(await fs.readFile(outPath, "utf8"));
  assert.equal(listing.privacy_policy_url, "https://memedrop.app/privacy");
  assert.equal(listing.support_email, "support@memedrop.app");
  assert.match(stdout, /wrote/);
  await fs.access(path.join(rootDir, "apps/extension", "store-assets"));
});

test("store listing initializer refuses to overwrite without force", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-store-listing-"));
  const outPath = path.join(tmpDir, "store-listing.json");
  await fs.writeFile(outPath, "{}\n");

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "scripts/init-store-listing.mjs",
        "--out",
        outPath,
        "--privacy-policy-url",
        "https://memedrop.app/privacy",
        "--support-email",
        "support@memedrop.app",
      ],
      { cwd: path.join(rootDir, "apps/extension") }
    ),
    (error) => {
      assert.match(error.stderr || "", /already exists/);
      return true;
    }
  );
});

test("store listing initializer rejects placeholder launch contacts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-store-listing-"));
  const outPath = path.join(tmpDir, "store-listing.json");

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "scripts/init-store-listing.mjs",
        "--out",
        outPath,
        "--privacy-policy-url",
        "https://example.com/privacy",
        "--support-email",
        "support@example.com",
      ],
      { cwd: path.join(rootDir, "apps/extension") }
    ),
    (error) => {
      assert.match(error.stderr || "", /privacy policy URL must not use a placeholder/);
      return true;
    }
  );
});

test("store readiness validator passes template metadata in non-strict mode", async () => {
  const { stdout } = await execFileAsync(
    "node",
    ["scripts/validate-store-readiness.mjs", "--file", "apps/extension/store-listing.example.json"],
    { cwd: path.join(rootDir, "apps/extension") }
  );

  assert.match(stdout, /store readiness validated/);
  assert.match(stdout, /WARN privacy policy still contains launch placeholders/);
});

test("store readiness validator fails strict mode on launch placeholders", async () => {
  await assert.rejects(
    execFileAsync(
      "node",
      [
        "scripts/validate-store-readiness.mjs",
        "--strict",
        "--file",
        "apps/extension/store-listing.example.json",
      ],
      { cwd: path.join(rootDir, "apps/extension") }
    ),
    (error) => {
      assert.match(error.stdout || "", /ERROR privacy policy still contains launch placeholders/);
      assert.match(error.stdout || "", /ERROR privacy_policy_url must not be an example URL/);
      assert.match(error.stderr || "", /store readiness failed/);
      return true;
    }
  );
});

test("store readiness validator requires detailed usage event disclosure", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-listing-"));
  const listingPath = path.join(tmpDir, "listing.json");
  const listing = JSON.parse(
    await fs.readFile(path.join(rootDir, "apps/extension", "store-listing.example.json"), "utf8")
  );
  listing.data_disclosures.usage_events = "Sent to the backend to improve ranking quality.";
  await fs.writeFile(listingPath, JSON.stringify(listing, null, 2));

  await assert.rejects(
    execFileAsync(
      "node",
      ["scripts/validate-store-readiness.mjs", "--file", listingPath],
      { cwd: path.join(rootDir, "apps/extension") }
    ),
    (error) => {
      assert.match(error.stdout || "", /usage_events disclosure must disclose shown meme feedback events/);
      assert.match(error.stdout || "", /usage_events disclosure must disclose clicked meme feedback events/);
      assert.match(error.stderr || "", /store readiness failed/);
      return true;
    }
  );
});

test("store readiness validator rejects invalid screenshot dimensions", async () => {
  const assetDir = path.join(rootDir, "apps/extension", "store-assets");
  const screenshotPath = path.join(assetDir, "test-invalid-dimensions.png");
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(screenshotPath, pngWithDimensions(1, 1));

  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-listing-"));
    const listingPath = path.join(tmpDir, "listing.json");
    const listing = JSON.parse(
      await fs.readFile(path.join(rootDir, "apps/extension", "store-listing.example.json"), "utf8")
    );
    listing.screenshots = [
      {
        path: "store-assets/test-invalid-dimensions.png",
        description: "Invalid screenshot size.",
      },
      {
        path: "store-assets/test-invalid-dimensions.png",
        description: "Invalid screenshot size repeated.",
      },
    ];
    await fs.writeFile(listingPath, JSON.stringify(listing, null, 2));

    await assert.rejects(
      execFileAsync(
        "node",
        ["scripts/validate-store-readiness.mjs", "--file", listingPath],
        { cwd: path.join(rootDir, "apps/extension") }
      ),
      (error) => {
        assert.match(error.stdout || "", /must be 1280x800 or 640x400; found 1x1/);
        assert.match(error.stderr || "", /store readiness failed/);
        return true;
      }
    );
  } finally {
    await fs.rm(screenshotPath, { force: true });
  }
});

test("store readiness validator accepts correctly sized screenshot files", async () => {
  const assetDir = path.join(rootDir, "apps/extension", "store-assets");
  const screenshotOne = path.join(assetDir, "test-valid-suggestion.png");
  const screenshotTwo = path.join(assetDir, "test-valid-library.png");
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(screenshotOne, pngWithDimensions(1280, 800));
  await fs.writeFile(screenshotTwo, pngWithDimensions(640, 400));

  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-listing-"));
    const listingPath = path.join(tmpDir, "listing.json");
    const listing = JSON.parse(
      await fs.readFile(path.join(rootDir, "apps/extension", "store-listing.example.json"), "utf8")
    );
    listing.screenshots = [
      {
        path: "store-assets/test-valid-suggestion.png",
        description: "Suggestion panel showing meme recommendations on X.",
      },
      {
        path: "store-assets/test-valid-library.png",
        description: "Popup library with saved memes and data deletion control.",
      },
    ];
    await fs.writeFile(listingPath, JSON.stringify(listing, null, 2));

    const { stdout } = await execFileAsync(
      "node",
      ["scripts/validate-store-readiness.mjs", "--file", listingPath],
      { cwd: path.join(rootDir, "apps/extension") }
    );

    assert.match(stdout, /store readiness validated/);
  } finally {
    await fs.rm(screenshotOne, { force: true });
    await fs.rm(screenshotTwo, { force: true });
  }
});

test("store readiness validator requires at least one 1280x800 screenshot", async () => {
  const assetDir = path.join(rootDir, "apps/extension", "store-assets");
  const screenshotOne = path.join(assetDir, "test-small-one.png");
  const screenshotTwo = path.join(assetDir, "test-small-two.png");
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(screenshotOne, pngWithDimensions(640, 400));
  await fs.writeFile(screenshotTwo, pngWithDimensions(640, 400));

  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-listing-"));
    const listingPath = path.join(tmpDir, "listing.json");
    const listing = JSON.parse(
      await fs.readFile(path.join(rootDir, "apps/extension", "store-listing.example.json"), "utf8")
    );
    listing.screenshots = [
      {
        path: "store-assets/test-small-one.png",
        description: "Small screenshot one.",
      },
      {
        path: "store-assets/test-small-two.png",
        description: "Small screenshot two.",
      },
    ];
    await fs.writeFile(listingPath, JSON.stringify(listing, null, 2));

    await assert.rejects(
      execFileAsync(
        "node",
        ["scripts/validate-store-readiness.mjs", "--file", listingPath],
        { cwd: path.join(rootDir, "apps/extension") }
      ),
      (error) => {
        assert.match(error.stdout || "", /must include at least one 1280x800 image/);
        return true;
      }
    );
  } finally {
    await fs.rm(screenshotOne, { force: true });
    await fs.rm(screenshotTwo, { force: true });
  }
});

test("release build validator rejects localhost API origins", async () => {
  await assert.rejects(
    execFileAsync("node", ["scripts/validate-release-build.mjs", "--pre"], {
      cwd: path.join(rootDir, "apps/extension"),
      env: {
        ...process.env,
        VITE_API_BASE_URL: "http://localhost:3001",
      },
    }),
    (error) => {
      assert.match(error.stderr || "", /must use https:\/\/ for release builds/);
      return true;
    }
  );
});

test("release build validator accepts HTTPS API origins in preflight mode", async () => {
  const { stdout } = await execFileAsync("node", ["scripts/validate-release-build.mjs", "--pre"], {
    cwd: path.join(rootDir, "apps/extension"),
    env: {
      ...process.env,
      VITE_API_BASE_URL: "https://api.memedrop.example",
    },
  });

  assert.match(stdout, /release build config validated \(pre\)/);
});

test("release package validator accepts a minimal valid package", async () => {
  const zipPath = await createReleaseZip({
    manifest: releaseManifest(),
  });

  const { stdout } = await execFileAsync(
    "node",
    ["scripts/validate-release-package.mjs", "--zip", zipPath],
    {
      cwd: path.join(rootDir, "apps/extension"),
      env: {
        ...process.env,
        VITE_API_BASE_URL: "https://api.memedrop.example",
      },
    }
  );

  assert.match(stdout, /release package validated/);
});

test("release package validator rejects local host permissions", async () => {
  const manifest = releaseManifest();
  manifest.host_permissions.push("http://localhost:3001/*");
  const zipPath = await createReleaseZip({ manifest });

  await assert.rejects(
    execFileAsync("node", ["scripts/validate-release-package.mjs", "--zip", zipPath], {
      cwd: path.join(rootDir, "apps/extension"),
      env: {
        ...process.env,
        VITE_API_BASE_URL: "https://api.memedrop.example",
      },
    }),
    (error) => {
      assert.match(error.stderr || "", /contains local host permissions/);
      return true;
    }
  );
});

async function createReleaseZip({ manifest }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-zip-"));
  const packageDir = path.join(tmpDir, "package");
  const iconDir = path.join(packageDir, "icons");
  const zipPath = path.join(tmpDir, "extension.zip");
  await fs.mkdir(iconDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(packageDir, "service-worker-loader.js"), "");
  await fs.writeFile(path.join(iconDir, "icon16.png"), minimalPng());
  await fs.writeFile(path.join(iconDir, "icon48.png"), minimalPng());
  await fs.writeFile(path.join(iconDir, "icon128.png"), minimalPng());
  await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: packageDir });
  return zipPath;
}

function releaseManifest() {
  return {
    manifest_version: 3,
    name: "MemeDrop",
    description: "Instantly reply with the perfect meme on X",
    version: "0.0.1",
    permissions: ["storage"],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.memedrop.example/*",
    ],
    background: {
      service_worker: "service-worker-loader.js",
      type: "module",
    },
    icons: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  };
}

function minimalPng() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  );
}

function pngWithDimensions(width, height) {
  const buffer = Buffer.from(minimalPng());
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
