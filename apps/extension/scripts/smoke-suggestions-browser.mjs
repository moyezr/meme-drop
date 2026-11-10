import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { repositoryOnlyEnvironment } from "../../../scripts/deployment-readiness.mjs";
import { redditFixtureHtml } from "./reddit-fixture.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const extension = process.env.MEMEDROP_BROWSER_EXTENSION_DIR
  ? path.resolve(process.env.MEMEDROP_BROWSER_EXTENSION_DIR)
  : path.join(repository, "apps/extension/dist");
const api = "http://127.0.0.1:3001";
const temporary = await mkdtemp(path.join(tmpdir(), "memedrop-browser-"));
let backend;
let context;
let scenarioId = 100;
const fileChooserCounts = new WeakMap();
let sharedCardAppearance;

async function verifySharedCardAppearance(card) {
  const appearance = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    const image = element.querySelector('img');
    return { radius: style.borderRadius, width: style.width, background: style.backgroundColor,
      imageFit: getComputedStyle(image).objectFit,
      badgesBelowImage: [...element.querySelectorAll('.source-badge, .tailored-badge')]
        .every(badge => badge.getBoundingClientRect().top >= image.getBoundingClientRect().bottom) };
  });
  if (!sharedCardAppearance) sharedCardAppearance = appearance;
  assert.deepEqual(appearance, sharedCardAppearance, "supported platforms share the same card presentation");
  assert.equal(appearance.imageFit, "contain", "preserves the entire captioned image");
  assert.equal(appearance.badgesBelowImage, true, "badges cannot cover caption text");
}

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
  const response = await fetch(`${api}/_fixture/state`);
  assert.equal(response.status, 200, "fixture state diagnostics must remain available");
  return response.json();
}

async function eventsFor(action) {
  const state = await fixtureState();
  return state.events.filter((event) => event.action === action);
}

async function performanceFor(kind, outcome) {
  return (await fixtureState()).performance_samples.filter((sample) =>
    sample.kind === kind && (!outcome || sample.outcome === outcome));
}

function assertContentFree(sample) {
  const allowed = new Set(["event_id", "kind", "platform", "extension_version", "outcome", "elapsed_ms",
    "suggestion_count", "first_usable_preview_ms", "api_response_ms", "cache_status", "generation_mode",
    "selected_preparation_ms", "native_attachment_confirmation_ms"]);
  assert.ok(Object.keys(sample).every((key) => allowed.has(key)));
  const encoded = JSON.stringify(sample);
  assert.ok(!/Skipped|Deploying|Who could|https?:|tweet|caption|steering|meme_id|cache_key|impression_id/.test(encoded));
}

