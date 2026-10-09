// The layers button at the bottom of the 3D view. Each press hides the
// outermost layer still showing: those bones turn into the pale ghost and
// can't be clicked, so the ones inside them can. On the last layer the
// button reads "Show all" and the next press brings every layer back.
// Layers come from the viewer's depth-peeling measurement
// (SkeletonViewer.computeLayers) of the bones in play, so they suit whatever
// region is shown. Replaced a slider (user request).

import { h } from "./dom.js";

// The measurement takes a moment (~1 s for the whole skeleton in software
// rendering), so it runs just after the screen has drawn, not before.
const COMPUTE_DELAY_MS = 250;

/** ids: the meshes to measure layers on, and to peel. */
export function createLayerButton(viewer, ids) {
  const action = h("span.layer-button-action");
  const count = h("span.layer-button-count");
  // Hidden until measured, and stays hidden when there's only one layer.
  const el = h("button.layer-button", { type: "button", hidden: true }, action, count);

  let levels = null;
  let total = 0;
  let peeled = 0; // layers hidden so far

  const update = () => {
    viewer.setPeel(levels, peeled);
    const shown = total - peeled;
    const last = shown === 1;
    action.textContent = last ? "Show all layers" : "Remove a layer";
    count.textContent = `${shown}/${total}`;
    el.setAttribute(
      "aria-label",
      last ? `Show all ${total} layers` : `Remove the outer layer (${shown} of ${total} shown)`,
    );
  };

  el.addEventListener("click", (e) => {
    // Pressing it is not the game's "click anywhere to advance".
    e.menuClick = true;
    peeled = peeled + 1 >= total ? 0 : peeled + 1;
    update();
  });

  let timer = null;
  const measure = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const result = viewer.computeLayers(ids);
      if (result.count < 2) return;
      levels = result.levels;
      total = result.count;
      update();
      el.hidden = false;
    }, COMPUTE_DELAY_MS);
  };
  measure();

  return {
    el,
    /** Re-measures on other meshes (Explore's subjects changed): all layers shown. */
    setIds(next) {
      ids = next;
      levels = null;
      total = 0;
      peeled = 0;
      viewer.setPeel(null, 0);
      el.hidden = true;
      measure();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
