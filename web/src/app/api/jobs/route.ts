import { NextResponse } from "next/server";
import { createSession, createTurn, endSession, waitForRuntime } from "@/lib/oc";
import { jobText, newJobId, type Mode } from "@/lib/jobs";
import { clientIp, dailyAllowed, ipAllowed } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

function validate(body: unknown): { mode: Mode; input: string } {
  const b = (body ?? {}) as { mode?: unknown; input?: unknown };
  const mode: Mode = b.mode === "url" ? "url" : "prompt";
  const input = typeof b.input === "string" ? b.input.trim() : "";
  if (!input) throw new Error(mode === "url" ? "Paste a URL." : "Write a prompt.");
  if (mode === "url") {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      throw new Error("That does not look like a URL.");
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs work.");
    return { mode, input: url.toString() };
  }
  if (input.length > 2000) throw new Error("Keep the prompt under 2000 characters.");
  return { mode, input };
}

export async function POST(request: Request) {
  let job: { mode: Mode; input: string };
  try {
    job = validate(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bad request" }, { status: 400 });
  }
  const ip = ipAllowed(clientIp(request));
  if (!ip.ok) {
    return NextResponse.json(
      { error: `Easy there. You can start a few videos an hour; try again in ${Math.ceil(ip.retryAfterSeconds / 60)} min, or deploy the agent to your own account.` },
      { status: 429, headers: { "retry-after": String(ip.retryAfterSeconds) } },
    );
  }
  const day = await dailyAllowed();
  if (!day.ok) {
    return NextResponse.json({ error: "Today's free videos are all used up. Deploy the agent to your own OpenComputer account and it runs without limits." }, { status: 429 });
  }
  const jobId = newJobId();
  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  try {
    session = await createSession();
    await waitForRuntime(session.id);
    const text = jobText({ jobId, mode: job.mode, input: job.input });
    await createTurn(session.id, text, `job:${jobId}`);
  } catch (error) {
    if (session) await endSession(session.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start the agent" }, { status: 502 });
  }
  return NextResponse.json({ jobId, sessionId: session.id });
}
