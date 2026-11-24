import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BookTailorWizard from '@/components/Public_C/tailors/BookTailorWizard';
import { getCachedPublicTailorBySlug } from '@/lib/tailors.server';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tailor = await getCachedPublicTailorBySlug(slug);
  return {
    title: tailor
      ? `Book ${tailor.displayName} | FECSYNC`
      : 'Book a tailor | FECSYNC',
    description: 'Submit a tailoring request with your measurements.',
  };
}

export default async function TailorBookPage({ params }: PageProps) {
  const { slug } = await params;
  const tailor = await getCachedPublicTailorBySlug(slug);
  if (!tailor) notFound();
  return <BookTailorWizard slug={slug} initialTailor={tailor} />;
}
