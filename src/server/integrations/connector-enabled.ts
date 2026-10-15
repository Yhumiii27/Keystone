import 'server-only';
// D-7a (R-020): IT disables a connector in its connectors file (connectors.enabled). A disabled connector exchanges nothing:
// its HTTP connector neither sends its outbox (entries stay pending, delivered once IT enables it again) nor refreshes its
// mirror (the screens read the local mirror). "Sync now" refuses it earlier (src/server/dal/integrations.ts).
import { eq } from 'drizzle-orm';
import { ensureConnectorsFileApplied } from '@/server/dal/connector-config';
import { getDb } from '@/server/db/client';
import { connectors } from '@/server/db/schema';

/** Rows of the connectors table of the systems Keystone exchanges with. */
export const VIGIE_CONNECTOR_NAME = 'Vigie';
export const CURSUS_CONNECTOR_NAME = 'Cursus';
export const CODEX_CONNECTOR_NAME = 'Codex';

/** False when IT disabled the connector named `name` (the connectors file is applied first); true when it is not listed. */
export async function connectorEnabled(name: string): Promise<boolean> {
  await ensureConnectorsFileApplied();
  const db = await getDb();
  const [c] = await db.select({ enabled: connectors.enabled }).from(connectors).where(eq(connectors.name, name));
  return c?.enabled ?? true;
}
