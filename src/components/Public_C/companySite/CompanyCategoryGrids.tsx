import BookProductCard from '@/components/Public_C/booking/BookProductCard';
import {
  formatPublicMoney,
  type CompanyBookingCardDto,
  type CompanyMembershipCardDto,
  type CompanyMenuItemDto,
} from '@/lib/publicCategory/publicDto';
import type { PublicCategoryLayout } from '@/lib/publicCategory/snippet';
import type { CompanySitePaths } from '@/lib/publicCategory/sitePaths';
import styles from './CompanyCategoryGrids.module.css';

function CardGrid({
  layout,
  children,
}: {
  layout: PublicCategoryLayout;
  children: React.ReactNode;
}) {
  const mode = layout === 'stack' || layout === 'grid' ? layout : 'auto';
  return (
    <div className={`${styles.cards} ${styles[mode]}`} data-company-layout={mode}>
      {children}
    </div>
  );
}

export function CompanyEmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
      {message}
    </p>
  );
}

export function CompanyBookingGrid({
  cards,
  layout,
  paths,
}: {
  cards: CompanyBookingCardDto[];
  layout: PublicCategoryLayout;
  paths: CompanySitePaths;
}) {
  if (!cards.length) {
    return <CompanyEmptyState message="Nothing is available to book here right now." />;
  }
  return (
    <CardGrid layout={layout}>
      {cards.map((c) => (
        <BookProductCard
          key={c.id}
          href={paths.product(c.id, c.party)}
          label={c.party ? 'Party' : c.type.replace('_', ' ')}
          name={c.name}
          description={c.description}
          priceFrom={c.priceFrom}
          currency={c.currency}
          soldOut={c.soldOut}
          party={c.party}
          parkName={c.parkName}
        />
      ))}
    </CardGrid>
  );
}

function CardImage({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="mb-3 aspect-[4/3] w-full rounded-lg object-cover"
      loading="lazy"
    />
  );
}

/** Display-only menu. No cart, no checkout. */
export function CompanyMenuGrid({
  items,
  layout,
}: {
  items: CompanyMenuItemDto[];
  layout: PublicCategoryLayout;
}) {
  if (!items.length) {
    return <CompanyEmptyState message="No items in this menu yet." />;
  }
  return (
    <CardGrid layout={layout}>
      {items.map((item) => (
        <div key={item.id} className="rounded-xl border border-stone-200 bg-white p-5">
          <CardImage src={item.imageUrl} />
          <p className="font-semibold text-stone-900">{item.name}</p>
          {item.description ? (
            <p className="mt-1 line-clamp-3 text-sm text-stone-600">{item.description}</p>
          ) : null}
          <p className="mt-3 text-sm font-medium text-stone-900">
            {formatPublicMoney(item.price)}
          </p>
        </div>
      ))}
    </CardGrid>
  );
}

function billingLabel(card: CompanyMembershipCardDto): string | null {
  if (!card.intervalUnit) return null;
  const n = card.intervalCount ?? 1;
  const span = n === 1 ? card.intervalUnit : `${n} ${card.intervalUnit}s`;
  return card.billing === 'recurring' ? `Every ${span}` : `${span} term`;
}

/** Display-only membership plans. No purchase button and no payment. */
export function CompanyMembershipGrid({
  cards,
  layout,
}: {
  cards: CompanyMembershipCardDto[];
  layout: PublicCategoryLayout;
}) {
  if (!cards.length) {
    return <CompanyEmptyState message="No memberships are offered here right now." />;
  }
  return (
    <CardGrid layout={layout}>
      {cards.map((card) => {
        const billing = billingLabel(card);
        return (
          <div key={card.id} className="rounded-xl border border-stone-200 bg-white p-5">
            <CardImage src={card.imageUrl} />
            <p className="font-semibold text-stone-900">{card.name}</p>
            {card.description ? (
              <p className="mt-1 line-clamp-3 text-sm text-stone-600">{card.description}</p>
            ) : null}
            <p className="mt-3 text-sm font-medium text-stone-900">
              {formatPublicMoney(card.price, card.currency)}
              {billing ? <span className="ml-1 text-stone-500">· {billing}</span> : null}
            </p>
          </div>
        );
      })}
    </CardGrid>
  );
}
