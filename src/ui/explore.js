// Free-explore, laid out like GeoQuiz's map explore: "Tap a bone" in the
// header with Random and the ☰ menu, and an info card floating over the
// top of the 3D view (name, group, Latin name, synonyms, side). Hover shows
// a name tooltip; no quiz mechanics.

import { buildQuizItems, displayLatin, displayName, loadSkeletonData } from "../core/dataset.js";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { credits } from "./credits.js";
import { h } from "./dom.js";
import { createHamburgerMenu } from "./hamburgerMenu.js";

const SIDE = { left: "Left", right: "Right" };

export function renderExplore(root, navigate) {
  const screen = h("div.game-screen");
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
  const stage = h("div.stage");
  const loading = h("div.stage-loading", {}, "Loading skeleton…");
  const card = h("div.explore-card", { hidden: true });
  const tooltip = h("div.tooltip", { hidden: true });

  screen.append(
    h("div.game-header", {}, h("span.explore-label", {}, "Tap a bone"), randomButton, menu),
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
  let selected = null;
  let mouse = { x: 0, y: 0 };
  const onMove = (e) => (mouse = { x: e.clientX, y: e.clientY });
  stage.addEventListener("pointermove", onMove);

  function showInfo(item) {
    if (!item) {
      card.hidden = true;
      card.replaceChildren();
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
    card.replaceChildren(
      h("div.explore-card-title", {}, displayName(item)),
      sub ? h("div.explore-card-sub", {}, sub) : null,
      h("dl.explore-card-facts", {}, facts.flatMap(([t, v]) => [h("dt", {}, t), h("dd", {}, v)])),
    );
    card.hidden = false;
  }

  function select(item) {
    if (selected) viewer.setState(selected.meshIds, null);
    selected = item;
    if (item) viewer.setState(item.meshIds, "selected");
    showInfo(item);
  }

  (async () => {
    const data = await loadSkeletonData();
    if (left) return;
    const items = buildQuizItems(data.items, { sides: "match" });
    const byMesh = new Map(items.map((i) => [i.id, i]));
    viewer = await getViewer(stage);
    if (left) return;
    loading.remove();
    viewer.frame(null, { direction: SkeletonViewer.FRONT });
    viewer.onPick((id) => select(id ? byMesh.get(id) : null));
    viewer.onHover((id) => {
      tooltip.hidden = !id;
      if (!id) return;
      const rect = stage.getBoundingClientRect();
      tooltip.textContent = displayName(byMesh.get(id));
      tooltip.style.left = `${mouse.x - rect.left + 14}px`;
      tooltip.style.top = `${mouse.y - rect.top + 14}px`;
    });
    randomButton.disabled = false;
    randomButton.addEventListener("click", () => {
      // The ossicles sit inside the temporal bone — a random pick there
      // would frame a bone you can't see.
      const visible = items.filter((i) => !i.groups.includes("Auditory ossicles"));
      const item = visible[Math.floor(Math.random() * visible.length)];
      select(item);
      // Extra padding: the info card covers the top of the view.
      viewer.frame(item.meshIds, { direction: "outward", minRadius: 0.12, padding: 1.8 });
    });
  })().catch((err) => {
    console.error(err);
    loading.textContent = "Couldn't load the skeleton. Try reloading the page.";
  });

  return () => {
    left = true;
    stage.removeEventListener("pointermove", onMove);
    viewer?.reset();
  };
}
