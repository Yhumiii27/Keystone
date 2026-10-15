// Client portal seed: client issues (CLIENT_ISSUES 3544 — global in the prototype, scoped here to the project of the
// client persona's organisation, HLT-026, 11 §7 #22). The prototype's typed document categories (CLIENT_DOCS 3543) are not
// seeded any more: the portal computes them from the Codex index (Delivery 8, L-9 = a, R-138).
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { clientIssueStatus, isoOfDisplayDate } from '../codes';
import { clientIssues } from '../schema';
import type { Tx } from '../types';
import { must, personIdOrNull, type SeedCtx } from './context';

/** Organisation of the client persona (PERSONAS.client: Nadia Bensaïd, Port authority). */
const CLIENT_ORG = 'Port authority';

export async function seedClient(tx: Tx, ctx: SeedCtx): Promise<void> {
  const contact = PROTO.PERSONAS.client[0] as string;
  const code = (PROTO_GEN.initialProjects as { code: string; client: string }[]).find((p) => p.client === CLIENT_ORG && PROTO_GEN.projectData[p.code])?.code;
  if (!code) return;
  const projectId = must(ctx.projectByCode, code, 'project');
  await tx.insert(clientIssues).values((PROTO.CLIENT_ISSUES as [string, string, string, string, string][]).map(([number, title, raised, status, response], position) => ({
    projectId, number, title, raisedOn: isoOfDisplayDate(raised.replace(/^Raised /, ''))!, raisedByName: contact, raisedByPersonId: personIdOrNull(ctx, contact),
    status: clientIssueStatus.code(status), response, position,
  })));
}
