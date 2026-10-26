/**
 * Capture the live scene once and save it as the static fallback image.
 *
 * The fallback is what a visitor without WebGL, or without JavaScript, sees, so
 * it has to be a real frame of the same scene rather than a mock-up. It is shot
 * at the widest framing (the last panel), because every other panel crops into
 * it — a still shot at the tightest framing could not be panned outwards.
 *
 * The shot keeps the page background instead of asking for transparency: the
 * post-processing chain writes colour into low-alpha pixels, and forcing those
 * pixels transparent makes the un-premultiplied result flare up. The page
 * background matches the image, so the rectangle is invisible in place.
 *
 *   npm run build && npm run capture
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const port = Number(process.env.CAPTURE_PORT || 4174);
const out = resolve(root, process.env.CAPTURE_OUT || "public/loop-fallback.jpg");
const size = {
  width: Number(process.env.CAPTURE_WIDTH || 1600),
  height: Number(process.env.CAPTURE_HEIGHT || 1000),
};
// Last panel: the lens is furthest back there.
const url = `http://127.0.0.1:${port}/#about`;

async function waitForServer(target, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Preview server did not answer at ${target}`);
}

const server = spawn(
  "npm",
  ["run", "preview", "--", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: "ignore" },
);

let browser;
try {
  await waitForServer(url);
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: size,
    deviceScaleFactor: 1.1,
    reducedMotion: "no-preference",
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('#scene-host[data-canvas-ready="true"]', {
    timeout: 40000,
  });
  // Let the pulse travel to a good spot and the lens settle on the last panel.
  await page.waitForTimeout(4600);
  await page.evaluate(() => {
    // Everything that belongs to the page rather than to the render.
    for (const selector of [".deck", ".header", ".progress", ".figure-still"]) {
      document.querySelectorAll(selector).forEach((element) => {
        element.style.display = "none";
      });
    }
  });
  await page.waitForTimeout(120);
  await mkdir(dirname(out), { recursive: true });
  // JPEG keeps the file small enough to preload; the art has no transparency.
  await page.screenshot({ path: out, type: "jpeg", quality: 70 });
  // The preview server serves dist/, so keep the copy it will serve in step.
  const built = resolve(root, "dist/loop-fallback.jpg");
  await copyFile(out, built).catch(() => {});
  console.log(`Saved ${out}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
