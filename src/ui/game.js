// Game screen, laid out like GeoQuiz's (reference/geoquiz/src/ui/game.js):
//
//   header: "Round 3 / 27"  "Score: 2"  "4.1s"  [Confirm/Next]  [☰]
//
// - Click-the-bone rounds (answer = location): the 3D view fills everything
//   below the header, and Confirm/Next, the question and the feedback float
//   over its top edge — GeoQuiz's map-answer overlay.
// - Typed / multiple-choice rounds: Confirm/Next sits in the header, the 3D
//   view fills the middle (a text question floats over its top as a pill),
//   and the answer widget and feedback line sit below it.
//
// Round flow: select → confirm → result → next. Confirm with the button,
// Enter, or re-selecting the same thing. Advance with the button, Enter, or
// a click anywhere (a click, not a drag, on the 3D view).

import * as THREE from "three";
import { attributes } from "../core/attributes.js";
import { buildQuizItems, displayLatin, displayName, loadSkeletonData } from "../core/dataset.js";
import { QuizSession } from "../core/engine.js";
import { gamePool } from "../core/pool.js";
import { findRegion } from "../core/regions.js";
import { loadSettings } from "../core/settings.js";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { h } from "./dom.js";
import { createHamburgerMenu } from "./hamburgerMenu.js";
import { inputs } from "./inputs.js";
import { prompts } from "./prompts.js";

// Context around a framed target: a phalanx alone fills the screen and says
// nothing about where it is. Scaled to the region (a quarter of its size,
// within these bounds, in metres) — a fixed 12 cm left the 3 mm ossicles a
// pixel wide.
const CONTEXT_MIN = 0.015;
const CONTEXT_MAX = 0.12;

