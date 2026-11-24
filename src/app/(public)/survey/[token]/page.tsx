"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

type SurveyPayload = {
  survey: {
    name: string;
    questions: unknown;
    thankYouMessage: string | null;
    promoUrl?: string | null;
  };
  invite: { completedAt: string | null };
};

export default function PublicSurveyPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [loaded, setLoaded] = useState<SurveyPayload | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    void api
      .get<MaybeWrapped<SurveyPayload>>(`/api/public/marketing/surveys/${token}`)
      .then((res) => setLoaded(unwrap(res)))
      .catch(() => setError("This survey link is invalid or expired."));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/public/marketing/surveys/${token}/submit`, {
        rating,
        comment,
        answers: { rating },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    }
  }

  if (error && !loaded) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center text-stone-600">{error}</main>
    );
  }

  if (!loaded) {
    return <main className="mx-auto max-w-md px-4 py-16 text-stone-500">Loading survey…</main>;
  }

  if (loaded.invite.completedAt || done) {
    const promo = loaded.survey.promoUrl?.trim();
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-stone-900">Thank you</h1>
        <p className="mt-2 text-stone-600">
          {loaded.survey.thankYouMessage ?? "We appreciate your feedback."}
        </p>
        {promo ? (
          <p className="mt-4">
            <a
              href={promo}
              className="inline-block rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900"
              rel="noopener noreferrer"
            >
              View offer
            </a>
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-stone-900">{loaded.survey.name}</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
        <label className="block text-sm">
          Rating (1–5)
          <input
            type="number"
            min={1}
            max={5}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          Comments (optional)
          <textarea
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-[#D4AF37] py-2.5 text-sm font-semibold text-stone-900"
        >
          Submit
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </main>
  );
}
