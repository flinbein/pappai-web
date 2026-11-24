// An event received during a read can describe a change missing from that snapshot.
// Waiters share the next authoritative result, including a trailing read when needed.
export function snapshotReader<T>(read: () => Promise<T>, apply: (snapshot: T) => void) {
  let running: Promise<void> | undefined;
  let dirty = false;
  async function drain() {
    try {
      while (dirty) {
        dirty = false;
        try {
          const snapshot = await read();
          if (!dirty) apply(snapshot);
        } catch (error) {
          if (!dirty) throw error;
        }
      }
    } finally {
      running = undefined;
    }
  }
  return () => {
    dirty = true;
    return running ??= Promise.resolve().then(drain);
  };
}
