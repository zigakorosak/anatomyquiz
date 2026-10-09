// "How to play", reachable from home: how the game works, in short
// sections. Keep it in step with the game when features change.

import { h } from "./dom.js";

const SECTIONS = [
  [
    "The idea",
    [
      "You're shown a fact about a structure and give another one: find a bone by its name, name a highlighted bone, give the Latin name of a bone, or find where a muscle attaches.",
      "A game asks about everything in the part of the body you choose, in random order.",
    ],
  ],
  [
    "Starting a game",
    [
      "Games → choose a subject: Bones, Muscle attachments (where muscles start and end on the skeleton), or Muscles.",
      "Then choose what you're shown and how you answer: click it on the skeleton, type the name (it autocompletes), or pick from 2–6 options.",
      "Then choose a region (each shows how many questions it has) and whether left and right count separately.",
    ],
  ],
  [
    "Answering",
    [
      "Select your answer, then confirm with the button at the top, Enter, or by clicking the same answer again.",
      "The right answer turns green; if you picked something else, it turns red. The name is shown in English and Latin.",
      "Go on with Next, Enter, or a click anywhere. Turning the model doesn't count as a click, so you can look around first.",
      "At the end you get your score, your times, and every question with what you missed.",
    ],
  ],
  [
    "Moving the skeleton",
    [
      "Mouse: drag to turn it, scroll to zoom (towards the pointer), right-drag to move it.",
      "Touch: drag with one finger to turn it, pinch to zoom, drag with two fingers to move it.",
      "Bones outside the chosen region fade out and can't be clicked.",
    ],
  ],
  [
    "Tools at the bottom",
    [
      "Remove a layer: hides the outermost bones still showing, so you can reach the ones inside (the vertebrae behind the ribs, the inner skull bones). On the last layer it shows everything again.",
      "Cut: slices through the body. Pick a sagittal, coronal or transverse plane, press it again to hide the other side, and move the slider to move the cut.",
    ],
  ],
  [
    "Elsewhere",
    [
      "☰ during a game: Restart, Back (to your last choice, with everything else kept), or Home.",
      "Explore: no questions. Subjects sets how each subject shows, pressing its button to cycle: Off, Outline (see-through), Visible, or Clickable. Hover for names, click (or press Random) for details, including the Latin name and, for muscles and attachments, the muscle's action (and an attachment's bone).",
      "Settings: keep your camera view between rounds or reset it, and choose whether the camera moves to the answer after each question.",
    ],
  ],
];

export function renderHelp(root, navigate) {
  root.append(
    h(
      "div.menu-screen.wizard-screen.help-screen",
      {},
      h("button.wizard-back", { type: "button", onclick: () => navigate("home") }, "← Back"),
      h("h1", {}, "How to play"),
      SECTIONS.map(([title, lines]) =>
        h("section.help-section", {}, h("h2", {}, title), h("ul", {}, lines.map((l) => h("li", {}, l)))),
      ),
    ),
  );
}
