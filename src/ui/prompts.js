// Prompt widget registry, keyed by attribute.promptKind. A prompt fills the
// prompt slot (a pill over the 3D view) and may set up the viewer.

import { h } from "./dom.js";

export const prompts = {
  // Just the value, big — GeoQuiz's "Kosovo" over the map.
  text({ el, target, question }) {
    el.replaceChildren(h("div.prompt-text", {}, question.display(target)));
  },

  // GeoQuiz's map-highlight shows no text at all: the highlighted shape is
  // the question. Same here — the target is lit in the accent colour (with
  // an x-ray copy so it shows through other bones) and framed from outside.
  highlight({ el, viewer, target, contextRadius }) {
    el.replaceChildren();
    viewer.setState(target.meshIds, "target");
    viewer.setXray(target.meshIds);
    viewer.frame(target.meshIds, { direction: "outward", minRadius: contextRadius, padding: 1.4 });
  },
};
