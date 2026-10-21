import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { repositoryOnlyEnvironment } from "../../../scripts/deployment-readiness.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const extension = path.join(repository, "apps/extension/dist");
const api = "http://127.0.0.1:3001";
const temporary = await mkdtemp(path.join(tmpdir(), "memedrop-browser-"));
let backend;
let context;
let scenarioId = 100;

async function until(check, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}

async function fixtureState() {
  return fetch(`${api}/_fixture/state`).then((response) => response.json());
}

async function eventsFor(action) {
  const state = await fixtureState();
  return state.events.filter((event) => event.action === action);
}

function fixtureHtml(platform, confirmation) {
  const linkedin = platform === "linkedin";
  const native = linkedin ? 'aria-label="Comment"' : 'data-testid="reply"';
  const source = linkedin
    ? `<div role="listitem" data-urn="urn:li:activity:${scenarioId}">`
    : '<article data-testid="tweet">';
  const close = linkedin ? "</div>" : "</article>";
  return `<!doctype html><html><head><style>
    body { margin:40px; font:16px system-ui; background:#fafafa; }
    article,[role=listitem] { width:650px; padding:20px; }
    [role=dialog] { width:650px; height:400px; border:1px solid #aaa; }
    [contenteditable] { height:100px; }
    #upload img { width:100px; height:100px; }
  </style></head><body>${source}
  <div data-testid="${linkedin ? "expandable-text-box" : "tweetText"}">We skipped tests and deployed Friday. Who could have predicted this?</div>
  <a href="${linkedin ? `/feed/update/urn:li:activity:${scenarioId}/` : `/fixture/status/${scenarioId}`}">Fixture post</a>
  <div role="group"><div><button id="native-reply" ${native}>Reply</button></div><div><button>Like</button></div></div>
  ${linkedin ? '<div id="editor"></div>' : ""}${close}
  <script>
  const linkedin = ${linkedin};
  const confirmation = ${JSON.stringify(confirmation)};
  document.querySelector('#native-reply').onclick = () => {
    const editor = linkedin ? document.querySelector('#editor') : document.createElement('div');
    if (!linkedin) { editor.setAttribute('role','dialog'); document.body.append(editor); }
    editor.innerHTML = linkedin
      ? '<div contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div><input type="file" accept="image/*"><div id="upload" class="comments-comment-box__photo"></div>'
      : '<div contenteditable="true" data-testid="tweetTextarea_0"></div><input type="file" data-testid="fileInput" accept="image/*"><div id="upload" data-testid="attachments"></div>';
    editor.querySelector('input').addEventListener('change', event => {
      if (confirmation !== 'confirm' || !event.target.files.length) return;
      setTimeout(() => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(event.target.files[0]);
        const remove = document.createElement('button');
        remove.dataset.testid = 'removeMedia';
        remove.textContent = 'Remove image';
        document.querySelector('#upload').replaceChildren(img,remove);
      }, 150);
    });
    if (!linkedin) history.pushState({},'', '/compose/post');
  };
  window.__browserTimings = [];
  for (const name of ['memedrop:suggestion-browser-performance','memedrop:suggestion-attach-performance']) {
    window.addEventListener(name, event => window.__browserTimings.push(event.detail));
  }
  </script></body></html>`;
}

async function openScenario({ platform = "x", mode = "success", confirmation = "confirm", waitReady = true, request = true } = {}) {
  scenarioId++;
  await fetch(`${api}/_fixture/reset?mode=${mode}`, { method: "POST" });
  const page = await context.newPage();
  const origin = platform === "linkedin" ? "https://www.linkedin.com" : "https://x.com";
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.route(`${origin}/**`, (route) => {
    if (route.request().isNavigationRequest()) {
      return route.fulfill({ contentType: "text/html", body: fixtureHtml(platform, confirmation) });
    }
    return route.abort();
  });
  await page.goto(`${origin}/${platform === "linkedin" ? "feed/" : "home"}`);
  const action = page.locator('[data-memedrop-reply="true"]');
  await action.waitFor();
  await (request ? action : page.locator("#native-reply")).click();
  const usable = page.locator('.meme-card[aria-disabled="false"]');
  if (waitReady && request) {
    await usable.first().waitFor({ timeout: 9_000 });
    await until(async () => (await eventsFor("shown")).length > 0, "visible rendered impression");
  }
  return { page, usable };
}

