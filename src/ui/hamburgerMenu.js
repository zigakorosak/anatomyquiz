// The ☰ header menu shared by the game and explore screens (GeoQuiz's
// hamburgerMenu.js). Rare, deliberate actions (Restart / Back / Home) live
// behind it instead of crowding the header.
//
// Closed by picking an action, tapping the toggle again, or a click
// anywhere else inside `root` — that listener lives on the screen's own
// root, so it goes away with the screen.

import { h } from "./dom.js";

export function createHamburgerMenu(root, buttons, { label = "Menu" } = {}) {
  const dropdown = h("div.game-menu-dropdown", { hidden: true }, buttons);
  const toggle = h(
    "button.exit-button.game-menu-toggle",
    { type: "button", "aria-label": label, "aria-expanded": "false" },
    "☰",
  );
  const setOpen = (open) => {
    dropdown.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", (e) => {
    // Opening the menu must not count as the game's "click anywhere to
    // advance", nor reach the outside-click closer below.
    e.menuClick = true;
    setOpen(dropdown.hidden);
  });
  dropdown.addEventListener("click", (e) => {
    e.menuClick = true;
  });
  const wrap = h("div.game-menu", {}, toggle, dropdown);
  root.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });
  return wrap;
}
