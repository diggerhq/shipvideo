import { NextResponse } from "next/server";
import { events, getSession, type OcEvent } from "@/lib/oc";
import { deleteManifest, findVideo } from "@/lib/jobs";

export const runtime = "nodejs";

type Status = "working" | "done" | "error";
type Step = { callId: string; tool: string; status: "running" | "done" | "failed"; seconds: number | null; detail: string | null };
type Run = { steps: Step[]; modelCalls: number; inputTokens: number; outputTokens: number; model: string | null };

const PHASES: Record<string, string> = {
  web_fetch: "Reading the page",
  check_scene: "Checking the scene",
  render_video: "Rendering frames",
};

// Turn the session's event stream into something a viewer can follow: one row
// per tool call with its duration (from the sandbox timestamps on
// tool.progress), plus the model usage the platform records per turn.
function summarize(list: OcEvent[]): Run {
  const steps = new Map<string, Step & { startedAt?: number }>();
  let modelCalls = 0, inputTokens = 0, outputTokens = 0, model: string | null = null;
  for (const e of list) {
    const d = e.data;
    if (e.type === "tool.started") {
      const callId = String(d.callId ?? e.seq);
      steps.set(callId, { callId, tool: String(d.tool ?? "tool"), status: "running", seconds: null, detail: null });
    } else if (e.type === "tool.progress") {
      const callId = String(d.callId ?? "");
      const step = steps.get(callId);
      const op = d.sandboxOperation as { timestamp?: string } | undefined;
      const ts = op?.timestamp ? Date.parse(op.timestamp) : NaN;
      if (!step) continue;
      if (d.stage === "started" && !Number.isNaN(ts)) step.startedAt = ts;
      if (typeof d.step === "string") step.detail = d.step;
      if ((d.stage === "completed" || d.stage === "failed") && !Number.isNaN(ts) && step.startedAt) step.seconds = Math.round((ts - step.startedAt) / 1000);
    } else if (e.type === "tool.completed" || e.type === "tool.failed") {
      const step = steps.get(String(d.callId ?? ""));
      if (step) {
        step.status = e.type === "tool.completed" ? "done" : "failed";
        if (e.type === "tool.failed" && typeof d.message === "string") step.detail = d.message.slice(0, 160);
      }
    } else if (e.type === "usage.recorded") {
      modelCalls += 1;
      inputTokens += Number(d.inputTokens ?? 0);
      outputTokens += Number(d.outputTokens ?? 0);
      if (typeof d.model === "string") model = d.model.replace(/^openrouter\//, "");
    } else if (e.type === "model.route_resolved" && !model) {
      const eff = d.effective as { model?: string } | undefined;
      if (eff?.model) model = eff.model;
    }
  }
  return {
    steps: [...steps.values()].map((s) => ({ callId: s.callId, tool: s.tool, status: s.status, seconds: s.seconds, detail: s.detail })),
    modelCalls,
    inputTokens,
    outputTokens,
    model,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const jobId = id.replace(/[^a-zA-Z0-9]/g, "");
  const sessionId = new URL(request.url).searchParams.get("session") ?? "";
  if (!jobId || !sessionId) return NextResponse.json({ error: "missing job or session" }, { status: 400 });

  let list: OcEvent[] = [];
  let warning: string | undefined;
  try {
    list = await events(sessionId, 0);
  } catch (error) {
    warning = error instanceof Error ? error.message : "poll failed";
  }
  const run = summarize(list);

  const video = await findVideo(jobId);
  if (video) {
    await deleteManifest(jobId);
    const note = list.findLast((e) => e.type === "message.completed" && typeof e.data.text === "string")?.data.text as string | undefined;
    return NextResponse.json({ status: "done" satisfies Status, phase: "Done", videoUrl: video.url, bytes: video.size, note, run });
  }

  let phase = "Starting the agent";
  let status: Status = "working";
  let message: string | undefined;
  let finalText = "";
  for (const event of list) {
    if (event.type === "runtime.connected") phase = "Thinking about the story";
    if (event.type === "tool.started") phase = PHASES[String(event.data.tool ?? "")] ?? phase;
    if (event.type === "tool.completed" && String(event.data.tool ?? "") === "render_video") phase = "Uploading";
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
      const again = await findVideo(jobId);
      if (again) {
        await deleteManifest(jobId);
        return NextResponse.json({ status: "done", phase: "Done", videoUrl: again.url, bytes: again.size, note: finalText, run });
      }
      status = "error";
      message = finalText ? finalText.slice(0, 500) : "The agent finished without producing a video.";
    }
  }
  if (status === "working" && list.length === 0 && !warning) {
    const session = await getSession(sessionId).catch(() => null);
    if (session && /ended|failed|terminated/i.test(session.status)) {
      status = "error";
      message = `Session ${session.status}.`;
    }
  }
  return NextResponse.json({ status, phase, message, warning, run });
}
