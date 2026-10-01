import { randomBytes } from "node:crypto";

export type Mode = "url" | "prompt";

export function newJobId(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x").slice(0, 8);
}

// The agent saves each video to the session workspace at this path; the poll
// route signs a download for it, so nothing else stores the MP4.
export function videoPathFor(jobId: string): string {
  return `videos/${jobId}.mp4`;
}

export function jobText(input: { jobId: string; mode: Mode; input: string }): string {
  return [
    "JOB",
    `job_id: ${input.jobId}`,
    `mode: ${input.mode}`,
    `input: ${input.input.replace(/\s*\n\s*/g, " ").trim()}`,
  ].join("\n");
}
