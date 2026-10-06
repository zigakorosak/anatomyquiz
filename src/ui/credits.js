import { h } from "./dom.js";

// Required by the CC BY-SA licenses of the anatomy data — see DESIGN.md
// "Data & license". Keep this visible on screens that show the model.
export function credits({ overlay = false } = {}) {
  return h(
    overlay ? "p.credits.credits-overlay" : "p.credits",
    {},
    "3D anatomy: ",
    h("a", { href: "https://www.z-anatomy.com/", target: "_blank", rel: "noopener" }, "Z-Anatomy"),
    " (CC BY-SA 4.0), based on ",
    h(
      "a",
      { href: "https://lifesciencedb.jp/bp3d/", target: "_blank", rel: "noopener" },
      "BodyParts3D",
    ),
    ", © The Database Center for Life Science (CC BY-SA 2.1 JP).",
  );
}
