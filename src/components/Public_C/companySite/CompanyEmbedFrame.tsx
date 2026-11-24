'use client';

import { useEffect } from 'react';
import { embedParentOrigin } from '@/lib/publicCategory/embedParent';

// Body is overflow-x:hidden app-wide; the frame document must scroll both ways
// when the iframe is shorter or narrower than the content.
const EMBED_DOCUMENT_CSS =
  'html{overflow:auto!important;height:auto}body{overflow:visible!important;min-width:0}';

/** Embed-only: document scrolling, and the parent origin captured on first load. */
export default function CompanyEmbedFrame() {
  useEffect(() => {
    embedParentOrigin();
  }, []);
  return <style>{EMBED_DOCUMENT_CSS}</style>;
}
