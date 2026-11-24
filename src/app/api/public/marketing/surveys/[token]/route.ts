export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, notFound } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import prisma from "@/lib/prisma";
import { getInviteByToken } from "@/lib/marketing/surveys";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const limited = apiRateLimited(request, "public-marketing-survey", 30, 60_000);
  if (limited) return limited;

  try {
    await connectDB();
    const { token } = await context.params;
    const loaded = await getInviteByToken(token);
    if (!loaded) return notFound("Survey not found or expired");
    if (!loaded.invite.openedAt) {
      await prisma.guestSurveyInvite
        .updateMany({
          where: { id: loaded.invite.id, openedAt: null },
          data: { openedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return ok({
      survey: {
        id: loaded.survey.id,
        name: loaded.survey.name,
        questions: loaded.survey.questions,
        thankYouMessage: loaded.survey.thankYouMessage,
        promoUrl: loaded.survey.promoUrl,
      },
      invite: {
        completedAt: loaded.invite.completedAt,
      },
    });
  } catch {
    return notFound("Survey not found");
  }
}
