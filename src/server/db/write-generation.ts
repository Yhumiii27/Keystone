// Write generation of this server process (R-017): a counter bumped by every write statement Keystone sends (`writeLogger`, the
// Drizzle logger of the handles opened by ./open.ts and ./postgres.ts) and by every committed transaction (./transactions.ts).
// The short-lived caches of src/server/cache/read-cache.ts (`ttlRead`: the shell's badges) drop their entries when it moves,
// so a viewer sees the effect of a write made through this process on the next page. Plain module (no server-only): the transaction wrappers
// and the scripts load it too.
const g = globalThis as unknown as { __ksWriteGeneration?: number };

/** Current write generation of the process. */
export const writeGeneration = (): number => g.__ksWriteGeneration ?? 0;

/** Marks a write (the caches keyed on the generation are dropped). */
export function bumpWriteGeneration(): void {
  g.__ksWriteGeneration = writeGeneration() + 1;
}

/** True for an SQL statement that writes (insert, update, delete, truncate, merge — also inside a WITH). */
export function isWriteStatement(query: string): boolean {
  return /^\s*(insert|update|delete|truncate|merge)\b/i.test(query) || /\b(insert\s+into|delete\s+from|truncate\s+table)\b/i.test(query) || /\bupdate\s+"?[\w.]+"?\s+(as\s+\w+\s+)?set\b/i.test(query);
}

/** Drizzle logger of Keystone's handles: logs nothing, bumps the write generation on a write statement. */
export const writeLogger = {
  logQuery(query: string): void {
    if (isWriteStatement(query)) bumpWriteGeneration();
  },
};
