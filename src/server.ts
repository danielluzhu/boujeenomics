import { existsSync } from "node:fs";
import { analyse, analyseItems } from "./analytics";
import { DB_PATH, open, openWritable, seed } from "./db";
import { ValidationError, deleteItem, insertItem } from "./items-write";

if (!existsSync(DB_PATH)) {
  console.log(`no database at ${DB_PATH} — seeding`);
  seed().close();
}

const db = open();
const wdb = openWritable();
const MAX_BODY = 32 * 1024;
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

    if (url.pathname === "/api/items" && req.method === "POST") {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_BODY) return json({ error: "request body too large" }, 413);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "body must be valid JSON" }, 400);
      }
      try {
        const { id } = insertItem(wdb, body);
        return json({ id }, 201);
      } catch (e) {
        if (e instanceof ValidationError) return json({ error: e.message }, 400);
        console.error("insert failed:", e);
        return json({ error: "could not save that model" }, 500);
      }
    }

    const del = url.pathname.match(/^\/api\/items\/([A-Za-z0-9-]{1,80})$/);
    if (del && req.method === "DELETE") {
      return deleteItem(wdb, del[1])
        ? json({ ok: true })
        : json({ error: "no such model, or it is part of the shipped catalogue" }, 404);
    }

    if (url.pathname === "/api/items") {
      const q = url.searchParams;
      return json(analyseItems(db, {
        from: clampInt(q.get("from"), 2005, 2005, 2025),
        to: clampInt(q.get("to"), 2025, 2005, 2025),
      }));
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
