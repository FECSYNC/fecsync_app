'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const CHANNEL = 'fecsync:parties';

/** Tell other open admin tabs that party / booking data changed. */
export function broadcastPartyChange(): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ at: Date.now() });
    channel.close();
  } catch {
    /* unsupported / closed */
  }
}

/** Refetch active party queries when another tab changes a party. */
export function usePartyCrossTabSync(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parties'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    };
    return () => channel.close();
  }, [qc]);
}
