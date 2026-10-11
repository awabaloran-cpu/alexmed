// The small rules of self-study, apart from any screen: how a score turns
// into stars, and how a round of flashcards goes.

// Three stars from 90%, two from 70%, one from 40%.
export function starsFor(correct: number, total: number): number {
  const share = total > 0 ? correct / total : 0;
  return share >= 0.9 ? 3 : share >= 0.7 ? 2 : share >= 0.4 ? 1 : 0;
}

// One round of flashcards: the cards still to see (by their index in the
// quiz), and where each one seen went.
export type Round = {
  queue: number[];
  known: number[];
  later: number[];
};

export const newRound = (cards: number[]): Round => ({
  queue: [...cards],
  known: [],
  later: [],
});

export const allCards = (count: number) =>
  Array.from({ length: count }, (_, index) => index);

// The top card goes to "I know it" or to "review later".
export function sortCard(round: Round, knew: boolean): Round {
  const [card, ...rest] = round.queue;
  if (card === undefined) return round;
  return {
    queue: rest,
    known: knew ? [...round.known, card] : round.known,
    later: knew ? round.later : [...round.later, card],
  };
}

export const roundDone = (round: Round) => round.queue.length === 0;

// The next round is only what was left for later, in the order it was met.
export const repeatLater = (round: Round): Round => newRound(round.later);

// How far across a card must be dragged, as a share of its width, to count
// as a swipe — and which way it went.
export const SWIPE_SHARE = 0.28;
export function swipeVerdict(
  dx: number,
  width: number
): "know" | "later" | null {
  if (width <= 0 || Math.abs(dx) < width * SWIPE_SHARE) return null;
  return dx > 0 ? "know" : "later";
}
