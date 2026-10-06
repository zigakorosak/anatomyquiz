import "./style.css";
import { renderHome } from "./ui/home.js";

// Top-level screen router. Each screen is a function (root, navigate) that
// fills `root`; navigate(name) swaps to another registered screen.
const screens = {
  home: renderHome,
};

const root = document.getElementById("app");

function navigate(name, ...args) {
  root.replaceChildren();
  screens[name](root, navigate, ...args);
}

navigate("home");