function fixtureHtml(platform, confirmation, commentLink = false, portal = false, photoInputMode = "single", editorMode = "new") {
  const linkedin = platform === "linkedin";
  const native = linkedin ? 'aria-label="Comment"' : 'data-testid="reply"';
  const source = linkedin
    ? `<div role="listitem" data-urn="urn:li:activity:${scenarioId}">`
    : '<article data-testid="tweet">';
  const close = linkedin ? "</div>" : "</article>";
  // The current LinkedIn feed exposes Comment as an A inside a plain DIV
  // containing seven actions, four ancestor levels below its post list item.
  const actions = linkedin && commentLink
    ? '<div><div><div><a id="native-reply" aria-label="Comment">Comment</a><button>Like</button><button>Repost</button><button>Send</button><span>Reactions</span><span>Comments</span><span>Reposts</span></div></div></div>'
    : `<div role="group"><div><button id="native-reply" ${native}>Reply</button></div><div><button>Like</button></div></div>`;
  const editorMarkup = linkedin
    ? '<div id="owned-editor" contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div><input type="file" accept="image/*"><div id="upload" class="comments-comment-box__photo"></div>'
    : '<div contenteditable="true" data-testid="tweetTextarea_0"></div><input type="file" data-testid="fileInput" accept="image/*"><div id="upload" data-testid="attachments"></div>';
  const preopenedMarkup = editorMode === "preexisting-portal"
    ? editorMarkup.replace('id="owned-editor"', 'id="inline-editor"')
      .replace('<input ', '<input id="inline-input" ').replace('id="upload"', 'id="inline-upload"')
    : editorMarkup;
  return `<!doctype html><html><head><style>
    body { margin:40px; font:16px system-ui; background:#fafafa; }
    article,[role=listitem] { width:650px; padding:20px; }
    [role=dialog], dialog { width:650px; height:400px; border:1px solid #aaa; }
    [contenteditable] { height:100px; }
    ${editorMode === "preexisting-offscreen" ? '#editor { margin-top:900px; }' : ""}
    #upload img { width:100px; height:100px; }
  </style></head><body>${source}
  <div data-testid="${linkedin ? "expandable-text-box" : "tweetText"}">We skipped tests and deployed Friday. Who could have predicted this?</div>
  <a href="${linkedin ? `/feed/update/urn:li:activity:${scenarioId}/` : `/fixture/status/${scenarioId}`}">Fixture post</a>
  ${actions}
  ${editorMode === "preexisting" ? '<div role="listitem"><div id="nested-editor" contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div><input id="nested-input" type="file" accept="image/*"></div>' : ""}
  ${linkedin ? `<div id="editor">${editorMode === "new" ? "" : preopenedMarkup}</div>` : ""}
  ${editorMode === "ambiguous" ? '<div id="ambiguous-editor" contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div>' : ""}${close}
  ${editorMode !== "new" ? '<aside role="listitem"><div id="other-editor" contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div><input id="other-input" type="file" accept="image/*"></aside>' : ""}
  ${portal ? '<dialog open id="unrelated-dialog" data-testid="dialog"><div contenteditable="true" role="textbox" aria-label="Text editor for creating comment"></div><input id="unrelated-input" type="file" accept="image/*"></dialog>' : ""}
  <script>
  const linkedin = ${linkedin};
  const portal = ${portal};
  const photoInputMode = ${JSON.stringify(photoInputMode)};
  const editorMode = ${JSON.stringify(editorMode)};
  const editorMarkup = ${JSON.stringify(editorMarkup)};
  window.__nativeReplyClicks = 0;
  window.__unrelatedEditorFocus = 0;
  window.__initialEditor = document.querySelector('#inline-editor, #owned-editor');
  if (window.__initialEditor) window.__initialEditor.textContent = 'Existing synthetic draft';
  for (const editor of document.querySelectorAll('#nested-editor, #other-editor, #ambiguous-editor')) {
    editor.addEventListener('focus', () => window.__unrelatedEditorFocus++);
  }
  window.__photoClicks = 0;
  window.__pasteCount = 0;
  window.__inputClickStates = [];
  const confirmation = ${JSON.stringify(confirmation)};
  document.querySelector('#native-reply').onclick = (event) => {
    event.preventDefault();
    window.__nativeReplyClicks++;
    const openEditor = () => {
    const editor = portal ? document.createElement('dialog') : linkedin ? document.querySelector('#editor') : document.createElement('div');
    if (portal) { editor.id = 'comment-dialog'; editor.dataset.testid = 'dialog'; document.body.append(editor); }
    if (!linkedin) { editor.setAttribute('role','dialog'); document.body.append(editor); }
    // A pre-opened LinkedIn editor survives the native Comment click without
    // being focused or remounted. The extension must bind it from one Meme click.
    if (editorMode === 'new' || portal) editor.innerHTML = editorMarkup;
    if (portal) {
      editor.querySelector('input').remove();
      editor.querySelector('#upload').className = '';
      const photo = document.createElement('button');
      photo.setAttribute('aria-label','Share photo');
      photo.onclick = () => {
        window.__photoClicks++;
        const count = photoInputMode === 'absent' ? 0 : photoInputMode === 'ambiguous' ? 2 : 1;
        for (let index = 0; index < count; index++) {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.id = 'owned-input-' + index;
          input.style.display = 'none';
          input.addEventListener('click', event => window.__inputClickStates.push(event.defaultPrevented));
          input.addEventListener('change', event => acceptFile(event.target.files[0]));
          document.body.append(input);
          input.click();
        }
        if (photoInputMode === 'closed') editor.close();
      };
      editor.append(photo);
      editor.showModal();
    }
    const acceptFile = file => {
      if (portal && file) {
        // A newly decoded blob/avatar in this same dialog must not count as
        // an attachment without the native figure/link/Dismiss structure.
        const avatar = document.createElement('img');
        avatar.id = 'unrelated-blob-avatar';
        avatar.src = URL.createObjectURL(file);
        avatar.dataset.loaded = 'true';
        editor.append(avatar);
      }
      if (confirmation !== 'confirm' || !file) return;
      setTimeout(() => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        const remove = document.createElement('button');
        remove.dataset.testid = 'removeMedia';
        remove.textContent = 'Remove image';
        if (portal) {
          img.dataset.loaded = 'true';
          const figure = document.createElement('figure');
          figure.append(img);
          const link = document.createElement('a');
          link.href = 'https://www.linkedin.com/fixture-preview/';
          link.append(figure);
          remove.setAttribute('aria-label','Dismiss');
          editor.querySelector('#upload').replaceChildren(link,remove);
        } else editor.querySelector('#upload').replaceChildren(img,remove);
      }, 150);
    };
    editor.querySelector('input')?.addEventListener('change', event => acceptFile(event.target.files[0]));
    editor.querySelector('[contenteditable]').addEventListener('paste', event => {
      window.__pasteCount++;
      acceptFile(event.clipboardData.files[0]);
    });
    if (!linkedin) history.pushState({},'', '/compose/post');
    };
    if (editorMode === 'preexisting-portal') setTimeout(openEditor, 100);
    else openEditor();
  };
  window.__browserTimings = [];
  for (const name of ['memedrop:suggestion-browser-performance','memedrop:suggestion-attach-performance']) {
    window.addEventListener(name, event => window.__browserTimings.push(event.detail));
  }
  </script></body></html>`;
}

