/**
 * Shared cap for bulk timeslot create (product wizard + schedule wizard + API).
 * One HTTP request + createMany stays fast; multi-million rows need batched jobs.
 */
export const BULK_SESSION_LIMIT = 10_000;

/** Insert chunk size inside one DB transaction. */
export const BULK_SESSION_CREATE_CHUNK = 1_000;
