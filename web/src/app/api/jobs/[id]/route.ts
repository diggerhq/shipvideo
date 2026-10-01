import { NextResponse } from "next/server";
import { events, getSession, workspaceDownload } from "@/lib/oc";
import { videoPathFor } from "@/lib/jobs";

export const runtime = "nodejs";

type Status = "working" | "done" | "error";

const PHASES: Record<string, string> = {
  web_fetch: "Reading the page",
  check_scene: "Checking the scene",
  render_video: "Rendering frames",
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const jobId = id.replace(/[^a-zA-Z0-9]/g, "");
  const sessionId = new URL(request.url).searchParams.get("session") ?? "";
  if (!jobId || !sessionId) return NextResponse.json({ error: "missing job or session" }, { status: 400 });

  const video = await workspaceDownload(sessionId, videoPathFor(jobId)).catch(() => null);
  if (video) {
    return NextResponse.json({ status: "done" satisfies Status, phase: "Done", videoUrl: video.url, bytes: video.size });
  }

  let phase = "Starting the agent";
  let status: Status = "working";
  let message: string | undefined;
  let finalText = "";
  try {
    const list = await events(sessionId, 0);
    for (const event of list) {
      if (event.type === "runtime.connected") phase = "Thinking about the story";
      if (event.type === "tool.started") {
        const tool = String(event.data.tool ?? "");
        phase = PHASES[tool] ?? phase;
        if (tool === "render_video") phase = "Rendering frames";
      }
      if (event.type === "tool.completed" && String(event.data.tool ?? "") === "render_video") phase = "Preparing the download";
      if (event.type === "tool.failed") phase = "Fixing a problem";
      if (event.type === "message.completed" && typeof event.data.text === "string") finalText = event.data.text;
      if (event.type === "turn.failed") {
        status = "error";
        message = String(event.data.message ?? "The agent failed.");
      }
      if (event.type === "runtime.disconnected") {
        status = "error";
        message = String(event.data.reason ?? "The agent runtime disconnected.");
      }
      if (event.type === "turn.completed") {
        const again = await workspaceDownload(sessionId, videoPathFor(jobId));
        if (again) {
          return NextResponse.json({ status: "done", phase: "Done", videoUrl: again.url, bytes: again.size, note: finalText });
        }
        status = "error";
        message = finalText ? finalText.slice(0, 500) : "The agent finished without producing a video.";
      }
    }
    if (status === "working" && list.length === 0) {
      const session = await getSession(sessionId).catch(() => null);
      if (session && /ended|failed|terminated/i.test(session.status)) {
        status = "error";
        message = `Session ${session.status}.`;
      }
    }
  } catch (error) {
    return NextResponse.json({ status: "working", phase, warning: error instanceof Error ? error.message : "poll failed" });
  }
  return NextResponse.json({ status, phase, message });
}
