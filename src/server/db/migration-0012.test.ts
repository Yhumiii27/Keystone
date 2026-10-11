// Delivery 7, C-6 (R-076): migration 0012 (the lot's 0008, renumbered at integration after the other lots' migrations) reads the
// payment rule and N of the contracts that existed before 0011 from their stored text, exactly as `termsOfText` does (the seed and
// the DAL use it). Re-runs the migration's SQL on stored texts.
import fs from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { termsOfText } from '@/domain/payment-terms';
import { getDb, setDb } from './client';
import { openDatabase } from './open';
import { contracts } from './schema';

const SQL = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0012_contract_payment_terms_backfill.sql'), 'utf8');

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('migration 0012: payment terms backfill', () => {
  it.each([
    'Net 45 days', 'Net 30 days', '45 jours fin de mois', '30 days end of month', 'Fin de mois + 30 jours', 'End of month + 15 days',
    'on receipt', 'Net 365 days', '60 days EOM', 'Paiement à 60 jours FDM', 'Net 1234567 days',
  ])('"%s"', async (text) => {
    const db = await getDb();
    const [c] = await db.select({ id: contracts.id }).from(contracts).limit(1);
    await db.update(contracts).set({ paymentTerms: text, paymentRule: 'net', paymentDays: 0 }).where(eq(contracts.id, c.id));
    await db.execute(sql.raw(SQL));
    const [after] = await db.select({ rule: contracts.paymentRule, days: contracts.paymentDays }).from(contracts).where(eq(contracts.id, c.id));
    expect(after).toEqual(termsOfText(text));
  });
});
