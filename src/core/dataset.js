// The skeleton dataset: quiz items (public/data/skeleton.json) and the 3D
// model (public/data/skeleton.glb), both generated — see DESIGN.md "Data
// pipeline". Every fetch is BASE_URL-prefixed so it works under /anatomyquiz/.

// `?.` so the module also loads outside Vite (Node logic checks).
const BASE = import.meta.env?.BASE_URL ?? "/";

export const MODEL_URL = `${BASE}data/skeleton.glb`;

let cache = null;

export function loadSkeletonData() {
  cache ??= fetch(`${BASE}data/skeleton.json`).then((r) => {
    if (!r.ok) throw new Error(`skeleton.json: HTTP ${r.status}`);
    return r.json();
  });
  return cache;
}

/**
 * Turns raw per-mesh items into quiz items.
 *
 * With sides "ignore", a left/right pair becomes one item ("Femur") that owns
 * both meshes — clicking either one counts. With sides "match", each side is
 * its own item ("Femur (left)").
 */
export function buildQuizItems(rawItems, { sides }) {
  if (sides === "match") {
    return rawItems.map((i) => ({ ...i, key: i.id, meshIds: [i.id] }));
  }
  const byName = new Map();
  for (const i of rawItems) {
    const existing = byName.get(i.name);
    if (existing) existing.meshIds.push(i.id);
    else byName.set(i.name, { ...i, key: i.name, side: null, meshIds: [i.id] });
  }
  return [...byName.values()];
}

const SIDE_LABEL = { left: "left", right: "right" };

export function displayName(item) {
  return item.side ? `${item.name} (${SIDE_LABEL[item.side]})` : item.name;
}

export function displayLatin(item) {
  return item.side ? `${item.latin} (${SIDE_LABEL[item.side]})` : item.latin;
}
