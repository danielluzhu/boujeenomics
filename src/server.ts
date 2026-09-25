import { existsSync } from "node:fs";
import { analyse, analyseItems, brands, facets, summarise } from "./analytics";
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

    const byId = url.pathname.match(/^\/api\/items\/([A-Za-z0-9-]{1,80})$/);
    if (byId && req.method === "DELETE") {
      return deleteItem(wdb, byId[1])
        ? json({ ok: true })
        : json({ error: "no such model, or it is part of the shipped catalogue" }, 404);
    }
    if (byId) {
      const q = url.searchParams;
      const page = analyseItems(db, {
        ids: [byId[1]],
        from: clampInt(q.get("from"), 2005, 2005, 2025),
        to: clampInt(q.get("to"), 2025, 2005, 2025),
        withSeries: true,
      });
      return page.items.length ? json(page.items[0]) : json({ error: "no such model" }, 404);
    }

    if (url.pathname === "/api/facets") {
      return json(facets(db));
    }

    if (url.pathname === "/api/brands") {
      const q = url.searchParams;
      return json(brands(db, {
        category: q.get("category") || undefined,
        kind: q.get("kind") || undefined,
      }));
    }

    if (url.pathname === "/api/summary") {
      const q = url.searchParams;
      return json(summarise(db, {
        from: clampInt(q.get("from"), 2005, 2005, 2025),
        to: clampInt(q.get("to"), 2024, 2005, 2025),
        real: q.get("real") === "1",
      }));
    }

    if (url.pathname === "/api/items") {
      const q = url.searchParams;
      const kind = q.get("kind");
      const sort = q.get("sort");
      // Series arrays dominate the payload at catalogue scale, so the list omits them;
      // /api/items/:id returns them for the handful of models actually plotted.
      return json(analyseItems(db, {
        from: clampInt(q.get("from"), 2005, 2005, 2025),
        to: clampInt(q.get("to"), 2025, 2005, 2025),
        q: (q.get("q") ?? "").slice(0, 120),
        category: q.get("category") || undefined,
        brand: q.get("brand") || undefined,
        confidence: q.get("confidence") || undefined,
        outcome: q.get("outcome") === "beat" || q.get("outcome") === "lost"
          ? (q.get("outcome") as "beat" | "lost") : undefined,
        kind: kind === "retail" || kind === "resale" ? kind : undefined,
        tracked: q.get("tracked") === "1",
        ids: q.get("ids") ? q.get("ids")!.split(",").filter(Boolean).slice(0, 24) : undefined,
        withSeries: q.get("series") === "1",
        sort: sort === "cagr" || sort === "name" || sort === "price" ? sort : "edge",
        limit: clampInt(q.get("limit"), 25, 1, 100),
        offset: clampInt(q.get("offset"), 0, 0, 100000),
      }));
    }

    if (url.pathname === "/api/provenance") {
      return json(
        db.query("SELECT id,name,class,confidence,source,blurb,caveat FROM assets ORDER BY ord").all(),
      );
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    // Social scrapers need absolute URLs, and the public origin is only knowable per request
    // (this runs behind a proxy), so the page's origin placeholders are filled in on the way out.
    if (path === "/index.html") {
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
      const origin = process.env.PUBLIC_ORIGIN ?? `${proto}://${host}`;
      const html = (await Bun.file("public/index.html").text()).replaceAll("{{ORIGIN}}", origin);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    const file = Bun.file(`public${path}`);
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`boujeenomics on http://localhost:${server.port}`);
