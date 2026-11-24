'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ResponsiveContainer } from 'recharts';

/**
 * Mount Recharts only after the parent has a real box size.
 * Prevents the console flood: "width(0)/height(0) of chart should be greater than 0"
 * (common while dashboard skeletons swap or the pane is still `Opening…`).
 */
export default function SafeResponsiveContainer({
  children,
  className = 'h-full w-full min-h-0 min-w-0',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setReady(w > 0 && h > 0);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {ready ? (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          {children as ReactElement}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
