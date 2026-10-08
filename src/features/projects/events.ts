// Client-side event shared by the New project wizard and the Projects register (no module coupling).
/** Dispatched on `window` after a project is created: the register clears its status filter (npCreate 3969). */
export const PROJECTS_RESET_EVENT = 'ks:projects-reset-filter';
