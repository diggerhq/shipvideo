// Two cheap guards so a public form cannot run up the OpenComputer bill:
// a per-IP limiter and a global daily cap, both in-process (per function
// instance; Fluid compute keeps instances warm so they are meaningfully
// sticky, and racy by design — soft ceilings, not accounting).
// The Vercel Firewall rate-limit rule on POST /api/jobs is the hard layer.

const PER_IP_PER_HOUR = Number(process.env.JOBS_PER_IP_PER_HOUR ?? 3);
const PER_DAY = Number(process.env.JOBS_PER_DAY ?? 60);

const ipHits = new Map<string, number[]>();

export function ipAllowed(ip: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < hour);
  if (hits.length >= PER_IP_PER_HOUR) {
    return { ok: false, retryAfterSeconds: Math.ceil((hits[0] + hour - now) / 1000) };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear();
  return { ok: true };
}

const dayHits = new Map<string, number>();

export function dailyAllowed(): Promise<{ ok: true; used: number } | { ok: false; used: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const used = dayHits.get(day) ?? 0;
  if (used >= PER_DAY) return Promise.resolve({ ok: false, used });
  dayHits.clear();
  dayHits.set(day, used + 1);
  return Promise.resolve({ ok: true, used: used + 1 });
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return (request.headers.get("x-real-ip") ?? fwd.split(",")[0] ?? "unknown").trim() || "unknown";
}
