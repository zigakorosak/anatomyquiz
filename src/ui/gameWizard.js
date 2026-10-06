// The Games flow: a sequence of choice screens, worded and laid out like
// GeoQuiz's wizard, ending in a game config handed to the game screen:
//   question → answer → [how, if the answer has more than one input style →
//   how many options, if multiple choice] → region [→ sub-region] →
//   left/right → play.
//
// Steps are named ({ name, ...params }) rather than closures, so the whole
// position — config, history, current step — can be handed to the game
// and back again: the game's ☰ → Back returns to the last step with every
// earlier choice (and the Back chain behind it) intact, as in GeoQuiz.

import { attributes, answerKindLabels, answerOptionsFor } from "../core/attributes.js";
import { loadSkeletonData } from "../core/dataset.js";
import { gamePool } from "../core/pool.js";
import { findRegion, regions } from "../core/regions.js";
import { choiceScreen, withCount } from "./screenKit.js";
import { h } from "./dom.js";

export function renderWizard(root, navigate, resume = null) {
  const config = { ...(resume?.config ?? {}) };
  const history = [...(resume?.history ?? [])];
  let current = resume?.current ?? { name: "question" };
  let raw = null;
  let left = false;

  const show = () => steps[current.name](current);
  const go = (step) => {
    history.push(current);
    current = step;
    show();
  };
  const back = () => {
    const prev = history.pop();
    if (!prev) return navigate("home");
    current = prev;
    show();
  };
  const screen = (opts) => choiceScreen(root, { onBack: back, ...opts });

  // Region counts use "left and right separately" (every mesh), like
  // GeoQuiz's region step counting before the sovereignty filter; the
  // final step shows both counts.
  const count = (region, sides = "match") => gamePool(raw, { ...config, sides }, region).length;

  const steps = {
    question() {
      screen({
        title: "What should we show you?",
        options: Object.values(attributes).map((a) => ({
          label: a.label,
          onSelect: () => {
            config.question = a.id;
            go({ name: "answer" });
          },
        })),
      });
    },

    answer() {
      screen({
        title: "How do you want to answer?",
        options: answerOptionsFor(config.question).map((a) => ({
          label: a.label,
          onSelect: () => {
            config.answer = a.id;
            if (a.answerKinds.length === 1) {
              config.how = a.answerKinds[0];
              go({ name: "region" });
            } else go({ name: "how" });
          },
        })),
      });
    },

    how() {
      const answer = attributes[config.answer];
      screen({
        title: `How do you want to answer with the ${answer.label.toLowerCase()}?`,
        options: answer.answerKinds.map((k) => ({
          label: answerKindLabels[k],
          onSelect: () => {
            config.how = k;
            go({ name: k === "choice" ? "count" : "region" });
          },
        })),
      });
    },

    count() {
      screen({
        title: "How many options?",
        options: [2, 3, 4, 5, 6].map((n) => ({
          label: String(n),
          onSelect: () => {
            config.choices = n;
            go({ name: "region" });
          },
        })),
      });
    },

    region() {
      screen({
        title: "Choose a region",
        options: regions.map((r) => {
          const n = count(r);
          // A parent's own count leaves out standalone children (the
          // ossicles), but its sub-screen offers them, so it stays enabled
          // if any child has items. An empty pool would start a game with
          // no rounds.
          const usable = r.children ? Math.max(n, ...r.children.map((c) => count(c))) : n;
          return {
            label: withCount(r.label, n),
            desc: r.children ? r.children.map((c) => c.label).join(" · ") : null,
            disabled: usable === 0,
            onSelect: () => {
              if (r.children) return go({ name: "subregion", parent: r.id });
              config.region = r.id;
              go({ name: "sides" });
            },
          };
        }),
      });
    },

    subregion({ parent: parentId }) {
      const parent = findRegion(parentId);
      const option = (r, label) => {
        const n = count(r);
        return {
          label: withCount(label, n),
          desc: n ? null : "Nothing to ask in this mode",
          disabled: n === 0,
          onSelect: () => {
            config.region = r.id;
            go({ name: "sides" });
          },
        };
      };
      screen({
        title: `Choose ${/^[aeiou]/i.test(parent.label) ? "an" : "a"} ${parent.label.toLowerCase()} region`,
        options: [option(parent, `All of ${parent.label.toLowerCase()}`), ...parent.children.map((c) => option(c, c.label))],
      });
    },

    sides() {
      const region = findRegion(config.region);
      const option = (sides, label, desc) => {
        const n = count(region, sides);
        return {
          label: withCount(label, n),
          desc,
          disabled: n === 0,
          onSelect: () => {
            config.sides = sides;
            navigate("game", { ...config }, { config: { ...config }, history: [...history], current });
          },
        };
      };
      screen({
        title: "Either side, or left and right separately?",
        options: [
          option("ignore", "Either side", "“Femur”: either one counts"),
          option("match", "Left and right separately", "“Femur (left)”, “Femur (right)”"),
        ],
      });
    },
  };

  root.append(h("div.menu-screen", {}, h("p.loading-text", {}, "Loading…")));
  loadSkeletonData()
    .then((data) => {
      if (left) return;
      raw = data.items;
      show();
    })
    .catch((err) => {
      console.error(err);
      if (left) return;
      choiceScreen(root, {
        title: "Could not load game data.",
        subtitle: "Check your connection and try again.",
        options: [{ label: "Home", onSelect: () => navigate("home") }],
      });
    });
  return () => (left = true);
}
