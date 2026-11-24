"use client";

import { useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { homepageContentKeys } from "@/hooks/useHomepageContent";
import type {
  HomepageSectionDto,
  HomepageSectionKey,
} from "@/lib/homepageContent.shared";

type PublicHomepagePayload = {
  sections: HomepageSectionDto[];
  byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>>;
};

/**
 * Seeds the public homepage CMS React Query cache before child sections render,
 * so the first paint uses DB content (not hardcoded defaults).
 */
export default function HomepageContentBootstrap({
  initial,
  children,
}: {
  initial: PublicHomepagePayload;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const seeded = useRef(false);

  if (!seeded.current) {
    queryClient.setQueryData(homepageContentKeys.public, initial);
    seeded.current = true;
  }

  return <>{children}</>;
}
