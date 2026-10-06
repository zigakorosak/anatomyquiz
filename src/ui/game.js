// Round loop: renders the prompt and answer widgets for the configured
// question/answer attributes, scores, and shows the end-of-game summary.
//
// Round flow (same as GeoQuiz): select → confirm → result → next.
// - Select: click a bone, pick an option, or type.
// - Confirm: the header button, Enter, or re-selecting the same thing.
// - Next: the header button, Enter, a click (not a drag) on the skeleton, or
//   a click on a locked multiple-choice option.

import { attributes } from "../core/attributes.js";
import { displayLatin, displayName, loadSkeletonData } from "../core/dataset.js";
import { QuizSession } from "../core/engine.js";
import { gamePool } from "../core/pool.js";
import { findRegion } from "../core/regions.js";
import * as THREE from "three";
import { SkeletonViewer } from "../viewer/SkeletonViewer.js";
import { getViewer } from "../viewer/shared.js";
import { h } from "./dom.js";
import { prompts } from "./prompts.js";
import { inputs } from "./inputs.js";

// Context around a framed target: a phalanx alone fills the screen and says
// nothing about where it is. Scaled to the region (a quarter of its size,
// within these bounds, in metres) — a fixed 12 cm left the 3 mm ossicles a
// pixel wide.
const CONTEXT_MIN = 0.015;
const CONTEXT_MAX = 0.12;

