// Golden values reproduced from the prototype's own logic (design lines 5019–5062, run by scripts/proto-golden-docs.ts
// into src/features/docs/docs.golden.json): the 42 DOCS records at their initial state, mapped the way `docRow` reads
// them (status, shared = client deliverable and released, acknowledgement default, revisions withdrawn = earlier
// letters) — scope, saved views, family / status chips, search, KPI tiles, the deposit number preview and helpers.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { docFamily, documentStatus } from '@/server/db/codes';
import GOLD from '@/features/docs/docs.golden.json';
import {
  QMS, canApproveDocument, documentsLinkedTo, clientRecipientText, codexProjectCode, countText, depositNumberPreview, detectDocType, docsBadgeText, familyCounts, filesText,
  inScope, linkedToText, nextRevision, parseDeposit, parseFamily, parseScope, parseStatus, parseView, previousRevision, projectText, queryMatch,
  revisionContextText, revisionIndex, revisionNote, selectedText, statusCounts, titleFromFileName, typeWithCode, vaultKpis, vaultList, versionsText, viewCounts,
  type DocView, type VaultFacts,
} from './documents';

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = PROTO as any;
const G = GOLD as any;

interface ProtoDoc { id: string; type: string; title: string; proj: string; rev: string; status: string; date: string; by: string; tags: string }
const facts = (d: ProtoDoc): VaultFacts => {
  const t = P.DOC_TYPE[d.type];
  const shared = t.client && d.status === 'Released';
  return {
    number: d.id, type: d.type, family: docFamily.code(P.DOC_FAM[t.fam]), project: d.proj, status: documentStatus.code(d.status), revision: d.rev, shared,
    acknowledged: shared && !['26 Sep', '28 Sep', '29 Sep'].includes(d.date), withdrawnRevisions: d.rev.charCodeAt(0) - 65, title: d.title, tagsText: d.tags,
    typeLabel: t.label, author: d.by,
  };
};
const DOCS: VaultFacts[] = (P.DOCS as ProtoDoc[]).map(facts);
const base = { scope: 'proj' as const, project: 'HLT-026', view: 'all' as DocView, family: null, status: null, q: '' };
const ids = (xs: VaultFacts[]) => xs.map((d) => d.number);
const kpiTriples = (ks: any[]) => ks.map((k) => [k.label, k.value, k.sub, k.color === 'var(--color-accent-300)']);

