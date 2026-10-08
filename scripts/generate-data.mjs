// Builds the quiz data:
//   public/data/skeleton.json   — bones
//   public/data/insertions.json — muscle attachments (origins and insertions)
// from:
//   data/skeleton-objects.json, data/insertions-objects.json — written by
//     scripts/export-models.py (Blender)
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
const INSERTION_OBJECTS = join(ROOT, "data", "insertions-objects.json");
const INSERTIONS_OUT = join(ROOT, "public", "data", "insertions.json");

// The one attachment muscle with no row in Translations0.txt; its standard
// Terminologia Anatomica Latin name.
const LATIN_OVERRIDES = {
  "Long head of biceps femoris": "Caput longum musculi bicipitis femoris",
};

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

// --- Muscle attachments ---
// Patch names are "<muscle>.<o|e><part?><l|r>": o = origin, e = insertion
// ("End" in the atlas), an optional part number for muscles attached in
// several places, and the side.
const ROLE = { o: "origin", e: "insertion" };
const LATIN_ROLE = { origin: "origo", insertion: "insertio" };
// Z-Anatomy brackets structures that aren't always present; shown plainly.
const unbracket = (s) => s.replace(/^\((.*)\)$/, "$1");
// "End-Flexion fingers" / "Origin-Abduction" / "Origin mastication" → the action.
// The atlas spells some variants two ways ("hand-foot", "mastication").
const action = (material) => {
  const a = material?.replace(/^(Origin|End|Muscular origin)[- ]?/i, "").trim().replace("hand-foot", "hand/foot");
  return a ? a[0].toUpperCase() + a.slice(1) : null;
};

const patches = JSON.parse(readFileSync(INSERTION_OBJECTS, "utf8")).map((o) => {
  const m = o.name.match(/^(.*)\.([oe])(\d*)([lr])$/);
  if (!m) throw new Error(`unexpected attachment name: ${o.name}`);
  const [, muscle, roleCode, part, sideCode] = m;
  const role = ROLE[roleCode];
  const t = translations.get(muscle.toLowerCase());
  const latin = LATIN_OVERRIDES[muscle] ?? t?.latin;
  if (!latin) missing.push(muscle);
  return {
    id: o.name,
    muscle: unbracket(muscle),
    latinMuscle: unbracket(latin ?? ""),
    role,
    // What quiz items display and merge on: "Biceps brachii muscle — insertion".
    name: `${unbracket(muscle)} — ${role}`,
    latin: `${unbracket(latin ?? "")} — ${LATIN_ROLE[role]}`,
    synonyms: [],
    latinSynonyms: [],
    part: part ? Number(part) : null,
    side: SIDES[sideCode],
    host: o.host,
    action: action(o.action),
  };
});
if (missing.length) {
  console.error(`no translation for: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}
const boneIds = new Set(items.map((i) => i.id));
const strays = patches.filter((p) => !boneIds.has(p.host));
if (strays.length) {
  console.error(`attachments on unknown bones: ${strays.map((p) => `${p.id} → ${p.host}`).join(", ")}`);
  process.exit(1);
}
// Every attachment off the midline must exist on both sides with the same
// number of parts (export-models.py corrects the atlas's side labels and
// mirrors one-sided ones; this keeps that from regressing).
const perSide = new Map();
for (const p of patches) {
  const n = perSide.get(p.name) ?? { left: 0, right: 0 };
  n[p.side]++;
  perSide.set(p.name, n);
}
const lopsided = [...perSide].filter(([, n]) => n.left !== n.right);
if (lopsided.length) {
  console.error(`attachments with unequal sides: ${lopsided.map(([k, n]) => `${k} (L${n.left} R${n.right})`).join(", ")}`);
  process.exit(1);
}
writeFileSync(INSERTIONS_OUT, JSON.stringify({ items: patches }) + "\n");
console.log(
  `wrote ${INSERTIONS_OUT}: ${patches.length} patches, ` +
    `${new Set(patches.map((p) => p.name)).size} muscle attachments`,
);
