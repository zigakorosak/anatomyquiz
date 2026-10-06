// Settings, reachable from home (GeoQuiz's settingsScreen.js): one section
// per preference, each a column of options with the current one selected.
// Saved on click (core/settings.js).

import { loadSettings, saveSettings } from "../core/settings.js";
import { h } from "./dom.js";

const sections = [
  {
    title: "Camera",
    key: "keepView",
    options: [
      { label: "Keep view between rounds", value: true },
      { label: "Reset view every round", value: false },
    ],
  },
  {
    title: "After answering",
    key: "zoomToAnswer",
    options: [
      { label: "Zoom to the answer", value: true },
      { label: "Don't zoom", value: false },
    ],
  },
];

export function renderSettings(root, navigate) {
  const settings = loadSettings();
  const section = ({ title, key, options }) => {
    const buttons = options.map((option) => {
      const btn = h("button.menu-option", { type: "button" }, option.label);
      if (option.value === settings[key]) btn.classList.add("menu-option--selected");
      btn.addEventListener("click", () => {
        for (const b of buttons) b.classList.remove("menu-option--selected");
        btn.classList.add("menu-option--selected");
        settings[key] = option.value;
        saveSettings(settings);
      });
      return btn;
    });
    return h("section.menu-step", {}, h("h2", {}, title), h("div.menu-options", {}, buttons));
  };
  root.append(
    h(
      "div.menu-screen.wizard-screen",
      {},
      h("button.wizard-back", { type: "button", onclick: () => navigate("home") }, "← Back"),
      h("h1", {}, "Settings"),
      sections.map(section),
    ),
  );
}
