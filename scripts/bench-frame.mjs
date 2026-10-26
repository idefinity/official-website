#!/usr/bin/env node
/**
 * The measurement behind the numbers in research/topics/*.
 *
 * Counts real frames with a MutationObserver on the crawl phase, and reads
 * main-thread time from CDP. The frame counter matters: requestAnimationFrame
 * callbacks can fire more often than frames are actually presented, so counting
 * rAF would overstate the frame rate.
 *
 *   npm run build && npm run preview &
 *   node scripts/bench-frame.mjs [url] [seconds]
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? process.env.BENCH_URL ?? "http://127.0.0.1:4173/";
const seconds = Number(process.argv[3] ?? 10);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector('#scene-host[data-canvas-ready="true"]', { timeout: 40000 });
await page.waitForTimeout(2500);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const read = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
};

await page.evaluate(() => {
  window.__frames = 0;
  new MutationObserver(() => {
    window.__frames += 1;
  }).observe(document.querySelector("#scene-host"), {
    attributes: true,
    attributeFilter: ["data-crawl"],
  });
});

const before = await read();
await page.waitForTimeout(seconds * 1000);
const after = await read();
const frames = await page.evaluate(() => window.__frames);
const canvas = await page.evaluate(() => {
  const element = document.querySelector("#scene-host canvas");
  return element ? [element.width, element.height] : null;
});

const task = ((after.TaskDuration - before.TaskDuration) * 1000) / frames;
const script = ((after.ScriptDuration - before.ScriptDuration) * 1000) / frames;

console.log(`canvas      ${canvas ? canvas.join(" × ") : "none"}`);
console.log(`frames      ${frames} in ${seconds}s → ${(frames / seconds).toFixed(1)} fps`);
console.log(`main thread ${task.toFixed(2)} ms/frame`);
console.log(`  script    ${script.toFixed(2)} ms/frame`);
console.log(`js heap     ${(after.JSHeapUsedSize / 1048576).toFixed(1)} MB`);
console.log(`lattice     ${await page.getAttribute("#scene-host", "data-lattice")}`);
await browser.close();
