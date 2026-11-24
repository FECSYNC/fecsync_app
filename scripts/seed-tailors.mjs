/**
 * Seed demo Find-a-Tailor providers for local development.
 * Usage: node scripts/seed-tailors.mjs
 *
 * Creates (or reuses) client users + TailorProfile rows on the default org,
 * and upserts Membership with rolePreset "tailor".
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const SEED_TAILORS = [
  {
    email: "tailor.ada@example.com",
    password: "TailorDemo1!",
    firstName: "Ada",
    lastName: "Okoro",
    displayName: "Ada Atelier",
    slug: "ada-atelier",
    bio: "Bridal and ceremonial wear with a focus on Lagos couture finishes.",
    specialties: ["Bridal", "Aso-ebi", "Alterations"],
    serviceTypes: ["Bespoke", "Fitting"],
    location: { city: "Lagos", state: "Lagos", country: "Nigeria" },
    pricingNotes: "Bridal packages from ₦180,000. Fabric not included.",
    status: "approved",
  },
  {
    email: "tailor.kai@example.com",
    password: "TailorDemo1!",
    firstName: "Kai",
    lastName: "Mensah",
    displayName: "Kai Menswear",
    slug: "kai-menswear",
    bio: "Agbada, suits, and everyday menswear tailored for comfort.",
    specialties: ["Agbada", "Suits", "Kaftan"],
    serviceTypes: ["Bespoke", "Ready-to-wear"],
    location: { city: "Accra", state: "Greater Accra", country: "Ghana" },
    pricingNotes: "Suits from GHS 1,200. Turnaround 10–14 days.",
    status: "approved",
  },
  {
    email: "tailor.pending@example.com",
    password: "TailorDemo1!",
    firstName: "Nia",
    lastName: "Bello",
    displayName: "Nia Studio",
    slug: "nia-studio",
    bio: "Contemporary Ankara ready for review.",
    specialties: ["Ankara", "Casual"],
    serviceTypes: ["Bespoke"],
    location: { city: "Abuja", state: "FCT", country: "Nigeria" },
    pricingNotes: "",
    status: "pending",
  },
];

const DEFAULT_SLUG = "harewa";

let org =
  (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
  (await prisma.organization.findUnique({ where: { slug: DEFAULT_SLUG } })) ||
  (await prisma.organization.findFirst());

if (!org) {
  console.error("No organization found. Run yarn ensure-default-org first.");
  process.exit(1);
}

for (const seed of SEED_TAILORS) {
  const email = seed.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const hash = await bcrypt.hash(seed.password, 10);
    user = await prisma.user.create({
      data: {
        email,
        password: hash,
        username: seed.email.split("@")[0].replace(/\./g, "_"),
        firstName: seed.firstName,
        lastName: seed.lastName,
        isVerified: true,
        accountDeleted: false,
        authzVersion: 0,
        role: "client",
      },
    });
    await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        firstName: seed.firstName,
        lastName: seed.lastName,
        bio: "",
      },
      update: {},
    });
    console.log(`Created user ${seed.email}`);
  } else {
    console.log(`Reusing user ${seed.email}`);
  }

  await prisma.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    create: {
      userId: user.id,
      orgId: org.id,
      rolePreset: "tailor",
      status: "active",
      companyWideView: false,
    },
    update: {
      rolePreset: "tailor",
      status: "active",
      roleTemplateId: null,
      companyWideView: false,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      authzVersion: { increment: 1 },
      refreshTokenJTI: null,
    },
  });

  const slug = slugify(seed.slug || seed.displayName);
  const existingProfile = await prisma.tailorProfile.findUnique({
    where: { userId: user.id },
  });
  if (existingProfile) {
    let uniqueSlug = slug;
    if (existingProfile.slug !== slug) {
      let n = 0;
      while (
        await prisma.tailorProfile.findFirst({
          where: {
            slug: uniqueSlug,
            NOT: { id: existingProfile.id },
          },
          select: { id: true },
        })
      ) {
        n += 1;
        uniqueSlug = `${slug}-${n}`;
      }
    } else {
      uniqueSlug = existingProfile.slug;
    }
    await prisma.tailorProfile.update({
      where: { id: existingProfile.id },
      data: {
        orgId: org.id,
        slug: uniqueSlug,
        displayName: seed.displayName,
        bio: seed.bio,
        specialties: seed.specialties,
        serviceTypes: seed.serviceTypes,
        location: seed.location,
        pricingNotes: seed.pricingNotes,
        status: seed.status,
        updatedByName: "seed-tailors",
      },
    });
    console.log(
      `Updated tailor profile ${seed.displayName} (${seed.status}) slug=${uniqueSlug}`
    );
  } else {
    let uniqueSlug = slug;
    let n = 0;
    while (await prisma.tailorProfile.findUnique({ where: { slug: uniqueSlug } })) {
      n += 1;
      uniqueSlug = `${slug}-${n}`;
    }
    await prisma.tailorProfile.create({
      data: {
        userId: user.id,
        orgId: org.id,
        slug: uniqueSlug,
        displayName: seed.displayName,
        bio: seed.bio,
        specialties: seed.specialties,
        serviceTypes: seed.serviceTypes,
        serviceTiers: [],
        portfolioImages: [],
        location: seed.location,
        pricingNotes: seed.pricingNotes,
        status: seed.status,
        createdByName: "seed-tailors",
        updatedByName: "seed-tailors",
      },
    });
    console.log(`Created tailor profile ${seed.displayName} (${seed.status})`);
  }
}

console.log("\nDone. Demo tailor logins:");
for (const seed of SEED_TAILORS) {
  console.log(`  ${seed.email} / ${seed.password}  →  /tailor/dashboard`);
}

await prisma.$disconnect();
