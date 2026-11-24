import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { isValidId, idWhere } from "@/lib/ids";
import type { Prisma } from "@prisma/client";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { getClientIp } from "@/lib/utils";
import { withStorefrontOrg } from "@/lib/org";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SEARCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "you",
  "are",
  "can",
  "what",
  "show",
  "find",
  "help",
  "please",
  "kind",
  "have",
  "that",
  "this",
  "some",
  "want",
  "need",
  "like",
  "about",
  "friend",
  "friends",
  "wedding",
  "wear",
  "wears",
  "use",
  "using",
]);

const FASHION_KEYWORD_RE =
  /\b(agbada|kaftan|senator|aso[\s-]?ebi|ankara|lace|native|buba|sokoto|gown|boubou|dashiki|traditional|brocade|aso\s*oke)\b/gi;

function detectFashionGender(
  message: string
): "male" | "female" | undefined {
  if (/\b(men|man|male|groom|grooms|him|his|boys)\b/i.test(message)) {
    return "male";
  }
  if (/\b(women|woman|female|bride|brides|her|ladies|girls)\b/i.test(message)) {
    return "female";
  }
  return undefined;
}

function extractFashionSearchTerms(message: string): string[] {
  const keywords = [...message.matchAll(FASHION_KEYWORD_RE)].map((m) =>
    m[0].toLowerCase().replace(/\s+/g, " ")
  );
  const words = message
    .toLowerCase()
    .split(/[\s,.?!;:]+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w));
  return [...new Set([...keywords, ...words])].slice(0, 8);
}

function simplifyProductRow(p: {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  description: string;
  images?: string[];
}): SimplifiedProduct {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.categoryId,
    description: p.description,
    image_url: p.images?.length ? p.images[0] : "",
  };
}

async function browseFashionProducts(
  orgFilter: { orgId: string },
  opts?: { gender?: string; limit?: number }
): Promise<SimplifiedProduct[]> {
  const products = await prisma.product.findMany({
    where: {
      orgId: orgFilter.orgId,
      ...(opts?.gender ? { gender: opts.gender as "male" | "female" | "unisex" | "non_binary" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 5,
    select: {
      id: true,
      name: true,
      price: true,
      categoryId: true,
      description: true,
      images: true,
    },
  });
  return products.map((p) => simplifyProductRow(p));
}

export function responseIncludesProductCards(text: string): boolean {
  return (
    /\/shop\/[a-f0-9]{24}/i.test(text) ||
    /\[!\[.*?\]\([^)]+\)\]\([^)]+\)/.test(text)
  );
}

export async function fashionChatIdentity(req: NextRequest): Promise<{
  userId: string | null;
  ip: string | null;
}> {
  try {
    const actor = await requireAuthActiveAccount(req);
    return { userId: actor.sub, ip: null };
  } catch {
    return { userId: null, ip: getClientIp(req) };
  }
}

export type SimplifiedProduct = {
  id: unknown;
  name: string;
  price: unknown;
  category: unknown;
  description: unknown;
  image_url: string;
};

export function buildProductCardsMarkdown(foundProducts: SimplifiedProduct[]): string {
  const productCards = foundProducts
    .map((p) => {
      const imgUrl = p.image_url || "";
      const productLink = `/shop/${p.id}`;
      let card = `**${p.name}**`;
      if (p.price) card += ` — ₦${Number(p.price).toLocaleString()}`;
      card += `\n`;
      if (imgUrl) {
        card += `[![${p.name}](${imgUrl})](${productLink})`;
      } else {
        card += `[View Product](${productLink})`;
      }
      return card;
    })
    .join("\n\n");
  return `Here are some items I found for you:\n\n${productCards}`;
}

export function finalizeRecommendations(
  content: string | null | undefined,
  foundProducts: SimplifiedProduct[]
): string {
  const recommendations = (content || "").trim();

  if (foundProducts.length > 0) {
    const cards = buildProductCardsMarkdown(foundProducts);
    if (!recommendations) return cards;
    if (!responseIncludesProductCards(recommendations)) {
      return `${recommendations}\n\n---\n\n${cards}`;
    }
    return recommendations;
  }

  if (recommendations) return recommendations;

  return (
    "I don't have matching items in the catalog for that right now, but I can still help with styling ideas and custom tailoring. " +
    "Share who you're dressing, the occasion, preferred colors or fabric, and budget — I'll suggest options."
  );
}

/** Server-side catalog lookup when the LLM cannot use native tools (e.g. Groq GPT-OSS). */
export async function prefetchFashionCatalog(
  userMessage: string,
  orgFilter: { orgId: string }
): Promise<{
  products: SimplifiedProduct[];
  catalogContext: string;
}> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return { products: [], catalogContext: "" };
  }

  const gender = detectFashionGender(trimmed);
  const terms = extractFashionSearchTerms(trimmed);
  const merged = new Map<string, SimplifiedProduct>();

  const absorb = (batch: SimplifiedProduct[]) => {
    for (const p of batch) {
      merged.set(String(p.id), p);
    }
  };

  const runSearch = async (search: string) => {
    const { foundProducts } = await runFashionToolCalls(
      [
        {
          id: `prefetch-${search}`,
          function: {
            name: "search_products",
            arguments: JSON.stringify({
              search,
              ...(gender ? { gender } : {}),
            }),
          },
        },
      ],
      orgFilter
    );
    absorb(foundProducts);
  };

  for (const term of terms) {
    await runSearch(term);
    if (merged.size >= 5) break;
  }

  if (merged.size === 0) {
    absorb(await browseFashionProducts(orgFilter, { gender, limit: 5 }));
  }

  const foundProducts = [...merged.values()].slice(0, 5);

  if (foundProducts.length === 0) {
    return {
      products: [],
      catalogContext:
        "CATALOG SEARCH: No matching products in stock for this query. " +
        "Give helpful styling advice and mention custom tailoring — do not invent product names.",
    };
  }

  const lines = foundProducts.map((p) => {
    const price =
      p.price != null && p.price !== ""
        ? `₦${Number(p.price).toLocaleString()}`
        : "price on request";
    return (
      `- **${p.name}** — ${price} — id: ${p.id}` +
      (p.image_url ? ` — image: ${p.image_url}` : "")
    );
  });

  return {
    products: foundProducts,
    catalogContext:
      `CATALOG SEARCH (${foundProducts.length} item${foundProducts.length === 1 ? "" : "s"} from our store):\n` +
      `${lines.join("\n")}\n` +
      "Mention these real items in your reply. Product image cards are added automatically below your message — focus on styling advice in text.",
  };
}

