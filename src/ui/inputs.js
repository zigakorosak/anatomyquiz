// Answer-input widget registry, keyed by answer kind. Each widget returns:
//   value()  — current selection, or null when nothing is selected yet
//              (null disables Confirm; a wrong answer is never null)
//   check()  — { correct, guessKey?, guessMeshIds?, message? }
//   lock()   — freeze after confirming; clicks on a locked widget may call
//              onNext() to advance
//   pick?(meshId) — clicks on the skeleton, while answering
//   focus?()

import { matchesTyped } from "../core/answers.js";
import { pickChoices } from "../core/engine.js";
import { h } from "./dom.js";

export const inputs = {
  click({ el, viewer, target, itemByMesh, onChange, onConfirm }) {
    let selected = null;
    viewer.setHoverGroup((id) => itemByMesh.get(id)?.meshIds ?? [id]);
    el.append(h("p.hint", {}, "Click a bone, then click it again or press Confirm."));
    return {
      value: () => selected,
      pick(meshId) {
        const item = meshId ? itemByMesh.get(meshId) : null;
        if (!item) return; // empty space keeps the current selection
        if (item === selected) return onConfirm();
        if (selected) viewer.setState(selected.meshIds, null);
        selected = item;
        viewer.setState(item.meshIds, "selected");
        onChange();
      },
      check() {
        const correct = selected.key === target.key;
        return {
          correct,
          guessKey: selected.key,
          guessMeshIds: selected.meshIds,
          message: correct ? null : "Your pick is in red, the right answer in green.",
        };
      },
      lock() {
        viewer.setHoverGroup(null);
      },
    };
  },

  type({ el, target, answer, config, onChange }) {
    const input = h("input.type-input", {
      type: "text",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
      placeholder:
        (answer.id === "latin" ? "Latin name" : "Name") +
        (config.sides === "match" && target.side ? ", with left/right" : "") +
        "…",
      oninput: () => onChange(),
    });
    el.append(input);
    const value = () => input.value.trim() || null;
    return {
      value,
      focus: () => input.focus({ preventScroll: true }),
      check() {
        const side = config.sides === "match" ? target.side : null;
        const correct = matchesTyped(value(), answer.accepted(target), side);
        return {
          correct,
          message: correct ? null : `You typed “${value()}”.`,
        };
      },
      lock() {
        input.disabled = true;
      },
    };
  },

  choice({ el, target, answer, pool, config, onChange, onConfirm, onNext }) {
    const options = pickChoices(target, pool, config.choices, answer.display);
    let selected = null;
    let locked = false;
    const buttons = options.map((item) => {
      const b = h("button.option", {
        onclick: () => {
          // Locked, not disabled: browsers don't fire clicks on disabled
          // buttons, and a click on any option after the result advances.
          if (locked) return onNext();
          if (selected === item) return onConfirm();
          selected = item;
          for (const x of buttons) x.classList.toggle("is-selected", x === b);
          onChange();
        },
      }, answer.display(item));
      b.item = item;
      return b;
    });
    el.append(h("div.options", {}, buttons));
    return {
      value: () => selected,
      check() {
        const correct = selected.key === target.key;
        return {
          correct,
          guessKey: selected.key,
          guessMeshIds: selected.meshIds,
          message: correct ? null : "Your choice is in red on the skeleton.",
        };
      },
      lock() {
        locked = true;
        for (const b of buttons) {
          b.classList.add("is-locked"); // still clickable: a click advances
          if (b.item.key === target.key) b.classList.add("is-correct");
          else if (b.item === selected) b.classList.add("is-wrong");
        }
      },
    };
  },
};