describe('vault scope, views, chips and KPI tiles (dvKpis, dvViews, dvFam, dvSt)', () => {
  it('HLT-026 scope = its records + QMS, Codex order; KPI tiles 40 · 1 · 1 · 25', () => {
    const { scoped, list } = vaultList(DOCS, base);
    expect(ids(list)).toEqual(G.en.hlt.list.map((d: any) => d.id));
    expect(scoped.length).toBe(40);
    expect(vaultKpis(scoped).map((k) => [k.label, k.value, k.sub, k.alert])).toEqual(kpiTriples(G.en.hlt.kpis));
    expect(countText(list.length, scoped.length)).toBe(G.en.hlt.count);
  });

  it('all projects (42), NDC-031 (6) and a project without documents (EWA-051: the 4 QMS records only)', () => {
    for (const [scope, project, g] of [['all', 'HLT-026', G.en.all], ['proj', 'NDC-031', G.en.ndc], ['proj', 'EWA-051', G.en.ewa]] as const) {
      const { scoped, list } = vaultList(DOCS, { ...base, scope: scope as 'all' | 'proj', project });
      expect(ids(list), project).toEqual(g.list.map((d: any) => d.id));
      expect(vaultKpis(scoped).map((k) => [k.label, k.value, k.sub, k.alert]), project).toEqual(kpiTriples(g.kpis));
      expect(viewCounts(scoped, project).map((c) => String(c.count))).toEqual(g.views.map((v: any) => v.count));
    }
  });

  it('saved views: counts and lists (BPE = released records of the current project, not QMS)', () => {
    const scoped = inScope(DOCS, 'proj', 'HLT-026');
    expect(viewCounts(scoped, 'HLT-026').map((c) => [c.view, String(c.count)])).toEqual(
      ['all', 'bpe', 'audit', 'client', 'pending', 'obsolete'].map((v, i) => [v, G.en.hlt.views[i].count]),
    );
    for (const view of ['bpe', 'audit', 'client', 'pending', 'obsolete'] as DocView[]) {
      expect(ids(vaultList(DOCS, { ...base, view }).list), view).toEqual(G.en.views[view]);
      expect(ids(vaultList(DOCS, { ...base, scope: 'all', view }).list), view).toEqual(G.en.allViews[view]);
    }
  });

  it('family and status chips: DOC_FAM / DOC_STATUSES order, present values only', () => {
    const scoped = inScope(DOCS, 'proj', 'HLT-026');
    expect(familyCounts(scoped).map((c) => [docFamily.label(c.family), String(c.count)])).toEqual(G.en.hlt.fam.slice(1).map((c: any) => [c.label, c.count]));
    expect(statusCounts(scoped).map((c) => [documentStatus.label(c.status), String(c.count)])).toEqual(G.en.hlt.st.slice(1).map((c: any) => [c.label, c.count]));
    expect(G.en.hlt.fam[0]).toMatchObject({ label: 'All families', count: '40' });
    const ndc = inScope(DOCS, 'proj', 'NDC-031');
    expect(statusCounts(ndc).map((c) => documentStatus.label(c.status))).toEqual(G.en.ndc.st.slice(1).map((c: any) => c.label));
  });

  it('family, status and view filters combine; search over number, title, tags, kind and author', () => {
    expect(ids(vaultList(DOCS, { ...base, family: 'quality' }).list)).toEqual(G.en.filters.famQuality);
    expect(ids(vaultList(DOCS, { ...base, status: 'draft' }).list)).toEqual(G.en.filters.stDraft);
    expect(ids(vaultList(DOCS, { ...base, view: 'audit', family: 'purchasing' }).list)).toEqual(G.en.filters.auditPurchasing);
    expect(ids(vaultList(DOCS, { ...base, q: 'nordvolt' }).list)).toEqual(G.en.filters.qNordvolt);
    expect(ids(vaultList(DOCS, { ...base, q: 'G. COMTE' }).list)).toEqual(G.en.filters.qComte);
    expect(ids(vaultList(DOCS, { ...base, q: 'material certificate' }).list)).toEqual(G.en.filters.qCertificate);
    const none = vaultList(DOCS, { ...base, q: 'zzz' });
    expect(countText(none.list.length, none.scoped.length)).toBe(G.en.filters.noMatch);
    // The displayed (French) text also matches.
    const d = DOCS.find((x) => x.number === 'NCR-HLT-031')!;
    expect(queryMatch(d, 'épaisseur', 'Épaisseur de peinture hors spécification — poutre G3')).toBe(true);
    expect(queryMatch(d, 'épaisseur')).toBe(false);
    expect(queryMatch(d, '   ')).toBe(true);
  });

  it('URL parsers fall back to the defaults', () => {
    expect([parseScope('all'), parseScope('x'), parseScope(null)]).toEqual(['all', 'proj', 'proj']);
    expect([parseView('audit'), parseView('folders'), parseView(undefined)]).toEqual(['audit', 'all', 'all']);
    expect([parseFamily('purchasing'), parseFamily('Purchasing')]).toEqual(['purchasing', null]);
    expect([parseStatus('release_proposed'), parseStatus('Release proposed')]).toEqual(['release_proposed', null]);
  });

  it('sidebar badge and selection text', () => {
    expect([docsBadgeText(1), docsBadgeText(0)]).toEqual(['1', '']);
    expect(selectedText(3)).toBe('3 selected');
    expect(G.en.selection.three).toBe('3 selected');
  });
});

