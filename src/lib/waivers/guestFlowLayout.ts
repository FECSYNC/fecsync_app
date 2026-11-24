import { DISPLAY_MODES, LAYOUT_IDS, type WaiverDisplayMode, type WaiverLayoutId } from "@/lib/waivers/presentation";

/** How the shared guest renderer structures a published form. */
export function guestFlowStructure(layoutId: string, displayMode: string) {
  const layout = (LAYOUT_IDS as readonly string[]).includes(layoutId)
    ? (layoutId as WaiverLayoutId)
    : "classic";
  const mode = (DISPLAY_MODES as readonly string[]).includes(displayMode)
    ? (displayMode as WaiverDisplayMode)
    : "single_page";
  return {
    layoutId: layout,
    displayMode: mode,
    oneBlockAtATime: mode === "multi_step",
    accordion: mode === "accordion",
    gridFields: mode === "grid" || layout === "two_column" || layout === "split",
    agreementBeforeIdentity: layout === "agreement_focus",
    splitSideBySide: layout === "split",
    numberedRail: mode === "multi_step" || layout === "numbered_rail" || layout === "wizard",
    cards: layout === "cards",
    compact: layout === "kiosk_compact",
    checklist: layout === "checklist",
  };
}
