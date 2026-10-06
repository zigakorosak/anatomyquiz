import { h } from "./dom.js";

/**
 * Shared full-screen "pick one of these" component used by the home screen
 * and every wizard step.
 *
 * options: [{ label, detail?, disabled?, onSelect }]
 */
export function choiceScreen(root, { title, subtitle, options, onBack, footer }) {
  const screen = h(
    "main.choice-screen",
    {},
    onBack ? h("button.back", { onclick: onBack }, "← Back") : null,
    h("h1", {}, title),
    subtitle ? h("p.subtitle", {}, subtitle) : null,
    h(
      "div.choices",
      {},
      options.map((o) =>
        h(
          "button.choice",
          { disabled: o.disabled, onclick: o.onSelect },
          h("span.choice-label", {}, o.label),
          o.detail ? h("span.choice-detail", {}, o.detail) : null,
        ),
      ),
    ),
    footer ?? null,
  );
  root.append(screen);
  return screen;
}
