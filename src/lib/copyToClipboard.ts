/**
 * Copy text from a click handler. Call it before any await: browsers only allow
 * clipboard writes during the user's click. navigator.clipboard is missing on
 * plain-http hosts (e.g. lvh.me), so fall back to a hidden textarea.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const legacy = legacyCopy(text);
  if (legacy) return true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

function legacyCopy(text: string): boolean {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  // Below 16px iOS Safari zooms the page when the field takes focus.
  area.style.fontSize = "16px";
  document.body.appendChild(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.select();
  // iOS Safari ignores select() on read-only fields.
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  focused?.focus({ preventScroll: true });
  return ok;
}
