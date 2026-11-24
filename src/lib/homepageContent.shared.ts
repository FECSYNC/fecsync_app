/** Client-safe homepage CMS types + defaults (no DB / mongoose). */

export const HOMEPAGE_SECTION_KEYS = [
  "hero",
  "whatWeOffer",
  "newArrivals",
  "fashionJourney",
] as const;

export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export type HeroCta = {
  label: string;
  href: string;
};

export type HeroImage = {
  src: string;
  alt: string;
};

export type HeroContent = {
  headline: string;
  subtitle: string;
  ctaPrimary: HeroCta;
  ctaSecondary: HeroCta;
  images: HeroImage[];
};

export type WhatWeOfferCard = {
  title: string;
  description: string;
  image: string;
};

export type WhatWeOfferContent = {
  title: string;
  subtitle: string;
  cards: WhatWeOfferCard[];
};

export type NewArrivalsContent = {
  title: string;
  subtitle: string;
};

export type FashionJourneyCard = {
  title: string;
  paragraph: string;
  icon: string;
  bgColor: string;
  textColor: string;
};

export type FashionJourneyContent = {
  title: string;
  subtitle: string;
  cards: FashionJourneyCard[];
};

export type HomepageSectionContentMap = {
  hero: HeroContent;
  whatWeOffer: WhatWeOfferContent;
  newArrivals: NewArrivalsContent;
  fashionJourney: FashionJourneyContent;
};

