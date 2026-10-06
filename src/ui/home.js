import { choiceScreen } from "./screenKit.js";
import { credits } from "./credits.js";

export function renderHome(root, navigate) {
  choiceScreen(root, {
    title: "Anatomy Quiz",
    subtitle: "Learn the bones of the human skeleton.",
    options: [
      { label: "Play", detail: "Choose a quiz", onSelect: () => navigate("wizard") },
      {
        label: "Explore",
        detail: "Turn the skeleton around and click bones to see their names",
        onSelect: () => navigate("explore"),
      },
    ],
    footer: credits(),
  });
}
