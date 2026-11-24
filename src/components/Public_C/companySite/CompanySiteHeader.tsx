import type { CompanySiteHeaderDto } from '@/lib/publicCategory/publicDto';

/** Company-only header: trading name, plus logo and contact lines the company switched on. */
export default function CompanySiteHeader({
  header,
  homeHref,
}: {
  header: CompanySiteHeaderDto;
  homeHref: string;
}) {
  const contacts = [
    header.phone
      ? { key: 'phone', label: header.phone, href: `tel:${header.phone.replace(/[^\d+]/g, '')}` }
      : null,
    header.supportEmail
      ? { key: 'email', label: header.supportEmail, href: `mailto:${header.supportEmail}` }
      : null,
    header.website
      ? {
          key: 'website',
          label: header.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
          href: header.website,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; href: string }>;

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <a href={homeHref} className="flex min-w-0 items-center gap-3">
          {header.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={header.logoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md object-contain"
            />
          ) : null}
          <span className="truncate text-lg font-semibold text-stone-900">
            {header.name}
          </span>
        </a>
        {contacts.length || header.address ? (
          <div className="flex flex-col items-start gap-1 text-sm text-stone-600 sm:items-end">
            {contacts.length ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {contacts.map((c) => (
                  <a
                    key={c.key}
                    href={c.href}
                    className="hover:text-stone-900"
                    {...(c.key === 'website'
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {c.label}
                  </a>
                ))}
              </div>
            ) : null}
            {header.address ? <p>{header.address}</p> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