export type HomepageSectionDto<K extends HomepageSectionKey = HomepageSectionKey> = {
  _id: string;
  key: K;
  label: string;
  published: boolean;
  content: HomepageSectionContentMap[K];
  createdByName?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const SECTION_LABELS: Record<HomepageSectionKey, string> = {
  hero: "Hero",
  whatWeOffer: "What We Offer",
  newArrivals: "New Arrivals",
  fashionJourney: "Fashion Journey",
};

export const DEFAULT_HOMEPAGE_CONTENT: HomepageSectionContentMap = {
  hero: {
    headline: "Where Innovation\nMeets Fashion",
    subtitle:
      "Your premier destination where cutting-edge technology meets the vibrant world of fashion.",
    ctaPrimary: { label: "Shop fabrics", href: "/fabrics" },
    ctaSecondary: { label: "Customise your fabric", href: "/customize" },
    images: [
      {
        src: "/fast/h1.webp",
        alt: "Models in patterned African-inspired fashion",
      },
      {
        src: "/fast/h2.webp",
        alt: "Close-up of patterned fashion detail",
      },
      {
        src: "/fast/h3.webp",
        alt: "Model in colorful patterned dress",
      },
    ],
  },
  whatWeOffer: {
    title: "What We Offer",
    subtitle: "Trending Fashion Styles",
    cards: [
      {
        title: "Trending Fashion Insights",
        description:
          "Stay ahead of the curve with our expertly curated sections showcasing the latest and emerging fashion trends. Like what you see? Save your favorite trends for future reference!",
        image: "/fast/w1.webp",
      },
      {
        title: "Ready-to-Wear Apparel Marketplace",
        description:
          "Browse our extensive online store featuring a diverse collection of ready-to-wear clothing for every occasion, ensuring to make the perfect choice.",
        image: "/fast/w2.webp",
      },
      {
        title: "AI-Powered Style Generator",
        description:
          "Unleash your inner stylist with our revolutionary AI Chat for Fashion Style Generation. Receive personalized fashion recommendations based on specific requirements.",
        image: "/fast/w3.webp",
      },
      {
        title: "Fabric & Accessories Hub",
        description:
          "Explore our comprehensive collection of premium fabrics and accessories. All you need to create stunning outfits that match what you need.",
        image: "/fast/w4.webp",
      },
    ],
  },
  newArrivals: {
    title: "New Arrivals",
    subtitle: "",
  },
  fashionJourney: {
    title: "Your Fashion Journey Starts Here",
    subtitle: "We provide value for a broad range of users",
    cards: [
      {
        title: "For Event Planners & Style Seekers",
        paragraph:
          "Planning an event or simply looking for the perfect outfit? Discover our Trending Fashion section for inspiration tailored to any occasion. Easily find ready-to-wear pieces that match the vibe you're aiming for, and explore our marketplace with confidence, knowing you're choosing from reliable suppliers.",
        icon: "/plan.png",
        bgColor: "#FFF4CE",
        textColor: "#5D5D5D",
      },
      {
        title: "For Fashion Designers & Innovators",
        paragraph:
          "Uncover insights into customer wants and showcase your unique vision. Our Fabric & Accessory Repository provides a wealth of resources, while the AI Style Generator can spark new ideas. Plus, you can connect with a broader audience and receive valuable feedback through our platform.",
        icon: "/thread.png",
        bgColor: "#3B3A36",
        textColor: "#FFFFFF",
      },
      {
        title: "For Everyone Who Loves Fashion",
        paragraph:
          "Whether you're shopping for a special event, updating your everyday look, or just exploring the exciting world of fashion, Fashion Forward is your go-to resource. Find what you love, get inspired, and express yourself with confidence.",
        icon: "/fashion.png",
        bgColor: "#3B3A36",
        textColor: "#FFFFFF",
      },
      {
        title: "For Suppliers & Retailers",
        paragraph:
          "Connect with potential customers and showcase your products to a targeted audience. Our platform provides tools to help you reach fashion enthusiasts, designers, and event planners who are actively seeking quality suppliers and unique pieces.",
        icon: "/supplier.png",
        bgColor: "#FFF4CE",
        textColor: "#5D5D5D",
      },
    ],
  },
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asTrimmed(value: unknown, fallback = ""): string {
  const s = asString(value, fallback).trim();
  return s || fallback;
}

function normalizeCta(value: unknown, fallback: HeroCta): HeroCta {
  if (!value || typeof value !== "object") return { ...fallback };
  const row = value as Record<string, unknown>;
  const href = asTrimmed(row.href, fallback.href);
  return {
    label: asTrimmed(row.label, fallback.label),
    href:
      href.startsWith("/") || href.startsWith("http://") || href.startsWith("https://")
        ? href
        : fallback.href,
  };
}

function normalizeHeroImages(value: unknown): HeroImage[] {
  const defaults = DEFAULT_HOMEPAGE_CONTENT.hero.images;
  if (!Array.isArray(value) || value.length === 0) {
    return defaults.map((img) => ({ ...img }));
  }
  const images = value.slice(0, 3).map((item, index) => {
    const fallback = defaults[index] ?? defaults[0];
    if (!item || typeof item !== "object") return { ...fallback };
    const row = item as Record<string, unknown>;
    return {
      src: asTrimmed(row.src, fallback.src),
      alt: asTrimmed(row.alt, fallback.alt),
    };
  });
  while (images.length < 3) {
    images.push({ ...defaults[images.length] });
  }
  return images;
}

function normalizeWhatWeOfferCards(value: unknown): WhatWeOfferCard[] {
  const defaults = DEFAULT_HOMEPAGE_CONTENT.whatWeOffer.cards;
  if (!Array.isArray(value) || value.length === 0) {
    return defaults.map((c) => ({ ...c }));
  }
  return value.slice(0, 8).map((item, index) => {
    const fallback = defaults[index % defaults.length];
    if (!item || typeof item !== "object") return { ...fallback };
    const row = item as Record<string, unknown>;
    return {
      title: asTrimmed(row.title, fallback.title),
      description: asTrimmed(row.description, fallback.description),
      image: asTrimmed(row.image ?? row.mainImage, fallback.image),
    };
  });
}

function normalizeFashionCards(value: unknown): FashionJourneyCard[] {
  const defaults = DEFAULT_HOMEPAGE_CONTENT.fashionJourney.cards;
  if (!Array.isArray(value) || value.length === 0) {
    return defaults.map((c) => ({ ...c }));
  }
  return value.slice(0, 6).map((item, index) => {
    const fallback = defaults[index % defaults.length];
    if (!item || typeof item !== "object") return { ...fallback };
    const row = item as Record<string, unknown>;
    let icon = asTrimmed(row.icon, fallback.icon);
    if (
      icon &&
      !icon.startsWith("/") &&
      !icon.startsWith("http://") &&
      !icon.startsWith("https://") &&
      !icon.startsWith("data:")
    ) {
      icon = `/${icon}`;
    }
    return {
      title: asTrimmed(row.title, fallback.title),
      paragraph: asTrimmed(row.paragraph, fallback.paragraph),
      icon,
      bgColor: asTrimmed(row.bgColor, fallback.bgColor),
      textColor: asTrimmed(row.textColor, fallback.textColor),
    };
  });
}

export function normalizeSectionContent<K extends HomepageSectionKey>(
  key: K,
  raw: unknown
): HomepageSectionContentMap[K] {
  const row =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (key === "hero") {
    const defaults = DEFAULT_HOMEPAGE_CONTENT.hero;
    return {
      headline: asString(row.headline, defaults.headline),
      subtitle: asString(row.subtitle, defaults.subtitle),
      ctaPrimary: normalizeCta(row.ctaPrimary, defaults.ctaPrimary),
      ctaSecondary: normalizeCta(row.ctaSecondary, defaults.ctaSecondary),
      images: normalizeHeroImages(row.images),
    } as HomepageSectionContentMap[K];
  }

  if (key === "whatWeOffer") {
    const defaults = DEFAULT_HOMEPAGE_CONTENT.whatWeOffer;
    return {
      title: asTrimmed(row.title, defaults.title),
      subtitle: asTrimmed(row.subtitle, defaults.subtitle),
      cards: normalizeWhatWeOfferCards(row.cards),
    } as HomepageSectionContentMap[K];
  }

  if (key === "newArrivals") {
    const defaults = DEFAULT_HOMEPAGE_CONTENT.newArrivals;
    return {
      title: asTrimmed(row.title, defaults.title),
      subtitle: asString(row.subtitle, defaults.subtitle).trim(),
    } as HomepageSectionContentMap[K];
  }

  const defaults = DEFAULT_HOMEPAGE_CONTENT.fashionJourney;
  return {
    title: asTrimmed(row.title, defaults.title),
    subtitle: asTrimmed(row.subtitle, defaults.subtitle),
    cards: normalizeFashionCards(row.cards),
  } as HomepageSectionContentMap[K];
}

export function isHomepageSectionKey(value: string): value is HomepageSectionKey {
  return (HOMEPAGE_SECTION_KEYS as readonly string[]).includes(value);
}