async function openScenario({ platform = "x", mode = "success", confirmation = "confirm", waitReady = true, request = true, commentLink = false, portal = false, photoInputMode = "single", editorMode = "new", reddit = {} } = {}) {
  scenarioId++;
  const reset = await fetch(`${api}/_fixture/reset?mode=${mode}`, { method: "POST" });
  assert.equal(reset.status, 200, "fixture scenario reset must succeed");
  const page = await context.newPage();
  fileChooserCounts.set(page, 0);
  page.on("filechooser", () => fileChooserCounts.set(page, fileChooserCounts.get(page) + 1));
  const origin = platform === "reddit" ? "https://www.reddit.com" : platform === "linkedin" ? "https://www.linkedin.com" : "https://x.com";
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.route(`${origin}/**`, (route) => {
    if (route.request().isNavigationRequest()) {
      return route.fulfill({ contentType: "text/html", body: platform === "reddit"
        ? redditFixtureHtml(scenarioId, confirmation, reddit)
        : fixtureHtml(platform, confirmation, commentLink, portal, photoInputMode, editorMode) });
    }
    return route.abort();
  });
  await page.goto(`${origin}/${platform === "reddit" ? `r/fixture/comments/${scenarioId.toString(36)}/synthetic/` : platform === "linkedin" ? "feed/" : "home"}`);
  const action = page.locator(platform === "reddit"
    ? '[data-fixture-target] > .actions [data-memedrop-reply="true"]' : '[data-memedrop-reply="true"]');
  await action.waitFor();
  if (editorMode === "preexisting-offscreen") {
    await page.evaluate(() => { window.__scrollBeforeMeme = window.scrollY; });
  }
  await (request ? action : page.locator("#native-reply")).click();
  const usable = page.locator('.meme-card[aria-disabled="false"]');
  if (waitReady && request) {
    try {
      await usable.first().waitFor({ timeout: 9_000 });
    } catch (error) {
      const state = await fixtureState();
      throw new Error(`${error.message}\n${JSON.stringify({ platform, mode,
        suggestion_calls: state.suggestion_calls,
        samples: state.performance_samples.map(sample => ({ kind: sample.kind, outcome: sample.outcome,
          generation_mode: sample.generation_mode })),
        unavailable_previews: await page.getByText('Preview unavailable', { exact: true }).count(),
        empty_panels: await page.locator('.empty').count() })}`);
    }
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
  try {
    await until(async () => {
      if (backend.exitCode !== null) throw new Error(`Fixture backend exited: ${backendError}`);
      return fetch(`${api}/_fixture/state`).then((response) => response.ok).catch(() => false);
    }, "loopback fixture backend");
  } catch (error) {
    throw new Error(`${error.message}\n${backendError}`);
  }
  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    headless: true,
    channel: "chromium",
    ...(process.env.MEMEDROP_CHROMIUM_EXECUTABLE ? { executablePath: process.env.MEMEDROP_CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await until(async () => context.serviceWorkers().length > 0, "extension service worker");
  for (const scenario of [
    { platform: "linkedin", editorMode: "preexisting", label: "linkedin-preopened-editor" },
    { platform: "x", label: "x" },
    { platform: "linkedin", label: "linkedin-comment-button" },
    { platform: "linkedin", commentLink: true, label: "linkedin-comment-link" },
    { platform: "linkedin", commentLink: true, portal: true, label: "linkedin-native-dialog" },
    { platform: "linkedin", commentLink: true, portal: true, editorMode: "preexisting-portal", label: "linkedin-preopened-editor-then-dialog" },
  ]) {
    const { platform, label } = scenario;
    const { page, usable } = await openScenario(scenario);
    assert.equal((await fixtureState()).suggestion_calls, 1, `${label} extracts source and requests once`);
    await verifySharedCardAppearance(usable.first());
    if (scenario.editorMode === "preexisting") {
      assert.equal(await page.locator('#owned-editor').evaluate((editor) => editor === window.__initialEditor), true,
        "native Comment preserves the already mounted editor");
      assert.equal(await page.locator('#owned-editor').evaluate((editor) => editor === document.activeElement), true,
        "one Meme click focuses only its owned pre-opened editor");
      assert.equal(await page.locator('#owned-editor').textContent(), 'Existing synthetic draft', "preserves typed draft");
      assert.equal(await page.evaluate(() => window.__nativeReplyClicks), 1, "forwards native Comment once");
      assert.equal(await page.evaluate(() => window.__unrelatedEditorFocus), 0);
      // Cross the bounded composer-mount grace period before selecting a card;
      // the previous bug rendered briefly then cancelled this valid session.
      await page.waitForTimeout(3_800);
      assert.ok(await usable.count() > 0, "pre-opened compose remains bound after mount grace");
      assert.equal((await fixtureState()).suggestion_calls, 1, "focus does not trigger another inference");
      assert.equal((await performanceFor("request", "cancelled")).length, 0);
    }
    if (scenario.commentLink) {
      assert.equal(await page.locator('a[aria-label="Comment"]').count(), 1);
      assert.equal(await page.locator('button[aria-label="Comment"]').count(), 0);
      assert.equal(await page.locator('[contenteditable="true"][role="textbox"]').count(),
        scenario.editorMode === "preexisting-portal" ? 4 : scenario.portal ? 2 : 1);
      assert.equal(await page.locator('[data-memedrop-reply="true"]').count(), 1);
    }
    if (process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR) {
      await mkdir(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR, `${label}.png`) });
    }
    if (scenario.portal) {
      assert.equal(await page.locator('#comment-dialog:modal #memedrop-suggestion-panel').count(), 1);
      assert.equal(await page.locator('#comment-dialog input[type="file"]').count(), 0);
    }
    if (scenario.editorMode === "preexisting-portal") {
      assert.equal(await page.locator('#inline-editor').evaluate((editor) => editor === window.__initialEditor), true);
      assert.equal(await page.locator('#inline-editor').textContent(), 'Existing synthetic draft');
      assert.equal(await page.evaluate(() => window.__nativeReplyClicks), 1);
    }
    await usable.first().click();
    await until(async () => (await eventsFor("inserted")).length === 1, `${label} confirmed native attachment`);
    const requestSamples = await until(async () => {
      const samples = await performanceFor("request", "usable");
      return samples.length ? samples : null;
    }, `${label} visible preview measurement`);
    const attachments = await until(async () => {
      const samples = await performanceFor("attachment", "inserted");
      return samples.length ? samples : null;
    }, `${label} native insertion measurement`);
    assert.equal(requestSamples.length, 1, "one terminal measurement per explicit request");
    assert.equal(requestSamples[0].platform, platform);
    assert.ok(requestSamples[0].first_usable_preview_ms > 0);
    assert.equal(requestSamples[0].generation_mode, "model");
    assert.ok(attachments[0].native_attachment_confirmation_ms >= 100, "waits for native upload preview");
    [...requestSamples, ...attachments].forEach(assertContentFree);
    if (scenario.portal) {
      assert.equal(await page.evaluate(() => window.__photoClicks), 1, "activates only the bound composer photo control");
      assert.deepEqual(await page.evaluate(() => window.__inputClickStates), [true], "cancels the exact input chooser activation");
      assert.equal(await page.evaluate(() => window.__pasteCount), 0);
      assert.equal(fileChooserCounts.get(page), 0, "never opens a native OS picker");
      assert.equal(await page.locator('#owned-input-0').evaluate((input) => input.closest('dialog')), null);
      assert.equal(await page.locator('#owned-input-0').evaluate((input) => input.files.length), 1);
      const leakedCapture = await page.locator('#owned-input-0').evaluate((input) => {
        let cancelledBeforeTarget = false;
        input.addEventListener('click', event => {
          cancelledBeforeTarget = event.defaultPrevented;
          event.preventDefault();
        }, { once: true });
        input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return cancelledBeforeTarget;
      });
      assert.equal(leakedCapture, false, "removes the temporary capture listener");
      assert.equal(await page.locator('#unrelated-input').evaluate((input) => input.files.length), 0);
      if (scenario.editorMode === "preexisting-portal") {
        assert.equal(await page.locator('#inline-input').evaluate((input) => input.files.length), 0);
        assert.equal(await page.locator('#inline-upload img').count(), 0);
        assert.equal(await page.locator('#inline-editor').textContent(), 'Existing synthetic draft');
      }
    }
    assert.equal(await page.locator("#upload img").count(), 1);
    if (scenario.editorMode === "preexisting") {
      assert.equal(await page.locator('#owned-editor').textContent(), 'Existing synthetic draft');
      assert.equal(await page.locator('#editor > input').evaluate((input) => input.files.length), 1);
      assert.equal(await page.locator('#nested-input').evaluate((input) => input.files.length), 0);
      assert.equal(await page.locator('#other-input').evaluate((input) => input.files.length), 0);
      assert.equal(await page.evaluate(() => window.__unrelatedEditorFocus), 0);
      assert.equal(fileChooserCounts.get(page), 0);
    }
    assert.equal((await eventsFor("copied")).length, 0);
    assert.equal((await eventsFor("dismissed")).length, 0);
    assert.equal((await eventsFor("rejected")).length, 0);
    const timings = await page.evaluate(() => window.__browserTimings);
    assert.ok(timings.length > 0, "browser timing event was observed");
    for (const timing of timings) {
      assert.doesNotMatch(JSON.stringify(timing), /tweet|caption|https?:|Skipped tests/i);
    }
    await page.close();
    console.log(`[MemeDrop] ${label}: rendered preview, safe timings, confirmed attachment PASS`);
  }
  {
    const { page } = await openScenario({ platform: "linkedin", editorMode: "preexisting-offscreen" });
    assert.equal(await page.locator('#owned-editor').evaluate((editor) => editor === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.scrollY === window.__scrollBeforeMeme), true,
      "focusing the exact editor does not scroll away from the selected post");
    await page.close();
    console.log("[MemeDrop] pre-opened offscreen editor: focused without scrolling PASS");
  }
  {
    const { page, usable } = await openScenario({ platform: "linkedin", editorMode: "ambiguous" });
    assert.equal(await page.evaluate(() => window.__unrelatedEditorFocus), 0, "never focuses an ambiguous editor");
    assert.notEqual(await page.locator('#owned-editor').evaluate((editor) => editor === document.activeElement), true);
    // Select before the mount grace expires: rejecting the binding must also
    // prevent an early card click from assigning the first arbitrary file input.
    await usable.first().click();
    const samples = await until(async () => {
      const rows = await performanceFor("attachment");
      return rows.length ? rows : null;
    }, "ambiguous composer neutral attachment outcome");
    assert.ok(samples.every((sample) => ["copied", "cancelled"].includes(sample.outcome)));
    assert.equal(await page.locator('#editor > input').evaluate((input) => input.files.length), 0);
    assert.equal(await page.locator('#other-input').evaluate((input) => input.files.length), 0);
    assert.equal((await eventsFor("inserted")).length, 0);
    await until(async () => (await page.locator('.meme-card[aria-disabled="false"]:visible').count()) === 0,
      "unbound ambiguous session closes", 6_000);
    await page.close();
    console.log("[MemeDrop] ambiguous pre-opened editors: no arbitrary focus or attachment PASS");
  }
  {
    const { page } = await openScenario({ platform: "linkedin", editorMode: "preexisting", request: false });
    await page.waitForTimeout(400);
    assert.equal((await fixtureState()).suggestion_calls, 0, "native Comment never starts inference");
    assert.equal(await page.locator('.meme-card').count(), 0);
    assert.equal(await page.locator('#owned-editor').evaluate((editor) => editor === document.activeElement), false,
      "native Comment leaves focus behavior to LinkedIn");
    await page.close();
    console.log("[MemeDrop] pre-opened native Comment: no implicit inference or extension focus PASS");
  }
  {
    const { page } = await openScenario({ platform: "linkedin", commentLink: true, portal: true,
      editorMode: "preexisting-portal", mode: "slow", waitReady: false });
    await until(async () => (await fixtureState()).suggestion_calls === 1, "portal suggestion request");
    await page.locator('#comment-dialog:modal #memedrop-suggestion-panel').waitFor();
    await page.evaluate(() => document.querySelector('#comment-dialog').close());
    await until(async () => (await fixtureState()).suggestion_pending === 0, "closed portal request completion");
    assert.equal((await eventsFor("shown")).length, 0);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(await page.locator('body > #memedrop-suggestion-panel').count(), 1, "recovers panel host from closed portal");
    assert.equal(await page.locator('.meme-card[aria-disabled="false"]').count(), 0);
    assert.equal(await page.locator('#inline-editor').textContent(), 'Existing synthetic draft');
    await page.close();
    console.log("[MemeDrop] closed native dialog: stale result ignored despite unrelated editor PASS");
  }
  {
    const { page, usable } = await openScenario({ platform: "linkedin", commentLink: true, portal: true, confirmation: "ignore" });
    await usable.first().click();
    await until(async () => (await eventsFor("copied")).length === 1, "unconfirmed captured upload clipboard outcome", 10_000);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(await page.evaluate(() => window.__photoClicks), 1);
    assert.equal(await page.evaluate(() => window.__pasteCount), 0);
    assert.deepEqual(await page.evaluate(() => window.__inputClickStates), [true]);
    assert.equal(fileChooserCounts.get(page), 0);
    assert.equal(await page.locator('#unrelated-input').evaluate((input) => input.files.length), 0);
    assert.equal(await page.locator('#unrelated-blob-avatar').evaluate((image) => image.complete && image.naturalWidth > 0), true,
      "an unrelated decoded blob image cannot confirm attachment");
    await page.close();
    console.log("[MemeDrop] unconfirmed captured native upload: copied, no picker or false insertion PASS");
  }
  for (const photoInputMode of ["absent", "ambiguous"]) {
    const { page, usable } = await openScenario({ platform: "linkedin", commentLink: true, portal: true, photoInputMode });
    await usable.first().click();
    await until(async () => (await eventsFor("copied")).length === 1, `${photoInputMode} activated input fallback`);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(fileChooserCounts.get(page), 0);
    assert.equal(await page.locator('#unrelated-input').evaluate((input) => input.files.length), 0);
    const assignedCounts = await page.locator('[id^="owned-input-"]').evaluateAll((inputs) => inputs.map((input) => input.files.length));
    assert.ok(assignedCounts.every((count) => count === 0), "never assigns ambiguous inputs");
    assert.deepEqual(await page.evaluate(() => window.__inputClickStates), photoInputMode === "ambiguous" ? [true, true] : []);
    await page.close();
    console.log(`[MemeDrop] ${photoInputMode} activated file input: copied, no arbitrary assignment or picker PASS`);
  }
  {
    const { page, usable } = await openScenario({ platform: "linkedin", commentLink: true, portal: true, photoInputMode: "closed" });
    await usable.first().click();
    await page.waitForTimeout(400);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal((await eventsFor("copied")).length, 0);
    assert.equal(fileChooserCounts.get(page), 0);
    assert.equal(await page.locator('#owned-input-0').evaluate((input) => input.files.length), 0);
    await page.close();
    console.log("[MemeDrop] dialog closes during capture: no file assignment or stale outcome PASS");
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
    const cancelled = await until(async () => {
      const samples = await performanceFor("request", "cancelled");
      return samples.length ? samples : null;
    }, "navigation cancellation measurement");
    assert.equal(cancelled.length, 1, "one terminal cancellation measurement per abandoned request");
    cancelled.forEach(assertContentFree);
    assert.equal((await eventsFor("shown")).length, 0);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(await page.locator('.meme-card[aria-disabled="false"]').count(), 0);
    await page.close();
    console.log("[MemeDrop] navigation during generation: late result ignored PASS");
  }
  for (const reddit of [{ kind: "post" }, { kind: "comment" }, { shadow: true, actionShadow: true, disableDuringUpload: true }, { huge: true, long: true }]) {
    const { page, usable } = await openScenario({ platform: "reddit", reddit });
    const state = await fixtureState();
    assert.equal(state.suggestion_calls, 1);
    assert.equal(state.reply_context_checks.length, 1);
    const check = state.reply_context_checks[0];
    assert.equal(check.has_post_title, true);
    assert.equal(check.has_post_body, true);
    if (reddit.kind !== "post") assert.equal(check.has_selected_comment, true);
    assert.ok(check.target_length <= 2000 && check.body_length <= 1200);
    assert.equal(check.truncated, Boolean(reddit.long));
    assert.equal(await page.locator('#memedrop-suggestion-panel .title').count(), 1, "same shared panel");
    await verifySharedCardAppearance(usable.first());
    if (process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR) {
      await mkdir(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.MEMEDROP_BROWSER_SCREENSHOT_DIR,
        `reddit-${reddit.kind || "comment"}-${reddit.shadow ? "shadow" : reddit.huge ? "huge" : "basic"}.png`) });
    }
    await usable.first().click();
    await until(async () => (await eventsFor("inserted")).length === 1, "Reddit exact native attachment");
    assert.equal(await page.evaluate(() => {
      const scope = window.__selectedComposer;
      return (scope.shadowRoot || scope).querySelector('[contenteditable]').textContent;
    }), "Existing synthetic draft");
    const uploads = await page.evaluate(() => window.__uploads);
    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].width <= 240 && uploads[0].height <= 240);
    assert.equal(await page.evaluate(() => {
      const scope = window.__otherComposer;
      return (scope.shadowRoot || scope).querySelector('input').files.length;
    }), 0);
    assert.equal(await page.evaluate(() => window.__submitClicks), 0);
    assert.equal(fileChooserCounts.get(page), 0);
    const samples = await until(async () => {
      const rows = await performanceFor("attachment", "inserted");
      return rows.length ? rows : null;
    }, "Reddit anonymous attachment sample");
    assert.equal(samples[0].platform, "reddit");
    samples.forEach(assertContentFree);
    assert.ok((await fixtureState()).events.every((event) =>
      !Object.keys(event.tweet_context || {}).some((key) => key !== "suggestion_mode")));
    await page.close();
    console.log(`[MemeDrop] Reddit ${reddit.kind || "comment"}${reddit.shadow ? " open-shadow" : ""}${reddit.huge ? " huge/deep thread" : ""}: shared UI, bounded context and native draft PASS`);
  }
  for (const reddit of [{ capability: "absent" }, { capability: "disabled" }, { missingContext: true },
    { ambiguous: true }, { wrongPost: true }, { nsfw: true }, { missingBody: true }, { ambiguousBody: true },
    { closedShadow: true }, { duplicateInput: true }]) {
    const { page } = await openScenario({ platform: "reddit", reddit, waitReady: false });
    await page.locator('#memedrop-suggestion-panel .empty').waitFor();
    assert.equal((await fixtureState()).suggestion_calls, 0, "unsupported context/capability never calls inference");
    assert.equal(await page.locator('.meme-card').count(), 0);
    await page.close();
    console.log("[MemeDrop] Reddit unavailable capability/context or ambiguous composer: zero inference PASS");
  }
  {
    const { page } = await openScenario({ platform: "reddit", request: false });
    await page.waitForTimeout(400);
    assert.equal((await fixtureState()).suggestion_calls, 0);
    assert.equal(await page.locator('#memedrop-suggestion-panel').count(), 0);
    await page.locator('[data-fixture-target] > .actions [data-memedrop-reply="true"]').click();
    await page.locator('.meme-card[aria-disabled="false"]').first().waitFor();
    assert.equal((await fixtureState()).suggestion_calls, 1);
    assert.equal(await page.evaluate(() => window.__nativeReplyClicks), 1,
      "Meme binds the pre-opened editor without toggling native Reply again");
    assert.equal(await page.evaluate(() => window.__selectedComposer.querySelector('[contenteditable]').textContent),
      "Existing synthetic draft");
    await until(async () => (await eventsFor("shown")).length === 2,
      "pre-opened Reddit impressions finish before the next fixture reset");
    await until(async () => (await performanceFor("request", "usable")).length === 1,
      "pre-opened Reddit request measurement");
    await page.close();
    console.log("[MemeDrop] Reddit native Reply: zero inference; later Meme binds the same draft without toggling PASS");
  }
  for (const change of ["navigation", "comment", "post", "capability"]) {
    const { page } = await openScenario({ platform: "reddit", mode: "slow", waitReady: false });
    await until(async () => (await fixtureState()).suggestion_calls === 1, "Reddit in-flight request");
    await page.evaluate((change) => {
      if (change === "navigation") history.pushState({}, "", "/r/fixture/comments/another/synthetic/");
      if (change === "comment") document.querySelector('[slot="comment"]').textContent = "Changed synthetic comment";
      if (change === "post") document.querySelector('shreddit-post').setAttribute('post-title', 'Changed synthetic post');
      if (change === "capability") {
        const scope = window.__selectedComposer;
        (scope.shadowRoot || scope).querySelector('[aria-label="Add an image"]').disabled = true;
      }
    }, change);
    await until(async () => (await fixtureState()).suggestion_pending === 0, "Reddit stale request completes");
    assert.equal((await eventsFor("shown")).length, 0);
    assert.equal((await eventsFor("inserted")).length, 0);
    assert.equal(await page.locator('.meme-card[aria-disabled="false"]').count(), 0);
    await page.close();
    console.log(`[MemeDrop] Reddit ${change} change cancels stale context/results PASS`);
  }
  {
    const { page, usable } = await openScenario({ platform: "reddit", reddit: { removable: false } });
    await usable.first().click();
    await until(async () => (await eventsFor("copied")).length === 1, "Reddit non-removable preview stays neutral");
    assert.equal((await eventsFor("inserted")).length, 0);
    await page.close();
    console.log("[MemeDrop] Reddit preview without native remove control: copied, never inserted PASS");
  }
  for (const kind of ["post", "comment"]) {
    const { page, usable } = await openScenario({ platform: "reddit", reddit: { nativeStructure: true, kind } });
    const contextChecks = (await fixtureState()).reply_context_checks;
    assert.ok(contextChecks.length > 0);
    assert.ok(contextChecks.every(row => row.kind === kind && row.has_post_body && row.has_post_title));
    assert.ok(contextChecks.every(row => row.body_length === "We skipped tests and deployed Friday.".length),
      "nested native body slots supply the post once without shadow-control text");
    await verifySharedCardAppearance(usable.first());
    assert.equal(await page.evaluate(() => window.__rootOpenClicks), kind === "post" ? 1 : 0);
    assert.equal(await page.evaluate(() => window.__nativeReplyClicks), kind === "post" ? 0 : 1);
    await usable.first().click();
    await until(async () => (await eventsFor("inserted")).length === 1, "native Reddit RTE attachment confirmation");
    assert.equal(await page.evaluate(() => window.__selectedComposer.querySelector('[contenteditable]').textContent),
      "Existing synthetic draft");
    const inputs = await page.evaluate(() => window.__nativeInputs.map(row => ({
      id:row.id,image:row.image.files.length,video:row.video.files.length,
    })));
    assert.equal(inputs.filter(row => row.image === 1).length, 1);
    assert.ok(inputs.every(row => row.video === 0));
    assert.equal(await page.evaluate(() => window.__submitClicks), 0);
    assert.equal(fileChooserCounts.get(page), 0);
    await page.close();
    console.log(`[MemeDrop] Reddit native ${kind}: tracked Reply, external host, nested image/video toolbar and editable media identity PASS`);
  }
  {
    const { page, usable } = await openScenario({ platform: "reddit", reddit: {
      nativeStructure: true, kind: "post", switchToComment: true,
    } });
    await page.locator('shreddit-comment[thingid="t1_selected"] [data-memedrop-reply]').click();
    await until(async () => (await fixtureState()).suggestion_calls === 2,
      "switch from active post to asynchronously mounted comment editor");
    await usable.first().waitFor();
    const checks=(await fixtureState()).reply_context_checks;
    assert.deepEqual(checks.map(row=>row.kind),["post","comment"]);
    assert.ok(checks[1].has_selected_comment && checks[1].has_post_title && checks[1].has_post_body);
    await usable.first().click();
    await until(async () => (await eventsFor("inserted")).length === 1, "switched comment attachment");
    assert.equal(await page.evaluate(()=>window.__postComposer.querySelector('[contenteditable]').textContent),
      "Existing synthetic draft");
    assert.equal(await page.evaluate(()=>window.__selectedComposer.querySelector('[contenteditable]').textContent),
      "Existing synthetic draft");
    const uploads=await page.evaluate(()=>window.__uploads);
    assert.equal(uploads.length,1);
    assert.equal(uploads[0].target,"t1_selected");
    assert.equal(await page.evaluate(()=>window.__submitClicks),0);
    assert.equal(fileChooserCounts.get(page),0);
    await page.close();
    console.log("[MemeDrop] Reddit switch from active post to delayed comment editor: one click, correct context and preserved drafts PASS");
  }
  for (const nativeImageMode of ["mismatch", "missing-key", "outside-editor"]) {
    const { page, usable } = await openScenario({ platform: "reddit", reddit: { nativeStructure: true, nativeImageMode } });
    await usable.first().click();
    await until(async () => (await eventsFor("copied")).length === 1, "unconfirmed native RTE image remains neutral");
    assert.equal((await eventsFor("inserted")).length, 0);
    await page.close();
    console.log(`[MemeDrop] Reddit native image ${nativeImageMode}: no false insertion PASS`);
  }
  for (const platform of ["x", "linkedin", "reddit"]) {
    for (const [name, captions] of [
      ["Two Buttons", ['Ship without tests', 'Wait for review', 'Friday deployment']],
      ["Gru's Plan", ['Skip the tests', 'Deploy on Friday', 'Service goes down', 'My weekend is gone']],
    ]) {
      const { page, usable } = await openScenario({ platform, mode: "dense", reddit: { nativeStructure: true } });
      await verifySharedCardAppearance(usable.first());
      const editor = platform === "reddit" ? null : page.locator(platform === "x" ? '[data-testid="tweetTextarea_0"]'
        : '[aria-label="Text editor for creating comment"]');
      if (platform !== 'reddit') await editor.fill('Existing synthetic draft');
      await page.getByRole('button', { name: 'Guide', exact: true }).click();
      const preview = page.getByRole('button', { name: `Preview ${name}`, exact: true });
      await preview.click();
      const detail = page.getByRole('region', { name: 'Meme preview', exact: true });
      await detail.waitFor();
      assert.deepEqual(await detail.locator('.preview-captions li').allTextContents(), captions);
      assert.equal(await detail.locator('.preview-captions').evaluate(el => getComputedStyle(el).userSelect), 'text');
      assert.ok(await detail.locator('img').evaluate(img => img.getBoundingClientRect().width > 300));
      for (const viewport of [{ width: 820, height: 560 }, { width: 390, height: 400 }]) {
        await page.setViewportSize(viewport);
        const bounds = await page.locator('#memedrop-suggestion-panel .panel').evaluate(panel => {
          const r = panel.getBoundingClientRect();
          const attach = panel.querySelector('.preview-attach').getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
            attachTop: attach.top, attachBottom: attach.bottom, height: innerHeight, width: innerWidth };
        });
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height && bounds.left >= 0 && bounds.right <= bounds.width,
          'review stays inside short and narrow viewports with Guide previously open');
        assert.ok(bounds.attachTop >= 0 && bounds.attachBottom <= bounds.height, 'Attach stays in view');
      }
      assert.equal((await fixtureState()).suggestion_calls, 1, 'review makes no inference call');
      assert.equal((await eventsFor('clicked')).length, 0, 'review does not select');
      assert.equal((await eventsFor('inserted')).length, 0, 'review does not attach');
      await page.keyboard.press('Escape');
      await detail.waitFor({ state: 'detached' });
      assert.equal(await preview.evaluate(el => el === el.getRootNode().activeElement), true, 'Escape restores focus');
      assert.equal(await page.locator('#memedrop-suggestion-panel').evaluate(host => host.style.bottom), '80px');
      assert.equal(await page.locator('.steering-control').evaluate(el => el.hidden), false, 'Guide is restored');
      await preview.click();
      await detail.getByRole('button', { name: 'Attach meme', exact: true }).click();
      await until(async () => (await eventsFor('inserted')).length === 1, 'reviewed dense native attachment');
      assert.equal((await fixtureState()).suggestion_calls, 1);
      const draft = platform === 'reddit'
        ? await page.evaluate(() => window.__selectedComposer.querySelector('[contenteditable]').textContent)
        : await editor.textContent();
      assert.equal(draft, 'Existing synthetic draft');
      if (platform === 'reddit') {
        assert.equal(await page.evaluate(() => window.__submitClicks), 0);
        const uploads = await page.evaluate(() => window.__uploads);
        assert.ok(uploads[0].width <= 240 && uploads[0].height <= 240);
      }
      assert.equal(fileChooserCounts.get(page), 0);
      await page.close();
      console.log(`[MemeDrop] ${platform} ${name}: complete review, narrow layout, keyboard return and explicit native attachment PASS`);
    }
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
