import 'server-only';
// R-158 lot B — the shipping documents of a shipment (owner's decision 3: every document needed but the invoices): the data the
// templates read (src/server/export/shipping-documents/), and the filing in Codex — the PDF generated, kept as filed in Keystone's
// file store, the Codex index record (type SHP, one per shipment and kind; a new revision at each filing) linked to the shipment,
// and a "deposit" entry in the Codex outbox (pending sync until Codex's API exists — the mock connector keeps it waiting, the HTTP
// connector delivers it with the file). Filed by the shipment editors (`editsShipments`), who see the customs values.
import { and, desc, eq, sql } from 'drizzle-orm';
import { canSeeShipmentValues } from '@/domain/rights';
import type { RoleKey } from '@/config/screens';
import { SHIPPING_DOC_LABEL, SHIPPING_DOC_TYPE, shippingDocBlocker, type ShippingDocKind } from '@/domain/shipping-documents';
import { systemMessage } from '@/domain/system-messages';
import type { Lang, T } from '@/i18n/translate';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { clients, documentTypeCircuitSteps, documentTypes, projects, shipmentDocuments, shipments, siteSheets } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { renderPdf } from '@/server/export/pdf';
import { buildShippingDocument, type ShippingDocData } from '@/server/export/shipping-documents';
import { getCodexConnector } from '@/server/integrations/codex/connector';
import { insertCodexEntry } from '@/server/integrations/codex/outbox';
import { storeFile } from '@/server/storage/files';
import { scanUpload } from '@/server/storage/scan';
import { logWarning } from '@/server/log';
import { fileGeneratedDocument } from './documents';
import { trace, whoIs, type Actor } from './ops-common';
import { getProjectShipments } from './shipments';
import { editsShipments } from './team-guard';

type Q = DB | Tx;

/** What the templates read for one shipment of a project; null when unknown. */
export async function shippingDocData(projectCode: string, ref: string): Promise<ShippingDocData | null> {
  const data = await getProjectShipments(projectCode);
  const s = data?.shipments.find((x) => x.ref === ref);
  if (!data || !s) return null;
  const db = await getDb();
  return shippingDocDataOf(db, data, s, projectCode);
}

async function shippingDocDataOf(db: Q, data: NonNullable<Awaited<ReturnType<typeof getProjectShipments>>>, s: NonNullable<Awaited<ReturnType<typeof getProjectShipments>>>['shipments'][number], projectCode: string): Promise<ShippingDocData> {
  const [p] = await db.select({ code: projects.code, name: projects.name, client: clients.name }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.code, projectCode));
  const [ss] = await db.select({ name: siteSheets.siteName, country: siteSheets.country, contact: siteSheets.clientContact }).from(siteSheets).where(eq(siteSheets.projectId, data.projectId));
  const label = (id: string) => {
    const e = data.equipment.find((x) => x.id === id);
    return e ? `${e.ref} · ${e.quantity > 1 ? `${e.quantity} × ` : ''}${e.machineTypeCode}` : '';
  };
  return {
    project: { code: p.code, name: p.name, client: p.client ?? null },
    site: ss ? { name: ss.name, country: ss.country, contact: ss.contact } : null,
    incoterm: data.incoterm ? { code: data.incoterm.code, name: data.incoterm.nameEn, place: data.incotermPlace } : null,
    shipment: s,
    equipment: s.equipment.map((e) => label(e.id)).filter(Boolean),
  };
}

/**
 * The Codex document type of the shipping documents (SHP, "Shipping document", family Site, kept 10 years, ISO 8.5.4, circuit: the
 * author — Keystone generates and releases the file), added to Keystone's register of Codex types at the first filing (it is to be
 * created in Codex too — notes § Lot B). Idempotent.
 */
export async function ensureShippingDocType(q: Q): Promise<void> {
  const [have] = await q.select({ code: documentTypes.code }).from(documentTypes).where(eq(documentTypes.code, SHIPPING_DOC_TYPE));
  if (have) return;
  const [{ max }] = await q.select({ max: sql<number>`coalesce(max(${documentTypes.position}), -1)::int` }).from(documentTypes);
  await q.insert(documentTypes).values({
    code: SHIPPING_DOC_TYPE, label: 'Shipping document', family: 'site', retention: '10 years', isoClause: '8.5.4 Preservation', isClientDeliverable: false, position: max + 1,
  }).onConflictDoNothing({ target: documentTypes.code });
  await q.insert(documentTypeCircuitSteps).values({ typeCode: SHIPPING_DOC_TYPE, position: 0, role: 'author' }).onConflictDoNothing();
}

