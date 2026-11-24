/**
 * Profile types + API helpers (Prisma-backed).
 */
import crypto from "crypto";
import type { Profile, User } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withMongoIdAlias } from "@/lib/ids";

export type { Profile } from "@prisma/client";

export interface IProfileAddress {
  _id?: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  lga?: string;
  zip?: string;
  country?: string;
  phone?: string;
  contactName?: string;
  isDefault?: boolean;
}

/** Legacy alias kept for gradual migration off mongoose HydratedDocument. */
export type IProfile = Profile & {
  user?: string | { _id?: string; id?: string; email?: string };
  addresses?: IProfileAddress[];
};

export type ProfileDocument = Profile;

const ADDRESS_FIELD_MAX = 200;
const ADDRESS_PHONE_MAX = 32;

function clipAddressField(value: unknown, max = ADDRESS_FIELD_MAX): string {
  if (value == null) return "";
  // Coerce numeric JSON values (legacy / imported addresses) without dropping them.
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim().slice(0, max);
  }
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Allowlist-only address sanitizer — drops unknown keys / nested objects
 * so clients cannot inject arbitrary JSON into Profile.addresses.
 */
export function sanitizeProfileAddress(entry: unknown): IProfileAddress | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = entry as Record<string, unknown>;
  const line1 = clipAddressField(raw.line1);
  const city = clipAddressField(raw.city);
  const state = clipAddressField(raw.state);
  const country = clipAddressField(raw.country);
  // Allow incomplete placeholder slots (home/office) but never unknown keys.
  const out: IProfileAddress = {
    line1,
    city: city || undefined,
    state: state || undefined,
    country: country || undefined,
    isDefault: Boolean(raw.isDefault),
  };
  const line2 = clipAddressField(raw.line2);
  if (line2) out.line2 = line2;
  const lga = clipAddressField(raw.lga);
  if (lga) out.lga = lga;
  const zip = clipAddressField(raw.zip, 32);
  if (zip) out.zip = zip;
  const phone = clipAddressField(raw.phone, ADDRESS_PHONE_MAX);
  if (phone) out.phone = phone;
  const contactName = clipAddressField(raw.contactName);
  if (contactName) out.contactName = contactName;
  if (typeof raw._id === "string" && raw._id.trim()) {
    out._id = raw._id.trim().slice(0, 64);
  }
  return out;
}

export function normalizeAddresses(raw: unknown): IProfileAddress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => sanitizeProfileAddress(entry))
    .filter((addr): addr is IProfileAddress => addr != null)
    .map((addr) => ({
      ...addr,
      _id: addr._id || crypto.randomUUID(),
    }));
}

export const PROFILE_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  phoneNumber: true,
  isVerified: true,
  role: true,
  firstName: true,
  lastName: true,
} as const;

export type ProfileUserSlice = Pick<
  User,
  | "id"
  | "email"
  | "username"
  | "phoneNumber"
  | "isVerified"
  | "role"
  | "firstName"
  | "lastName"
>;

/** Mongo-style profile doc for API responses (populated `user`, `_id` aliases). */
export function formatProfileForApi(
  profile: Profile,
  user: ProfileUserSlice
): IProfile & { _id: string; user: ProfileUserSlice & { _id: string } } {
  const normalizedAddresses = normalizeAddresses(profile.addresses);
  return {
    ...withMongoIdAlias(profile),
    user: { ...user, _id: user.id },
    addresses: normalizedAddresses as IProfile["addresses"],
  };
}

export async function loadProfileUser(
  userId: string
): Promise<ProfileUserSlice | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: PROFILE_USER_SELECT,
  });
}

export async function getProfileForUser(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const user = await loadProfileUser(userId);
  if (!user) return null;
  return formatProfileForApi(profile, user);
}

export async function ensureProfileForUser(
  userId: string,
  defaults?: { firstName?: string; lastName?: string; profilePicture?: string }
): Promise<Profile> {
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await prisma.profile.create({
      data: {
        userId,
        firstName: defaults?.firstName ?? "",
        lastName: defaults?.lastName ?? "",
        profilePicture: defaults?.profilePicture,
        addresses: [],
      },
    });
  } catch {
    const raced = await prisma.profile.findUnique({ where: { userId } });
    if (!raced) throw new Error("Unable to provision profile");
    return raced;
  }
}
