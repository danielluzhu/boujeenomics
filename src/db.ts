import { Database } from "bun:sqlite";
import raw from "../data/assets.json";

export const DB_PATH = process.env.BOUJEE_DB ?? "boujee.db";

export type Confidence = "high" | "estimated";

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
      confidence TEXT NOT NULL CHECK (confidence IN ('high','estimated')),
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
  })();

  return db;
}

export function open(path = DB_PATH): Database {
  return new Database(path, { create: false, readonly: true });
}
