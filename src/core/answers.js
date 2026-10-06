// Typed-answer matching. Deliberately exact after normalization — no typo
// tolerance, because one character is often the whole answer
// ("Vertebra T4" vs "Vertebra T5", "Fifth rib" vs "Sixth rib").

const SIDE_WORDS = {
  left: "left",
  l: "left",
  sinister: "left",
  sinistra: "left",
  sinistrum: "left",
  right: "right",
  r: "right",
  dexter: "right",
  dextra: "right",
  dextrum: "right",
};

export function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** Splits side words out of a guess: "left femur" -> { rest: "femur", side: "left" }. */
function parseSide(guess) {
  let side = null;
  const words = normalize(guess)
    .split(" ")
    .filter((w) => {
      if (w in SIDE_WORDS) {
        side = SIDE_WORDS[w];
        return false;
      }
      return true;
    });
  return { rest: words.join(" "), side };
}

/**
 * accepted: the item's names for this attribute (primary + synonyms).
 * itemSide: "left" | "right" | null — null when sides don't matter.
 */
export function matchesTyped(guess, accepted, itemSide) {
  // Names that legitimately contain a side-like word ("Vertebra L1") must
  // still match, so try the raw normalized guess first.
  const raw = normalize(guess);
  const targets = accepted.map(normalize);
  if (!itemSide && targets.includes(raw)) return true;
  const { rest, side } = parseSide(guess);
  if (!targets.includes(rest)) return false;
  return itemSide ? side === itemSide : true;
}
