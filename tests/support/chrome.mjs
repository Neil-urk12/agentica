import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where Chrome may live on the platforms this repo is developed on. */
function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.CHROME_EXECUTABLE,
    process.env.LOCALAPPDATA &&
      join(
        process.env.LOCALAPPDATA,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
}

function findBrowser() {
  const found = chromeCandidates().find((candidate) => existsSync(candidate));
  if (!found)
    throw new Error(
      "No Chrome or Edge binary found. Install one or set CHROME_PATH to run " +
        "the rendered canvas interaction test.",
    );
  return found;
}

/**
 * Launch headless Chrome and return a page bound to one target. Headless Chrome
 * renders the real DOM and layout, so Svelte Flow measures handles the same way
 * a desktop user's browser does.
 */
export async function launchBrowser() {
  const executablePath = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "agentica-browser-"));
  const child = spawn(
    executablePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      // Without these Chrome treats an occluded headless window as background:
      // it stops compositing, hit-testing collapses to the document root, and
      // dispatched input silently lands nowhere.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
      "--remote-allow-origins=*",
      "--remote-debugging-port=0",
      "--window-size=1600,1000",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let output = "";
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("DevTools never reported a listening port.")),
      20_000,
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      output += text;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready (${code}).`));
    });
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error)
      waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });

  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await focusPage({ send, sessionId });
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  // Keep the page focused so Chrome composites it; an unfocused headless page
  // stops producing frames and hit-testing collapses to the document root.
  await send(
    "Emulation.setFocusEmulationEnabled",
    { enabled: true },
    sessionId,
  );

  // Wait for the process before removing its profile: Windows keeps the files
  // locked until Chrome has actually exited, and a throw here would skip the
  // caller's own cleanup.
  const close = async () => {
    try {
      socket.close();
    } catch {}
    try {
      child.kill("SIGKILL");
    } catch {}
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      const timer = setTimeout(resolve, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };

  return { send, sessionId, close };
}

/**
 * A target that is not the active one reports hit-testing at the document root
 * and silently drops dispatched input, so re-activate it before interacting.
 */
async function focusPage(page) {
  await page.send("Page.bringToFront", {}, page.sessionId);
  // Activation only takes effect once Chrome commits a frame, and a screenshot
  // forces that commit, after which hit-testing and input dispatch work again.
  await page.send(
    "Page.captureScreenshot",
    { format: "jpeg", quality: 20, captureBeyondViewport: false },
    page.sessionId,
  );
}

/** Evaluate an expression in the page and return its JSON value. */
export async function evaluate(page, expression) {
  const response = await page.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    page.sessionId,
  );
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ??
        `evaluate failed: ${expression}`,
    );
  return response.result.value;
}

/** Poll until the expression is truthy; throws with a label when it never is. */
export async function waitFor(page, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = false;
    try {
      value = await evaluate(page, expression);
    } catch {
      // The page may still be navigating; keep polling.
    }
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await sleep(120);
  }
}

/** Center and size of the first element matching a selector, or null. */
export async function boxOf(page, selector) {
  return evaluate(
    page,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    })()`,
  );
}

/** Center of the element whose text contains `text`, or null. */
export async function boxByText(page, selector, text) {
  return evaluate(
    page,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.includes(${JSON.stringify(text)}));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    })()`,
  );
}

/** How many elements currently match a selector. */
export async function countOf(page, selector) {
  return evaluate(
    page,
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

async function mouse(
  page,
  type,
  { x, y, button = "none", buttons = 0, clickCount = 0 },
) {
  await page.send(
    "Input.dispatchMouseEvent",
    { type, x, y, button, buttons, clickCount },
    page.sessionId,
  );
}

export async function clickAt(page, { x, y }) {
  await focusPage(page);
  await mouse(page, "mouseMoved", { x, y });
  await mouse(page, "mousePressed", {
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await mouse(page, "mouseReleased", {
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

/** Press on one point, move in steps, release on another — a real user drag. */
export async function dragBetween(page, from, to) {
  await focusPage(page);
  await mouse(page, "mouseMoved", { x: from.x, y: from.y });
  await mouse(page, "mousePressed", {
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  const steps = 10;
  for (let index = 1; index <= steps; index += 1)
    await mouse(page, "mouseMoved", {
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
      button: "left",
      buttons: 1,
    });
  await mouse(page, "mouseReleased", {
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}
