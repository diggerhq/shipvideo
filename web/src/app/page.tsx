"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Examples } from "./examples";
import { Technical } from "./technical";
import { AfterVideo, Nav } from "./cta";
import { DEPLOY_URL, DOCS, DOCS_URL, REPO_URL } from "@/lib/links";
import { RunReceipt, RunTimeline, type Run } from "./run";

type Mode = "url" | "prompt";
type Job = { jobId: string; sessionId: string; mode: Mode; input: string; startedAt: number };
type Poll = { status: "working" | "done" | "error"; phase?: string; videoUrl?: string; message?: string; note?: string; run?: Run };

const STORAGE = "launchvideo:job";
const EXAMPLES: Record<Mode, string> = {
  url: "https://opencomputer.dev",
  prompt: "A modern, slick, punchy launch video for a startup that does LLM inference: first token in 38 ms, 12,000 tokens per second, nothing idle.",
};

function loadJob(): Job | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as Job) : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("url");
  const [input, setInput] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // Runs once on mount to restore a job from the URL or localStorage; the
    // server render has no job, so this has to happen after hydration.
    // ?job=<id>&session=<sid> reopens a job started elsewhere (handy for sharing a link).
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    const sessionId = params.get("session");
    const saved = loadJob();
    const restored = jobId && sessionId ? { jobId, sessionId, mode: "prompt" as Mode, input: "", startedAt: Date.now() } : saved && Date.now() - saved.startedAt < 30 * 60 * 1000 ? saved : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time rehydration after mount
    if (restored) setJob(restored);
  }, []);

  useEffect(() => {
    if (!job) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${job.jobId}?session=${encodeURIComponent(job.sessionId)}`, { cache: "no-store" });
        const data = (await res.json()) as Poll;
        if (stopped) return;
        setPoll(data);
        if (data.status === "working") timer.current = window.setTimeout(tick, 2500);
        else localStorage.removeItem(STORAGE);
      } catch {
        if (!stopped) timer.current = window.setTimeout(tick, 4000);
      }
    };
    tick();
    const clock = window.setInterval(() => setElapsed(Math.floor((Date.now() - job.startedAt) / 1000)), 1000);
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
      window.clearInterval(clock);
    };
  }, [job]);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, input }) });
      const data = (await res.json()) as { jobId?: string; sessionId?: string; error?: string; limited?: boolean };
      setLimited(Boolean(data.limited));
      if (!res.ok || !data.jobId || !data.sessionId) throw new Error(data.error ?? "Could not start");
      const next: Job = { jobId: data.jobId, sessionId: data.sessionId, mode, input, startedAt: Date.now() };
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setPoll(null);
      setElapsed(0);
      setJob(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [mode, input]);

  const reset = () => {
    localStorage.removeItem(STORAGE);
    setJob(null);
    setPoll(null);
    setError(null);
    setLimited(false);
  };

  const working = job && (!poll || poll.status === "working");
  const done = job && poll?.status === "done" && poll.videoUrl;
  const failed = job && poll?.status === "error";

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16 pt-2">
      <div className="w-full max-w-3xl">
        <Nav />
        <header className="mb-10 mt-8">
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-[-0.04em] leading-[0.95]">
            Ship a launch video.
          </h1>
          <p className="mt-5 text-lg text-muted max-w-xl">
            Paste a URL or describe the product. Opus 5.5 writes the film and a serverless agent renders it. About four minutes and roughly 100k tokens per video.
          </p>
          <p className="mt-3 text-sm text-muted">
            Open source. The whole thing is one{" "}
            <a href={DOCS.overview} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">OpenComputer agent</a>
            {" "}and this page; <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">read the code</a> or{" "}
            <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">run your own copy</a>.
          </p>
        </header>

        {!job && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!submitting && input.trim()) submit();
            }}
            className="rounded-2xl border border-line bg-white/[0.02] p-2"
          >
            <div className="flex items-center gap-1 p-1">
              {(["url", "prompt"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? "bg-white text-black" : "text-muted hover:text-foreground"}`}
                >
                  {m === "url" ? "URL" : "Prompt"}
                </button>
              ))}
              <span className="ml-auto font-mono text-[11px] text-muted pr-2">choose one</span>
            </div>
            {mode === "url" ? (
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://yourproduct.com"
                inputMode="url"
                className="w-full bg-transparent px-4 py-4 text-xl outline-none placeholder:text-muted/60"
              />
            ) : (
              <textarea
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Make a modern, slick, punchy video for a startup that works on inference."
                rows={4}
                className="w-full bg-transparent px-4 py-4 text-xl outline-none resize-none placeholder:text-muted/60"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && input.trim()) submit();
                }}
              />
            )}
            <div className="flex items-center justify-between gap-3 p-2 pt-0">
              <button type="button" onClick={() => setInput(EXAMPLES[mode])} className="text-xs text-muted hover:text-foreground px-2">
                try an example
              </button>
              <button
                type="submit"
                disabled={submitting || !input.trim()}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:brightness-110 transition"
              >
                {submitting ? "Starting…" : "Ship it"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-line p-4">
            <p className="text-sm text-red-300">{error}</p>
            {limited && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90">Deploy your own copy</a>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-foreground underline underline-offset-4">or read the code first</a>
              </div>
            )}
          </div>
        )}

        {working && (
          <section className="rounded-2xl border border-line p-6">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              <p className="text-lg font-medium">{poll?.phase ?? "Starting the agent"}</p>
              <span className="ml-auto font-mono text-xs text-muted tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
            </div>
            <p className="mt-3 text-sm text-muted break-words">
              {job.mode === "url" ? job.input : job.input.slice(0, 160)}
            </p>
            <RunTimeline run={poll?.run} />
            <p className="mt-4 text-xs text-muted">
              The agent reads the source, writes an HTML film, checks it, renders 30 frames a second in a headless browser, and uploads the MP4. You can leave this tab open.
              The agent is open source: <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">deploy a copy to your own account</a> while you wait.
            </p>
            <button onClick={reset} className="mt-4 text-xs text-muted hover:text-foreground">cancel and start over</button>
          </section>
        )}

        {done && (
          <section>
            <video src={poll.videoUrl} controls autoPlay playsInline className="w-full rounded-2xl border border-line bg-black aspect-video" />
            <div className="mt-4 flex items-center gap-4">
              <a href={poll.videoUrl} download className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">
                Download MP4
              </a>
              <a href={poll.videoUrl} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-foreground">open in new tab</a>
              <button onClick={reset} className="ml-auto text-sm text-muted hover:text-foreground">make another</button>
            </div>
            {poll.note && <p className="mt-4 text-sm text-muted whitespace-pre-wrap">{poll.note.replace(poll.videoUrl ?? "", "").trim()}</p>}
            <RunReceipt run={poll.run} wallSeconds={elapsed} />
            <AfterVideo />
          </section>
        )}

        {failed && (
          <section className="rounded-2xl border border-red-900/60 p-6">
            <p className="text-lg font-medium text-red-300">That one did not ship.</p>
            <p className="mt-2 text-sm text-muted whitespace-pre-wrap">{poll.message}</p>
            <button onClick={reset} className="mt-4 text-sm text-foreground underline underline-offset-4">try again</button>
          </section>
        )}

        <Examples
          onTry={(m, value) => {
            reset();
            setMode(m);
            setInput(value);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />

        <Technical />

        <footer className="mt-14 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-muted">
          <span>a serverless agent on opencomputer.dev · anthropic/claude-opus-5.5 · no video model</span>
          <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">deploy</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">github</a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">docs</a>
        </footer>
      </div>
    </main>
  );
}
