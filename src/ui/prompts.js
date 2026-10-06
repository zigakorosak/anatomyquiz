// Prompt widget registry, keyed by attribute.promptKind. A prompt fills the
// prompt bar and may set up the viewer (highlighting the target).

import { h } from "./dom.js";

const ASK = {
  location: "Find the",
  name: "English name for",
  latin: "Latin name for",
};

function kindOf(item) {
  if (item.tissue === "tooth") return "tooth";
  if (item.tissue === "cartilage") return "cartilage";
  return "bone";
}

export const prompts = {
  text({ el, target, question, answer }) {
    el.replaceChildren(
      h("span.prompt-ask", {}, ASK[answer.id] ?? "Answer for"),
      h("span.prompt-value", {}, question.display(target)),
    );
  },

  highlight({ el, viewer, target, answer, contextRadius }) {
    const what = answer.id === "latin" ? "Latin name of" : "Name";
    el.replaceChildren(
      h("span.prompt-ask", {}, `${what} the highlighted`),
      h("span.prompt-value", {}, kindOf(target)),
    );
    viewer.setState(target.meshIds, "target");
    viewer.setXray(target.meshIds);
    viewer.frame(target.meshIds, { direction: "outward", minRadius: contextRadius, padding: 1.4 });
  },
};
