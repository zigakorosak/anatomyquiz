// Free-explore: the whole skeleton, no quiz mechanics. Hover shows a name,
// click shows the details panel.

import { buildQuizItems, displayLatin, displayName, loadSkeletonData } from "../core/dataset.js";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { credits } from "./credits.js";
import { h } from "./dom.js";

export function renderExplore(root, navigate) {
  const stage = h("div.stage");
  const tooltip = h("div.tooltip", { hidden: true });
  const panel = h("aside.info", { hidden: true });
  const loading = h("div.stage-loading", {}, "Loading skeleton…");

  root.append(
    h(
      "main.game.explore",
      {},
      h(
        "header.game-header",
        {},
        h("button.ghost", { onclick: () => navigate("home"), title: "Home" }, "✕"),
        h("div.stats", {}, h("span", {}, "Explore")),
        h("button.ghost", { onclick: () => viewer?.frame(null, { direction: SkeletonViewer.FRONT }) }, "Reset view"),
      ),
      h("div.stage-wrap", {}, stage, loading, tooltip, panel),
      credits(),
    ),
  );

  let left = false;
  let viewer;
  let selected = null;
  let mouse = { x: 0, y: 0 };
  const onMove = (e) => (mouse = { x: e.clientX, y: e.clientY });
  stage.addEventListener("pointermove", onMove);

  function showInfo(item) {
    panel.hidden = false;
    panel.replaceChildren(
      h(
        "div",
        {},
        h("button.ghost.close", { onclick: () => select(null), title: "Close" }, "✕"),
        h("h2", {}, displayName(item)),
        h("p.latin", {}, displayLatin(item)),
        item.synonyms.length ? h("p.synonyms", {}, "Also: ", item.synonyms.join(", ")) : null,
        h("p.groups", {}, [...item.groups].reverse().slice(1).join(" › ")),
      ),
    );
  }

  function select(item) {
    if (selected) viewer.setState(selected.meshIds, null);
    selected = item;
    if (item) {
      viewer.setState(item.meshIds, "selected");
      showInfo(item);
    } else panel.hidden = true;
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
