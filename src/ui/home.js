// Main hub: Games / Explore / How to play / Settings (GeoQuiz: Games /
// Map / Settings).

import { choiceScreen } from "./screenKit.js";
import { credits } from "./credits.js";

export function renderHome(root, navigate) {
  choiceScreen(root, {
    title: "Anatomy Quiz",
    options: [
      { label: "Games", onSelect: () => navigate("wizard") },
      { label: "Explore", onSelect: () => navigate("explore") },
      { label: "How to play", onSelect: () => navigate("help") },
      { label: "Settings", onSelect: () => navigate("settings") },
    ],
    footer: credits(),
  });
}
