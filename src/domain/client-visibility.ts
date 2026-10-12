// What a client sees of a project of their organisation, as one rule shared by the global search, the Changes page and the
// client portal (P-10b). Kept apart so the open cost-control question "internal CRs shown to the client"
// (docs/delivery-7/notes-cost-control.md §8, e.g. CR-007) changes every place at once when the owner answers it.

/** The facts of a change request the client rule may look at. */
export interface ClientCrFacts {
  id: string;
  status: string;
}

/**
 * Whether a client sees this change request of one of their organisation's projects (the caller has already checked
 * the project with `clientRefusedProject`). Today: every change request of the project, as the Changes page shows them
 * (X-5, R-052; P-10b).
 */
export function clientSeesChangeRequest(cr: ClientCrFacts): boolean {
  return cr.id.length > 0;
}
