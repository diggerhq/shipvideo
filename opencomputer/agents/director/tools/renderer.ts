import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Rendering pipeline: headless Chromium (Playwright's arm64 headless shell)
// draws the scene frame by frame under a virtual clock, ffmpeg encodes the
// frames to H.264. Nothing here depends on wall-clock time, so a render is
// reproducible and a 30 s scene at 30 fps takes roughly 30-40 s.
//
// The runtime is a fresh Amazon Linux 2023 arm64 microVM per session with
// node 22, npm, curl, and dnf but no browser or ffmpeg, so the first call
// installs them into ~/.shipvideo on the local disk (about a minute). Only
// the finished MP4 goes to /workspace, the session's shared workspace that
// the OpenComputer files API can list and sign downloads for.

export const WORK = join(homedir(), ".shipvideo");
export const WORKSPACE = "/workspace";
const MARKER = join(WORK, ".ready");

export const WIDTH = 1920;
export const HEIGHT = 1080;

export function run(command: string, options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "/bin/bash",
      ["-lc", command],
      {
        cwd: options.cwd ?? WORK,
        env: { ...process.env, NODE_ENV: "development", npm_config_include: "dev", CI: "1" },
        timeout: options.timeoutMs ?? 300_000,
        maxBuffer: 16_000_000,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string }) | null;
        resolve({ exitCode: typeof err?.code === "number" ? err.code : err ? 1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

const SYSTEM_LIBS =
  "nss nspr atk at-spi2-atk at-spi2-core cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr libXfixes libXext libX11 libxcb mesa-libgbm pango cairo alsa-lib libxshmfence expat google-noto-sans-fonts google-noto-emoji-fonts dejavu-sans-fonts liberation-fonts";

let bootstrapped: Promise<void> | null = null;
export function bootstrap(progress?: (step: string) => void): Promise<void> {
  bootstrapped ??= (async () => {
    if (existsSync(MARKER)) return;
    await mkdir(WORK, { recursive: true });
    progress?.("installing renderer (chromium + ffmpeg)");
    const [npm, libs] = await Promise.all([
      run("npm init -y >/dev/null 2>&1; npm i playwright-core@1 ffmpeg-static --no-audit --no-fund 2>&1 | tail -2 && npx playwright-core install chromium-headless-shell 2>&1 | tail -1", { timeoutMs: 600_000 }),
      run(`command -v dnf >/dev/null && dnf install -y -q ${SYSTEM_LIBS} >/dev/null 2>&1; echo dnf=$?`, { timeoutMs: 600_000 }),
    ]);
    if (npm.exitCode !== 0) throw new Error(`renderer install failed: ${npm.stdout.slice(-800)} ${npm.stderr.slice(-800)}`);
    await writeFile(MARKER, `${new Date().toISOString()} ${libs.stdout.trim()}\n`);
  })().catch((error) => {
    bootstrapped = null;
    throw error;
  });
  return bootstrapped;
}

async function load<T = unknown>(pkg: string): Promise<T> {
  // The renderer packages are CommonJS; require() them through the toolchain
  // directory's own resolution so subpath exports work too.
  const { createRequire } = await import("node:module");
  const req = createRequire(join(WORK, "package.json"));
  const mod = req(pkg);
  const isEsmShim = mod && typeof mod === "object" && mod.__esModule && "default" in mod && Object.keys(mod).length === 1;
  return (isEsmShim ? mod.default : mod) as T;
}

// Injected before any page script. Replaces the page's clocks with a virtual
// one that only moves when the renderer asks for a frame, so rAF loops,
// timers, and CSS/WAAPI animations all land on exact frame boundaries.
export const VIRTUAL_CLOCK = `(() => {
  const EPOCH = Date.now(); let now = 0; let rafs = new Map(); let rafId = 0; const timers = new Map(); let timerId = 0;
  const RealDate = Date;
  performance.now = () => now;
  const FakeDate = function (...args) { return args.length ? new RealDate(...args) : new RealDate(EPOCH + now); };
  FakeDate.now = () => EPOCH + now; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse; FakeDate.prototype = RealDate.prototype;
  window.Date = FakeDate;
  window.requestAnimationFrame = (cb) => { rafs.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  window.setTimeout = (cb, ms = 0, ...args) => { const id = ++timerId; timers.set(id, { at: now + Math.max(0, +ms || 0), cb, args, every: null }); return id; };
  window.setInterval = (cb, ms = 0, ...args) => { const id = ++timerId; const every = Math.max(1, +ms || 1); timers.set(id, { at: now + every, cb, args, every }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  const seen = new WeakMap();
  const step = 1000 / 60;
  window.__seek = (t) => {
    while (now < t - 1e-6) {
      now = Math.min(t, now + step);
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= now + 1e-6 && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        const [id, tm] = next;
        if (tm.every) tm.at += tm.every; else timers.delete(id);
        try { typeof tm.cb === "function" ? tm.cb(...tm.args) : (0, eval)(String(tm.cb)); } catch (e) { console.error("timer callback threw: " + (e && e.message)); }
      }
      const cbs = [...rafs.values()]; rafs = new Map();
      for (const cb of cbs) { try { cb(now); } catch (e) { console.error("requestAnimationFrame callback threw: " + (e && e.message)); } }
    }
    for (const a of document.getAnimations({ subtree: true })) {
      try { let s = seen.get(a); if (s === undefined) { s = now; seen.set(a, s); } a.pause(); a.currentTime = Math.max(0, now - s); } catch (e) {}
    }
    return now;
  };
})();`;

type Page = {
  setContent(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  evaluate<T>(fn: string | ((arg: any) => T), arg?: unknown): Promise<T>;
  screenshot(options: { type: "jpeg" | "png"; quality?: number }): Promise<Buffer>;
  waitForLoadState(state: string, options?: { timeout?: number }): Promise<void>;
  on(event: string, handler: (arg: any) => void): void;
  close(): Promise<void>;
};

let browser: { newContext(o: unknown): Promise<{ addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }>; close(): Promise<void> } | null = null;

async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await load<{ chromium: { launch(o: unknown): Promise<typeof browser> } }>("playwright-core");
  browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none", "--hide-scrollbars", "--force-color-profile=srgb"],
  });
  return browser!;
}

export type LoadedScene = {
  page: Page;
  errors: string[];
  close(): Promise<void>;
};

export async function loadScene(html: string): Promise<LoadedScene> {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: "light" });
  await context.addInitScript(VIRTUAL_CLOCK);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: { type(): string; text(): string }) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("requestfailed", (r: { url(): string; failure(): { errorText: string } | null }) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
  await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => (window as any).__seek(0));
  return {
    page,
    errors,
    close: async () => {
      await context.close();
    },
  };
}

