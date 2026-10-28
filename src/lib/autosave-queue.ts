/**
 * Serializes autosave so an older in-flight PUT cannot "win" over a newer edit.
 * While a save runs, further request() calls mark pending; after finish, one
 * trailing save runs with a fresh getSnapshot() / getVersion().
 */
export type AutosaveState = "saving" | "synced" | "conflict" | "offline";

export type AutosaveQueueOptions<T> = {
  getSnapshot: () => T;
  getVersion: () => number | undefined;
  setVersion: (version: number) => void;
  save: (snapshot: T, expectedVersion: number | undefined) => Promise<number | false>;
  onState?: (state: AutosaveState) => void;
  isConflict?: (error: unknown) => boolean;
};

export type AutosaveQueue = {
  /** Schedule a save of the current snapshot (coalesces while in flight). */
  request: () => void;
  /** True while a save promise is outstanding. */
  get busy(): boolean;
};

export function createAutosaveQueue<T>(options: AutosaveQueueOptions<T>): AutosaveQueue {
  let inFlight = false;
  let pending = false;
  let generation = 0;

  async function run(): Promise<void> {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    const gen = ++generation;
    const snapshot = options.getSnapshot();
    const expectedVersion = options.getVersion();
    options.onState?.("saving");
    try {
      const version = await options.save(snapshot, expectedVersion);
      if (typeof version === "number") options.setVersion(version);
      if (gen === generation && !pending) options.onState?.("synced");
    } catch (error) {
      if (gen !== generation || pending) {
        /* trailing run will retry with the latest snapshot */
      } else if (options.isConflict?.(error)) {
        options.onState?.("conflict");
      } else {
        options.onState?.("offline");
      }
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        await run();
      }
    }
  }

  return {
    request() {
      void run();
    },
    get busy() {
      return inFlight;
    },
  };
}
