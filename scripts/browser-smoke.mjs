import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// A real Chromium browser runs against a loopback-only, simulated HA fixture.
// CHROME_PATH must point to a local Chrome/Chromium/Edge executable when no
// standard installation is found. No browser sandbox flags are disabled.
const standardLocations = [
  process.platform === "win32" &&
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  process.platform === "win32" &&
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  process.platform === "win32" &&
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  process.platform === "darwin" &&
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  process.platform === "darwin" &&
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  process.platform === "linux" && "/usr/bin/chromium",
  process.platform === "linux" && "/usr/bin/google-chrome",
  process.platform === "linux" && "/usr/bin/microsoft-edge",
].filter(Boolean);
const candidates = process.env.CHROME_PATH
  ? [process.env.CHROME_PATH]
  : standardLocations;
let executable;
for (const path of candidates) {
  try {
    await access(path);
    executable = path;
    break;
  } catch {
    /* Try the next standard location. */
  }
}
if (!executable)
  throw new Error(
    "Chrome/Chromium/Edge not found. Set CHROME_PATH to the browser executable.",
  );

const root = new URL("../", import.meta.url);
const bundle = await readFile(
  new URL("../dist/advanced-blind-card.js", import.meta.url),
  "utf8",
);
const metadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
assert.ok(
  bundle.startsWith(`/*!\nAdvanced Blind Card v${metadata.version}\n`),
  "Bundle version is stale; run pnpm build before pnpm test:browser.",
);
const fresh = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  write: false,
  logLevel: "silent",
});
assert.ok(
  bundle.endsWith(fresh.outputFiles[0].text),
  "Bundle is stale; run pnpm build before pnpm test:browser.",
);
const fixture = await readFile(
  new URL("browser-fixture.html", import.meta.url),
);
const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
  } else if (request.url === "/card.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
    });
    response.end(bundle);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve, reject) =>
  server.once("error", reject).listen(0, "127.0.0.1", resolve),
);
const address = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "blind-card-browser-"));
const resolvedTemp = await realpath(tmpdir());
const resolvedProfile = await realpath(profile);
const profileWithinTemp = relative(resolvedTemp, resolvedProfile);
assert.ok(
  profileWithinTemp &&
    !isAbsolute(profileWithinTemp) &&
    profileWithinTemp !== ".." &&
    !profileWithinTemp.startsWith(`..${sep}`),
  "Temporary browser profile resolved outside the temporary directory.",
);
let child, socket;
try {
  child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "",
    launchError;
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  child.on("error", (error) => {
    launchError = error;
  });
  let portFile;
  for (let i = 0; i < 120; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null)
      throw new Error(`Browser exited before starting: ${stderr}`);
    try {
      portFile = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      break;
    } catch {
      await delay(100);
    }
  }
  if (!portFile)
    throw new Error(`Browser debugging endpoint did not start: ${stderr}`);
  const [port, path] = portFile.trim().split(/\r?\n/);
  assert.match(port, /^\d+$/);
  assert.match(path, /^\/devtools\/browser\//);
  socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timeout);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const target = await send("Target.createTarget", { url: "about:blank" });
  const session = (
    await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    })
  ).sessionId;
  const command = (method, params = {}) => send(method, params, session);
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Page.navigate", { url: address });
  const evaluate = async (expression) => {
    const r = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  for (let i = 0; i < 100; i++) {
    if (await evaluate("!!window.ready")) break;
    if (i === 99) throw new Error("Fixture did not load.");
    await delay(100);
  }
  const run = (fn) => evaluate(`(${fn.toString()})()`);
  const settle = () =>
    run(async () => {
      await card.updateComplete;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
  const calls = () => evaluate("window.calls");
  assert.deepEqual(await calls(), []);
  await run(() => card.shadowRoot.querySelector(".expand").click());
  await settle();
  assert.equal(
    await run(() => card.shadowRoot.querySelectorAll("[data-row]").length),
    3,
  );
  assert.deepEqual(await calls(), []);
  console.log("PASS passive initialization and group expansion");
  const mixed = await run(() => {
    const row = card.shadowRoot.querySelector('[data-row="row-0"]');
    const input = row.querySelector("#row-0-position");
    return {
      summary: [...row.querySelectorAll(":scope > .inline-mixed-report")]
        .map((n) => n.textContent)
        .join(" "),
      accessible: input.getAttribute("aria-valuetext"),
    };
  });
  assert.match(mixed.summary, /20–60%/);
  assert.match(mixed.accessible, /20–60%/);
  console.log(
    "PASS mixed group range remains visible with show_values disabled",
  );
  const geometry = await run(() => {
    const root = card.shadowRoot,
      box = card.getBoundingClientRect();
    return [...root.querySelectorAll(".inline-arrow,.stop,.expand")]
      .filter((n) => n.getClientRects().length)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          boxLeft: box.left,
          boxRight: box.right,
        };
      });
  });
  assert.ok(geometry.length >= 8);
  for (const b of geometry)
    assert.ok(
      b.width >= 44 &&
        b.height >= 44 &&
        b.left >= b.boxLeft - 1 &&
        b.right <= b.boxRight + 1,
      JSON.stringify(b),
    );
  console.log("PASS mobile action geometry");
  const box = await run(() => {
    const b = card.shadowRoot
      .querySelector("#row-0-position")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const initialValue = await run(
    () => card.shadowRoot.querySelector("#row-0-position").valueAsNumber,
  );
  const y = box.y + box.h / 2;
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: box.x + box.w * 0.25,
    y,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x + box.w * 0.25,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: box.x + box.w * 0.75,
    y,
    button: "left",
    buttons: 1,
  });
  await settle();
  assert.deepEqual(await calls(), []);
  const selectedValue = await run(
    () => card.shadowRoot.querySelector("#row-0-position").valueAsNumber,
  );
  assert.ok(
    Number.isFinite(selectedValue) &&
      selectedValue !== initialValue &&
      selectedValue > 0 &&
      selectedValue < 100,
  );
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x + box.w * 0.75,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await settle();
  const move = await calls();
  assert.equal(move.length, 2);
  assert.deepEqual(move.map((c) => [c.service, c.target.entity_id]).sort(), [
    ["set_cover_position", "cover.one"],
    ["set_cover_position", "cover.two"],
  ]);
  assert.ok(move.every((call) => call.data.position === selectedValue));
  console.log(
    "PASS shared slider dispatches only after release to both members",
  );
  const pointerClick = async (selector) => {
    const target = await evaluate(`(async () => {
      const root = card.shadowRoot, button = root.querySelector(${JSON.stringify(selector)});
      if (!button || button.disabled) throw new Error('Button missing or disabled');
      button.scrollIntoView({block:'center',inline:'center'});
      await new Promise(r => requestAnimationFrame(r));
      const box = button.getBoundingClientRect(), x = box.left + box.width/2, y = box.top + box.height/2;
      const hit = root.elementFromPoint(x,y);
      return {x,y,hit:hit === button || button.contains(hit)};
    })()`);
    assert.equal(target.hit, true, `Button is obscured: ${selector}`);
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: target.x,
      y: target.y,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  };
  await pointerClick('[data-row="row-0"] > .inline-grid .stop');
  await settle();
  const stops = (await calls())
    .slice(2)
    .map((c) => [c.service, c.target.entity_id])
    .sort();
  assert.deepEqual(stops, [
    ["stop_cover", "cover.one"],
    ["stop_cover", "cover.two"],
    ["stop_cover_tilt", "cover.one"],
    ["stop_cover_tilt", "cover.two"],
  ]);
  console.log("PASS STOP targets supported channels for both members");
  await run(async () => {
    calls.length = 0;
    hass.states["cover.two"].state = "unavailable";
    card.hass = { ...hass };
    await card.updateComplete;
  });
  await settle();
  const state = await run(() => {
    const row = card.shadowRoot.querySelector('[data-row="row-0"]');
    return {
      text: [...row.querySelectorAll(":scope > .inline-mixed-report")]
        .map((n) => n.textContent)
        .join(" "),
      calls: calls.length,
    };
  });
  assert.match(state.text, /unavailable/i);
  assert.equal(state.calls, 0);
  await pointerClick(
    '[data-row="row-0"] > .inline-grid .inline-arrow[data-action="open"]',
  );
  await settle();
  assert.deepEqual(
    (await calls()).map((c) => [c.service, c.target.entity_id]),
    [["open_cover", "cover.one"]],
  );
  console.log("PASS unavailable member stays visible and receives no command");
  await command("Browser.close").catch(() => {});
} finally {
  socket?.close();
  child?.kill();
  await new Promise((resolve) => server.close(resolve));
  await rm(resolvedProfile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }).catch((error) =>
    console.error(
      `Could not remove temporary browser profile ${profile}: ${error.message}`,
    ),
  );
}
