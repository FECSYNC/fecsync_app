'use client';

type Props = {
  section: { label: string; key: string } | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function HomepageSectionResetModal({
  section,
  isPending,
  onClose,
  onConfirm,
}: Props) {
  if (!section) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
        disabled={isPending}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Reset section?</h2>
        <p className="mt-2 text-sm text-gray-600">
          Delete custom content for <strong>{section.label}</strong> and restore
          the built-in defaults. The section will be published again. This
          updates the store immediately.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? 'Resetting…' : 'Delete & reset'}
          </button>
        </div>
      </div>
    </div>
  );
}
