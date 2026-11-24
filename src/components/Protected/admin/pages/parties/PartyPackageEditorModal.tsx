'use client';

import { useCallback, useRef } from 'react';
import { PackagePlus, Pencil } from 'lucide-react';
import { usePartyPackageQuery } from '@/hooks/useParties';
import PartyPackageEditorPage from './PartyPackageEditorPage';
import PartiesSideSheet from './PartiesSideSheet';

/** Create / edit a party package in a side sheet over the packages list (no route load). */
export default function PartyPackageEditorModal({
  productId,
  onClose,
  onCreated,
}: {
  productId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dirty = useRef(false);
  const packageQuery = usePartyPackageQuery(productId);
  const title = productId ? packageQuery.data?.name ?? 'Edit package' : 'New party package';

  const requestClose = useCallback(() => {
    if (dirty.current && !window.confirm('Discard your unsaved changes to this package?')) return;
    onClose();
  }, [onClose]);

  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  return (
    <PartiesSideSheet
      eyebrow="Party packages"
      title={title}
      icon={productId ? <Pencil className="h-5 w-5" /> : <PackagePlus className="h-5 w-5" />}
      onRequestClose={requestClose}
    >
      {/* key: create → edit swaps to a fresh editor for the saved package (time slots appear). */}
      <PartyPackageEditorPage
        key={productId ?? 'new'}
        productId={productId}
        inModal
        onCreated={onCreated}
        onDirtyChange={onDirtyChange}
      />
    </PartiesSideSheet>
  );
}
