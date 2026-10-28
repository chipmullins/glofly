// Reading Postgres errors through Drizzle's "Failed query" wrapper (no imports: easy to test).

/** Postgres's error code (23505 duplicate, 23503 missing reference), through Drizzle's wrapper. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

/**
 * Drizzle's "Failed query: …" hides why Postgres refused it (Oct 28, 2026: a push registration
 * report said nothing about the cause). The error's code, constraint and table come first, so
 * Control → Errors says which rule was broken. Never the values: those stay out of reports.
 */
export function withDatabaseReason(err: unknown, message: string): string {
  const cause = (err as { cause?: { code?: unknown; constraint?: unknown; table?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : null;
  if (!code) return message;
  const parts = [`Postgres ${code}`];
  if (typeof cause?.constraint === "string") parts.push(cause.constraint);
  else if (typeof cause?.table === "string") parts.push(cause.table);
  return `${parts.join(" ")}: ${message}`;
}
