// Operations seed: the interface register (INTERFACES 3719, HLT-026 × 7). A seeded "Late" status is stored as open:
// lateness is derived from the need date (IF-07, needed 20 Sep). See schema/operations.ts.
import { PROTO } from '@/server/prototype';
import { isoOfDisplayDate, keystoneSide, type InterfaceStatus } from '../codes';
import { projectInterfaces } from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';

const STORED_STATUS: Record<string, InterfaceStatus> = { Open: 'open', Late: 'open', Received: 'received', Frozen: 'frozen' };

export async function seedOperations(tx: Tx, ctx: SeedCtx): Promise<void> {
  type Row = [string, string, string, string, string, string, string, string, string];
  const rows = Object.entries(PROTO.INTERFACES as Record<string, Row[]>).flatMap(([code, list]) =>
    list.map(([number, title, side, otherParty, dataExpected, needed, provided, status, owner], position) => ({
      id: newId(), projectId: must(ctx.projectByCode, code, 'project'), number, title, keystoneSide: keystoneSide.code(side), otherParty, dataExpected,
      neededBy: isoOfDisplayDate(needed)!, providedOn: provided && provided !== '—' ? isoOfDisplayDate(provided) : null,
      status: must(new Map(Object.entries(STORED_STATUS)), status, 'interface status'), ownerPersonId: personIdOrNull(ctx, owner), ownerName: owner, position,
    })),
  );
  if (rows.length) await tx.insert(projectInterfaces).values(rows);
}
