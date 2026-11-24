// Tablet layout of the shell (R-146, decision X-4: collapsible menu, Site / Punch list / Deliveries first, online).
// Up to 1024 px wide the sidebar leaves the grid and becomes a drawer opened by the menu button of the top bar; touch
// targets grow to 40 px there and on any coarse pointer. The CSS files repeat these media queries (CSS cannot import
// them): norma/charte/coque.css (the shell, Norma 2.0), norma/charte/touch.css and the DS modules — tablet.test.ts checks it.

/** Width at and below which the sidebar is a drawer (768–1024 px tablets, portrait and landscape). */
export const TABLET_MAX_PX = 1024;
/** `matchMedia` query of the tablet layout. */
export const TABLET_MEDIA = `(max-width: ${TABLET_MAX_PX}px)`;
/** Media query of the 40 px touch targets: the tablet layout and any touch screen (iPad landscape is wider). */
export const TOUCH_MEDIA = `${TABLET_MEDIA}, (pointer: coarse)`;
/** Minimum size of a touch target (px). */
export const TOUCH_TARGET_PX = 40;
