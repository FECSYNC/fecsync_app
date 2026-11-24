import type { Metadata } from 'next';
import TailorsListingClient from '@/components/Public_C/tailors/TailorsListingClient';

export const metadata: Metadata = {
  title: 'Find a Tailor | FECSYNC',
  description:
    'Discover approved FECSYNC tailors for bridal, menswear, alterations, and bespoke pieces.',
  openGraph: {
    title: 'Find a Tailor | FECSYNC',
    description:
      'Browse approved makers and book fittings for custom garments.',
  },
};

export default function TailorsPage() {
  return <TailorsListingClient />;
}
