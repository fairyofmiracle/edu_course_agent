import { describe, expect, it, vi } from "vitest";
import { createAutosaveQueue } from "./autosave-queue";

function flush() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("createAutosaveQueue", () => {
  it("keeps only a trailing save with the latest snapshot when requests overlap", async () => {
    let current = "A";
    let version: number | undefined = 0;
    const saved: string[] = [];
    const states: string[] = [];
    const gate: { release!: (version: number) => void } = {} as {
      release: (version: number) => void;
    };

    const queue = createAutosaveQueue({
      getSnapshot: () => current,
      getVersion: () => version,
      setVersion: (next) => {
        version = next;
      },
      onState: (state) => states.push(state),
      isConflict: () => false,
      save: (snapshot, expectedVersion) =>
        new Promise((resolve) => {
          saved.push(`${snapshot}@${expectedVersion}`);
          if (saved.length === 1) {
            gate.release = (next) => resolve(next);
          } else {
            resolve((expectedVersion ?? 0) + 1);
          }
        }),
    });

    queue.request();
    await flush();
    expect(saved).toEqual(["A@0"]);
    expect(queue.busy).toBe(true);

    current = "B";
    queue.request();
    current = "C";
    queue.request();
    expect(saved).toEqual(["A@0"]);

    gate.release(1);
    await flush();
    await flush();

    expect(saved).toEqual(["A@0", "C@1"]);
    expect(version).toBe(2);
    expect(states.at(-1)).toBe("synced");
    expect(queue.busy).toBe(false);
  });

  it("does not mark synced from a superseded failure when a trailing save is pending", async () => {
    let current = "old";
    let version: number | undefined = 3;
    const states: string[] = [];
    let rejectFirst!: (error: Error) => void;

    const queue = createAutosaveQueue({
      getSnapshot: () => current,
      getVersion: () => version,
      setVersion: (next) => {
        version = next;
      },
      onState: (state) => states.push(state),
      isConflict: (error) => error instanceof Error && error.message === "conflict",
      save: (snapshot) =>
        new Promise((resolve, reject) => {
          if (snapshot === "old") {
            rejectFirst = reject;
            return;
          }
          resolve(4);
        }),
    });

    queue.request();
    await flush();
    current = "new";
    queue.request();
    rejectFirst(new Error("conflict"));
    await flush();
    await flush();

    expect(states).toEqual(["saving", "saving", "synced"]);
    expect(version).toBe(4);
  });
});
