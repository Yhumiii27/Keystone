// Cursus mirror seed: the prototype's SITE_DOCS (3574) as Cursus would report them for the site sheet's project,
// received at the prototype's last Cursus sync ("26 Sep 07:00"), written through the connector's mirror writer.
import { PROTO } from '@/server/prototype';
import { upsertClearances } from '@/server/integrations/cursus/mirror';
import { CURSUS_SEED_SYNC, prototypeClearanceSnapshot, type ProtoSiteDocRow } from '@/server/integrations/cursus/prototype-snapshot';
import { parseStampText } from '../codes';
import type { Tx } from '../types';

export async function seedCursus(tx: Tx): Promise<void> {
  const code = PROTO.SITE.code as string;
  await upsertClearances(tx, code, prototypeClearanceSnapshot(PROTO.SITE_DOCS as ProtoSiteDocRow[], code), parseStampText(CURSUS_SEED_SYNC), 'mock');
}