describe('record drawer texts', () => {
  it('revision notes, working versions, identity values', () => {
    expect(revisionNote({ revision: 'B', current: true, withdrawnText: null })).toBe(G.en.drawers['PID-HLT-026'].revs[0].note.replace('D', 'B'));
    expect(revisionNote({ revision: 'A', current: true, withdrawnText: null })).toBe('First issue');
    expect(revisionNote({ revision: 'A', current: false, withdrawnText: '2 Sep' })).toBe('Withdrawn 2 Sep');
    expect(G.en.drawers['PID-HLT-026'].revs.map((r: any) => r.note)).toEqual([
      'Rev D · changes recorded in transmittal', 'Withdrawn 26 Sep', 'Withdrawn 5 Sep', 'Withdrawn 15 Aug',
    ]);
    expect(versionsText({ revision: 'A', current: true, workingVersions: 3 })).toBe('A.3');
    expect(versionsText({ revision: 'D', current: true, workingVersions: 3 })).toBe('D.3');
    expect(versionsText({ revision: 'B', current: false, workingVersions: 3 })).toBe('3 working versions');
    expect([projectText(QMS), projectText('HLT-026'), filesText('photos'), filesText('native_pdf')]).toEqual(['QMS — transverse', 'HLT-026', 'JPG ×12', 'Native + PDF']);
    expect(G.en.drawers['PRO-QMS-001'].meta.find((m: any) => m.k === 'Project').v).toBe('QMS — transverse');
    expect(G.en.drawers['PHO-HLT-011'].meta.find((m: any) => m.k === 'Files').v).toBe('JPG ×12');
    expect(clientRecipientText('Port authority', 'N. Bensaïd')).toBe(G.en.drawers['PID-HLT-026'].dist[0].to);
    expect(clientRecipientText('Infrastructure BU', null)).toBe('Client — Infrastructure BU');
    expect(typeWithCode('P&ID', 'PID')).toBe(G.en.drawers['PID-HLT-026'].meta.find((m: any) => m.k === 'Type').v);
    expect([typeWithCode('Acceptance minutes (PV)', 'PV'), typeWithCode('Schéma de procédé (PFD)', 'PFD'), typeWithCode('Quotation', 'RFQ')]).toEqual([
      'Acceptance minutes (PV)', 'Schéma de procédé (PFD)', 'Quotation (RFQ)',
    ]);
  });

  it('revision letters', () => {
    expect([revisionIndex('A'), revisionIndex('D'), nextRevision('D'), nextRevision('Z'), previousRevision('D'), previousRevision('A')]).toEqual([0, 3, 'E', null, 'C', null]);
    expect(revisionContextText('PID-HLT-026', 'D')).toBe('PID-HLT-026 · new revision E');
  });

  it('who may approve: the named next approver, or the portfolio director', () => {
    const d = { canApprove: true, nextApprover: 'G. Comte' };
    expect(canApproveDocument({ short: 'G. Comte', role: 'quality' }, d)).toBe(true);
    expect(canApproveDocument({ short: 'M. Lefebvre', role: 'director' }, d)).toBe(true);
    expect(canApproveDocument({ short: 'R. Aubert', role: 'pm' }, d)).toBe(false);
    expect(canApproveDocument({ short: 'G. Comte', role: 'quality' }, { canApprove: false, nextApprover: 'G. Comte' })).toBe(false);
    expect(canApproveDocument({ short: 'L. Fabre', role: 'member' }, { canApprove: true, nextApprover: null })).toBe(false);
  });
});

describe('records linked to a reference (partDocs, PLM part drawer)', () => {
  it('relation or whole tag', () => {
    const docs = (P.DOCS as (ProtoDoc & { links: [string, string][] })[]).map((d) => ({ number: d.id, tags: d.tags.split(' · '), links: d.links.map(([, ref]) => ({ ref })) }));
    expect(documentsLinkedTo(docs, 'EL-VFD-200').map((d) => d.number)).toEqual(['BOM-ELE-026', 'RPT-HLT-016', 'REC-HLT-009', 'RFQ-HLT-041', 'PO-HLT-118']);
    expect(documentsLinkedTo(docs, 'CR-RAIL-A100').map((d) => d.number)).toEqual(['CER-HLT-039']);
    expect(documentsLinkedTo(docs, 'NOPE')).toEqual([]);
  });
});

