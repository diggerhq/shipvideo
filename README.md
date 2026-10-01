# LaunchVideo (launchvideo.io)

Live: https://launchvideo.io

Paste a URL or a prompt, get a 20 to 40 second launch video. No video model:
Opus 5.5 writes a single HTML film and a serverless agent on OpenComputer
renders it frame by frame in headless Chromium, encodes it with ffmpeg, and
saves the MP4 to the session workspace so it can be downloaded straight away.
Same mechanism as the "Opus 5.5 is incredible at instructional video
generation" demo (Opus wrote JS, rendered via a headless browser + ffmpeg),
packaged behind a one-field form.

```
opencomputer/   the OpenComputer project (one agent, `director`, model anthropic/claude-opus-5.5)
oc-template.toml  one-click deploy manifest
web/            Next.js app: the form and two API routes — no storage of its own
```

## Deploy the agent to your own OpenComputer account

One click: https://app.opencomputer.dev/new?repository-url=https%3A%2F%2Fgithub.com%2Fdiggerhq%2Fshipvideo

Or from a terminal:

```
npx opencomputer template deploy https://github.com/diggerhq/shipvideo
```

The agent works on its own in the playground or the CLI: it writes the MP4 to
`/workspace/videos/<job>.mp4`, the session's shared workspace, and reports the
path. Download it from the session's workspace files in the dashboard, or with
`opencomputer session files download <session-id> videos/<job>.mp4`. The
`web/` frontend adds the form and signs that same file for download.

## How a job flows

1. `POST /api/jobs` validates the input, mints a job id, creates an
   OpenComputer session, waits for `runtime.connected`, and sends one turn
   whose text is a `JOB` block (job id, mode, input).
2. The agent (url mode) fetches the page with `web_fetch`, which also extracts
   title, description, headings, the most used hex colors, and Google Fonts.
3. It writes the film as one HTML document (1920x1080, CSS keyframes or a
   rAF loop), runs `check_scene` (loads it under the virtual clock, reports JS
   errors and the visible text at several timestamps), fixes, then calls
   `render_video`.
4. `render_video` renders every frame with Playwright's arm64 headless shell
   under an injected virtual clock (rAF, timers, Date, and CSS/WAAPI animations
   are all driven by `__seek(t)`), pipes JPEG frames into a static ffmpeg
   (libx264, crf 18, yuv420p, faststart), and copies the finished MP4 to
   `/workspace/videos/<job>.mp4` in the session workspace.
5. `GET /api/jobs/<id>?session=<sid>` reads the session's events to derive a
   phase, and reports `done` with a signed download URL as soon as
   `POST /sessions/<id>/workspace/download` finds the MP4.

The runtime is a fresh Amazon Linux 2023 arm64 microVM per session (node 22,
dnf, no browser), so the first tool call installs playwright-core, ffmpeg-static,
the Chromium shared libs, and Noto fonts into ~/.shipvideo on the local disk
(about a minute). Rendering runs at roughly real time: a 30 s film takes 30-40 s.

## Run it

```
npm install && npx opencomputer link --create-project shipvideo && npx opencomputer deploy --watch
cd web && npm install && vercel link && vercel env pull .env.local
# add to web/.env.local: OPENCOMPUTER_API_KEY=... and OC_AGENT_ID=shipvideo@development
cd web && npm run dev
```

That is the whole setup: the web app needs nothing but the OpenComputer API
key. No object storage, no tokens to hand the agent — the video lives in the
session workspace and the API signs a download for it.

## Gotchas

- Turns carry a plain string (`POST /sessions/:id/turns {input}`), so the job
  fields ride in the prompt text and the model copies the job id into
  `render_video`.
- No `<video>`, `<audio>`, `<iframe>`, CSS transitions, `Math.random`, or
  external images in a scene; the tools reject the first three and the prompt
  forbids the rest so renders stay deterministic.
- `@sparticuz/chromium` does not ship arm64 builds; Playwright's
  `chromium-headless-shell` does, and needs the dnf libs listed in
  `opencomputer/agents/director/tools/renderer.ts`.
