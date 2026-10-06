// The Play flow: a sequence of choice screens, each with Back, ending in a
// game config handed to the game screen:
//   question → answer → how (type / multiple choice) → how many options →
//   left/right → region (→ sub-region) → play.
// Steps that offer only one option are skipped.

import { attributes, answerKindLabels, answerOptionsFor } from "../core/attributes.js";
import { loadSkeletonData } from "../core/dataset.js";
import { gamePool } from "../core/pool.js";
import { regions } from "../core/regions.js";
import { choiceScreen } from "./screenKit.js";
import { h } from "./dom.js";

export function renderWizard(root, navigate, preset = {}) {
  const config = { ...preset };
  const history = [];
  let raw = null;

  const show = (step) => {
    root.replaceChildren();
    step();
  };
  const go = (step) => {
    history.push(current);
    current = step;
    show(step);
  };
  const back = () => {
    const prev = history.pop();
    if (!prev) return navigate("home");
    current = prev;
    show(prev);
  };
  let current = stepQuestion;

  function stepQuestion() {
    choiceScreen(root, {
      title: "What will you be shown?",
      onBack: back,
      options: Object.values(attributes).map((a) => ({
        label: a.label,
        onSelect: () => {
          config.question = a.id;
          go(stepAnswer);
        },
      })),
    });
  }

  function stepAnswer() {
    choiceScreen(root, {
      title: "What will you answer?",
      subtitle: `Shown: ${attributes[config.question].label.toLowerCase()}`,
      onBack: back,
      options: answerOptionsFor(config.question).map((a) => ({
        label: a.label,
        onSelect: () => {
          config.answer = a.id;
          const kinds = a.answerKinds;
          if (kinds.length === 1) {
            config.how = kinds[0];
            go(stepSides);
          } else go(stepHow);
        },
      })),
    });
  }

  function stepHow() {
    choiceScreen(root, {
      title: "How will you answer?",
      onBack: back,
      options: attributes[config.answer].answerKinds.map((k) => ({
        label: answerKindLabels[k],
        onSelect: () => {
          config.how = k;
          go(k === "choice" ? stepChoiceCount : stepSides);
        },
      })),
    });
  }

  function stepChoiceCount() {
    choiceScreen(root, {
      title: "How many options?",
      onBack: back,
      options: [2, 3, 4, 5, 6].map((n) => ({
        label: String(n),
        onSelect: () => {
          config.choices = n;
          go(stepSides);
        },
      })),
    });
  }

  function stepSides() {
    choiceScreen(root, {
      title: "Left and right",
      subtitle: "Most bones come in pairs.",
      onBack: back,
      options: [
        {
          label: "Doesn't matter",
          detail: "“Femur” — either femur counts",
          onSelect: () => {
            config.sides = "ignore";
            go(stepRegion);
          },
        },
        {
          label: "Must match",
          detail: "“Femur (left)” and “Femur (right)” are separate questions",
          onSelect: () => {
            config.sides = "match";
            go(stepRegion);
          },
        },
      ],
    });
  }

  const countIn = (region) => gamePool(raw, config, region).length;

  // A region can be empty in some modes (all three ossicles have identical
  // English and Latin names), so it's shown but disabled.
  const regionOption = (region, label, onSelect) => {
    const n = countIn(region);
    return {
      label: `${label} (${n})`,
      detail: n ? null : "Nothing to ask in this mode",
      disabled: n === 0,
      onSelect,
    };
  };

  const play = (region) => {
    config.region = region.id;
    navigate("game", { ...config });
  };

  function stepRegion() {
    choiceScreen(root, {
      title: "Which part of the skeleton?",
      onBack: back,
      options: regions.map((r) => {
        if (!r.children) return regionOption(r, r.label, () => play(r));
        // A parent's own count leaves out standalone children, but the
        // sub-screen offers them, so it stays enabled if any child has items.
        const n = Math.max(countIn(r), ...r.children.map(countIn));
        return {
          label: `${r.label} (${countIn(r)})`,
          detail: r.children.map((c) => c.label).join(" · "),
          disabled: n === 0,
          onSelect: () => go(() => stepSubRegion(r)),
        };
      }),
    });
  }

  function stepSubRegion(parent) {
    choiceScreen(root, {
      title: parent.label,
      onBack: back,
      options: [
        regionOption(parent, "All of it", () => play(parent)),
        ...parent.children.map((c) => regionOption(c, c.label, () => play(c))),
      ],
    });
  }

  let left = false;
  root.append(h("p.loading", {}, "Loading…"));
  loadSkeletonData()
    .then((data) => {
      if (left) return;
      raw = data.items;
      show(current);
    })
    .catch((err) => {
      console.error(err);
      if (left) return;
      root.replaceChildren(
        h("p.loading", {}, "Couldn't load the quiz data. Try reloading the page."),
      );
    });
  return () => (left = true);
}
