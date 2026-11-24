"use client";

import { useRef, useState } from "react";
import { useUploadAccountingAttachmentMutation } from "@/hooks/useAccounting";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { accountingErrorMessage } from "./AccountingErrorMessage";

export default function AttachmentUploader({
  urls,
  onChange,
  disabled,
  maxFiles = 10,
  className = "",
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAccountingAttachmentMutation();
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (urls.length >= maxFiles) {
      setError(`Maximum ${maxFiles} attachments`);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await upload.mutateAsync(fd);
      const url = String(res.url ?? "");
      if (!url) throw new Error("Upload did not return a URL");
      onChange([...urls, url]);
    } catch (err) {
      setError(accountingErrorMessage(err));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || upload.isPending || urls.length >= maxFiles}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {upload.isPending ? <ButtonSpinner /> : null}
          Upload attachment
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        <span className="text-xs text-gray-500">PDF or image · max size per plan</span>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {urls.length > 0 ? (
        <ul className="space-y-2">
          {urls.map((url) => (
            <li
              key={url}
              className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2 text-sm"
            >
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[#D4AF37] hover:underline"
              >
                {url.split("/").pop() || url}
              </a>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(urls.filter((u) => u !== url))}
                className="text-xs font-medium text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
