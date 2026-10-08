// The items a game actually asks about. Shared by the wizard (item counts)
// and the game screen, so the counts always match the game.

import { normalize } from "./answers.js";
import { attributes } from "./attributes.js";
import { buildQuizItems } from "./dataset.js";
import { subjectOf } from "./subjects.js";

/**
 * True when the prompt itself would be an accepted answer, so the question
 * gives itself away: 15 bones have identical English and Latin names
 * ("Humerus", "Stapes"), and the vertebrae list "Vertebra T4" as a Latin
 * synonym. With multiple choice only the primary name is shown as an
 * option, so only that counts; typed answers accept synonyms too.
 */
function givesAway(item, question, answer, how) {
  if (question.promptKind !== "text" || !answer.accepted) return false;
  const shown = normalize(question.accepted(item)[0]);
  const accepted = how === "type" ? answer.accepted(item) : answer.accepted(item).slice(0, 1);
  return accepted.some((x) => normalize(x) === shown);
}

export function gamePool(rawItems, config, region) {
  const question = attributes[config.question];
  const answer = attributes[config.answer];
  const { inRegion } = subjectOf(config);
  return buildQuizItems(rawItems, config)
    .filter((i) => inRegion(i, region))
    .filter((i) => !givesAway(i, question, answer, config.how));
}
