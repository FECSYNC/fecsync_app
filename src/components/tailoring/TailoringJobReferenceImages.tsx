'use client';

function isValidImageUrl(url: string): boolean {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/')
  );
}

type Props = {
  images?: string[];
  className?: string;
};

export default function TailoringJobReferenceImages({
  images,
  className = '',
}: Props) {
  const valid = (images ?? []).filter(isValidImageUrl);
  if (valid.length === 0) return null;

  return (
    <section className={`space-y-2 ${className}`}>
      <h3 className="font-medium text-sm">Reference images</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {valid.map((src, index) => (
          <a
            key={`${src}-${index}`}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50 hover:border-[#D4AF37] transition-colors"
          >
            <img
              src={src}
              alt={`Reference ${index + 1}`}
              className="w-full h-full object-cover"
            />
          </a>
        ))}
      </div>
    </section>
  );
}
