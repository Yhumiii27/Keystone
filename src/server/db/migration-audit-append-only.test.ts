// Delivery 8, R-168 (spec 11 §3.12): the audit trail is append-only and names the user that acted.
// - The custom migration `audit_append_only` (backfill, then the triggers) re-run on an "existing data directory": rows
//   written before the migration get their user, then UPDATE, DELETE and TRUNCATE are refused — a cascaded foreign-key
//   action included (project_id is NO ACTION: a project with audit rows cannot be deleted).
// - writeAudit resolves the user (person → account), keeps none for a system actor, and stores reason, before / after and the
//   message key; the seed writes its rows with their user (they can no longer be updated after insert).
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { systemMessage } from '@/domain/system-messages';
import { getDb, setDb } from './client';
import { writeAudit } from './helpers';
import { openDatabase } from './open';
import { auditEntries, persons, projects, users } from './schema';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { trace } from '@/server/dal/ops-common';

const FILE = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((f) => /^\d{4}_audit_append_only\.sql$/.test(f))!;
const STATEMENTS = fs.readFileSync(path.join(process.cwd(), 'drizzle', FILE), 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

/** The database error of a refused statement (Drizzle wraps the driver's error). */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    let msg = '';
    for (let err = e as { message?: string; cause?: unknown } | undefined, i = 0; err && i < 5; err = err.cause as typeof err, i++) msg += ` ${err.message ?? ''}`;
    return msg;
  }
  return 'not refused';
}

const userOfPersona = async (role: string) => {
  const [u] = await (await getDb()).select({ id: users.id, personId: users.personId, email: users.email }).from(users).where(eq(users.personaRole, role));
  return u;
};

describe('R-168: append-only audit trail (custom migration)', () => {
  it('UPDATE, DELETE and TRUNCATE are refused; so is deleting a project that has audit rows', async () => {
    const db = await getDb();
    const before = (await listAudit({ limit: 1_000 })).length;
    expect(await refusal(() => db.update(auditEntries).set({ change: 'tampered' }))).toMatch(/audit_entries is append-only: UPDATE refused/);
    expect(await refusal(() => db.delete(auditEntries))).toMatch(/audit_entries is append-only: DELETE refused/);
    expect(await refusal(() => db.execute(sql`truncate audit_entries`))).toMatch(/audit_entries is append-only: TRUNCATE refused/);
    // A project with an audit row: its deletion is refused (the foreign key no longer sets the row's project to null).
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'EWA-051'));
    await writeAudit(db, { actorName: 'Marie Lefebvre', objectRef: 'EWA-051', change: 'audit test', area: 'Projects', projectId: p.id });
    expect(await refusal(() => db.delete(projects).where(eq(projects.id, p.id)))).toMatch(/violates foreign key constraint "audit_entries_project_id_projects_id_fk"/);
    expect((await listAudit({ limit: 1_000 })).length).toBe(before + 1);
    expect((await listAudit({ limit: 1_000 })).every((a) => a.change !== 'tampered')).toBe(true);
  });

  it('re-run on an existing data directory: rows written before it get their user, then the triggers are back', async () => {
    const db = await getDb();
    const pm = await userOfPersona('pm');
    // Before the migration: no triggers, a row with its person but no user.
    await db.execute(sql`drop trigger if exists "audit_entries_no_update_delete" on "audit_entries"`);
    await db.execute(sql`drop trigger if exists "audit_entries_no_truncate" on "audit_entries"`);
    await db.insert(auditEntries).values({ occurredAt: new Date('2026-09-01T08:00:00Z'), actorName: 'Romain Aubert', actorPersonId: pm.personId, objectRef: 'OLD-1', change: 'before 0017', area: 'Test' });
    for (const s of STATEMENTS) await db.execute(sql.raw(s));
    const [row] = await db.select({ user: auditEntries.actorUserId }).from(auditEntries).where(eq(auditEntries.objectRef, 'OLD-1'));
    expect(row.user).toBe(pm.id);
    expect(await refusal(() => db.update(auditEntries).set({ reason: 'x' }).where(eq(auditEntries.objectRef, 'OLD-1')))).toMatch(/append-only/);
    expect(await refusal(() => db.execute(sql`truncate audit_entries`))).toMatch(/append-only/);
  });

  it('the seeded rows carry the user of their actor (set at insert)', async () => {
    const db = await getDb();
    const seeded = await db
      .select({ who: auditEntries.actorName, user: auditEntries.actorUserId, personUser: users.id })
      .from(auditEntries)
      .leftJoin(users, eq(users.personId, auditEntries.actorPersonId))
      .where(isNotNull(auditEntries.actorPersonId));
    expect(seeded.length).toBeGreaterThanOrEqual(8);
    for (const r of seeded) expect([r.who, r.user]).toEqual([r.who, r.personUser]);
    // Romain Aubert (CR-008), the client contact (D-015) and the procurement persona (PO-1082) have accounts.
    expect(seeded.filter((r) => ['Romain Aubert', 'Nadia Bensaïd', 'Fabien Bertrand'].includes(r.who)).every((r) => r.user)).toBe(true);
  });
});

