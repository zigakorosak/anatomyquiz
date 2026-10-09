// Free-explore, laid out like GeoQuiz's map explore: straight into the 3D
// view, "Tap a bone" in the header with Subjects, Random and the ☰ menu, and
// an info card floating over the top of the view. Hover shows a name
// tooltip; no quiz mechanics.
//
// Subjects opens a popup in the middle of the screen, one row per subject,
// each with a button cycling its mode (MODES): Off (not drawn), Outline
// (a translucent ghost, as outside the region in games), Visible (solid,
// not clickable) and Clickable (solid and clickable). Bones start
// Clickable, everything else Off.
// - Bones card: name, group, Latin, synonyms, side.
// - Muscle attachments card: muscle and role, Latin, bone, action, side.

import { buildQuizItems, displayLatin, displayName, INSERTIONS_MODEL_URL } from "../core/dataset.js";
import { subjects } from "../core/subjects.js";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { credits } from "./credits.js";
import { h } from "./dom.js";
import { createHamburgerMenu } from "./hamburgerMenu.js";
import { createViewTools } from "./viewTools.js";

const SIDE = { left: "Left", right: "Right" };

// A subject's modes, in the order its button cycles through them.
const MODES = [
  { id: "off", label: "Off" },
  { id: "outline", label: "Outline" },
  { id: "visible", label: "Visible" },
  { id: "clickable", label: "Clickable" },
];
const nextMode = (id) => MODES[(MODES.findIndex((m) => m.id === id) + 1) % MODES.length].id;

// How each subject appears in Explore. A new subject (muscles, …) adds an
// entry here as well as in core/subjects.js.
const EXPLORE = {
  bones: {
    noun: "bone",
    meshIds: (viewer) => viewer.meshIds,
    prepare: async () => {},
    // The ossicles sit inside the temporal bone; Random would frame a bone
    // you can't see.
    randomPool: (items) => items.filter((i) => !i.groups.includes("Auditory ossicles")),
    frame: (viewer, item) => viewer.frame(item.meshIds, { direction: "outward", minRadius: 0.12, padding: 1.8 }),
  },
  attachments: {
    noun: "attachment",
    meshIds: (viewer) => viewer.patchIds,
    prepare: (viewer) => viewer.loadInsertions(INSERTIONS_MODEL_URL),
    randomPool: (items) => items,
    frame: (viewer, item) => {
      const view = viewer.faceOn(item);
      viewer.frame(view.ids, { direction: view.direction, minRadius: 0.06, padding: 1.8 });
    },
  },
};

