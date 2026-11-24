export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { uploadSingleFile, safeCloudinaryFolder, isUploadFile } from "@/lib/upload";
import { ok, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import {
  ensureProfileForUser,
  formatProfileForApi,
  loadProfileUser,
} from "@/lib/models/Profile";

const MAX_PROFILE_BYTES = 5 * 1024 * 1024;

// POST /api/auth/profile/picture — session user's profile only.
export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await dbConnect();

        const formData = await request.formData();
        // Always land in profile-pictures — ignore client folder tricks.
        const folder = safeCloudinaryFolder("profile-pictures");
        const uploadedFile = formData.get("file");

        if (!isUploadFile(uploadedFile)) {
            return badRequest("No file provided");
        }
        if (uploadedFile.size > MAX_PROFILE_BYTES) {
            return badRequest("Image must be 5MB or smaller");
        }
        const mime = typeof uploadedFile.type === "string" ? uploadedFile.type : "";
        if (mime && !mime.startsWith("image/")) {
            return badRequest("Only image uploads are allowed");
        }

        const buffer = Buffer.from(await uploadedFile.arrayBuffer());
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const filename = `file_${timestamp}_${randomString}`;

        const uploadResult = await uploadSingleFile(buffer, filename, folder, "image");
        const { secure_url } = uploadResult as { secure_url: string };

        let profileRow = await ensureProfileForUser(actor.sub, {
            profilePicture: secure_url,
        });
        if (profileRow.profilePicture !== secure_url) {
            profileRow = await prisma.profile.update({
                where: { id: profileRow.id },
                data: { profilePicture: secure_url },
            });
        }

        const user = await loadProfileUser(actor.sub);
        if (!user) {
            return serverError("Unable to load profile user");
        }
        return ok(formatProfileForApi(profileRow, user));
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Upload error:", error);
        return serverError("Upload failed");
    }
}
