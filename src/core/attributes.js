// Attribute registry: the quizzable facts about an item. Each attribute says
// how it's shown as a question (promptKind) and how it can be answered
// (answerKinds). The wizard, engine and game screen look widgets up by these
// kinds and never special-case an attribute by id.

import { displayLatin, displayName } from "./dataset.js";

export const attributes = {
  name: {
    id: "name",
    label: "Name",
    promptKind: "text",
    answerKinds: ["type", "choice"],
    display: displayName,
    accepted: (item) => [item.name, ...item.synonyms],
  },
  latin: {
    id: "latin",
    label: "Latin name",
    promptKind: "text",
    answerKinds: ["type", "choice"],
    display: displayLatin,
    accepted: (item) => [item.latin, ...item.latinSynonyms],
  },
  location: {
    id: "location",
    label: "Location on the skeleton",
    promptKind: "highlight",
    answerKinds: ["click"],
  },
};

export const answerKindLabels = {
  type: "Type it",
  choice: "Multiple choice",
  click: "Click it on the skeleton",
};

/** Answer attributes that make sense for a given question attribute. */
export function answerOptionsFor(questionId) {
  return Object.values(attributes).filter((a) => a.id !== questionId);
}
