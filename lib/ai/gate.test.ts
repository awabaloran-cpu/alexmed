import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiGateState,
  aiMaxConcurrent,
  noteGatewayBusy,
  resetAiGateForTests,
  withAiSlot,
} from "./gate";

// A task the test finishes by hand.
function held() {
  let finish!: (value: string) => void;
  let fail!: (error: Error) => void;
  const done = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { done, finish, fail };
}

describe("the gate in front of the AI gateway", () => {
  const saved = process.env.AI_MAX_CONCURRENT;

  beforeEach(() => {
    process.env.AI_MAX_CONCURRENT = "2";
    resetAiGateForTests();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_MAX_CONCURRENT;
    else process.env.AI_MAX_CONCURRENT = saved;
    vi.useRealTimers();
    resetAiGateForTests();
  });

  it("reads its size from the environment, with a sane default", () => {
    expect(aiMaxConcurrent()).toBe(2);
    process.env.AI_MAX_CONCURRENT = "0";
    expect(aiMaxConcurrent()).toBe(6);
    process.env.AI_MAX_CONCURRENT = "abc";
    expect(aiMaxConcurrent()).toBe(6);
    process.env.AI_MAX_CONCURRENT = "500";
    expect(aiMaxConcurrent()).toBe(64);
  });

  it("lets only so many run at once, and the rest in the order they came", async () => {
    const tasks = [held(), held(), held(), held()];
    const started: number[] = [];
    const results = tasks.map((task, i) =>
      withAiSlot(() => {
        started.push(i);
        return task.done;
      })
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(aiGateState()).toMatchObject({ inFlight: 2, waiting: 2 });

    tasks[1].finish("b");
    await results[1];
    expect(started).toEqual([0, 1, 2]);

    tasks[0].finish("a");
    await results[0];
    expect(started).toEqual([0, 1, 2, 3]);

    tasks[2].finish("c");
    tasks[3].finish("d");
    expect(await Promise.all(results)).toEqual(["a", "b", "c", "d"]);
    expect(aiGateState()).toMatchObject({ inFlight: 0, waiting: 0 });
  });

  it("a failed call gives its slot back", async () => {
    const first = held();
    const failing = withAiSlot(() => first.done);
    first.fail(new Error("boom"));
    await expect(failing).rejects.toThrow("boom");
    expect(aiGateState().inFlight).toBe(0);
    await expect(withAiSlot(async () => "next")).resolves.toBe("next");
  });

  it("a call arriving as a slot frees does not jump the line", async () => {
    process.env.AI_MAX_CONCURRENT = "1";
    const first = held();
    const order: string[] = [];
    const a = withAiSlot(() => first.done);
    const b = withAiSlot(async () => order.push("waiting one"));
    first.finish("done");
    await a;
    // Arrives after the slot was freed but before the waiting one ran.
    const c = withAiSlot(async () => order.push("late one"));
    await Promise.all([b, c]);
    expect(order).toEqual(["waiting one", "late one"]);
  });

  it("holds new calls back while the gateway says it is busy", async () => {
    vi.useFakeTimers();
    noteGatewayBusy(5_000);
    let ran = false;
    const call = withAiSlot(async () => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await call;
    expect(ran).toBe(true);
    // The pause is capped: a wild value cannot close the gate for long.
    noteGatewayBusy(10 * 60_000);
    expect(aiGateState().pausedForMs).toBeLessThanOrEqual(20_000);
  });
});
