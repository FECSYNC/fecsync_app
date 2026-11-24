"use client";

import { useQuery } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { listComplianceGuides, waiverKeys } from "@/services/waivers";

export default function WaiverCompliancePage() {
  const query = useQuery({
    queryKey: waiverKeys.guides(),
    queryFn: listComplianceGuides,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Compliance guides</h1>
      <WaiverSubnav />
      <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-stone-800">
        Not legal advice. {query.data?.disclaimer ?? "These checklists do not make a venue legally compliant."}
      </p>
      {query.isError ? (
        <p className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Could not load guides"}
        </p>
      ) : null}
      <div className="space-y-6">
        {(query.data?.guides ?? []).map((guide) => (
          <article key={guide.id} className="rounded-lg border border-stone-200 p-4">
            <h2 className="text-lg font-semibold text-stone-900">{guide.title}</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
              {guide.disclaimer}
            </p>
            {guide.sections.map((section) => (
              <section key={section.heading} className="mt-4">
                <h3 className="font-medium text-stone-900">{section.heading}</h3>
                <p className="mt-1 text-sm text-stone-700">{section.body}</p>
                {section.links?.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="mt-1 block text-sm text-stone-800 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
