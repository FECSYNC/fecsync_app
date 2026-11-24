/**
 * VenueFlow landing — responsive navbar, mega menus, mobile drawer
 * Standalone; does not depend on any other project styles.
 */

(function () {
  const MOBILE_NAV_MAX = 1099;

  const header = document.getElementById("siteHeader");
  const announce = document.getElementById("announce");
  const menuToggle = document.getElementById("menuToggle");
  const mobileDrawer = document.getElementById("mobileDrawer");
  const drawerClose = document.getElementById("drawerClose");
  const form = document.getElementById("newsletterForm");
  const formNote = document.getElementById("formNote");
  const drawerPanel = mobileDrawer?.querySelector(".drawer-panel");

  const megaTriggers = document.querySelectorAll(".nav-trigger[data-mega]");
  const navItems = document.querySelectorAll(".nav-item.has-mega");

  let lastFocused = null;

  function isMobileNav() {
    return window.matchMedia(`(max-width: ${MOBILE_NAV_MAX}px)`).matches;
  }

  function canHover() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  /* Sticky header shadow on scroll */
  function onScroll() {
    header?.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Dismiss announcement */
  if (announce) {
    const closeBtn = announce.querySelector(".announce-close");
    closeBtn?.addEventListener("click", () => {
      document.body.classList.add("announce-hidden");
      try {
        sessionStorage.setItem("vf-announce-hidden", "1");
      } catch (_) {}
    });
    try {
      if (sessionStorage.getItem("vf-announce-hidden") === "1") {
        document.body.classList.add("announce-hidden");
      }
    } catch (_) {}
  }

  /* Mega menu open/close */
  function closeAllMegas(except) {
    navItems.forEach((item) => {
      if (item === except) return;
      item.classList.remove("is-open");
      const btn = item.querySelector(".nav-trigger");
      const mega = item.querySelector(".mega");
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (mega) mega.hidden = true;
    });
  }

  function openMega(item) {
    if (isMobileNav()) return;
    const btn = item.querySelector(".nav-trigger");
    const mega = item.querySelector(".mega");
    closeAllMegas(item);
    item.classList.add("is-open");
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (mega) mega.hidden = false;
  }

  megaTriggers.forEach((btn) => {
    const item = btn.closest(".nav-item");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMobileNav()) return;
      if (item.classList.contains("is-open")) {
        closeAllMegas();
      } else {
        openMega(item);
      }
    });

    item.addEventListener("mouseenter", () => {
      if (canHover() && !isMobileNav()) openMega(item);
    });
  });

  document.querySelector(".primary-nav")?.addEventListener("mouseleave", () => {
    if (canHover() && !isMobileNav()) closeAllMegas();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".primary-nav")) closeAllMegas();
  });

  /* Mobile drawer */
  function getFocusable(container) {
    return [
      ...container.querySelectorAll(
        'a[href], button:not([disabled]), summary, input, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  }

  function openDrawer() {
    if (!mobileDrawer) return;
    lastFocused = document.activeElement;
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

  menuToggle?.addEventListener("click", () => {
    if (mobileDrawer.hidden) openDrawer();
    else closeDrawer();
  });

  drawerClose?.addEventListener("click", closeDrawer);

  mobileDrawer?.addEventListener("click", (e) => {
    if (e.target === mobileDrawer) closeDrawer();
  });

  mobileDrawer?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeDrawer);
  });

  /* Accordion: only one details open at a time in drawer */
  mobileDrawer?.querySelectorAll("details").forEach((detail) => {
    detail.addEventListener("toggle", () => {
      if (!detail.open) return;
      mobileDrawer.querySelectorAll("details").forEach((other) => {
        if (other !== detail) other.open = false;
      });
    });
  });

  /* Focus trap while drawer is open */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllMegas();
      closeDrawer();
      return;
    }

    if (e.key !== "Tab" || !mobileDrawer || mobileDrawer.hidden || !drawerPanel) {
      return;
    }

    const focusable = getFocusable(drawerPanel);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* Close menus when crossing the mobile breakpoint */
  let wasMobile = isMobileNav();
  window.addEventListener(
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

  /* Dummy newsletter */
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    form.reset();
    if (formNote) {
      formNote.hidden = false;
      setTimeout(() => {
        formNote.hidden = true;
      }, 4000);
    }
  });

  /* Reveal on scroll — skip if reduced motion */
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealEls = document.querySelectorAll(
    ".intent-card, .feature-block, .price-card, .launch-copy"
  );

  if (!prefersReduced && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.transition =
              "opacity 0.7s cubic-bezier(0.22,1,0.36,1), transform 0.7s cubic-bezier(0.22,1,0.36,1)";
            entry.target.style.opacity = "1";
            entry.target.style.transform = "none";
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(22px)";
      io.observe(el);
    });
  }
})();
