export type ParkSlide = {
  id: string;
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  position?: string;
};

/** 18 venue / park slides — local images only (fast). */
export const PARK_SLIDES: ParkSlide[] = [
  {
    id: "1",
    image: "/venueflow/img/mega-spotlight.jpg",
    eyebrow: "Trampoline parks",
    title: "High-energy jump arenas",
    description:
      "Fill courts, manage timed sessions, and keep queues moving with live capacity.",
  },
  {
    id: "2",
    image: "/venueflow/img/launch.jpg",
    eyebrow: "Adventure centers",
    title: "Climbing walls & obstacle courses",
    description:
      "Book lanes and guest journeys from one company workspace — Growth+ companies can publish waivers guests sign by link, QR, or kiosk.",
  },
  {
    id: "3",
    image: "/venueflow/img/sol-1.jpg",
    eyebrow: "Entertainment venues",
    title: "Night events that sell out",
    description:
      "Online ticketing catalog, guest and staff booking wizards, payments, HQ search, bookings export, and marketplace booking packages with Connect payouts are live for entitled companies.",
  },
  {
    id: "4",
    image: "/venueflow/img/sol-3.jpg",
    eyebrow: "Large attractions",
    title: "Festival-scale guest flow",
    description:
      "Coordinate entry, zones, and staff visibility across busy event floors.",
  },
  {
    id: "5",
    image: "/venueflow/img/hero.jpg",
    eyebrow: "Community parks",
    title: "Gatherings that feel effortless",
    description:
      "Group bookings, party packages, and clear communication for every visit.",
  },
  {
    id: "6",
    image: "/venueflow/img/sol-2.jpg",
    eyebrow: "Multi-site operators",
    title: "One company, many parks",
    description:
      "Add venues under your plan — Growth includes a park filter and park-lock seats; entitled Enterprise unlocks the HQ multi-venue control plane (venue switcher + cross-park dashboard; park-stamped modules follow scope; members roster stays company-wide).",
  },
  {
    id: "7",
    image: "/venueflow/img/intent-1.jpg",
    eyebrow: "Family playcenters",
    title: "Moments guests come back for",
    description:
      "Memberships and loyalty programs: Growth+ companies sell and manage guest memberships in admin today (plans, CRM, renew/upgrade/cancel/dunning, redeem/verify desk, POS/online adapters) plus guest self-serve, reports, and click-to-cancel; loyalty modules deepen in later epics — venues and company admin are live now.",
  },
  {
    id: "8",
    image: "/venueflow/img/intent-2.jpg",
    eyebrow: "Front desk & POS",
    title: "Sell faster at the counter",
    description:
      "Unified POS for tickets, merch, and food is live on Growth+ — check-in scanner product and ticket-purchase kiosk remain later epics.",
  },
  {
    id: "9",
    image: "/venueflow/img/intent-3.jpg",
    eyebrow: "Operations",
    title: "Plans that scale with you",
    description:
      "Company Billing and plan meters help managers stay inside caps today; deeper reporting modules ship later.",
  },
  {
    id: "10",
    image: "/venueflow/img/feature-ticket.jpg",
    eyebrow: "Online ticketing",
    title: "Bookings that never sleep",
    description:
      "Staff configure ticket products and sessions; guest and staff booking wizards, payments, HQ search, bookings export, and marketplace Connect packages are live for entitled companies.",
  },
  {
    id: "11",
    image: "/venueflow/img/feature-pos.jpg",
    eyebrow: "Guest services",
    title: "Hospitality at every touchpoint",
    description:
      "From welcome desk to exit, give staff the tools to delight visitors.",
  },
  {
    id: "12",
    image: "/venueflow/img/feature-multi.jpg",
    eyebrow: "City networks",
    title: "Venues across the skyline",
    description:
      "Enterprise HQ control plane: switch parks in admin, see cross-park venue health. Park-stamped ticketing (and stamped products/orders) follow HQ/park scope; members roster stays company-wide.",
  },
  {
    id: "13",
    image: "/venueflow/img/platform.jpg",
    eyebrow: "Analytics",
    title: "See performance in real time",
    description:
      "Dashboards that turn attendance and spend into clear next actions.",
  },
  {
    id: "14",
    image: "/venueflow/img/launch.jpg",
    eyebrow: "Indoor parks",
    title: "All-weather adventure hubs",
    description:
      "Dynamic pricing and capacity rules are on the roadmap — park capacity tools attach when modules ship.",
    position: "center top",
  },
  {
    id: "15",
    image: "/venueflow/img/mega-spotlight.jpg",
    eyebrow: "Youth programs",
    title: "Camps, leagues & open play",
    description:
      "Recurring schedules and parent-friendly booking for every season.",
    position: "left center",
  },
  {
    id: "16",
    image: "/venueflow/img/sol-1.jpg",
    eyebrow: "Live entertainment",
    title: "Stages, shows & special nights",
    description:
      "Reserved seating, timed entry, and promo codes that fill every seat.",
    position: "right center",
  },
  {
    id: "17",
    image: "/venueflow/img/hero.jpg",
    eyebrow: "Seasonal festivals",
    title: "Pop-up parks with pro ops",
    description:
      "Stand up temporary venues fast without losing control of guest data.",
    position: "center bottom",
  },
  {
    id: "18",
    image: "/venueflow/img/platform.jpg",
    eyebrow: "Smart growth",
    title: "From one site to many",
    description:
      "Expand confidently with the same platform that runs your first park.",
    position: "center center",
  },
];
