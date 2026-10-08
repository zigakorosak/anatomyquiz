import "./style.css";
import { renderHome } from "./ui/home.js";
import { renderWizard } from "./ui/gameWizard.js";
import { renderGame } from "./ui/game.js";
import { renderExplore } from "./ui/explore.js";
import { renderSettings } from "./ui/settingsScreen.js";
import { renderHelp } from "./ui/helpScreen.js";

// Top-level screen router. Each screen is a function (root, navigate, ...args)
// that fills `root` and may return a cleanup function, run when the next
// screen replaces it (timers, document-level listeners).
const screens = {
  home: renderHome,
  wizard: renderWizard,
  game: renderGame,
  explore: renderExplore,
  settings: renderSettings,
  help: renderHelp,
};

const root = document.getElementById("app");
let cleanup = null;

function navigate(name, ...args) {
  cleanup?.();
  cleanup = null;
  root.replaceChildren();
  const result = screens[name](root, navigate, ...args);
  if (typeof result === "function") cleanup = result;
}

navigate("home");