try {
  // Refuse to reuse/stop another project's backend on the extension's fixed development port.
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(3001, "127.0.0.1", resolve));
  await new Promise((resolve) => probe.close(resolve));
  const environment = {
    ...repositoryOnlyEnvironment(),
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/browser_fixture_test",
    MEMEDROP_BROWSER_FIXTURE: "1",
    MEMEDROP_BROWSER_FIXTURE_PATH: path.join(temporary, "media"),
    MEMEDROP_TEST_DATABASE_URL: "",
    MEMEDROP_TEST_REDIS_URL: "",
  };
  backend = spawn("uv", ["run", "--frozen", "uvicorn", "tests.browser_fixture:app", "--host", "127.0.0.1", "--port", "3001", "--no-access-log"], {
    cwd: path.join(repository, "apps/api"), env: environment, stdio: ["ignore", "ignore", "pipe"],
  });
  let backendError = "";
  backend.stderr.on("data", (chunk) => { backendError = (backendError + chunk).slice(-4000); });
  await until(async () => {
    if (backend.exitCode !== null) throw new Error(`Fixture backend exited: ${backendError}`);
    return fetch(`${api}/_fixture/state`).then((response) => response.ok).catch(() => false);
  }, "loopback fixture backend");
  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    headless: true,
    channel: "chromium",
    ...(process.env.MEMEDROP_CHROMIUM_EXECUTABLE ? { executablePath: process.env.MEMEDROP_CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await until(async () => context.serviceWorkers().length > 0, "extension service worker");
  for (const platform of ["x", "linkedin"]) {
    const { page, usable } = await openScenario({ platform });
    if (process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR) {
      await mkdir(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR, `${platform}.png`) });
    }
    await usable.first().click();
    await until(async () => (await eventsFor("inserted")).length === 1, `${platform} confirmed native attachment`);
    assert.equal(await page.locator("#upload img").count(), 1);
    assert.equal((await eventsFor("copied")).length, 0);
    assert.equal((await eventsFor("dismissed")).length, 0);
    assert.equal((await eventsFor("rejected")).length, 0);
    const timings = await page.evaluate(() => window.__browserTimings);
    assert.ok(timings.length > 0, "browser timing event was observed");
    for (const timing of timings) {
      assert.doesNotMatch(JSON.stringify(timing), /tweet|caption|https?:|Skipped tests/i);
    }
    await page.close();
    console.log(`[MemeDrop] ${platform}: rendered preview, safe timings, confirmed attachment PASS`);
  }
  {
    const { page, usable } = await openScenario({ confirmation: "ignore" });
    await usable.first().click();
    await until(async () => (await eventsFor("copied")).length === 1, "unconfirmed upload clipboard outcome", 10_000);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(await page.locator("#upload img").count(), 0);
    await page.close();
    console.log("[MemeDrop] no native upload confirmation: copied, never inserted PASS");
  }
  {
    const { page } = await openScenario();
    await page.locator(".close-btn").click();
    await until(async () => (await eventsFor("abandoned")).length > 0, "neutral panel abandonment");
    assert.equal((await eventsFor("dismissed")).length, 0);
    assert.equal((await eventsFor("rejected")).length, 0);
    await page.close();
    console.log("[MemeDrop] ordinary close: neutral abandonment PASS");
  }
  {
    const started = performance.now();
    const { page } = await openScenario({ mode: "slow" });
    assert.ok(performance.now() - started < 8_000, "slow-trend/provider fallback precedes browser timeout");
    assert.equal((await fixtureState()).suggestion_calls, 1);
    assert.ok((await eventsFor("shown")).length > 0);
    await page.close();
    console.log("[MemeDrop] hanging trends + provider: rendered reviewed fallback before client abort PASS");
  }
  {
    const { page } = await openScenario({ request: false });
    await page.waitForTimeout(400);
    assert.equal((await fixtureState()).suggestion_calls, 0);
    assert.equal(await page.locator(".meme-card").count(), 0);
    await page.close();
    console.log("[MemeDrop] native Reply: no implicit inference PASS");
  }
  {
    const { page } = await openScenario({ mode: "error", waitReady: false });
    await page.getByText("Could not reach the MemeDrop API.", { exact: false }).waitFor();
    assert.equal((await eventsFor("shown")).length, 0);
    await page.close();
    console.log("[MemeDrop] unavailable catalog: actionable error, no false impression PASS");
  }
  {
    const { page } = await openScenario({ mode: "broken_media", waitReady: false });
    await page.getByText("Preview unavailable", { exact: true }).first().waitFor();
    assert.equal((await eventsFor("shown")).length, 0);
    assert.equal(await page.locator('.meme-card[aria-disabled="false"]').count(), 0);
    await page.close();
    console.log("[MemeDrop] broken media: unavailable preview, no false impression PASS");
  }
  {
    const { page } = await openScenario({ mode: "slow", waitReady: false });
    await until(async () => (await fixtureState()).suggestion_calls === 1, "in-flight suggestion request");
    await page.evaluate(() => history.pushState({}, "", "/home"));
    await until(async () => (await fixtureState()).suggestion_pending === 0, "abandoned request completion");
    assert.equal((await eventsFor("shown")).length, 0);
    assert.equal(await page.locator('.meme-card[aria-disabled="false"]').count(), 0);
    await page.close();
    console.log("[MemeDrop] navigation during generation: late result ignored PASS");
  }
  console.log("[MemeDrop] packaged extension / real FastAPI / Chromium fixture smoke passed");
} finally {
  if (context) await context.close();
  if (backend && backend.exitCode === null) {
    backend.kill("SIGTERM");
    await new Promise((resolve) => backend.once("exit", resolve));
  }
  await rm(temporary, { recursive: true, force: true });
}
