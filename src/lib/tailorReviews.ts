import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { storefrontOrgFilter } from "@/lib/org";
import { paginatedMeta, type PaginationOpts } from "@/lib/pagination";

export type TailorReviewDto = {
  _id: string;
  rating: number;
  comment: string;
  /** Present on create response; omitted from public list for privacy. */
  jobId?: string;
  createdAt?: string;
  authorName?: string;
};

async function recomputeTailorRating(
  tailorProfileId: string,
  client: Pick<typeof prisma, "tailorReview" | "tailorProfile"> = prisma
): Promise<{ avgRating: number; reviewCount: number }> {
  const rows = await client.tailorReview.findMany({
    where: { tailorProfileId },
    select: { rating: true },
  });
  const reviewCount = rows.length;
  const avgRating =
    reviewCount === 0
      ? 0
      : Math.round(
          (rows.reduce((acc, r) => acc + Number(r.rating || 0), 0) /
            reviewCount) *
            10
        ) / 10;

  await client.tailorProfile.update({
    where: { id: tailorProfileId },
    data: { avgRating, reviewCount },
  });

  return { avgRating, reviewCount };
}

/** Recompute cached avgRating/reviewCount when stored values drift from live rows. */
export async function syncTailorProfileRatingsIfNeeded(
  tailorProfileId: string,
  opts?: {
    storedReviewCount?: number | null;
    /** When already counted (e.g. list query), skip a second count. */
    liveReviewCount?: number;
  }
): Promise<{ avgRating: number; reviewCount: number }> {
  await dbConnect();
  const actual =
    typeof opts?.liveReviewCount === "number"
      ? opts.liveReviewCount
      : await prisma.tailorReview.count({
          where: { tailorProfileId },
        });
  if (
    typeof opts?.storedReviewCount === "number" &&
    opts.storedReviewCount === actual
  ) {
    const profile = await prisma.tailorProfile.findUnique({
      where: { id: tailorProfileId },
      select: { avgRating: true },
    });
    return {
      avgRating:
        typeof profile?.avgRating === "number" ? profile.avgRating : 0,
      reviewCount: actual,
    };
  }
  return recomputeTailorRating(tailorProfileId);
}

export async function listTailorReviewsBySlug(
  slug: string,
  opts?: PaginationOpts
): Promise<{
  reviews: TailorReviewDto[];
  avgRating: number;
  reviewCount: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  await dbConnect();
  const { orgId } = await storefrontOrgFilter();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const profile = await prisma.tailorProfile.findFirst({
    where: {
      orgId,
      slug: slug.trim().toLowerCase(),
      status: "approved",
    },
    select: { id: true, avgRating: true, reviewCount: true },
  });
  if (!profile) {
    throw new Error("Tailor not found");
  }

  const where = { tailorProfileId: profile.id };
  const [total, rows] = await Promise.all([
    prisma.tailorReview.count({ where }),
    prisma.tailorReview.findMany({
      where,
      include: {
        user: {
          select: { firstName: true, lastName: true, username: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const reviews: TailorReviewDto[] = rows.map((row) => {
    const user = row.user;
    const name = user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.username ||
        "Customer"
      : "Customer";
    return {
      _id: row.id,
      rating: Number(row.rating),
      comment: String(row.comment ?? ""),
      createdAt: row.createdAt.toISOString(),
      authorName: name,
    };
  });

  const { avgRating, reviewCount } = await syncTailorProfileRatingsIfNeeded(
    profile.id,
    { storedReviewCount: profile.reviewCount, liveReviewCount: total }
  );

  return {
    reviews,
    avgRating,
    reviewCount,
    ...paginatedMeta(page, limit, total),
  };
}

export async function createTailorReview(input: {
  slug: string;
  customerId: string;
  jobId: string;
  rating: number;
  comment?: string;
}): Promise<TailorReviewDto> {
  await dbConnect();
  const { orgId } = await storefrontOrgFilter();
  if (!isValidId(input.jobId)) {
    throw new Error("Job not found");
  }
  const rating = Number(input.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }

  const profile = await prisma.tailorProfile.findFirst({
    where: {
      orgId,
      slug: input.slug.trim().toLowerCase(),
      status: "approved",
    },
    select: { id: true },
  });
  if (!profile) throw new Error("Tailor not found");

  const job = await prisma.tailoringJob.findFirst({
    where: {
      ...idWhere(input.jobId),
      orgId,
      customerId: input.customerId,
    },
  });
  if (!job) throw new Error("Job not found");
  if (job.tailorProfileId !== profile.id) {
    throw new Error("Job does not belong to this tailor");
  }
  if (job.status !== "completed") {
    throw new Error("Reviews are only allowed after the job is completed");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.tailorReview.findUnique({
        where: { jobId: job.id },
        select: { id: true },
      });
      if (existing) {
        throw new Error("You already reviewed this job");
      }

      const created = await tx.tailorReview.create({
        data: {
          userId: input.customerId,
          tailorProfileId: profile.id,
          jobId: job.id,
          rating: Math.round(rating),
          comment: (input.comment ?? "").trim().slice(0, 1000),
        },
      });

      await recomputeTailorRating(profile.id, tx);

      return created;
    });

    return {
      _id: result.id,
      rating: result.rating,
      comment: result.comment ?? "",
      jobId: job.id,
      createdAt: result.createdAt.toISOString(),
    };
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "P2002") {
      throw new Error("You already reviewed this job");
    }
    throw err;
  }
}

export async function customerCanReviewJob(input: {
  customerId: string;
  jobId: string;
}): Promise<boolean> {
  await dbConnect();
  if (!isValidId(input.jobId)) return false;
  const { orgId } = await storefrontOrgFilter();
  const job = await prisma.tailoringJob.findFirst({
    where: {
      ...idWhere(input.jobId),
      orgId,
      customerId: input.customerId,
      status: "completed",
    },
    select: { id: true, tailorProfileId: true },
  });
  if (!job) return false;

  const tailor = await prisma.tailorProfile.findFirst({
    where: {
      id: job.tailorProfileId,
      orgId,
      status: "approved",
    },
    select: { id: true },
  });
  if (!tailor) return false;

  const existing = await prisma.tailorReview.findUnique({
    where: { jobId: job.id },
    select: { id: true },
  });
  return !existing;
}

export async function jobHasTailorReview(jobId: string): Promise<boolean> {
  await dbConnect();
  if (!isValidId(jobId)) return false;
  const existing = await prisma.tailorReview.findUnique({
    where: { jobId },
    select: { id: true },
  });
  return Boolean(existing);
}
