import { CliCommand, TryCta } from "./cta";
import { DEPLOY_URL } from "@/lib/links";

const AGENT_SNIPPET = `// opencomputer/agents/director/agent.ts
import { useInput, useModel, useTool } from "@opencomputer/agent";
import { checkScene, renderVideo } from "./tools/scene.js";
import { webFetch } from "./tools/web.js";

export default function Agent() {
  const input = useInput();           // the JOB block from the form
  useModel("anthropic/claude-opus-5.5");
  useTool(webFetch);                  // read the product's site
  useTool(checkScene);                // load the HTML, report errors + visible text
  useTool(renderVideo);               // headless Chromium → ffmpeg → /workspace
  return \`You are a motion designer who writes code. ...\`;
}`;

const ROWS: Array<[string, string]> = [
  ["Agent", "One OpenComputer serverless agent, defined in TypeScript and deployed with `opencomputer deploy`. No framework, no queue, no server of ours."],
  ["Model", "anthropic/claude-opus-5.5 through OpenComputer's model gateway. Roughly 90k input and 15k output tokens per film, most of it the HTML itself."],
  ["Runtime", "Every job is one session in a fresh microVM: Amazon Linux 2023 on arm64, 4 vCPU, 8 GB RAM, Node 22. The first tool call installs Playwright's headless Chromium and a static ffmpeg (about a minute); the VM is thrown away after."],
  ["Tools", "Three `defineTool` functions. web_fetch returns page text plus title, headings, the most used hex colors, and Google Fonts. check_scene loads the film and reports JS errors and the visible text at sample timestamps. render_video renders frames to an MP4 in the session workspace."],
  ["Rendering", "No video model. The page's clocks (requestAnimationFrame, timers, Date, CSS and Web Animations) are replaced with a virtual clock, so every frame is a deterministic seek. 1920x1080 at 30 fps, JPEG frames piped into libx264, crf 18."],
  ["Storage", "The agent holds no secrets and no storage of its own. The finished MP4 lands in the session workspace at /workspace/videos/<job>.mp4, and this page asks the OpenComputer API to sign a download URL for it. Nothing to configure."],
  ["Control plane", "This page uses the same API the CLI does: create a session, send one turn, poll the event stream (tool.started, tool.completed, turn.completed) to show progress, and treat the MP4 appearing in the session workspace as done."],
];

export function Technical() {
  return (
    <section className="mt-24 border-t border-line pt-12">
      <p className="font-mono text-xs tracking-[0.2em] uppercase text-muted">how it runs</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">A serverless agent on OpenComputer. Yours in one click.</h2>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        The whole product is one agent file, three tools, and this form. OpenComputer runs the agent, the microVM it renders in, the model gateway, and the session API the page polls.
      </p>
      <dl className="mt-8 grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[140px_1fr]">
        {ROWS.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="font-mono text-xs uppercase tracking-wider text-muted md:pt-0.5">{term}</dt>
            <dd className="text-sm leading-relaxed text-foreground/85">
              {detail.split(/(`[^`]+`)/).map((part, i) =>
                part.startsWith("`") ? (
                  <code key={i} className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
      <pre className="mt-10 overflow-x-auto rounded-xl border border-line bg-white/[0.02] p-5 font-mono text-[12.5px] leading-relaxed text-foreground/85">
        <code>{AGENT_SNIPPET}</code>
      </pre>
      <TryCta />
      <div className="mt-4">
        <CliCommand />
      </div>
      <p className="mt-6 text-sm text-muted">
        Everything above is in the repo, and{" "}
        <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">one click deploys it to your account</a>. The idea comes from{" "}
        <a href="https://x.com/deedydas/status/2102787937482252537" className="text-foreground underline underline-offset-4" target="_blank" rel="noreferrer">Deedy's post</a>{" "}
        on Opus 5.5 and instructional video: the model writes the film as code, and code renders the same every time.
      </p>
    </section>
  );
}
