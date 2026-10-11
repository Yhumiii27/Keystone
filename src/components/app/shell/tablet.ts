// Tablet layout of the shell (R-146, decision X-4: collapsible menu, Site / Punch list / Deliveries first, online).
// Up to 1024 px wide the sidebar leaves the grid and becomes a drawer opened by the menu button of the top bar; touch
// targets grow to 40 px there and on any coarse pointer. The CSS files repeat these media queries (CSS cannot import
// them): src/components/app/shell/*.module.css, src/styles/touch.css and the DS modules — tablet.test.ts checks it.

/** Width at and below which the sidebar is a drawer (768–1024 px tablets, portrait and landscape). */
export const TABLET_MAX_PX = 1024;
/** `matchMedia` query of the tablet layout. */
export const TABLET_MEDIA = `(max-width: ${TABLET_MAX_PX}px)`;
/** Media query of the 40 px touch targets: the tablet layout and any touch screen (iPad landscape is wider). */
export const TOUCH_MEDIA = `${TABLET_MEDIA}, (pointer: coarse)`;
/** Minimum size of a touch target (px). */
export const TOUCH_TARGET_PX = 40;

/** DOM ids linking the menu button (aria-controls) and the sidebar. */
export const SIDEBAR_ID = 'ks-sidebar';
export const NAV_TOGGLE_ID = 'ks-nav-toggle';

/** The drawer state after a navigation: a new path closes it, the same path keeps it. */
export function navDrawerAfter(state: { open: boolean; path: string }, path: string): { open: boolean; path: string } {
  return state.path === path ? state : { open: false, path };
}
