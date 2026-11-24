'use client';

import { useCallback, useRef } from 'react';

/**
 * Backdrop dismiss that ignores text-highlight drags.
 * A select-and-drag often ends with mouseup on the overlay, which a plain
 * onClick treats as "click outside" and closes the modal (wiping the form).
 */
export function useOverlayDismiss(onClose: () => void) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointerDownOnOverlay = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownOnOverlay.current = e.target === overlayRef.current;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const startedOnOverlay = pointerDownOnOverlay.current;
      pointerDownOnOverlay.current = false;
      if (!startedOnOverlay) return;
      if (e.target !== overlayRef.current) return;
      const selected = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
      if (selected && selected.trim().length > 0) return;
      onClose();
    },
    [onClose]
  );

  return {
    overlayRef,
    overlayDismissProps: {
      ref: overlayRef,
      onPointerDown,
      onClick,
    },
  };
}
