import { describe, expect, it } from "vitest";
import {
  allCards,
  newRound,
  repeatLater,
  roundDone,
  sortCard,
  starsFor,
  SWIPE_SHARE,
  swipeVerdict,
} from "./study";

describe("a score in stars", () => {
  it.each([
    [0, 8, 0],
    [3, 8, 0],
    [4, 8, 1],
    [5, 8, 1],
    [6, 8, 2],
    [7, 8, 2],
    [8, 8, 3],
    [9, 10, 3],
    [0, 0, 0],
  ])("%d of %d is %d", (correct, total, stars) => {
    expect(starsFor(correct, total)).toBe(stars);
  });
});

describe("a round of flashcards", () => {
  it("each card goes to one of two piles, in the order it was met", () => {
    let round = newRound(allCards(4));
    expect(round.queue).toEqual([0, 1, 2, 3]);
    round = sortCard(round, true);
    round = sortCard(round, false);
    round = sortCard(round, false);
    expect(roundDone(round)).toBe(false);
    round = sortCard(round, true);
    expect(roundDone(round)).toBe(true);
    expect(round.known).toEqual([0, 3]);
    expect(round.later).toEqual([1, 2]);
  });

  it("the next round is only what was left for later", () => {
    let round = newRound(allCards(3));
    round = sortCard(sortCard(sortCard(round, false), true), false);
    const again = repeatLater(round);
    expect(again.queue).toEqual([0, 2]);
    expect(again.known).toEqual([]);
    expect(again.later).toEqual([]);
  });

  it("sorting with no card left changes nothing", () => {
    const empty = newRound([]);
    expect(sortCard(empty, true)).toBe(empty);
    expect(roundDone(empty)).toBe(true);
  });

  it("never changes the round it was given", () => {
    const round = newRound([5, 6]);
    sortCard(round, true);
    expect(round).toEqual({ queue: [5, 6], known: [], later: [] });
  });
});

describe("a swipe", () => {
  it("counts only past its share of the card, right is 'know', left is 'later'", () => {
    const width = 300;
    const edge = width * SWIPE_SHARE;
    expect(swipeVerdict(edge - 1, width)).toBeNull();
    expect(swipeVerdict(-(edge - 1), width)).toBeNull();
    expect(swipeVerdict(edge, width)).toBe("know");
    expect(swipeVerdict(-edge, width)).toBe("later");
    expect(swipeVerdict(500, 0)).toBeNull();
  });
});
