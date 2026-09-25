import { existsSync } from "node:fs";
import { analyse } from "./analytics";
import { DB_PATH, open, seed } from "./db";

if (!existsSync(DB_PATH)) {
  console.log(`no database at ${DB_PATH} — seeding`);
  seed().close();
}

const db = open();
const PORT = Number(process.env.PORT ?? 4321);

const clampInt = (v: string | null, fallback: number, lo: number, hi: number) => {
  // Number(null) and Number("") are both 0, so an absent param must be rejected before parsing
  // or it silently clamps to the floor instead of falling back.
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : fallback;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/analysis") {
      const q = url.searchParams;
      const from = clampInt(q.get("from"), 2005, 2005, 2025);
      const to = clampInt(q.get("to"), 2024, 2005, 2025);
      if (to <= from) return json({ error: "`to` must be later than `from`" }, 400);
      return json(
        analyse(db, {
          from,
          to,
          real: q.get("real") === "1",
          amount: clampInt(q.get("amount"), 10_000, 1, 1_000_000_000),
        }),
      );
    }

    if (url.pathname === "/api/provenance") {
      return json(
        db.query("SELECT id,name,class,confidence,source,blurb,caveat FROM assets ORDER BY ord").all(),
      );
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`public${path}`);
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`boujeenomics on http://localhost:${server.port}`);