export async function renderMp4(input: {
  html: string;
  durationSeconds: number;
  fps: number;
  outPath: string;
  signal?: AbortSignal;
  onProgress?: (frame: number, total: number) => void;
}) {
  const { spawn } = await import("node:child_process");
  const ffmpegPath = await load<string>("ffmpeg-static");
  if (typeof ffmpegPath !== "string") throw new Error("ffmpeg-static did not resolve to a binary path");
  const scene = await loadScene(input.html);
  const total = Math.round(input.durationSeconds * input.fps);
  const started = Date.now();
  const ff = spawn(ffmpegPath, [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(input.fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    input.outPath,
  ]);
  let ffErr = "";
  ff.stderr.on("data", (d) => { ffErr += String(d); });
  const closed = new Promise<number>((resolve) => ff.on("close", (code) => resolve(code ?? 1)));
  try {
    for (let i = 0; i < total; i++) {
      if (input.signal?.aborted) throw new Error("render aborted");
      await scene.page.evaluate((t: number) => (window as any).__seek(t), (i * 1000) / input.fps);
      const frame = await scene.page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i % Math.max(1, Math.round(input.fps * 3)) === 0) input.onProgress?.(i, total);
    }
  } finally {
    ff.stdin.end();
  }
  const code = await closed;
  await scene.close();
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${ffErr.slice(-1500)}`);
  return { frames: total, renderMs: Date.now() - started, errors: scene.errors };
}


