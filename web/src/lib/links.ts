export const REPO_URL = "https://github.com/diggerhq/shipvideo";
export const DEPLOY_URL = `https://app.opencomputer.dev/new?repository-url=${encodeURIComponent(REPO_URL)}`;
export const SIGNUP_URL = "https://app.opencomputer.dev";
export const DOCS_URL = "https://docs.opencomputer.dev/agents/quickstart";
export const CLI_COMMAND = "npx opencomputer template deploy https://github.com/diggerhq/shipvideo";

// Docs pages for the concepts the site mentions. Every link points at a page
// that exists today; check before adding one.
export const DOCS = {
  overview: "https://docs.opencomputer.dev/agents/overview",
  quickstart: DOCS_URL,
  mentalModel: "https://docs.opencomputer.dev/agents/mental-model",
  tools: "https://docs.opencomputer.dev/agents/tools",
  sessions: "https://docs.opencomputer.dev/agents/sessions",
  events: "https://docs.opencomputer.dev/agents/events",
  models: "https://docs.opencomputer.dev/agents/models",
  byok: "https://docs.opencomputer.dev/agents/byok",
  secrets: "https://docs.opencomputer.dev/agents/secrets",
  deployments: "https://docs.opencomputer.dev/agents/deployments",
  api: "https://docs.opencomputer.dev/agents/api",
  inputs: "https://docs.opencomputer.dev/agents/inputs",
  playground: "https://docs.opencomputer.dev/agents/playground",
  logs: "https://docs.opencomputer.dev/agents/logs",
} as const;

// Source files on GitHub, so a tool name on the page is one click from its code.
const BLOB = `${REPO_URL}/blob/main`;
export const SOURCE = {
  agent: `${BLOB}/opencomputer/agents/director/agent.ts`,
  web_fetch: `${BLOB}/opencomputer/agents/director/tools/web.ts`,
  check_scene: `${BLOB}/opencomputer/agents/director/tools/scene.ts`,
  render_video: `${BLOB}/opencomputer/agents/director/tools/scene.ts`,
  renderer: `${BLOB}/opencomputer/agents/director/tools/renderer.ts`,
  template: `${BLOB}/oc-template.toml`,
  jobsApi: `${BLOB}/web/src/app/api/jobs/route.ts`,
  pollApi: `${BLOB}/web/src/app/api/jobs/%5Bid%5D/route.ts`,
} as const;

export function sourceFor(tool: string): string | null {
  return (SOURCE as Record<string, string>)[tool] ?? null;
}