export function formatTime(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export function renderGame(root, navigate, config) {
  const question = attributes[config.question];
  const answer = attributes[config.answer];
  const region = findRegion(config.region);

  const els = {
    progress: h("span.progress"),
    score: h("span.score"),
    timer: h("span.timer"),
    action: h("button.primary.action", { disabled: true }),
    prompt: h("div.prompt"),
    feedback: h("div.feedback", { hidden: true }),
    stage: h("div.stage"),
    answerArea: h("div.answer-area"),
    loading: h("div.stage-loading", {}, "Loading skeleton…"),
  };

  const screen = h(
    "main.game",
    {},
    h(
      "header.game-header",
      {},
      h("button.ghost", { onclick: () => navigate("home"), title: "Home" }, "✕"),
      h("button.ghost", { onclick: () => navigate("game", config), title: "Restart" }, "↻"),
      h("div.stats", {}, els.progress, els.score, els.timer),
      els.action,
    ),
    h("div.prompt-bar", {}, els.prompt, els.feedback),
    h("div.stage-wrap", {}, els.stage, els.loading, els.answerArea),
  );
  root.append(screen);

  let left = false;
  let session, pool, viewer, itemByMesh;
  let phase = "loading"; // answering | result | summary
  let widget = null; // current answer widget: { value(), focus?(), lock() }
  let timerId = null;
  let contextRadius = CONTEXT_MAX;
  let viewBeforeResult = null; // the player's own view, restored next round

  const onKey = (e) => {
    if (e.key !== "Enter" || phase === "summary") return;
    // An enabled button's own click handles Enter. A disabled one (a locked
    // multiple-choice option that kept focus) doesn't, so act on it here.
    if (e.target.tagName === "BUTTON" && !e.target.disabled) return;
    e.preventDefault();
    act();
  };
  document.addEventListener("keydown", onKey);

  els.action.addEventListener("click", () => act());

  function act() {
    if (phase === "answering" && widget?.value() != null) confirm();
    else if (phase === "result") next();
  }

  function setAction(label, enabled) {
    els.action.textContent = label;
    els.action.disabled = !enabled;
  }

  function updateStats() {
    els.progress.textContent = `${Math.min(session.index + 1, pool.length)} / ${pool.length}`;
    els.score.textContent = `✓ ${session.correctCount}`;
  }

  function tick() {
    if (phase === "answering") {
      els.timer.textContent = formatTime(performance.now() - session.roundStart);
    }
  }

  function startRound() {
    phase = "answering";
    const target = session.current;
    viewer.clearStates();
    if (viewBeforeResult) {
      viewer.setView(viewBeforeResult);
      viewBeforeResult = null;
    }
    els.feedback.hidden = true;
    els.feedback.className = "feedback";
    els.answerArea.replaceChildren();
    updateStats();
    tick();

    prompts[question.promptKind]({
      el: els.prompt,
      viewer,
      target,
      question,
      answer,
      contextRadius,
    });

    widget = inputs[config.how]({
      el: els.answerArea,
      viewer,
      target,
      answer,
      pool,
      itemByMesh,
      config,
      onChange: () => setAction("Confirm", widget.value() != null),
      onConfirm: () => confirm(),
      // Clicks on a widget after the result (e.g. a locked multiple-choice
      // option) advance, like a click on the skeleton.
      onNext: () => {
        if (phase === "result") next();
      },
    });
    setAction("Confirm", false);
    widget.focus?.();
  }

  function confirm() {
    if (phase !== "answering") return;
    const target = session.current;
    const verdict = widget.check();
    session.answer(verdict.correct, verdict.guessKey);
    widget.lock();
    phase = "result";
    updateStats();

    // Show where the target is, whatever the mode — every answer is a chance
    // to learn the location. Green is always "the right answer is here", red
    // always "what you picked instead".
    const wrongIds = verdict.correct ? [] : (verdict.guessMeshIds ?? []);
    viewer.clearStates();
    viewer.setState(target.meshIds, "correct");
    viewer.setState(wrongIds, "wrong");
    viewer.setXray(target.meshIds, 0x3fa45b);
    if (question.promptKind !== "highlight") {
      viewBeforeResult = viewer.getView();
      viewer.frame([...target.meshIds, ...wrongIds], {
        direction: "outward",
        minRadius: contextRadius,
        padding: 1.4,
      });
    }

    const name = displayName(target);
    const latin = displayLatin(target);
    els.feedback.hidden = false;
    els.feedback.className = `feedback ${verdict.correct ? "is-correct" : "is-wrong"}`;
    els.feedback.replaceChildren(
      h("strong", {}, verdict.correct ? "Correct" : "Not quite"),
      ...(verdict.message ? [h("span", {}, verdict.message)] : []),
      h("span.answer-names", {}, h("b", {}, name), " · ", h("i", {}, latin)),
    );
    setAction(session.index + 1 >= pool.length ? "Results" : "Next", true);
  }

  function next() {
    session.next();
    if (session.done) showSummary();
    else startRound();
  }

  function showSummary() {
    phase = "summary";
    viewer.reset();
    const missed = session.results.filter((r) => !r.correct);
    const total = session.results.length;
    const pct = total ? Math.round((session.correctCount / total) * 100) : 0;
    screen.replaceChildren(
      h(
        "div.choice-screen.summary",
        {},
        h("h1", {}, `${session.correctCount} / ${total}`),
        h(
          "p.subtitle",
          {},
          `${pct}% · total ${formatTime(session.totalMs)} · average ${formatTime(session.totalMs / Math.max(1, total))}`,
        ),
        h(
          "div.choices",
          {},
          h("button.choice", { onclick: () => navigate("game", config) }, "Play again"),
          h("button.choice", { onclick: () => navigate("wizard") }, "New game"),
          h("button.choice", { onclick: () => navigate("home") }, "Home"),
        ),
        missed.length
          ? h(
              "section.missed",
              {},
              h("h2", {}, `Missed (${missed.length})`),
              h(
                "ul",
                {},
                missed.map((r) =>
                  h("li", {}, h("b", {}, displayName(r.item)), " · ", h("i", {}, displayLatin(r.item))),
                ),
              ),
            )
          : null,
      ),
    );
  }

  (async () => {
    const data = await loadSkeletonData();
    if (left) return;
    pool = gamePool(data.items, config, region);
    if (!pool.length) {
      // The wizard disables empty regions; this covers anything else.
      els.loading.textContent = "Nothing to ask in this mode and region.";
      return;
    }
    itemByMesh = new Map(pool.flatMap((i) => i.meshIds.map((m) => [m, i])));
    viewer = await getViewer(els.stage);
    if (left) return;
    els.loading.remove();
    const regionIds = [...itemByMesh.keys()];
    viewer.setPlayable(regionIds);
    viewer.frame(regionIds, { direction: SkeletonViewer.FRONT });
    const size = viewer.boxOf(regionIds).getSize(new THREE.Vector3()).length();
    contextRadius = Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, size / 4));
    viewer.onPick((meshId) => {
      // A click on the skeleton advances past a result, like GeoQuiz's
      // click-anywhere. Answer widgets get picks only while answering.
      if (phase === "result") next();
      else if (phase === "answering") widget?.pick?.(meshId);
    });
    session = new QuizSession(pool);
    timerId = setInterval(tick, 250);
    startRound();
  })().catch((err) => {
    console.error(err);
    els.loading.textContent = "Couldn't load the skeleton. Try reloading the page.";
  });

  return () => {
    left = true;
    clearInterval(timerId);
    document.removeEventListener("keydown", onKey);
    viewer?.reset();
  };
}
