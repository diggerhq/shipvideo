"use client";

import { DOCS, SOURCE, sourceFor } from "@/lib/links";

export type Step = { callId: string; tool: string; status: "running" | "done" | "failed"; seconds: number | null; detail: string | null };
export type Run = { steps: Step[]; modelCalls: number; inputTokens: number; outputTokens: number; model: string | null };

const LABELS: Record<string, string> = {
  web_fetch: "read the site",
  check_scene: "checked the scene",
  render_video: "rendered and uploaded",
};

function Ext({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`underline decoration-line underline-offset-4 hover:text-foreground hover:decoration-foreground ${className}`}>
      {children}
    </a>
  );
}

// What the agent is doing right now, one row per tool call, straight from the
// session's event stream. Tool names link to their source.
export function RunTimeline({ run }: { run: Run | undefined }) {
  const steps = run?.steps ?? [];
  return (
    <div className="mt-5 rounded-xl border border-line bg-black/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">session</p>
        <p className="font-mono text-[11px] text-muted">
          {run?.modelCalls ? `${run.modelCalls} model call${run.modelCalls === 1 ? "" : "s"} · ${fmt(run.inputTokens + run.outputTokens)} tokens` : "waiting for the first event"}
        </p>
      </div>
      <ol className="mt-3 space-y-1.5 font-mono text-[12.5px]">
        {steps.length === 0 && <li className="text-muted">Opus 5.5 is writing the film. Tool calls appear here as they happen.</li>}
        {steps.map((s) => {
          const src = sourceFor(s.tool);
          return (
            <li key={s.callId} className="flex items-baseline gap-3">
              <span className={`w-2 shrink-0 ${s.status === "running" ? "text-accent animate-pulse" : s.status === "failed" ? "text-red-400" : "text-muted"}`}>●</span>
              {src ? <Ext href={src} className="text-foreground/90">{s.tool}</Ext> : <span className="text-foreground/90">{s.tool}</span>}
              <span className="truncate text-muted">{s.status === "running" ? s.detail ?? "running" : s.status === "failed" ? `failed: ${s.detail ?? ""}` : LABELS[s.tool] ?? "done"}</span>
              {s.seconds !== null && <span className="ml-auto shrink-0 text-muted">{s.seconds}s</span>}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] text-muted">
        This is the agent&apos;s <Ext href={DOCS.events}>event stream</Ext>, read through the same <Ext href={DOCS.api}>sessions API</Ext> the CLI uses.
      </p>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

// After a video: what it cost and how it was made, with each number linked to
// the part of the platform that produced it.
export function RunReceipt({ run, wallSeconds }: { run: Run | undefined; wallSeconds: number }) {
  if (!run) return null;
  const render = run.steps.find((s) => s.tool === "render_video" && s.seconds !== null);
  const failed = run.steps.filter((s) => s.status === "failed").length;
  const cells: Array<[string, string, string]> = [
    ["wall clock", `${Math.floor(wallSeconds / 60)}m ${wallSeconds % 60}s`, DOCS.sessions],
    ["model calls", String(run.modelCalls), DOCS.models],
    ["tokens", `${fmt(run.inputTokens)} in · ${fmt(run.outputTokens)} out`, DOCS.byok],
    ["tool calls", `${run.steps.length}${failed ? ` (${failed} retried)` : ""}`, DOCS.tools],
    ["render", render ? `${render.seconds}s` : "n/a", SOURCE.renderer],
  ];
  return (
    <div className="mt-5 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">this run</p>
        {run.model && <p className="font-mono text-[11px] text-muted">{run.model}</p>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {cells.map(([k, v, href]) => (
          <div key={k}>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-muted"><Ext href={href}>{k}</Ext></dt>
            <dd className="mt-0.5 text-sm tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-muted">
        Tokens are billed through OpenComputer&apos;s model gateway, or <Ext href={DOCS.byok}>bring your own key</Ext> when you deploy a copy.
      </p>
    </div>
  );
}
