import type { Database } from "bun:sqlite";

export const MIN_YEAR = 2005;
export const MAX_YEAR = 2025;
const MAX_POINTS = 40;
const MAX_PRICE = 1e12;

export interface NewItem {
  name: string; brand: string; ref?: string; category: string;
  kind: "retail" | "resale"; source?: string; blurb?: string; caveat?: string;
  confidence?: "medium" | "estimated";
  points: Record<string, number> | { year: number; price: number }[];
}

export class ValidationError extends Error {}

const str = (v: unknown, field: string, max: number, required = true): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s && required) throw new ValidationError(`${field} is required`);
  if (s.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return s;
};

/** Stable, readable id; collisions get a numeric suffix rather than overwriting. */
function slug(db: Database, name: string, kind: string): string {
  const base = (name + "-" + kind)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
  const taken = db.prepare("SELECT 1 FROM items WHERE id = ?");
  if (!taken.get(base)) return base;
  for (let i = 2; i < 500; i++) if (!taken.get(`${base}-${i}`)) return `${base}-${i}`;
  throw new ValidationError("could not allocate an id for that name");
}

export function validate(db: Database, body: unknown): Required<Omit<NewItem, "points">> & {
  points: { year: number; price: number }[];
} {
  if (!body || typeof body !== "object") throw new ValidationError("expected a JSON object");
  const b = body as NewItem;

  const name = str(b.name, "Model name", 80);
  const brand = str(b.brand, "Brand", 60);
  const ref = str(b.ref, "Reference", 120, false);
  const source = str(b.source, "Source", 300, false);
  const blurb = str(b.blurb, "Description", 300, false);
  const caveat = str(b.caveat, "Caveat", 500, false);

  const kind = b.kind;
  if (kind !== "retail" && kind !== "resale") throw new ValidationError("kind must be 'retail' or 'resale'");

  const confidence = b.confidence ?? "estimated";
  if (confidence !== "medium" && confidence !== "estimated") {
    throw new ValidationError("confidence must be 'medium' or 'estimated'");
  }

  const category = str(b.category, "Category", 40);
  const known = db.prepare("SELECT 1 FROM assets WHERE id = ? AND class = 'luxury'").get(category);
  if (!known) throw new ValidationError("category must be one of the luxury categories");

  // Accept either {year: price} or [{year, price}].
  const raw = Array.isArray(b.points)
    ? b.points.map((p) => [p?.year, p?.price] as const)
    : Object.entries(b.points ?? {}).map(([y, p]) => [y, p] as const);

  const seen = new Set<number>();
  const points: { year: number; price: number }[] = [];
  for (const [y, p] of raw) {
    const year = Number(y), price = Number(p);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      throw new ValidationError(`years must be whole numbers between ${MIN_YEAR} and ${MAX_YEAR}`);
    }
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      throw new ValidationError("every price must be a positive number");
    }
    if (seen.has(year)) throw new ValidationError(`year ${year} is listed twice`);
    seen.add(year);
    points.push({ year, price });
  }
  if (points.length < 2) throw new ValidationError("give at least two priced years — one point says nothing about a rate of change");
  if (points.length > MAX_POINTS) throw new ValidationError(`at most ${MAX_POINTS} priced years`);
  points.sort((a, b2) => a.year - b2.year);

  return { name, brand, ref, category, kind, source, blurb, caveat, confidence, points };
}

export function insertItem(db: Database, body: unknown): { id: string } {
  const v = validate(db, body);
  const id = slug(db, v.name, v.kind);
  const ord = (db.query<{ m: number }, []>("SELECT COALESCE(MAX(ord), 0) m FROM items").get()?.m ?? 0) + 1;

  db.transaction(() => {
    db.run(
      `INSERT INTO items (id,name,ref,brand,category_id,kind,blurb,source,confidence,caveat,origin,created_at,ord)
       VALUES (?,?,?,?,?,?,?,?,?,?,'user',?,?)`,
      [id, v.name, v.ref, v.brand, v.category, v.kind, v.blurb, v.source, v.confidence, v.caveat,
       new Date().toISOString(), ord],
    );
    const ins = db.prepare("INSERT INTO item_prices (item_id,year,price) VALUES (?,?,?)");
    for (const p of v.points) ins.run(id, p.year, p.price);
  })();

  return { id };
}

/** Only user-contributed rows can be removed; the shipped catalogue is not deletable. */
export function deleteItem(db: Database, id: string): boolean {
  const row = db.query<{ origin: string }, [string]>("SELECT origin FROM items WHERE id = ?").get(id);
  if (!row || row.origin !== "user") return false;
  db.transaction(() => {
    db.run("DELETE FROM item_prices WHERE item_id = ?", [id]);
    db.run("DELETE FROM items WHERE id = ?", [id]);
  })();
  return true;
}
