import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TailorProfileClient from '@/components/Public_C/tailors/TailorProfileClient';
import { getCachedPublicTailorBySlug } from '@/lib/tailors.server';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tailor = await getCachedPublicTailorBySlug(slug);
  if (!tailor) {
    return {
      title: 'Tailor not found | FECSYNC',
      description: 'This tailor profile is unavailable.',
    };
  }
  const place = [tailor.location.city, tailor.location.state, tailor.location.country]
    .filter(Boolean)
    .join(', ');
  const description =
    tailor.bio?.trim() ||
    `${tailor.displayName}${place ? ` — ${place}` : ''} on FECSYNC Find a Tailor.`;
  return {
    title: `${tailor.displayName} | Find a Tailor | FECSYNC`,
    description: description.slice(0, 160),
    openGraph: {
      title: tailor.displayName,
      description: description.slice(0, 160),
      images: tailor.portfolioImages[0]
        ? [{ url: tailor.portfolioImages[0] }]
        : undefined,
    },
  };
}

export default async function TailorDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const tailor = await getCachedPublicTailorBySlug(slug);
  if (!tailor) notFound();
  return <TailorProfileClient slug={slug} initialTailor={tailor} />;
}
