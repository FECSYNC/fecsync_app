/**
 * Faithful port of venueflow-landing/js/main.js for the Next.js landing page.
 * Operates on the DOM the same way (mega menus, drawer, announce, reveal).
 */
export function initVenueFlowLanding(): () => void {
  const MOBILE_NAV_MAX = 1099;

  const header = document.getElementById("siteHeader");
  const announce = document.getElementById("announce");
  const menuToggle = document.getElementById("menuToggle");
  const mobileDrawer = document.getElementById("mobileDrawer") as HTMLElement | null;
  const drawerClose = document.getElementById("drawerClose");
  const form = document.getElementById("newsletterForm") as HTMLFormElement | null;
  const formNote = document.getElementById("formNote");
  const drawerPanel = mobileDrawer?.querySelector(".drawer-panel") as HTMLElement | null;

  const megaTriggers = document.querySelectorAll(".nav-trigger[data-mega]");
  const navItems = document.querySelectorAll(".nav-item.has-mega");

  let lastFocused: HTMLElement | null = null;
  const cleanups: Array<() => void> = [];

  function on(el: EventTarget | null, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  }

  function isMobileNav() {
    return window.matchMedia(`(max-width: ${MOBILE_NAV_MAX}px)`).matches;
  }

  function canHover() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function onScroll() {
    header?.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  on(window, "scroll", onScroll, { passive: true });
  onScroll();

  if (announce) {
    const closeBtn = announce.querySelector(".announce-close");
    on(closeBtn, "click", () => {
      document.body.classList.add("announce-hidden");
      try {
        sessionStorage.setItem("vf-announce-hidden", "1");
      } catch {
        /* ignore */
      }
    });
    try {
      if (sessionStorage.getItem("vf-announce-hidden") === "1") {
        document.body.classList.add("announce-hidden");
      }
    } catch {
      /* ignore */
    }
  }

  function closeAllMegas(except?: Element | null) {
    navItems.forEach((item) => {
      if (item === except) return;
      item.classList.remove("is-open");
      const btn = item.querySelector(".nav-trigger");
      const mega = item.querySelector(".mega") as HTMLElement | null;
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (mega) mega.hidden = true;
    });
  }

  function openMega(item: Element) {
    if (isMobileNav()) return;
    const btn = item.querySelector(".nav-trigger");
    const mega = item.querySelector(".mega") as HTMLElement | null;
    closeAllMegas(item);
    item.classList.add("is-open");
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (mega) mega.hidden = false;
  }

  megaTriggers.forEach((btn) => {
    const item = btn.closest(".nav-item");
    if (!item) return;

    on(btn, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMobileNav()) return;
      if (item.classList.contains("is-open")) {
        closeAllMegas();
      } else {
        openMega(item);
      }
    });

    on(item, "mouseenter", () => {
      if (canHover() && !isMobileNav()) openMega(item);
    });
  });

  on(document.querySelector(".primary-nav"), "mouseleave", () => {
    if (canHover() && !isMobileNav()) closeAllMegas();
  });

  on(document, "click", (e) => {
    const t = e.target as Element | null;
    if (!t?.closest(".primary-nav")) closeAllMegas();
  });

  function getFocusable(container: HTMLElement) {
    return [
      ...container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  }

  function openDrawer() {
    if (!mobileDrawer) return;
    lastFocused = document.activeElement as HTMLElement | null;
    mobileDrawer.hidden = false;
    menuToggle?.classList.add("is-open");
    menuToggle?.setAttribute("aria-expanded", "true");
    menuToggle?.setAttribute("aria-label", "Close menu");
    document.body.classList.add("drawer-open");
    closeAllMegas();
    requestAnimationFrame(() => {
      drawerClose?.focus();
    });
  }

  function closeDrawer() {
    if (!mobileDrawer || mobileDrawer.hidden) return;
    mobileDrawer.hidden = true;
    menuToggle?.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open menu");
    document.body.classList.remove("drawer-open");
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    } else {
      menuToggle?.focus();
    }
  }

  on(menuToggle, "click", () => {
    if (mobileDrawer?.hidden) openDrawer();
    else closeDrawer();
  });

  on(drawerClose, "click", () => closeDrawer());

  on(mobileDrawer, "click", (e) => {
    if (e.target === mobileDrawer) closeDrawer();
  });

  mobileDrawer?.querySelectorAll("a").forEach((link) => {
    on(link, "click", () => closeDrawer());
  });

  mobileDrawer?.querySelectorAll("details").forEach((detail) => {
    on(detail, "toggle", () => {
      if (!(detail as HTMLDetailsElement).open) return;
      mobileDrawer.querySelectorAll("details").forEach((other) => {
        if (other !== detail) (other as HTMLDetailsElement).open = false;
      });
    });
  });

  on(document, "keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Escape") {
      closeAllMegas();
      closeDrawer();
      return;
    }

    if (ke.key !== "Tab" || !mobileDrawer || mobileDrawer.hidden || !drawerPanel) {
      return;
    }

    const focusable = getFocusable(drawerPanel);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (ke.shiftKey && document.activeElement === first) {
      ke.preventDefault();
      last.focus();
    } else if (!ke.shiftKey && document.activeElement === last) {
      ke.preventDefault();
      first.focus();
    }
  });

  let wasMobile = isMobileNav();
  on(
    window,
    "resize",
    () => {
      const nowMobile = isMobileNav();
      if (nowMobile !== wasMobile) {
        closeAllMegas();
        if (!nowMobile) closeDrawer();
        wasMobile = nowMobile;
      }
    },
    { passive: true }
  );

  on(form, "submit", (e) => {
    e.preventDefault();
    form?.reset();
    if (formNote) {
      formNote.hidden = false;
      window.setTimeout(() => {
        formNote.hidden = true;
      }, 4000);
    }
  });

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealEls = document.querySelectorAll(
    ".intent-card, .feature-block, .price-card, .launch-copy"
  );

  let io: IntersectionObserver | null = null;
  if (!prefersReduced && "IntersectionObserver" in window) {
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transition =
              "opacity 0.7s cubic-bezier(0.22,1,0.36,1), transform 0.7s cubic-bezier(0.22,1,0.36,1)";
            el.style.opacity = "1";
            el.style.transform = "none";
            io?.unobserve(el);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach((el) => {
      const node = el as HTMLElement;
      node.style.opacity = "0";
      node.style.transform = "translateY(22px)";
      io?.observe(node);
    });
  }

  return () => {
    io?.disconnect();
    cleanups.forEach((fn) => fn());
    closeAllMegas();
    document.body.classList.remove("drawer-open");
  };
}
