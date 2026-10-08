// Free-explore, laid out like GeoQuiz's map explore: straight into the 3D
// view, "Tap a bone" in the header with Subjects, Random and the ☰ menu, and
// an info card floating over the top of the view. Hover shows a name
// tooltip; no quiz mechanics.
//
// Subjects is a dropdown of toggles (bones on to start): any mix can be on.
// - Bones on: every bone clickable; card: name, group, Latin, synonyms, side.
// - Muscle attachments on: every patch clickable; card: muscle and role,
//   Latin, bone, action, side. With bones off, the bones stay as a solid,
//   unclickable backdrop for them.
// - Nothing on: everything ghosts.

import { buildQuizItems, displayLatin, displayName, INSERTIONS_MODEL_URL } from "../core/dataset.js";
import { subjects } from "../core/subjects.js";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { credits } from "./credits.js";
import { h } from "./dom.js";
import { createHamburgerMenu } from "./hamburgerMenu.js";
import { createViewTools } from "./viewTools.js";

const SIDE = { left: "Left", right: "Right" };

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

  // Subjects dropdown: one checkbox per subject. Unlike ☰ it stays open
  // while toggling; a click elsewhere on the screen closes it.
  const enabled = new Set(["bones"]);
  const checkboxes = Object.values(subjects).map((s) =>
    h("input", { type: "checkbox", checked: enabled.has(s.id), dataset: { subject: s.id } }),
  );
  const subjectList = h(
    "div.game-menu-dropdown.subject-list",
    { hidden: true },
    Object.values(subjects).map((s, i) => h("label.subject-option", {}, checkboxes[i], h("span", {}, s.label))),
  );
  const subjectToggle = h(
    "button.exit-button.game-menu-toggle",
    { type: "button", "aria-expanded": "false" },
    "Subjects",
  );
  const subjectMenu = h("div.game-menu.subject-menu", {}, subjectToggle, subjectList);
  const setListOpen = (open) => {
    subjectList.hidden = !open;
    subjectToggle.setAttribute("aria-expanded", String(open));
  };
  subjectToggle.addEventListener("click", () => setListOpen(subjectList.hidden));
  screen.addEventListener("click", (e) => {
    if (!subjectMenu.contains(e.target)) setListOpen(false);
  });

  const stage = h("div.stage");
  const loading = h("div.stage-loading", {}, "Loading skeleton…");
  const card = h("div.explore-card", { hidden: true });
  const tooltip = h("div.tooltip", { hidden: true });

  screen.append(
    h("div.game-header", {}, label, subjectMenu, randomButton, menu),
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
  const itemOf = (meshId) => {
    for (const [id, l] of loaded) if (enabled.has(id) && l.byMesh.has(meshId)) return l.byMesh.get(meshId);
    return null;
  };

  async function loadSubject(id) {
    if (loaded.has(id)) return;
    const data = await subjects[id].load();
    await EXPLORE[id].prepare(viewer);
    const items = buildQuizItems(data.items, { sides: "match" }).map((i) => ({ ...i, subject: id }));
    loaded.set(id, { items, byMesh: new Map(items.flatMap((i) => i.meshIds.map((m) => [m, i]))) });
  }

  // Shows the enabled subjects: their meshes clickable, the bones as a solid
  // backdrop when only other subjects are on, everything ghosted when none.
  function apply() {
    const on = [...enabled];
    viewer.showPatches(enabled.has("attachments"));
    viewer.setBackdrop(!enabled.has("bones") && on.length ? viewer.meshIds : []);
    viewer.setPlayable(on.flatMap((id) => EXPLORE[id].meshIds(viewer)));
    const nouns = on.map((id) => EXPLORE[id].noun);
    label.textContent = nouns.length
      ? `Tap ${/^[aeiou]/.test(nouns[0]) ? "an" : "a"} ${nouns.join(" or ")}`
      : "Nothing selected";
    randomButton.disabled = !on.length;
    if (selected && !enabled.has(selected.subject)) select(null);
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

  checkboxes.forEach((box) =>
    box.addEventListener("change", async () => {
      const id = box.dataset.subject;
      if (!viewer) return void (box.checked = enabled.has(id));
      if (box.checked) {
        box.disabled = true; // while its data and model load
        try {
          await loadSubject(id);
        } finally {
          box.disabled = false;
        }
        if (left) return;
        enabled.add(id);
      } else enabled.delete(id);
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
      const pool = [...enabled].flatMap((id) => EXPLORE[id].randomPool(loaded.get(id).items));
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
    viewTools?.dispose();
    stage.removeEventListener("pointermove", onMove);
    viewer?.reset();
  };
}
