// QuizSession: generic round/scoring logic, no DOM. One round per item in
// play, in random order — a game always covers everything selected.

export function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class QuizSession {
  constructor(items) {
    this.items = items;
    this.order = shuffle(items);
    this.index = 0;
    this.results = [];
    this.roundStart = performance.now();
  }

  get current() {
    return this.order[this.index];
  }

  get done() {
    return this.index >= this.order.length;
  }

  get correctCount() {
    return this.results.filter((r) => r.correct).length;
  }

  /** Records the answer to the current round. guessKey is the guessed item's key, if any. */
  answer(correct, guessKey = null) {
    const result = {
      item: this.current,
      correct,
      guessKey,
      ms: performance.now() - this.roundStart,
    };
    this.results.push(result);
    return result;
  }

  next() {
    this.index++;
    this.roundStart = performance.now();
  }

  get totalMs() {
    return this.results.reduce((s, r) => s + r.ms, 0);
  }
}

/**
 * Multiple-choice options: the target plus distractors, preferring items
 * from the same group (other carpals for a carpal) so the choice is
 * actually instructive, then filling from the rest of the pool.
 */
export function pickChoices(target, pool, count, labelOf) {
  const others = pool.filter((i) => i.key !== target.key && labelOf(i) !== labelOf(target));
  const near = shuffle(others.filter((i) => i.groups[0] === target.groups[0]));
  const far = shuffle(others.filter((i) => i.groups[0] !== target.groups[0]));
  const picked = [];
  const seen = new Set([labelOf(target)]);
  for (const i of [...near, ...far]) {
    if (picked.length >= count - 1) break;
    if (seen.has(labelOf(i))) continue;
    seen.add(labelOf(i));
    picked.push(i);
  }
  return shuffle([target, ...picked]);
}