export function renderExplore(root, navigate) {
  const screen = h("div.game-screen");
  const label = h("span.explore-label", {}, "Tap a bone");
  const randomButton = h("button.action-button", { type: "button", disabled: true }, "Random");
  const menu = createHamburgerMenu(
    screen,
    [
      h(
        "button.exit-button",
        { type: "button", onclick: () => viewer?.frame(null, { direction: SkeletonViewer.FRONT }) },
        "Reset view",
      ),
      h("button.exit-button", { type: "button", onclick: () => navigate("home") }, "Home"),
    ],
    { label: "Explore menu" },
  );

  // Subjects popup: one row per subject with its mode button. Stays open
  // while cycling modes; Done, Escape or a click outside the panel closes it.
  const mode = Object.fromEntries(Object.values(subjects).map((s) => [s.id, s.id === "bones" ? "clickable" : "off"]));
  const modeButtons = Object.values(subjects).map((s) =>
    h("button.subject-mode", { type: "button", dataset: { subject: s.id } }),
  );
  const showMode = (button) => {
    const m = mode[button.dataset.subject];
    button.dataset.mode = m;
    button.textContent = MODES.find((x) => x.id === m).label;
  };
  modeButtons.forEach(showMode);
  const subjectToggle = h("button.exit-button", { type: "button", "aria-haspopup": "dialog" }, "Subjects");
  const subjectPopup = h(
    "div.subject-popup-backdrop",
    { hidden: true },
    h(
      "div.subject-popup",
      { role: "dialog", "aria-label": "Subjects" },
      h("div.subject-popup-title", {}, "Subjects"),
      h(
        "div.subject-rows",
        {},
        Object.values(subjects).map((s, i) => h("div.subject-row", {}, h("span", {}, s.label), modeButtons[i])),
      ),
      h("p.subject-popup-hint", {}, "Off · Outline · Visible · Clickable: press to change."),
      h("button.action-button", { type: "button", onclick: () => setPopupOpen(false) }, "Done"),
    ),
  );
  const setPopupOpen = (open) => (subjectPopup.hidden = !open);
  subjectToggle.addEventListener("click", () => setPopupOpen(true));
  subjectPopup.addEventListener("click", (e) => {
    if (e.target === subjectPopup) setPopupOpen(false);
  });
  const onKey = (e) => {
    if (e.key === "Escape" && !subjectPopup.hidden) setPopupOpen(false);
  };
  document.addEventListener("keydown", onKey);

  const stage = h("div.stage");
  const loading = h("div.stage-loading", {}, "Loading skeleton…");
  const card = h("div.explore-card", { hidden: true });
  const tooltip = h("div.tooltip", { hidden: true });

  screen.append(
    h("div.game-header", {}, label, subjectToggle, randomButton, menu),
    h(
      "div.round-area",
      {},
      h(
        "div.viewer-area",
        {},
        stage,
        loading,
        h("div.map-overlay", {}, card),
        tooltip,
        credits({ overlay: true }),
      ),
    ),
    subjectPopup,
  );
  root.append(screen);

  let left = false;
  let viewer;
  let viewTools = null;
  let selected = null;
  let mouse = { x: 0, y: 0 };
  const onMove = (e) => (mouse = { x: e.clientX, y: e.clientY });
  stage.addEventListener("pointermove", onMove);

  // Per subject, once loaded: its items (tagged with the subject) and a
  // mesh id -> item map.
  const loaded = new Map();
  const ids = (m) => Object.keys(mode).filter((id) => mode[id] === m && loaded.has(id));
  const itemOf = (meshId) => {
    for (const id of ids("clickable")) if (loaded.get(id).byMesh.has(meshId)) return loaded.get(id).byMesh.get(meshId);
    return null;
  };

  async function loadSubject(id) {
    if (loaded.has(id)) return;
    const data = await subjects[id].load();
    await EXPLORE[id].prepare(viewer);
    const items = buildQuizItems(data.items, { sides: "match" }).map((i) => ({ ...i, subject: id }));
    loaded.set(id, { items, byMesh: new Map(items.flatMap((i) => i.meshIds.map((m) => [m, i]))) });
  }

  // Draws each subject in its mode: Off hidden, Outline muted (the
  // default for anything neither playable nor backdrop), Visible as a
  // solid backdrop, Clickable playable.
  function apply() {
    const meshes = (m) => ids(m).flatMap((id) => EXPLORE[id].meshIds(viewer));
    viewer.showPatches(loaded.has("attachments"));
    viewer.setHidden(meshes("off"));
    viewer.setBackdrop(meshes("visible"));
    viewer.setPlayable(meshes("clickable"));
    const nouns = ids("clickable").map((id) => EXPLORE[id].noun);
    label.textContent = nouns.length
      ? `Tap ${/^[aeiou]/.test(nouns[0]) ? "an" : "a"} ${nouns.join(" or ")}`
      : "Nothing clickable";
    randomButton.disabled = !nouns.length;
    if (selected && mode[selected.subject] !== "clickable") select(null);
  }

  function showInfo(item) {
    if (!item) {
      card.hidden = true;
      card.replaceChildren();
      return;
    }
    if (item.subject === "attachments") {
      const bones = [...new Set(item.members.map((m) => displayName(m.bone)))];
      const facts = [
        ["Latin", displayLatin(item)],
        [bones.length > 1 ? "Bones" : "Bone", bones.join(", ")],
        ["Action", item.action],
        ["Side", SIDE[item.side]],
      ].filter(([, v]) => v);
      card.replaceChildren(
        h("div.explore-card-title", {}, displayName(item)),
        h("dl.explore-card-facts", {}, facts.flatMap(([t, v]) => [h("dt", {}, t), h("dd", {}, v)])),
      );
      card.hidden = false;
      return;
    }
    // The broadest named group under "Skeletal system" and the nearest
    // one, e.g. "Bones of upper limb · Bones of free part of upper limb".
    const groups = item.groups.slice(0, -1);
    const sub = [...new Set([groups.at(-1), groups[0]])].filter(Boolean).join(" · ");
    const facts = [
      ["Latin", displayLatin(item)],
      ["Also", item.synonyms.join(", ")],
      ["Side", SIDE[item.side]],
    ].filter(([, v]) => v);
    // (replaceChildren would print a null as "null": MISTAKES.md.)
    card.replaceChildren(
      ...[
        h("div.explore-card-title", {}, displayName(item)),
        sub && h("div.explore-card-sub", {}, sub),
        h("dl.explore-card-facts", {}, facts.flatMap(([t, v]) => [h("dt", {}, t), h("dd", {}, v)])),
      ].filter(Boolean),
    );
    card.hidden = false;
  }

  function select(item) {
    if (selected) viewer.setState(selected.meshIds, null);
    selected = item;
    if (item) viewer.setState(item.meshIds, "selected");
    showInfo(item);
  }

  modeButtons.forEach((button) =>
    button.addEventListener("click", async () => {
      const id = button.dataset.subject;
      if (!viewer || button.disabled) return;
      const next = nextMode(mode[id]);
      if (next !== "off" && !loaded.has(id)) {
        button.disabled = true; // while its data and model load
        button.textContent = "Loading…";
        try {
          await loadSubject(id);
        } finally {
          button.disabled = false;
        }
        if (left) return;
      }
      mode[id] = next;
      showMode(button);
      apply();
    }),
  );

  (async () => {
    viewer = await getViewer(stage);
    if (left) return;
    await loadSubject("bones");
    if (left) return;
    loading.remove();
    viewer.frame(null, { direction: SkeletonViewer.FRONT });
    apply();
    // Layers are measured on, and peel, the bones only; attachment patches
    // stay solid and clickable (see game.js). The cut spans the skeleton.
    viewTools = createViewTools(viewer, { layerIds: viewer.meshIds, cutIds: viewer.meshIds });
    stage.parentElement.append(viewTools.el);
    viewer.onPick((id) => select(id ? itemOf(id) : null));
    viewer.onHover((id) => {
      const item = id ? itemOf(id) : null;
      tooltip.hidden = !item;
      if (!item) return;
      const rect = stage.getBoundingClientRect();
      tooltip.textContent = displayName(item);
      tooltip.style.left = `${mouse.x - rect.left + 14}px`;
      tooltip.style.top = `${mouse.y - rect.top + 14}px`;
    });
    randomButton.addEventListener("click", () => {
      const pool = ids("clickable").flatMap((id) => EXPLORE[id].randomPool(loaded.get(id).items));
      if (!pool.length) return;
      const item = pool[Math.floor(Math.random() * pool.length)];
      select(item);
      // Extra padding: the info card covers the top of the view.
      EXPLORE[item.subject].frame(viewer, item);
    });
  })().catch((err) => {
    console.error(err);
    loading.textContent = "Couldn't load the skeleton. Try reloading the page.";
  });

  return () => {
    left = true;
    document.removeEventListener("keydown", onKey);
    viewTools?.dispose();
    stage.removeEventListener("pointermove", onMove);
    viewer?.reset();
  };
}
