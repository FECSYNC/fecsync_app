import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CompanySignInScreen from "@/components/Public_C/auth/CompanySignInScreen";
import { companyLoginPageBySlug } from "@/lib/companyLogin";
import { companyTabIconUrl } from "@/lib/companyBrandIcon";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const company = await companyLoginPageBySlug((await params).orgSlug);
  if (!company) return { title: "Sign in", robots: { index: false, follow: false } };
  const icon = companyTabIconUrl({ name: company.name, logoUrl: company.logoUrl });
  const title = `Sign in — ${company.name}`;
  return {
    title,
    description: `Staff sign in for ${company.name}.`,
    applicationName: company.name,
    authors: [],
    creator: null,
    publisher: null,
    keywords: [],
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    icons: { icon, shortcut: icon, apple: icon },
    openGraph: { title, siteName: company.name, description: `Staff sign in for ${company.name}.` },
    twitter: { card: "summary", title },
    alternates: { canonical: null },
  };
}

export default async function CompanySignInPage({ params }: Props) {
  const company = await companyLoginPageBySlug((await params).orgSlug);
  if (!company) notFound();
  return (
    <CompanySignInScreen
      brand={{
        slug: company.slug,
        name: company.name,
        logoUrl: company.logoUrl,
        accentColor: company.accentColor,
        backgroundUrl: company.backgroundUrl,
        phone: company.phone,
        supportEmail: company.supportEmail,
        website: company.website,
      }}
    />
  );
}
