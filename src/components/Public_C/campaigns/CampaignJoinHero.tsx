'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import type { PublicCampaignDto } from '@/lib/measurementCampaigns.shared';
import {
  DEFAULT_CAMPAIGN_JOIN_INSTRUCTIONS,
  DEFAULT_CAMPAIGN_JOIN_PRIVACY,
} from '@/lib/measurementCampaigns.shared';

type Props = {
  campaign: PublicCampaignDto;
};

function formatEventDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function CampaignJoinHero({ campaign }: Props) {
  const eventLabel = formatEventDate(campaign.eventDate);
  const instructions =
    campaign.instructions?.trim() || DEFAULT_CAMPAIGN_JOIN_INSTRUCTIONS;

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      {campaign.coverImageUrl ? (
        <div className="relative aspect-[2.4/1] w-full bg-stone-900">
          <Image
            src={campaign.coverImageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 560px"
            priority
          />
        </div>
      ) : (
        <div className="aspect-[2.4/1] w-full bg-gradient-to-br from-stone-900 via-stone-800 to-[#1a1508]" />
      )}

      <div className="px-5 py-6 sm:px-6">
        <div className="flex items-start gap-4">
          {campaign.logoUrl ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-900">
              <Image
                src={campaign.logoUrl}
                alt=""
                fill
                className="object-cover"
                sizes="56px"
              />
            </div>
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#FFF8E7] text-lg font-bold text-[#8A6D00]">
              {campaign.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              Measurement campaign
            </p>
            <h1 className="mt-0.5 text-2xl font-bold leading-tight text-stone-900">
              {campaign.name}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Organised by{' '}
              <Link
                href={`/tailors/${campaign.tailorSlug}`}
                className="text-[#B8960C] hover:underline"
              >
                {campaign.organizerName}
              </Link>
            </p>
            {(campaign.joiningViaGroup || campaign.groupLinkNotActive) &&
            campaign.groupCoordinatorName ? (
              <p className="mt-1 text-sm text-stone-600">
                Group led by{' '}
                <span className="font-medium text-stone-800">
                  {campaign.groupCoordinatorName}
                </span>
                {campaign.groupCoordinatorLabel
                  ? ` · ${campaign.groupCoordinatorLabel}`
                  : ''}
              </p>
            ) : null}
            {campaign.description ? (
              <p className="mt-1 text-sm text-stone-500">{campaign.description}</p>
            ) : null}
          </div>
        </div>

        {eventLabel ? (
          <div className="mt-5 inline-flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <CalendarDays size={20} className="shrink-0 text-stone-500" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                Event date
              </p>
              <p className="text-sm font-semibold text-stone-900">{eventLabel}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50/80 p-4">
          <p className="text-sm font-semibold text-stone-900">
            Instructions for participants
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {instructions}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-stone-600">
            {DEFAULT_CAMPAIGN_JOIN_PRIVACY}
          </p>
        </div>
      </div>
    </div>
  );
}
