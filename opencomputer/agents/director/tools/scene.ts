import { defineTool } from "@opencomputer/agent";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HEIGHT, WIDTH, WORK, WORKSPACE, bootstrap, loadScene, renderMp4 } from "./renderer.js";

const MAX_SECONDS = 90;

// Videos land under /workspace/videos so the session's workspace files API
// (and the dashboard / `oc` CLI) can list them and sign a download URL.
function videoWorkspacePath(jobId: string): string {
  return `videos/${jobId}.mp4`;
}

function sceneHtml(input: Record<string, unknown>): string {
  const html = String(input.html ?? "");
  if (html.length < 200) throw new Error("html is too short to be a scene.");
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) throw new Error("html must be a complete document (include <html> and <body>).");
  if (/<(video|audio|iframe)[\s>]/i.test(html)) throw new Error("Scenes cannot use <video>, <audio>, or <iframe>; draw everything with HTML, CSS, SVG, and canvas.");
  return html;
}

export const checkScene = defineTool({
  name: "check_scene",
  description:
    `Load a scene (a complete HTML document, ${WIDTH}x${HEIGHT}) in the renderer's headless browser, seek to the given timestamps under the virtual clock, and report JavaScript errors, failed network requests, and what text is visible at each timestamp. Cheap (a few seconds). Call it before render_video and fix anything it reports.`,
  input: {
    type: "object",
    properties: {
      html: { type: "string", description: "The full HTML document." },
      timestamps: { type: "array", items: { type: "number" }, description: "Seconds to inspect, e.g. [0, 2.5, 6, 12]. Default: every 3 s up to durationSeconds." },
      durationSeconds: { type: "number", minimum: 1, maximum: MAX_SECONDS },
    },
    required: ["html"],
    additionalProperties: false,
  },
  async run({ input, reportProgress }) {
    const html = sceneHtml(input);
    await bootstrap((step) => void reportProgress({ step }));
    const duration = Number(input.durationSeconds ?? 30);
    const stamps = Array.isArray(input.timestamps) && input.timestamps.length
      ? (input.timestamps as number[]).map(Number).filter((t) => t >= 0 && t <= MAX_SECONDS)
      : Array.from({ length: Math.floor(duration / 3) + 1 }, (_, i) => i * 3);
    const scene = await loadScene(html);
    const frames: Array<{ t: number; visibleText: string; bodyBackground: string }> = [];
    try {
      for (const t of stamps) {
        await scene.page.evaluate((ms: number) => (window as any).__seek(ms), t * 1000);
        const snapshot = await scene.page.evaluate(() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          const texts: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n: Node | null;
          while ((n = walker.nextNode())) {
            const s = (n.textContent ?? "").replace(/\s+/g, " ").trim();
            if (!s) continue;
            const el = n.parentElement;
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
            texts.push(s.slice(0, 80));
          }
          return { visibleText: [...new Set(texts)].join(" | ").slice(0, 1200), bodyBackground: getComputedStyle(document.body).backgroundColor };
        });
        frames.push({ t, ...snapshot });
      }
    } finally {
      await scene.close();
    }
    return { ok: scene.errors.length === 0, errors: scene.errors.slice(0, 20), frames };
  },
});

export const renderVideo = defineTool({
  name: "render_video",
  description:
    `Render a scene (a complete HTML document, ${WIDTH}x${HEIGHT}) to an H.264 MP4 under the virtual clock and save it to the session workspace (/workspace). Takes about as long as the video is. Returns the workspace path. Call this once the scene passes check_scene.`,
  input: {
    type: "object",
    properties: {
      html: { type: "string", description: "The full HTML document." },
      durationSeconds: { type: "number", minimum: 3, maximum: MAX_SECONDS, description: "Total length of the video." },
      fps: { type: "integer", enum: [24, 30], description: "Default 30." },
      jobId: { type: "string", description: "job_id from the JOB block; any short name works when there is none." },
    },
    required: ["html", "durationSeconds"],
    additionalProperties: false,
  },
  async run({ input, signal, reportProgress }) {
    const html = sceneHtml(input);
    const jobId = String(input.jobId ?? "video").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!jobId) throw new Error("jobId is required.");
    await bootstrap((step) => void reportProgress({ step }));
    const fps = input.fps === 24 ? 24 : 30;
    const durationSeconds = Math.min(Math.max(Number(input.durationSeconds), 3), MAX_SECONDS);
    const dir = join(WORK, "out");
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, `${jobId}.mp4`);
    const rendered = await renderMp4({
      html,
      durationSeconds,
      fps,
      outPath,
      signal,
      onProgress: (frame, total) => void reportProgress({ step: `rendering ${frame}/${total}` }),
    });
    await reportProgress({ step: "saving to the workspace" });
    // Render on local disk first, then publish the finished file in one copy
    // so the workspace never shows a partial MP4.
    const workspacePath = videoWorkspacePath(jobId);
    const workspaceFile = join(WORKSPACE, workspacePath);
    await mkdir(join(WORKSPACE, "videos"), { recursive: true });
    await copyFile(outPath, workspaceFile);
    const { stat } = await import("node:fs/promises");
    const info = await stat(workspaceFile);
    return {
      path: workspacePath,
      localPath: workspaceFile,
      bytes: info.size,
      durationSeconds,
      fps,
      frames: rendered.frames,
      renderSeconds: Math.round(rendered.renderMs / 1000),
      errors: rendered.errors.slice(0, 20),
      note: `Saved to the session workspace at /workspace/${workspacePath}; download it from the session's workspace files.`,
    };
  },
});