export const FILING_ERRORS = [
  'The shipments are read-only for you', 'Unknown shipment', 'Declare the loads and their content first', 'The CMR consignment note is for road transport',
] as const;

/** "File in Codex": generates the document, keeps the PDF as filed, revises its Codex index record and queues the deposit. */
export async function fileShippingDocument(
  projectCode: string, ref: string, kind: ShippingDocKind, actor: Actor, i18n: { t: T; lang: Lang },
): Promise<{ number: string; revision: string }> {
  const db = await getDb();
  const today = await businessToday();
  const data = await getProjectShipments(projectCode);
  const s = data?.shipments.find((x) => x.ref === ref);
  if (!data || !s) throw new Error('Unknown shipment');
  if (!(await editsShipments(db, actor, data.projectId))) throw new Error('The shipments are read-only for you');
  const blocker = shippingDocBlocker(kind, s);
  if (blocker) throw new Error(blocker);
  const docData = await shippingDocDataOf(db, data, s, projectCode);
  const pdf = buildShippingDocument(kind, docData, { t: i18n.t, lang: i18n.lang, values: canSeeShipmentValues(actor.role as RoleKey), today });
  const bytes = await renderPdf(pdf, i18n.lang);
  const who = await whoIs(db, actor);
  const fileName = `${kind}-${projectCode}-${ref}-${today}.pdf`;
  const scanned = await scanUpload(bytes, { purpose: 'export', name: fileName, actor: { name: actor.name, personId: who.personId }, objectRef: `Shipment ${ref}`, projectId: data.projectId });
  const result = await db.transaction(async (tx) => {
    const [sh] = await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.projectId, data.projectId), eq(shipments.ref, ref)));
    if (!sh) throw new Error('Unknown shipment');
    const [prev] = await tx.select().from(shipmentDocuments).where(and(eq(shipmentDocuments.shipmentId, sh.id), eq(shipmentDocuments.kind, kind))).orderBy(desc(shipmentDocuments.generatedAt)).limit(1);
    await ensureShippingDocType(tx);
    const title = `${i18n.t(SHIPPING_DOC_LABEL[kind])} — ${ref}${s.label ? ` · ${s.label}` : ''}`;
    const doc = await fileGeneratedDocument(tx, {
      typeCode: SHIPPING_DOC_TYPE, projectId: data.projectId, projectCode, title, authorPersonId: who.personId, authorName: who.short || actor.name, tags: [ref],
      links: [{ kind: 'shipment', ref }], existingId: prev?.documentId ?? null,
    }, today);
    const file = await storeFile({ purpose: 'export', name: fileName, data: scanned, projectId: data.projectId, ownerType: 'shipment_document', ownerId: sh.id, actor: { name: actor.name, personId: who.personId } }, tx);
    const entry = await insertCodexEntry(tx, {
      documentId: doc.id, documentNumber: doc.number, revision: doc.revision, kind: 'deposit', actorName: who.who, actorPersonId: who.personId, actorRole: actor.role,
      recordedAt: new Date(), storedFileId: file.id,
    });
    await tx.insert(shipmentDocuments).values({
      shipmentId: sh.id, kind, documentId: doc.id, number: doc.number, revision: doc.revision, storedFileId: file.id, sha256: file.sha256, lang: i18n.lang, generatedByPersonId: who.personId,
    });
    const message = systemMessage('shipment.documentFiled', { project: projectCode, ref, document: SHIPPING_DOC_LABEL[kind], number: doc.number, revision: doc.revision });
    await trace(tx, who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: sh.id, projectId: data.projectId, message,
      after: { kind, document: doc.number, revision: doc.revision, sha256: file.sha256, lang: i18n.lang }, activity: { kind: 'change', message },
    });
    await trace(tx, who, {
      objectRef: doc.number, change: doc.created ? `generated by Keystone · ${SHIPPING_DOC_LABEL[kind]} ${ref} · deposited in Codex · Released rev ${doc.revision}` : `new revision generated by Keystone · deposited in Codex · Released rev ${doc.revision}`,
      area: 'Documents', entityType: 'document', entityId: doc.id, projectId: data.projectId,
    });
    return { number: doc.number, revision: doc.revision, entryId: entry.id };
  });
  // The HTTP connector delivers at once (a failure leaves the entry pending for the "codex-outbox" job); the mock keeps it waiting.
  await getCodexConnector().afterRecord(result.entryId).catch((e) => logWarning('Codex deposit (stays pending)', e, { component: 'codex' }));
  return { number: result.number, revision: result.revision };
}