describe('R-168: writeAudit — user, reason, before / after; R-184: message key', () => {
  it('resolves the user of a demo persona from the person id or the name, keeps an explicit (Entra) user, none for systems', async () => {
    const db = await getDb();
    const pm = await userOfPersona('pm');
    const director = await userOfPersona('director');
    await writeAudit(db, { actorName: 'Romain Aubert', actorPersonId: pm.personId, objectRef: 'U-1', change: 'by person id', area: 'Test' });
    await writeAudit(db, { actorName: 'R. Aubert', objectRef: 'U-2', change: 'by short name', area: 'Test' });
    await writeAudit(db, { actorName: 'Romain Aubert', actorPersonId: pm.personId, actorUserId: director.id, objectRef: 'U-3', change: 'signed-in user', area: 'Test' });
    for (const system of ['System', 'Codex', 'Lucca', 'Vigie', 'Cursus', 'Sage X3', 'Keystone', 'IT · configuration file']) {
      await writeAudit(db, { actorName: system, objectRef: `S-${system}`, change: 'system', area: 'Test' });
    }
    // A person without an account (no user) and an unknown name.
    const [helene] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Hélène Sauvage'));
    expect((await db.select().from(users).where(eq(users.personId, helene.id))).length).toBe(0);
    await writeAudit(db, { actorName: 'Hélène Sauvage', actorPersonId: helene.id, objectRef: 'U-4', change: 'no account', area: 'Test' });
    await writeAudit(db, { actorName: 'Accounts payable', objectRef: 'U-5', change: 'unknown', area: 'Test' });
    const userOf = async (ref: string) => (await db.select({ u: auditEntries.actorUserId }).from(auditEntries).where(eq(auditEntries.objectRef, ref)))[0].u;
    expect([await userOf('U-1'), await userOf('U-2'), await userOf('U-3'), await userOf('U-4'), await userOf('U-5')]).toEqual([pm.id, pm.id, director.id, null, null]);
    const systems = await db.select({ u: auditEntries.actorUserId }).from(auditEntries).where(eq(auditEntries.change, 'system'));
    expect(systems.map((r) => r.u)).toEqual(Array(8).fill(null));
  });

  it('stores the reason, the values before / after and the message key with its English text', async () => {
    const db = await getDb();
    await writeAudit(db, {
      actorName: 'Marie Lefebvre', objectRef: 'RFQ-T', area: 'Purchasing', entityType: 'rfq', reason: '  Supplier withdrew  ', before: { status: 'draft' }, after: { status: 'open' },
      message: systemMessage('audit.status', { from: 'Draft', to: 'Open' }),
    });
    const [row] = await db.select().from(auditEntries).where(and(eq(auditEntries.objectRef, 'RFQ-T'), eq(auditEntries.area, 'Purchasing')));
    // The English text stays byte-identical to what kpis.ts matches ('status: Draft → Open').
    expect([row.change, row.reason, row.before, row.after, row.messageKey, row.messageParams]).toEqual([
      'status: Draft → Open', 'Supplier withdrew', { status: 'draft' }, { status: 'open' }, 'audit.status', { from: 'Draft', to: 'Open' },
    ]);
    const listed = (await listAudit({ limit: 1_000 })).find((a) => a.object === 'RFQ-T')!;
    expect(listed).toMatchObject({ reason: 'Supplier withdrew', before: { status: 'draft' }, after: { status: 'open' }, messageKey: 'audit.status' });
    expect(listed.userEmail).toBe((await userOfPersona('director')).email);
  });
});

describe('R-168 / R-184: the shared trace helper (ops-common)', () => {
  it('passes the user, reason and before / after to the audit row, and a keyed activity writes its English text', async () => {
    const db = await getDb();
    const quality = await userOfPersona('quality');
    await trace(db, { personId: quality.personId, who: 'Gabriel Comte' }, {
      objectRef: 'TR-1', area: 'Quality', reason: 'Wrong batch', before: { status: 'open' }, after: { status: 'closed' },
      message: systemMessage('audit.status', { from: 'Open', to: 'Closed' }),
      activity: { kind: 'quality', message: systemMessage('audit.status', { from: 'Open', to: 'Closed' }) },
    });
    const [row] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'TR-1'));
    expect([row.actorUserId, row.change, row.reason, row.before, row.after, row.messageKey]).toEqual([quality.id, 'status: Open → Closed', 'Wrong batch', { status: 'open' }, { status: 'closed' }, 'audit.status']);
    const act = (await listActivity()).find((a) => a.who === 'Gabriel Comte' && a.messageKey === 'audit.status')!;
    expect([act.what, act.messageParams]).toEqual(['status: Open → Closed', { from: 'Open', to: 'Closed' }]);
    // Plain text callers are unchanged; an explicit user wins.
    await trace(db, { personId: quality.personId, who: 'Gabriel Comte', userId: null }, { objectRef: 'TR-2', change: 'note added', area: 'Quality', activity: { text: 'Noted TR-2', kind: 'quality' } });
    const [plain] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'TR-2'));
    expect([plain.actorUserId, plain.change, plain.messageKey, plain.before]).toEqual([null, 'note added', null, null]);
  });
});
