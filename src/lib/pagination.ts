/** Shared list pagination — safe for API routes and lib layer. */

export type PaginationOpts = {
  page?: number;
  limit?: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function parsePagination(
  rawPage: string | null | undefined,
  rawLimit: string | null | undefined,
  defaults?: { page?: number; limit?: number; maxLimit?: number }
): PaginationMeta & { skip: number } {
  const page = Math.max(1, Number(rawPage) || defaults?.page || 1);
  const maxLimit = defaults?.maxLimit ?? 50;
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number(rawLimit) || defaults?.limit || 20)
  );
  const skip = (page - 1) * limit;
  return {
    page,
    limit,
    skip,
    total: 0,
    totalPages: 1,
  };
}

export function paginatedMeta(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
