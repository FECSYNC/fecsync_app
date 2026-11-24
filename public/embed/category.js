/*
 * Company category embed loader. Public, no secrets.
 *
 * Finds containers marked with data-company-category-embed, sizes the iframe to the
 * container (width 100%, container height), and keeps it sized on resize. The
 * framed page cannot see this page's DOM; this script is what matches the box.
 * Loading the script twice, or running it again, never adds a second iframe.
 *
 * <div data-company-category-embed data-org="org" data-category="cat" style="height:640px">
 *   <iframe src="https://app.example/org/cat?embed=1" ...></iframe>   (optional)
 * </div>
 */
(function () {
  "use strict";
  var w = window;
  var MARK = "data-company-category-embed";
  var READY = "data-company-category-ready";
  var FRAME = "data-company-category-frame";
  var DEFAULT_HEIGHT = 640;

  function scriptOrigin() {
    var el = document.currentScript;
    if (!el || !el.src) {
      el = document.querySelector('script[src*="/embed/category.js"]');
    }
    try {
      return el && el.src ? new URL(el.src, w.location.href).origin : null;
    } catch (e) {
      return null;
    }
  }

  var api = w.__companyCategoryEmbed;
  if (!api) {
    api = w.__companyCategoryEmbed = { origin: scriptOrigin(), scan: null };
  } else if (!api.origin) {
    api.origin = scriptOrigin();
  }

  function frameSrc(container) {
    var org = container.getAttribute("data-org") || "";
    var cat = container.getAttribute("data-category") || "";
    if (!org || !cat || !api.origin) return null;
    return (
      api.origin + "/" + encodeURIComponent(org) + "/" + encodeURIComponent(cat) + "?embed=1"
    );
  }

  function size(container, frame) {
    var rect = container.getBoundingClientRect();
    var height = Math.round(rect.height) || DEFAULT_HEIGHT;
    frame.style.width = "100%";
    frame.style.height = height + "px";
    frame.setAttribute("width", "100%");
    frame.setAttribute("height", String(height));
  }

  function setup(container) {
    if (container.getAttribute(READY) === "1") return;
    var frame = container.querySelector("iframe[" + FRAME + "]") || container.querySelector("iframe");
    if (!frame) {
      var src = frameSrc(container);
      if (!src) return;
      frame = document.createElement("iframe");
      frame.src = src;
      frame.title = container.getAttribute("data-title") || "Book";
      frame.loading = "lazy";
      container.appendChild(frame);
    }
    container.setAttribute(READY, "1");
    frame.setAttribute(FRAME, "");
    frame.style.border = "0";
    frame.style.display = "block";
    if (!container.style.height && container.getBoundingClientRect().height < 1) {
      container.style.height = DEFAULT_HEIGHT + "px";
    }
    // The iframe fills the measured box; it must not grow the box it measures.
    container.style.overflow = "hidden";
    frame.style.boxSizing = "border-box";
    frame.style.maxWidth = "100%";
    size(container, frame);
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () {
        size(container, frame);
      }).observe(container);
    } else {
      w.addEventListener("resize", function () {
        size(container, frame);
      });
    }
  }

  function scan() {
    var nodes = document.querySelectorAll("[" + MARK + "]");
    for (var i = 0; i < nodes.length; i++) setup(nodes[i]);
  }

  if (api.scan) {
    api.scan();
    return;
  }
  api.scan = scan;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
})();
