// Answer-input widget registry, keyed by answer kind. Each widget returns:
//   value()   — current selection, or null when nothing is selected yet
//               (null disables Confirm; a wrong answer is never null)
//   check()   — { correct, guessItem? }
//   lock(correct) — freeze after confirming. Locked widgets stay clickable
//               (never `disabled` — browsers fire no click on a disabled
//               control), so a click on them counts as the game's "click
//               anywhere advances".
//   pick?(meshId) — clicks on the skeleton, while answering
//   focus?()
//
// A click that itself confirms (re-clicking the selected option) is marked
// `e.confirmClick`, so the game's screen-wide click listener doesn't also
// treat it as "advance" (GeoQuiz's suppressNextRootAdvance, scoped to the
// one event instead of a flag that could outlive it).

import { matchesTyped } from "../core/answers.js";
import { pickChoices } from "../core/engine.js";
import { h } from "./dom.js";

export const inputs = {
  click({ viewer, target, itemByMesh, onChange, onConfirm }) {
    let selected = null;
    viewer.setHoverGroup((id) => itemByMesh.get(id)?.meshIds ?? [id]);
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
      check: () => ({ correct: selected.key === target.key, guessItem: selected }),
      lock() {
        viewer.setHoverGroup(null);
      },
    };
  },

  type({ el, target, answer, allItems, config, onChange }) {
    // Autocomplete from every answer value in this mode (GeoQuiz's
    // datalist) — the whole skeleton, not just the region, so the list
    // doesn't narrow down the answer.
    const listId = `answer-options-${typeInstance++}`;
    const values = [...new Set(allItems.map((i) => answer.display(i)))].sort();
    const datalist = h("datalist", { id: listId }, values.map((v) => h("option", { value: v })));
    const input = h("input", {
      type: "text",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
      // With "left and right separately" the side is part of the answer —
      // say so, as multiple choice does by showing "(left)" on every option.
      placeholder:
        config.sides === "match" && target.side
          ? `Type the ${answer.label.toLowerCase()}, with left or right...`
          : `Type the ${answer.label.toLowerCase()}...`,
      oninput: () => onChange(),
    });
    input.setAttribute("list", listId);
    el.append(h("div.answer-text-form", {}, input, datalist));
    const value = () => input.value.trim() || null;
    return {
      value,
      focus: () => input.focus({ preventScroll: true }),
      check() {
        const side = config.sides === "match" ? target.side : null;
        return { correct: matchesTyped(value(), answer.accepted(target), side) };
      },
      lock(correct) {
        input.readOnly = true;
        input.classList.add(correct ? "input--correct" : "input--wrong");
      },
    };
  },

  choice({ el, target, answer, pool, config, onChange, onConfirm }) {
    const options = pickChoices(target, pool, config.choices, answer.display);
    let selected = null;
    let locked = false;
    const buttons = options.map((item) => {
      const b = h(
        "button.menu-option",
        {
          type: "button",
          onclick: (e) => {
            if (locked) return; // bubbles to the game's "click anywhere advances"
            if (selected === item) {
              e.confirmClick = true;
              return onConfirm();
            }
            selected = item;
            for (const x of buttons) x.classList.toggle("menu-option--selected", x === b);
            onChange();
          },
        },
        answer.display(item),
      );
      b.item = item;
      return b;
    });
    el.append(h("div.menu-options.multiple-choice-options", {}, buttons));
    return {
      value: () => selected,
      check: () => ({ correct: selected.key === target.key, guessItem: selected }),
      lock() {
        locked = true;
        for (const b of buttons) {
          b.classList.add("menu-option--locked");
          if (b.item.key === target.key) b.classList.add("menu-option--correct");
          else if (b.item === selected) b.classList.add("menu-option--wrong");
        }
      },
    };
  },
};

let typeInstance = 0;
