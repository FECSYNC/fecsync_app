"use client";

import { useEffect, useState } from "react";
import {
  checklistLabels,
  readGuestDocumentLocally,
  type ExtractedGuest,
} from "@/lib/waivers/extractGuestDocument";

export default function WaiverDocumentScan({
  kind,
  minorCap,
  onExtractBackup,
  onResult,
  onFailed,
}: {
  kind: "scan" | "document";
  minorCap: number;
  onExtractBackup?: (jpegDataUrl: string) => Promise<ExtractedGuest | null>;
  onResult: (parsed: ExtractedGuest) => void;
  onFailed: (message: string) => void;
}) {
  const [front, setFront] = useState<File | null>(null);
  const [extra, setExtra] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [checklist, setChecklist] = useState(false);
  const secure = typeof window !== "undefined" && window.isSecureContext;

  useEffect(() => {
    return () => {
      setFront(null);
      setExtra(null);
    };
  }, []);

  async function readPhoto(source: "upload" | "camera", which: "front" | "extra") {
    if (source === "camera" && !secure) {
      setNote("This page is not a secure browser context. Upload a JPEG or PNG instead.");
      return;
    }
    if (source === "camera") {
      try {
        const shot = await captureRearFrame();
        if (which === "front") setFront(shot);
        else setExtra(shot);
      } catch {
        setNote("The camera is not available. Upload a JPEG or PNG instead.");
      }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png";
    if (source === "camera") input.capture = "environment";
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      if (which === "front") setFront(file);
      else setExtra(file);
    };
    input.click();
  }

  async function run() {
    if (!front) {
      onFailed("Add a front photo, or fill the form manually.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const local = await readGuestDocumentLocally(front, extra);
      let parsed = local;
      if (!local.strong && onExtractBackup) {
        try {
          const dataUrl = await blobToJpeg(front);
          const backup = dataUrl ? await onExtractBackup(dataUrl) : null;
          if (backup) parsed = backup;
        } catch {
          parsed = local;
        }
      }
      setFront(null);
      setExtra(null);
      if (!parsed.firstName && !parsed.lastName && !parsed.dateOfBirth) {
        onFailed("That photo could not be read. Fill the form manually.");
        return;
      }
      onResult(parsed);
      setNote(parsed.labels.length ? `Filled from the photo: ${parsed.labels.join(", ")}` : "Some fields were filled from the photo.");
    } catch (err) {
      setFront(null);
      setExtra(null);
      onFailed(err instanceof Error ? err.message : "That photo could not be read. Fill the form manually.");
    } finally {
      setBusy(false);
    }
  }

  const labels = checklistLabels(minorCap);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-stone-600">
        {kind === "scan"
          ? "Use a photo of an ID card or a typed details page."
          : "Use a photo of typed details from a screen or a printed page."}{" "}
        The front photo is required. A second page is optional.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <PhotoSlot
          title="Front photo"
          required
          file={front}
          onUpload={() => void readPhoto("upload", "front")}
          onCamera={() => void readPhoto("camera", "front")}
        />
        <PhotoSlot
          title="Extra page"
          file={extra}
          onUpload={() => void readPhoto("upload", "extra")}
          onCamera={() => void readPhoto("camera", "extra")}
        />
      </div>
      {!secure ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          This browser cannot use the camera. Upload a JPEG or PNG instead.
        </p>
      ) : null}
      {note ? <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">{note}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm font-medium text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline"
          onClick={() => setChecklist((open) => !open)}
        >
          {checklist ? "Hide field labels" : "Show field labels to copy"}
        </button>
        <button
          type="button"
          className="rounded-lg bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !front}
          onClick={() => void run()}
        >
          {busy ? "Reading photo…" : "Read photo"}
        </button>
      </div>
      {checklist ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm font-medium text-stone-800">Copy a label onto a printed page if you need it.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {labels.map((label) => (
              <li key={label}>
                <button
                  type="button"
                  className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 hover:border-[#D4AF37]"
                  onClick={() => void navigator.clipboard?.writeText(label)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PhotoSlot({
  title,
  required = false,
  file,
  onUpload,
  onCamera,
}: {
  title: string;
  required?: boolean;
  file: File | null;
  onUpload: () => void;
  onCamera: () => void;
}) {
  return (
    <div className={`rounded-xl border border-dashed p-3 ${file ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-stone-300 bg-stone-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <span className={`text-xs font-medium ${required ? "text-stone-600" : "text-stone-400"}`}>
          {required ? "Required" : "Optional"}
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-stone-500">{file ? file.name || "Photo ready" : "No photo yet"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:border-[#D4AF37]"
          onClick={onUpload}
        >
          Upload
        </button>
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:border-[#D4AF37]"
          onClick={onCamera}
        >
          Camera
        </button>
      </div>
    </div>
  );
}

async function captureRearFrame(): Promise<File> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not capture a photo");
    return new File([blob], "capture.jpg", { type: "image/jpeg" });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

async function blobToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
