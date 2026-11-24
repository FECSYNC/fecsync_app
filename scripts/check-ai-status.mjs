import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const hasEnvKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
const envModel = process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini";

try {
  const rows = await prisma.aiSettings.findMany({
    select: {
      botName: true,
      provider: true,
      model: true,
      apiKeyLast4: true,
      apiKeyEncrypted: true,
      usePublicData: true,
    },
  });
  console.log("OPENROUTER_API_KEY in env:", hasEnvKey ? "yes" : "no");
  console.log("AiSettings DB rows:", rows.length);
  for (const row of rows) {
    console.log("---");
    console.log("botName:", row.botName);
    console.log("provider:", row.provider ?? "env_default");
    console.log("model:", row.model || "(uses env default)");
    console.log("storedKeyLast4:", row.apiKeyLast4 || "none");
    console.log("usePublicData:", row.usePublicData);
    const usesEnv =
      !row.provider ||
      row.provider === "env_default" ||
      (!row.apiKeyEncrypted && hasEnvKey);
    console.log("likelyUsesEnvKey:", usesEnv);
  }
  if (rows.length === 0) {
    console.log("No AiSettings row yet — will auto-create on first admin/public read.");
    console.log("Assistant can still use OPENROUTER_API_KEY from .env if provider is env_default.");
  }
  console.log("---");
  console.log(
    "Assistant likely ready:",
    hasEnvKey || rows.some((r) => r.apiKeyEncrypted)
  );
} finally {
  await prisma.$disconnect();
}
