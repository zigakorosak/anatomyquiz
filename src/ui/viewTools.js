// The toolbar at the bottom of the 3D view: the layers button and the plane
// cut. Pressing "Cut" reveals three plane buttons and a slider:
//
//   [Remove a layer 5/5] [Cut]
//   [Sagittal · right hidden] [Coronal] [Transverse]
//   [──────●──────]
//
// Choosing a plane cuts the model there; pressing the chosen plane again
// flips which side is hidden. The slider moves the plane across the bones
// in play. Everything on the hidden side disappears (cut bones show a solid
// cross-section) and can't be clicked. Pressing "Cut" again turns it off.

import * as THREE from "three";
import { h } from "./dom.js";
import { createLayerButton } from "./layerButton.js";

const PLANES = [
  // flip false keeps the left / front / upper side (SkeletonViewer.setCut).
  { axis: "sagittal", label: "Sagittal", hidden: ["right", "left"] },
  { axis: "coronal", label: "Coronal", hidden: ["back", "front"] },
  { axis: "transverse", label: "Transverse", hidden: ["bottom", "top"] },
];

/**
 * layerIds: meshes the layers button measures and peels. cutIds: meshes
 * whose bounds the cut slider spans (the bones and attachments in play).
 */
export function createViewTools(viewer, { layerIds, cutIds }) {
  const layers = createLayerButton(viewer, layerIds);
  const cutToggle = h("button.view-tool.cut-toggle", { type: "button", "aria-pressed": "false" }, "Cut");
  const planeButtons = PLANES.map((p) =>
    h("button.view-tool.plane-button", { type: "button", dataset: { axis: p.axis } }),
  );
  const slider = h("input.cut-slider", {
    type: "range",
    min: 0,
    max: 1000,
    step: 1,
    value: 500,
    "aria-label": "Cut position",
  });
  const cutPanel = h(
    "div.cut-panel",
    { hidden: true },
    h("div.view-tools-row", {}, planeButtons),
    h("div.view-tools-row", {}, slider),
  );
  const el = h("div.view-tools", {}, cutPanel, h("div.view-tools-row", {}, layers.el, cutToggle));
  // Using the toolbar is not the game's "click anywhere to advance".
  el.addEventListener("click", (e) => {
    e.menuClick = true;
  });

  const box = new THREE.Box3();
  let cut = null; // { axis, flip } while on

  function update() {
    cutPanel.hidden = !cut;
    cutToggle.classList.toggle("is-active", Boolean(cut));
    cutToggle.setAttribute("aria-pressed", String(Boolean(cut)));
    PLANES.forEach((p, i) => {
      const b = planeButtons[i];
      const active = cut?.axis === p.axis;
      b.classList.toggle("is-active", active);
      // (replaceChildren would print a null as "null": MISTAKES.md.)
      b.replaceChildren(
        ...[h("span", {}, p.label), active && h("span.plane-hidden", {}, `${p.hidden[cut.flip ? 1 : 0]} hidden`)].filter(Boolean),
      );
      b.title = active ? "Press again to hide the other side" : `Cut along the ${p.label.toLowerCase()} plane`;
    });
    viewer.setCut(cut && { ...cut, t: Number(slider.value) / 1000, box });
  }

  cutToggle.addEventListener("click", () => {
    if (cut) cut = null;
    else {
      // Span the bones in play as they are now.
      box.copy(viewer.boxOf(cutIds));
      cut = { axis: "sagittal", flip: false };
    }
    update();
  });
  planeButtons.forEach((b, i) =>
    b.addEventListener("click", () => {
      const axis = PLANES[i].axis;
      // The same plane again flips which side is hidden.
      cut = cut.axis === axis ? { axis, flip: !cut.flip } : { axis, flip: false };
      update();
    }),
  );
  slider.addEventListener("input", update);
  update();

  return {
    el,
    /** The meshes the layers button measures and peels changed. */
    setLayerIds(ids) {
      layers.setIds(ids);
    },
    dispose() {
      layers.dispose();
    },
  };
}
