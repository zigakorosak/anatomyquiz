import { h } from "./dom.js";

/**
 * Shared full-screen "pick one of these" component for the home screen and
 * every wizard step — GeoQuiz's renderChoiceScreen: title, optional
 * subtitle, a row of option buttons, an optional Back button.
 *
 * options: [{ label, desc?, disabled?, onSelect }]
 */
export function choiceScreen(root, { title, subtitle, options, onBack, footer }) {
  root.replaceChildren();
  const screen = h(
    "div.menu-screen.wizard-screen",
    {},
    onBack ? h("button.wizard-back", { type: "button", onclick: onBack }, "← Back") : null,
    h("h1", {}, title),
    subtitle ? h("p.wizard-subtitle", {}, subtitle) : null,
    h(
      "div.menu-options.wizard-options",
      {},
      options.map((o) =>
        h(
          "button.menu-option.wizard-option",
          { type: "button", disabled: Boolean(o.disabled), onclick: o.disabled ? null : o.onSelect },
          h("span", {}, o.label),
          o.desc ? h("span.wizard-option-desc", {}, o.desc) : null,
        ),
      ),
    ),
    footer ?? null,
  );
  root.append(screen);
  return screen;
}

/** "Hand (27)" — GeoQuiz's withCount. */
export const withCount = (label, n) => `${label} (${n})`;
