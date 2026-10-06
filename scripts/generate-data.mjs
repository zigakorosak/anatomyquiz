// Builds public/data/skeleton.json (quiz items) from:
//   data/skeleton-objects.json — written by scripts/export-skeleton.py (Blender)
//   reference/…/Translations0.txt — Z-Anatomy's name table (English, Latin,
//     French, Spanish, Portuguese, each followed by a %-separated synonyms column)
//
// Run with `npm run generate-data`. See DESIGN.md "Data pipeline".

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OBJECTS = join(ROOT, "data", "skeleton-objects.json");
const TRANSLATIONS = join(
  ROOT,
  "reference/Z-Anatomy-PC-Version/Z-Anatomy PC/Assets/Resources/Translations0.txt",
);
const OUT = join(ROOT, "public", "data", "skeleton.json");

function loadTranslations() {
  const rows = new Map();
  const lines = readFileSync(TRANSLATIONS, "utf8").split(/\r?\n/).slice(1);
  for (const line of lines) {
    const f = line.split(";");
    if (f.length < 3 || !f[0].trim()) continue;
    const key = f[0].trim().toLowerCase();
    if (rows.has(key)) continue; // first entry wins
    const syn = (s) =>
      (s ?? "")
        .split("%")
        .map((x) => x.trim())
        .filter(Boolean);
    rows.set(key, {
      name: f[0].trim(),
      synonyms: syn(f[1]),
      latin: (f[2] ?? "").trim(),
      latinSynonyms: syn(f[3]),
    });
  }
  return rows;
}

const stripGroup = (n) => n.replace(/\.g$/, "");
const SIDES = { l: "left", r: "right" };

function splitSide(objectName) {
  const m = objectName.match(/^(.*)\.([lr])$/);
  return m ? { base: m[1], side: SIDES[m[2]] } : { base: objectName, side: null };
}

function tissue(materials) {
  if (materials.includes("tooth")) return "tooth";
  if (materials.includes("bone")) return "bone";
  return "cartilage";
}

const translations = loadTranslations();
const objects = JSON.parse(readFileSync(OBJECTS, "utf8"));
const missing = [];

function lookup(name) {
  const t = translations.get(name.toLowerCase());
  if (!t) missing.push(name);
  return t ?? { name, synonyms: [], latin: "", latinSynonyms: [] };
}

const items = objects.map((o) => {
  const { base, side } = splitSide(o.name);
  const t = lookup(base);
  return {
    id: o.name,
    name: t.name,
    side,
    latin: t.latin,
    synonyms: t.synonyms,
    latinSynonyms: t.latinSynonyms,
    groups: o.groups.map(stripGroup),
    tissue: tissue(o.materials),
  };
});

const groups = {};
for (const g of new Set(items.flatMap((i) => i.groups))) {
  const t = lookup(g);
  groups[g] = { name: t.name, latin: t.latin };
}

if (missing.length) {
  console.error(`no translation for: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ items, groups }) + "\n");
console.log(`wrote ${OUT}: ${items.length} items, ${Object.keys(groups).length} groups`);