// The result's green, for the x-ray copy of the target (viewer's "correct").
const CORRECT_COLOR = 0x34c77b;

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function renderGame(root, navigate, config, backState) {
  const question = attributes[config.question];
  const answer = attributes[config.answer];
  const region = findRegion(config.region);
  const clickAnswer = config.how === "click";
  const { keepView, zoomToAnswer } = loadSettings();

  // The name the answer is given in, and the other language alongside it,
  // so every result teaches both: "Femur · Os femoris". A middle dot, not
  // brackets: with sides the names carry their own ("Femur (left)").
  const answerName = answer.id === "latin" ? displayLatin : displayName;
  const otherName = answer.id === "latin" ? displayName : displayLatin;
  // Only when it differs: 15 bones have identical English and Latin names
  // ("Tibia · Tibia" said nothing).
  const named = (item) =>
    answerName(item) === otherName(item) ? answerName(item) : `${answerName(item)} · ${otherName(item)}`;

  const screen = h("div.game-screen");
  const progress = h("span.game-progress");
  const score = h("span.game-score");
  const timerEl = h("span.game-timer");
  const actionButton = h("button.action-button", { type: "button", disabled: true }, "Confirm");
  const menu = createHamburgerMenu(
    screen,
    [
      h("button.exit-button", { type: "button", onclick: () => navigate("game", config, backState) }, "Restart"),
      h("button.exit-button", { type: "button", onclick: () => navigate("wizard", backState) }, "Back"),
      h("button.exit-button", { type: "button", onclick: () => navigate("home") }, "Home"),
    ],
    { label: "Game menu" },
  );
  const header = h(
    "div.game-header",
    {},
    progress,
    score,
    timerEl,
    clickAnswer ? null : actionButton,
    menu,
  );

  const stage = h("div.stage");
  const loading = h("div.stage-loading", {}, "Loading skeleton…");
  const promptArea = h("div.prompt-area");
  const feedbackArea = h("div.feedback-area");
  const answerArea = h("div.answer-area");
  const overlay = clickAnswer
    ? h("div.map-overlay", {}, actionButton, promptArea, feedbackArea)
    : h("div.map-overlay", {}, promptArea);
  const viewerArea = h("div.viewer-area", {}, stage, loading, overlay);
  const roundArea = clickAnswer
    ? h("div.round-area", {}, viewerArea)
    : h("div.round-area", {}, viewerArea, answerArea, feedbackArea);

  screen.append(header, roundArea);
  root.append(screen);

  let left = false;
  let session, pool, allItems, viewer, itemByMesh, regionIds;
  let phase = "loading"; // answering | result | summary
  let widget = null;
  let timerId = null;
  let contextRadius = CONTEXT_MAX;
  let viewBeforeResult = null; // the player's own view, restored next round

  function updateHeader() {
    progress.textContent = `Round ${Math.min(session.index + 1, pool.length)} / ${pool.length}`;
    score.textContent = `Score: ${session.correctCount}`;
  }

  function startTimer() {
    session.roundStart = performance.now();
    timerEl.textContent = "0.0s";
    timerId = setInterval(() => (timerEl.textContent = seconds(performance.now() - session.roundStart)), 100);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  function act() {
    if (phase === "answering" && widget?.value() != null) confirm();
    else if (phase === "result") next();
  }
  actionButton.addEventListener("click", act);

  // Enter confirms / advances. An enabled button's own click handles Enter;
  // a locked option or read-only input doesn't, so act on those here.
  const onKey = (e) => {
    if (e.key !== "Enter" || (phase !== "answering" && phase !== "result")) return;
    if (e.target.tagName === "BUTTON" && !e.target.disabled && !e.target.classList.contains("menu-option--locked")) return;
    e.preventDefault();
    act();
  };
  document.addEventListener("keydown", onKey);

  // After a result, a click anywhere advances (GeoQuiz's root listener) —
  // except the action button (its own handler), the ☰ menu, the click that
  // confirmed (e.confirmClick), and the 3D canvas, whose own pick handler
  // advances on a click but not on a drag, so turning the model to look at
  // the answer doesn't skip it.
  screen.addEventListener("click", (e) => {
    if (phase !== "result" || e.confirmClick || e.menuClick) return;
    if (actionButton.contains(e.target) || e.target === viewer?.renderer.domElement) return;
    next();
  });

  function startRound() {
    phase = "answering";
    const target = session.current;
    viewer.clearStates();
    // Highlight prompts frame the target themselves. Otherwise: keep the
    // player's own view (restoring it after the result's zoom to the
    // answer), or go back to the region's front view, per Settings.
    if (question.promptKind !== "highlight") {
      if (!keepView) viewer.frame(regionIds, { direction: SkeletonViewer.FRONT });
      else if (viewBeforeResult) viewer.setView(viewBeforeResult);
    }
    viewBeforeResult = null;
    promptArea.replaceChildren();
    feedbackArea.replaceChildren();
    answerArea.replaceChildren();
    actionButton.textContent = "Confirm";
    actionButton.disabled = true;
    updateHeader();
    startTimer();

    prompts[question.promptKind]({ el: promptArea, viewer, target, question, contextRadius });
    widget = inputs[config.how]({
      el: answerArea,
      viewer,
      target,
      answer,
      pool,
      allItems,
      itemByMesh,
      config,
      onChange: () => (actionButton.disabled = phase !== "answering" || widget.value() == null),
      onConfirm: () => confirm(),
    });
    widget.focus?.();
  }

  function confirm() {
    if (phase !== "answering") return;
    const target = session.current;
    const { correct, guessItem } = widget.check();
    session.answer(correct, guessItem?.key ?? null);
    stopTimer();
    timerEl.textContent = seconds(session.results.at(-1).ms);
    widget.lock(correct);
    phase = "result";
    updateHeader();

    // Show where the answer is, whatever the mode: green is always "the
    // right answer is here", red "what you picked instead".
    const wrongIds = correct ? [] : (guessItem?.meshIds ?? []);
    viewer.clearStates();
    viewer.setState(target.meshIds, "correct");
    viewer.setState(wrongIds, "wrong");
    viewer.setXray(target.meshIds, CORRECT_COLOR);
    // Highlight prompts are already framed on the target. Otherwise glide
    // to the answer, unless Settings says not to.
    if (question.promptKind !== "highlight" && zoomToAnswer) {
      viewBeforeResult = viewer.getView();
      viewer.frame([...target.meshIds, ...wrongIds], {
        direction: "outward",
        minRadius: contextRadius,
        padding: 1.4,
      });
    }

    // GeoQuiz's wording, plus the name in the other language.
    let text;
    if (correct) text = `Correct! ${named(target)}`;
    else if (clickAnswer && guessItem) text = `You picked ${answerName(guessItem)} — correct answer: ${named(target)}`;
    else text = `Correct answer: ${named(target)}`;
    feedbackArea.replaceChildren(h("div.answer-feedback", {}, text));

    actionButton.disabled = false;
    actionButton.textContent = session.index + 1 >= pool.length ? "See Results" : "Next";
  }

  function next() {
    if (phase !== "result") return;
    session.next();
    if (session.done) showSummary();
    else startRound();
  }

  function showSummary() {
    phase = "summary";
    stopTimer();
    viewer.reset();
    const total = session.results.length;
    // Each round is labelled by what the player was shown; the correction
    // is dropped when it would just repeat the label (GeoQuiz's rule).
    const label = (item) => (question.display ?? displayName)(item);
    const value = (item) => (answer.display ?? displayName)(item);
    const list = h(
      "ul.summary-list",
      {},
      session.results.map((r) => {
        const correction = r.correct || value(r.item) === label(r.item) ? "" : ` (was ${value(r.item)})`;
        return h(
          `li.${r.correct ? "summary-correct" : "summary-wrong"}`,
          {},
          `${label(r.item)}: ${r.correct ? "correct" : "wrong"}${correction} (${seconds(r.ms)})`,
        );
      }),
    );
    screen.replaceChildren(
      h(
        "div.game-summary",
        {},
        h("h2", {}, "Game Over"),
        h("p.summary-score", {}, `You scored ${session.correctCount} / ${total}`),
        h(
          "p.summary-time",
          {},
          `Total time: ${seconds(session.totalMs)} — average ${seconds(session.totalMs / Math.max(1, total))} / round`,
        ),
        list,
        h("button", { type: "button", onclick: () => navigate("game", config, backState) }, "Play Again"),
        // Same as ☰ → Back: the wizard's last step, every choice kept.
        h("button", { type: "button", onclick: () => navigate("wizard", backState) }, "Back"),
        h("button", { type: "button", onclick: () => navigate("home") }, "Home"),
      ),
    );
  }

  (async () => {
    const data = await loadSkeletonData();
    if (left) return;
    pool = gamePool(data.items, config, region);
    allItems = buildQuizItems(data.items, config);
    if (!pool.length) {
      // The wizard disables empty regions; this covers anything else.
      loading.textContent = "Nothing to ask in this mode and region.";
      return;
    }
    itemByMesh = new Map(pool.flatMap((i) => i.meshIds.map((m) => [m, i])));
    viewer = await getViewer(stage);
    if (left) return;
    loading.remove();
    // The whole region is drawn solid and framed, even items the pool
    // leaves out (give-aways in English↔Latin modes: Humerus, Radius, Ulna
    // in Upper limb). Muting them made the chosen region look partly
    // missing. Only the pool is asked about.
    regionIds = allItems.filter(region.test).flatMap((i) => i.meshIds);
    viewer.setPlayable(regionIds);
    viewer.frame(regionIds, { direction: SkeletonViewer.FRONT });
    const size = viewer.boxOf(regionIds).getSize(new THREE.Vector3()).length();
    contextRadius = Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, size / 4));
    viewer.onPick((meshId) => {
      if (phase === "result") next();
      else if (phase === "answering") widget?.pick?.(meshId);
    });
    session = new QuizSession(pool);
    startRound();
  })().catch((err) => {
    console.error(err);
    loading.textContent = "Couldn't load the skeleton. Try reloading the page.";
  });

  return () => {
    left = true;
    stopTimer();
    document.removeEventListener("keydown", onKey);
    viewer?.reset();
  };
}
