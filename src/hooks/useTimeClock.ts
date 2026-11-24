"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getTicketingSettings,
  ticketingKeys,
} from "@/services/ticketing";
import {
  DEFAULT_TIME_CLOCK_FORMAT,
  isHour12,
  normalizeTimeClockFormat,
  type TimeClockFormat,
} from "@/lib/timeClock";

/**
 * Effective 12/24-hour setting for staff calendars and wizards.
 * Uses org default when locationId is empty; venue override when set.
 * Fail-soft: missing permission or load error falls back to 12-hour.
 */
export function useTimeClockFormat(locationId?: string | null) {
  const query = useQuery({
    queryKey: ticketingKeys.settings(locationId || null),
    queryFn: () => getTicketingSettings(locationId || null),
    staleTime: 30_000,
    retry: false,
    meta: { suppressErrorBanner: true },
  });
  const timeFormat: TimeClockFormat = query.data
    ? normalizeTimeClockFormat(query.data.timeFormat)
    : DEFAULT_TIME_CLOCK_FORMAT;
  return {
    timeFormat,
    hour12: isHour12(timeFormat),
    isLoading: query.isLoading,
  };
}
