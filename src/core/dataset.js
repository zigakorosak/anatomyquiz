// The skeleton dataset: quiz items (public/data/skeleton.json) and the 3D
// model (public/data/skeleton.glb), both generated — see DESIGN.md "Data
// pipeline". Every fetch is BASE_URL-prefixed so it works under /anatomyquiz/.

// `?.` so the module also loads outside Vite (Node logic checks).
const BASE = import.meta.env?.BASE_URL ?? "/";

export const MODEL_URL = `${BASE}data/skeleton.glb`;
export const INSERTIONS_MODEL_URL = `${BASE}data/insertions.glb`;

const fetchJson = (file) =>
  fetch(`${BASE}data/${file}`).then((r) => {
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  });

let cache = null;
let insertionsCache = null;

export function loadSkeletonData() {
  cache ??= fetchJson("skeleton.json");
  return cache;
}

/**
 * Muscle-attachment patches (public/data/insertions.json), each with
 * `bone` set to its host bone's raw item from skeleton.json. Also returns
 * the bones, which the attachments screens draw as a backdrop.
 */
export function loadInsertionData() {
  insertionsCache ??= Promise.all([fetchJson("insertions.json"), loadSkeletonData()]).then(
    ([insertions, skeleton]) => {
      const bones = new Map(skeleton.items.map((b) => [b.id, b]));
      return {
        items: insertions.items.map((p) => ({ ...p, bone: bones.get(p.host) })),
        bones: skeleton.items,
      };
    },
  );
  return insertionsCache;
}

/**
 * Turns raw per-mesh items into quiz items.
 *
 * Raw items sharing a name are one quiz item that owns all their meshes.
 * With sides "ignore", that's both sides ("Femur": either femur counts).
 * With sides "match", each side is its own item ("Femur (left)"). A muscle
 * attached in several places ("Diaphragm — origin", parts 1–6 on each side)
 * is one item either way. `members` keeps the raw items merged into it.
 */
export function buildQuizItems(rawItems, { sides }) {
  const merged = new Map();
  for (const i of rawItems) {
    const key = sides === "match" ? `${i.name}|${i.side ?? ""}` : i.name;
    const existing = merged.get(key);
    if (existing) {
      existing.meshIds.push(i.id);
      existing.members.push(i);
    } else {
      merged.set(key, {
        ...i,
        key,
        side: sides === "match" ? i.side : null,
        meshIds: [i.id],
        members: [i],
      });
    }
  }
  return [...merged.values()];
}

const SIDE_LABEL = { left: "left", right: "right" };

export function displayName(item) {
  return item.side ? `${item.name} (${SIDE_LABEL[item.side]})` : item.name;
}

export function displayLatin(item) {
  return item.side ? `${item.latin} (${SIDE_LABEL[item.side]})` : item.latin;
}
