'use client';

import {
  Ruler,
  Shirt,
  PanelBottom,
  GraduationCap,
  Footprints,
  Hand,
  Gem,
  type LucideIcon,
} from 'lucide-react';
import type { MeasurementCategoryIconKey } from '@/lib/measurements.shared';

const ICONS: Record<MeasurementCategoryIconKey, LucideIcon> = {
  ruler: Ruler,
  shirt: Shirt,
  pants: PanelBottom,
  cap: GraduationCap,
  shoe: Footprints,
  glove: Hand,
  ring: Gem,
};

type Props = {
  iconKey: MeasurementCategoryIconKey;
  className?: string;
  size?: number;
};

export default function MeasurementCategoryIcon({
  iconKey,
  className = 'text-[#8A6D00]',
  size = 22,
}: Props) {
  const Icon = ICONS[iconKey] ?? Ruler;
  return <Icon className={className} size={size} aria-hidden />;
}
