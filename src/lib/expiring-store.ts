// Bounded, self-pruning key/value store for short-lived process-local state
// (session capabilities, pending elicitations, in-memory rate-limit buckets).
//
// Plain module-level Maps only drop an entry when that exact key is read
// again, so abandoned keys accumulate for the lifetime of the process. This
// store sweeps expired entries at most once per `sweepIntervalMs` on write
// and evicts the oldest entry once `maxEntries` is reached.

export type ExpiringStoreOptions = {
  maxEntries: number;
  sweepIntervalMs?: number;
};

type Entry<V> = { value: V; expiresAt: number };

/** Remove every entry whose expiry (as returned by `expiryOf`) is at or before `now`. */
export function pruneExpired<V>(
  map: Map<string, V>,
  expiryOf: (value: V) => number,
  now = Date.now(),
): void {
  for (const [key, value] of map) {
    if (expiryOf(value) <= now) map.delete(key);
  }
}

export function createExpiringStore<V>({
  maxEntries,
  sweepIntervalMs = 60_000,
}: ExpiringStoreOptions) {
  const entries = new Map<string, Entry<V>>();
  let lastSweep = 0;

  function maybeSweep(now: number) {
    if (now - lastSweep < sweepIntervalMs) return;
    lastSweep = now;
    pruneExpired(entries, (entry) => entry.expiresAt, now);
  }

  function get(key: string, now = Date.now()): V | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  return {
    get,
    set(key: string, value: V, ttlMs: number, now = Date.now()): void {
      maybeSweep(now);
      entries.delete(key);
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      entries.set(key, { value, expiresAt: now + ttlMs });
    },
    /** Read and remove in one step (single-use values). */
    take(key: string, now = Date.now()): V | undefined {
      const value = get(key, now);
      entries.delete(key);
      return value;
    },
    delete(key: string): void {
      entries.delete(key);
    },
    get size(): number {
      return entries.size;
    },
  };
}
