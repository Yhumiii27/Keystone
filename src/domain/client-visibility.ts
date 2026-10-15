// Which change requests a client finds in the global search (P-10b, R-052): the only caller is `searchShellClient`
// (src/server/dal/shell.ts). The rule matches the Changes page, which lists every change request of the project to the client
// (X-5) without calling this predicate. The client portal and the client's Home follow another rule: they list only the
// requests waiting for the client — in review, current step the client's, after the PM and the director (R-069, P-6b:
// `crAwaitsClient` in src/domain/rexclient.ts, `getClientPortal` in src/server/dal/client.ts).
// So an answer to the open cost-control question "internal CRs shown to the client" (docs/delivery-7/notes-cost-control.md
// §8, e.g. CR-007) must change this predicate, the Changes page and those portal rules together.

/** The facts of a change request the client rule may look at. */
export interface ClientCrFacts {
  id: string;
  status: string;
}

/**
 * Whether the global search shows a client this change request of one of their organisation's projects (the caller has
 * already checked the project with `clientRefusedProject`). Today: every change request of the project, as the Changes page
 * shows them (X-5, R-052; P-10b) — not only those waiting for the client, as the portal lists them (`crAwaitsClient`).
 */
export function clientSeesChangeRequest(cr: ClientCrFacts): boolean {
  return cr.id.length > 0;
}