describe('deposit hand-off (depVals 5048–5060)', () => {
  it('number preview: count of the type in the project + 40, next free number', () => {
    const all = DOCS.map((d) => ({ number: d.number, type: d.type, project: d.project }));
    expect(depositNumberPreview(all, 'CER', 'HLT-026')).toBe(G.en.deposit.default.number);
    expect(depositNumberPreview(all, 'RPT', 'HLT-026')).toBe(G.en.deposit.rptEmpty.number);
    expect(depositNumberPreview(all, 'PV', 'NDC-031')).toBe(G.en.deposit.ndcPv.number);
    expect(depositNumberPreview(all, 'REC', QMS)).toBe(G.en.deposit.qmsRec.number);
    expect(depositNumberPreview(all, 'PHO', 'EWA-051')).toBe('PHO-EWA-040');
    // A taken number moves to the next free one (the prototype would have created a duplicate).
    expect(depositNumberPreview([...all, { number: 'CER-HLT-042', type: 'LET', project: 'HLT-026' }], 'CER', 'HLT-026')).toBe('CER-HLT-043');
    expect([codexProjectCode('HLT-026'), codexProjectCode(QMS)]).toEqual(['HLT', 'QMS']);
  });

  it('type detection from the file name and the proposed title', () => {
    expect(detectDocType('Certificat_3.1_S355_coulee_7781.pdf')).toBe('CER');
    expect(detectDocType('Certificate_of_conformity_SW-001.pdf')).toBe('COC');
    expect(detectDocType('NCR_paint_thickness_G3.docx')).toBe('NCR');
    expect(detectDocType('rapport_non-conformite_poteau7.pdf')).toBe('NCR');
    expect(detectDocType('PV_reception_fondations.pdf')).toBe('PV');
    expect(detectDocType('CR_reunion_chantier_24.docx')).toBe('MIN');
    expect(detectDocType('Lettre_acces_quai_4.pdf')).toBe('LET');
    expect(detectDocType('Calibration_record_torque.xlsx')).toBe('REC');
    expect(detectDocType('FAT_report_hoist_drive.pdf')).toBe('RPT');
    expect(detectDocType('IMG_2041.JPG')).toBe('PHO');
    expect(detectDocType('Site_report_quay4.jpg')).toBe('PHO');
    expect(detectDocType('Photos_fondations_poteau7.zip')).toBe('PHO');
    expect(detectDocType('scan0001.pdf')).toBeNull();
    expect(detectDocType('')).toBeNull();
    expect(titleFromFileName('Rapport_FAT_lot-2.pdf')).toBe('Rapport FAT lot-2');
    expect(titleFromFileName('  IMG_2041.JPG')).toBe('IMG 2041');
  });

  it('summary helpers and validation of the hand-off', () => {
    expect(linkedToText('PO-2026-118', 'CR-RAIL-A100')).toBe(G.en.deposit.default.meta.find((m: any) => m.k === 'Linked to').v);
    expect(linkedToText(' ', '')).toBe(G.en.deposit.rptEmpty.meta.find((m: any) => m.k === 'Linked to').v);
    expect(linkedToText('', 'EL-VFD-200')).toBe('EL-VFD-200');
    expect(parseDeposit({ project: 'HLT-026', type: 'CER', title: '  Cert  3.1 ', po: ' PO-1 ', part: '' })).toEqual({
      ok: true, value: { project: 'HLT-026', type: 'CER', title: 'Cert 3.1', po: 'PO-1', part: '', revisionOf: null },
    });
    expect(parseDeposit({ project: 'HLT-026', type: 'PID', title: 'x' })).toEqual({ ok: false, error: 'Unknown document type' });
    expect(parseDeposit({ project: 'HLT-026', type: 'CER', title: '   ' })).toEqual({ ok: false, error: 'Title is required' });
    expect(parseDeposit({ project: 'HLT-026', type: 'CER', title: 'x'.repeat(161) })).toEqual({ ok: false, error: 'Title too long' });
    expect(parseDeposit({ project: 'HLT-026', type: 'CER', title: 'x', po: 'P'.repeat(61) })).toEqual({ ok: false, error: 'Reference too long' });
    expect(parseDeposit({ project: '', type: 'CER', title: 'x' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(parseDeposit(null)).toEqual({ ok: false, error: 'Invalid request' });
    expect(parseDeposit({ project: 'HLT-026', type: 7, title: { x: 1 } })).toEqual({ ok: false, error: 'Unknown document type' });
    expect(parseDeposit({ project: 'HLT-026', revisionOf: 'PID-HLT-026', po: 'D-016' })).toEqual({
      ok: true, value: { project: 'HLT-026', type: '', title: '', po: 'D-016', part: '', revisionOf: 'PID-HLT-026' },
    });
  });
});
