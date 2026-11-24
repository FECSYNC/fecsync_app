import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import type { MarketingAutomationKind } from "@/lib/marketing/types";
import { buildUnsubscribeUrl } from "@/lib/marketing/unsubscribe";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type TemplateVars = {
  guestFirstName?: string;
  orgName?: string;
  websiteUrl?: string;
  partyCtaUrl?: string;
  bookAgainUrl?: string;
  promoUrl?: string;
  surveyUrl?: string;
  unsubscribeUrl?: string;
};

const DEFAULTS: Record<
  MarketingAutomationKind,
  { subject: string; htmlBody: string }
> = {
  welcome: {
    subject: "Welcome — we’re glad you visited",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>Thanks for visiting {{orgName}}. Explore what’s next on our website:</p>
<p><a href="{{websiteUrl}}">Visit our website</a></p>
<p><a href="{{unsubscribeUrl}}">Unsubscribe from promotional emails</a></p>`,
  },
  birthday: {
    subject: "Celebrate your birthday with us",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>Your birthday is coming up — book a party or celebration with {{orgName}}:</p>
<p><a href="{{partyCtaUrl}}">Plan your party</a></p>
<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  reengagement: {
    subject: "We miss you at {{orgName}}",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>It’s been a while since your last visit. Come back soon:</p>
<p><a href="{{bookAgainUrl}}">Book again</a></p>
<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  post_visit_survey: {
    subject: "How was your visit?",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>We’d love your feedback about {{orgName}}:</p>
<p><a href="{{surveyUrl}}">Take a short survey</a></p>
<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  newsletter_confirm: {
    subject: "You’re subscribed",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>Thanks for subscribing to updates from {{orgName}}.</p>
<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  survey_thank_you: {
    subject: "Thanks for your feedback",
    htmlBody: `<p>Hi {{guestFirstName}},</p>
<p>Thank you for completing our survey.</p>
{{promoBlock}}
<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
};

function applyVars(template: string, vars: TemplateVars): string {
  let out = template;
  const map: Record<string, string | undefined> = {
    guestFirstName: vars.guestFirstName ?? "there",
    orgName: vars.orgName ?? "our park",
    websiteUrl: vars.websiteUrl ?? "#",
    partyCtaUrl: vars.partyCtaUrl ?? "#",
    bookAgainUrl: vars.bookAgainUrl ?? "#",
    promoUrl: vars.promoUrl ?? "",
    surveyUrl: vars.surveyUrl ?? "#",
    unsubscribeUrl: vars.unsubscribeUrl ?? "#",
  };
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`{{${key}}}`).join(escapeHtml(value ?? ""));
  }
  const promoBlock = vars.promoUrl?.trim()
    ? `<p><a href="${escapeHtml(vars.promoUrl)}">View your offer</a></p>`
    : "";
  out = out.replace("{{promoBlock}}", promoBlock);
  return out;
}

export async function getTemplate(
  orgId: string,
  kind: MarketingAutomationKind
): Promise<{ subject: string; htmlBody: string; templateKey: string }> {
  const id = requireId(orgId, "orgId");
  const custom = await prisma.marketingAutomationTemplate.findUnique({
    where: { orgId_kind: { orgId: id, kind } },
  });
  const fallback = DEFAULTS[kind];
  return {
    subject: custom?.subject ?? fallback.subject,
    htmlBody: custom?.htmlBody ?? fallback.htmlBody,
    templateKey: custom ? `custom:${kind}` : `default:${kind}`,
  };
}

export async function resolveCtaUrls(input: {
  orgId: string;
  orgSlug?: string | null;
  settings: {
    websiteCtaUrl?: string | null;
    partyBookingCtaPath?: string | null;
    partyCategorySlug?: string | null;
    promoCodeOrUrl?: string | null;
  };
}): Promise<{
  websiteUrl: string;
  partyCtaUrl: string;
  bookAgainUrl: string;
  promoUrl: string | null;
}> {
  const base = publicAppBaseUrl();
  const slug =
    input.orgSlug ??
    (
      await prisma.organization.findUnique({
        where: { id: input.orgId },
        select: { slug: true },
      })
    )?.slug;

  const websiteUrl =
    input.settings.websiteCtaUrl?.trim() ||
    (slug ? `${base}/${slug}` : base);

  let partyCtaUrl = input.settings.partyBookingCtaPath?.trim() || "";
  if (!partyCtaUrl && input.settings.partyCategorySlug?.trim() && slug) {
    partyCtaUrl = `${base}/${slug}/${input.settings.partyCategorySlug.trim()}`;
  }
  // Prefer an active company category page whose slug looks like birthday/party.
  if (!partyCtaUrl && slug) {
    const categoryPage = await prisma.publicCategoryPage.findFirst({
      where: {
        orgId: input.orgId,
        active: true,
        kind: "booking",
        OR: [
          { slug: { contains: "birthday", mode: "insensitive" } },
          { slug: { contains: "party", mode: "insensitive" } },
        ],
      },
      select: { slug: true },
      orderBy: { updatedAt: "desc" },
    });
    if (categoryPage) {
      partyCtaUrl = `${base}/${slug}/${categoryPage.slug}`;
    }
  }
  // Documented fallback: public venue book path (not /{orgSlug}/book).
  if (!partyCtaUrl) {
    const venue = await prisma.venueLocation.findFirst({
      where: {
        orgId: input.orgId,
        publicBookingEnabled: true,
        status: "active",
        archivedAt: null,
      },
      select: { slug: true },
      orderBy: { name: "asc" },
    });
    if (venue) {
      partyCtaUrl = `${base}/book/${venue.slug}`;
    }
  }
  if (!partyCtaUrl) {
    partyCtaUrl = websiteUrl;
  }

  const bookAgainUrl = partyCtaUrl || websiteUrl;
  const promoUrl = input.settings.promoCodeOrUrl?.trim() || null;

  return { websiteUrl, partyCtaUrl, bookAgainUrl, promoUrl };
}

export async function renderMarketingTemplate(input: {
  orgId: string;
  kind: MarketingAutomationKind;
  guestProfileId: string;
  guestFirstName: string;
  orgName: string;
  orgSlug?: string | null;
  settings: {
    websiteCtaUrl?: string | null;
    partyBookingCtaPath?: string | null;
    partyCategorySlug?: string | null;
    promoCodeOrUrl?: string | null;
  };
  surveyUrl?: string;
}): Promise<{ subject: string; html: string; templateKey: string }> {
  const tpl = await getTemplate(input.orgId, input.kind);
  const ctas = await resolveCtaUrls({
    orgId: input.orgId,
    orgSlug: input.orgSlug,
    settings: input.settings,
  });
  const unsubscribeUrl = buildUnsubscribeUrl(input.orgId, input.guestProfileId);
  const vars: TemplateVars = {
    guestFirstName: input.guestFirstName,
    orgName: input.orgName,
    websiteUrl: ctas.websiteUrl,
    partyCtaUrl: ctas.partyCtaUrl,
    bookAgainUrl: ctas.bookAgainUrl,
    promoUrl: ctas.promoUrl ?? undefined,
    surveyUrl: input.surveyUrl,
    unsubscribeUrl,
  };
  return {
    subject: applyVars(tpl.subject, vars),
    html: applyVars(tpl.htmlBody, vars),
    templateKey: tpl.templateKey,
  };
}
