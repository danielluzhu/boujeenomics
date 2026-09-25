import { Database } from "bun:sqlite";
import raw from "../data/assets.json";
import rawItems from "../data/items.json";
import { seedCatalogue } from "./catalogue";

export const DB_PATH = process.env.BOUJEE_DB ?? "boujee.db";

export type Confidence = "high" | "medium" | "estimated" | "modelled";
export type ItemKind = "retail" | "resale";

export interface AssetRow {
  id: string;
  name: string;
  class: "traditional" | "luxury" | "benchmark";
  blurb: string;
  source: string;
  confidence: Confidence;
  caveat: string;
}

/** Build the database from data/assets.json. Idempotent: drops and reseeds. */
export function seed(path = DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    DROP TABLE IF EXISTS returns;
    DROP TABLE IF EXISTS assets;
    DROP TABLE IF EXISTS meta;
    CREATE TABLE assets (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      class      TEXT NOT NULL CHECK (class IN ('traditional','luxury','benchmark')),
      blurb      TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','estimated')),
      caveat     TEXT NOT NULL DEFAULT '',
      ord        INTEGER NOT NULL
    );
    CREATE TABLE returns (
      asset_id TEXT NOT NULL REFERENCES assets(id),
      year     INTEGER NOT NULL,
      pct      REAL NOT NULL,
      PRIMARY KEY (asset_id, year)
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    -- A specific model (a Daytona, a Birkin) priced at anchor years rather than annually.
    -- Created IF NOT EXISTS and never dropped: reseeding replaces only the rows this file
    -- owns (origin='seed'), so models people add through the app survive it.
    CREATE TABLE IF NOT EXISTS items (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      ref         TEXT NOT NULL DEFAULT '',
      brand       TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES assets(id),
      kind        TEXT NOT NULL CHECK (kind IN ('retail','resale')),
      blurb       TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL DEFAULT '',
      confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','estimated','modelled')),
      caveat      TEXT NOT NULL DEFAULT '',
      origin      TEXT NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','user')),
      created_at  TEXT,
      ord         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS item_prices (
      item_id TEXT NOT NULL REFERENCES items(id),
      year    INTEGER NOT NULL,
      price   REAL NOT NULL,
      PRIMARY KEY (item_id, year)
    );
  `);

  migrateItems(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_origin ON items(origin)");

  // Clear out only the seed-owned rows before reinserting them.
  db.exec(`
    DELETE FROM item_prices WHERE item_id IN (SELECT id FROM items WHERE origin = 'seed');
    DELETE FROM items WHERE origin = 'seed';
  `);

  const insAsset = db.prepare(
    "INSERT INTO assets (id,name,class,blurb,source,confidence,caveat,ord) VALUES (?,?,?,?,?,?,?,?)",
  );
  const insReturn = db.prepare("INSERT INTO returns (asset_id,year,pct) VALUES (?,?,?)");
  const insMeta = db.prepare("INSERT INTO meta (key,value) VALUES (?,?)");

  const first = raw.meta.firstReturnYear;
  const all = [...raw.assets, { ...raw.cpi, class: "benchmark", blurb: "", caveat: "" }];

  db.transaction(() => {
    for (const [i, a] of all.entries()) {
      const cls = (a as any).class ?? "benchmark";
      insAsset.run(a.id, a.name, cls, (a as any).blurb ?? "", a.source, a.confidence, (a as any).caveat ?? "", i);
      a.returns.forEach((pct: number, k: number) => insReturn.run(a.id, first + k, pct));
    }
    for (const [k, v] of Object.entries(raw.meta)) insMeta.run(k, String(v));

    const insItem = db.prepare(
      "INSERT INTO items (id,name,ref,brand,category_id,kind,blurb,source,confidence,caveat,origin,created_at,ord) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const insPrice = db.prepare("INSERT INTO item_prices (item_id,year,price) VALUES (?,?,?)");
    const now = new Date().toISOString();
    for (const [i, it] of rawItems.items.entries()) {
      insItem.run(it.id, it.name, it.ref ?? "", it.brand, it.category, it.kind,
        it.blurb ?? "", it.source ?? "", it.confidence, it.caveat ?? "", "seed", now, i);
      for (const [year, price] of Object.entries(it.points)) insPrice.run(it.id, Number(year), price as number);
    }
  })();

  // The generated catalogue goes in after the curated items, so a hand-sourced entry always
  // wins an id collision with a modelled one.
  const n = seedCatalogue(db, raw.meta.lastYear);
  console.log(`  catalogue: ${n} modelled items`);

  return db;
}

/**
 * Bring an items table created by an earlier schema up to date. SQLite cannot ALTER in a
 * CHECK constraint or a non-constant default, so origin is validated in application code
 * on migrated databases and created_at is written explicitly at insert time.
 */
function migrateItems(db: Database) {
  const have = new Set(
    db.query<{ name: string }, []>("PRAGMA table_info(items)").all().map((r) => r.name),
  );
  if (!have.size) return; // fresh database — CREATE TABLE already produced the full schema
  const add: Record<string, string> = {
    origin: "TEXT NOT NULL DEFAULT 'seed'",
    created_at: "TEXT",
  };
  for (const [col, decl] of Object.entries(add)) {
    if (!have.has(col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} ${decl}`);
  }
}

export function open(path = DB_PATH): Database {
  return new Database(path, { create: false, readonly: true });
}

/** Writable handle — the app accepts new models, so writes need their own connection. */
export function openWritable(path = DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON");
  return db;
}
