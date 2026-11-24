import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  uploadSingleFile,
  safeCloudinaryFolder,
  isUploadFile,
} from "@/lib/upload";
import { stampUpdate } from "@/lib/audit/recordAudit";
import {
  getTailoringJobById,
  resolveJobAccessRole,
} from "@/lib/tailoringJobs";
import prisma from "@/lib/prisma";
import { idWhere } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 8;

/**
 * POST /api/tailoring-jobs/[id]/reference-images
 * Customer owner only — upload reference image while job is still submitted/draft.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailoringJobsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/tailoring-jobs/[id]/reference-images", {
          permission: P.TailoringJobsWriteOwn,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await params;
    const job = await getTailoringJobById(id);
    if (!job) return notFound("Tailoring job not found");

    const role = await resolveJobAccessRole({
      job,
      actorSub: actor.sub,
      isStaff: false,
    });
    if (role !== "customer") return forbidden("Only the customer can upload");
    if (job.status !== "submitted" && job.status !== "draft") {
      return badRequest("Cannot add images after the job leaves submitted");
    }
    if (job.referenceImages.length >= MAX_IMAGES) {
      return badRequest(`At most ${MAX_IMAGES} reference images`);
    }

    const formData = await req.formData();
    const folder = safeCloudinaryFolder("tailoring-jobs");
    const uploadedFile = formData.get("file");
    if (!isUploadFile(uploadedFile)) {
      return badRequest("No file provided");
    }
    if (uploadedFile.size > MAX_BYTES) {
      return badRequest("Image must be 8MB or smaller");
    }
    const mime = typeof uploadedFile.type === "string" ? uploadedFile.type : "";
    if (mime && !mime.startsWith("image/")) {
      return badRequest("Only image uploads are allowed");
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const filename = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const uploadResult = await uploadSingleFile(
      buffer,
      filename,
      folder,
      "image"
    );
    const { secure_url } = uploadResult as { secure_url: string };

    const audit = await stampUpdate(actor.sub);
    const existing = await prisma.tailoringJob.findFirst({
      where: { ...idWhere(id), customerId: actor.sub },
    });
    if (!existing) return notFound("Tailoring job not found");

    await prisma.tailoringJob.update({
      where: { id: existing.id },
      data: {
        referenceImages: [...(existing.referenceImages ?? []), secure_url],
        ...auditUpdateToPrisma(audit),
      },
    });

    const updated = await getTailoringJobById(existing.id);
    if (!updated) return notFound("Tailoring job not found");

    return ok({
      job: updated,
      url: secure_url,
      message: "Image uploaded",
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Job reference image upload error:", err);
    return serverError("Upload failed");
  }
}