/**
 * Execute StyleForge tool calls (product search / human escalation).
 */
export async function runFashionToolCalls(
  toolCalls: unknown[],
  orgFilter: { orgId: string }
): Promise<{
  toolResults: Array<{
    tool_call_id: string;
    role: "tool";
    name: string;
    content: string;
  }>;
  handoffRequired: boolean;
  foundProducts: SimplifiedProduct[];
}> {
  const toolResults: Array<{
    tool_call_id: string;
    role: "tool";
    name: string;
    content: string;
  }> = [];
  let handoffRequired = false;
  let foundProducts: SimplifiedProduct[] = [];
  const orgId = orgFilter.orgId;

  for (const toolCall of toolCalls) {
    const call = toolCall as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    if (!call.function?.name) continue;

    const name = call.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      args = {};
    }

    if (name === "search_products") {
      const { search, category, gender, minPrice, maxPrice, fabricType } = args;
      const where: Prisma.ProductWhereInput = {
        orgId,
      };

      if (typeof category === "string" && category) {
        if (isValidId(category)) {
          const catById = await prisma.productCategory.findFirst({
            where: { orgId, ...idWhere(category) },
          });
          if (catById) where.categoryId = catById.id;
        } else {
          const cat =
            (await prisma.productCategory.findFirst({
              where: {
                orgId,
                name: { equals: category, mode: "insensitive" },
              },
            })) ??
            (await prisma.productCategory.findFirst({
              where: {
                orgId,
                name: { contains: category, mode: "insensitive" },
              },
            }));
          if (cat) where.categoryId = cat.id;
        }
      }

      if (typeof fabricType === "string" && fabricType) {
        if (isValidId(fabricType)) {
          const fabById = await prisma.fabric.findFirst({
            where: { orgId, ...idWhere(fabricType) },
          });
          if (fabById) where.fabricTypeId = fabById.id;
        } else {
          const fab =
            (await prisma.fabric.findFirst({
              where: {
                orgId,
                name: { equals: fabricType, mode: "insensitive" },
              },
            })) ??
            (await prisma.fabric.findFirst({
              where: {
                orgId,
                name: { contains: fabricType, mode: "insensitive" },
              },
            }));
          if (fab) where.fabricTypeId = fab.id;
        }
      }

      if (typeof gender === "string" && gender) {
        where.gender = gender as "male" | "female" | "unisex" | "non_binary";
      }
      if (minPrice || maxPrice) {
        where.price = {
          ...(minPrice ? { gte: Number(minPrice) } : {}),
          ...(maxPrice ? { lte: Number(maxPrice) } : {}),
        };
      }
      if (typeof search === "string" && search) {
        const terms = search
          .split(/[\s,+/]+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 2)
          .slice(0, 6);
        const searchTerms = terms.length > 0 ? terms : [search];
        where.OR = searchTerms.flatMap((term) => [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ]);
      }

      const products = await prisma.product.findMany({
        where,
        take: 5,
        select: {
          id: true,
          name: true,
          price: true,
          categoryId: true,
          description: true,
          images: true,
        },
      });
      const simplifiedProducts = products.map((p) => simplifyProductRow(p));
      foundProducts = simplifiedProducts;
      toolResults.push({
        tool_call_id: call.id || "",
        role: "tool",
        name,
        content: JSON.stringify({
          products: simplifiedProducts,
          count: simplifiedProducts.length,
          instruction:
            simplifiedProducts.length === 0
              ? "No catalog matches. Give helpful fashion styling advice for the user's request, suggest custom tailoring if relevant, and do not only say you found nothing."
              : "Use these products in your reply with Markdown image links when helpful.",
        }),
      });
    } else if (name === "escalate_to_human") {
      handoffRequired = true;
      toolResults.push({
        tool_call_id: call.id || "",
        role: "tool",
        name,
        content: JSON.stringify({
          status: "escalated",
          message: "A fashion consultant has been notified.",
        }),
      });
    }
  }

  return { toolResults, handoffRequired, foundProducts };
}
