// URLs of the Documents — Codex index (docs/spec/10 §4, 00 §8.3). Pure: usable from Server and Client Components of
// any screen. URL state of /projects/[code]/documents:
//   ?scope=all              "All projects" (default: current project + QMS)
//   ?view=bpe|audit|client|pending|obsolete   saved view (default all)
//   ?fam=<family code>      ?status=<status code>   ?q=<search>   ?page=2 (R-017: the list's page, 1 omitted)
//   ?doc=PID-HLT-026        open document record drawer (any record, whatever the filters)
//   ?deposit=new            "Deposit in Codex" dialog for a new document, with optional context
//                           &dtype=CER (proposed type) &po=PO-2026-118 (linked order) &part=CR-RAIL-A100 (linked article)
//   ?deposit=PID-HLT-026    dialog in "new revision" mode for that record
import { screenHref } from '@/config/screens';

export interface DocsQuery {
  scope?: 'proj' | 'all' | null;
  view?: string | null;
  fam?: string | null;
  status?: string | null;
  q?: string | null;
  /** R-017: page of the vault list (1 omitted). */
  page?: string | null;
  doc?: string | null;
  deposit?: string | null;
  dtype?: string | null;
  po?: string | null;
  part?: string | null;
}

const ORDER: (keyof DocsQuery)[] = ['scope', 'view', 'fam', 'status', 'q', 'page', 'doc', 'deposit', 'dtype', 'po', 'part'];

/** `/projects/{project}/documents` with its state (defaults omitted). */
export function documentsHref(project: string, query: DocsQuery = {}): string {
  const u = new URLSearchParams();
  for (const k of ORDER) {
    const v = query[k];
    if (v == null || v === '') continue;
    if ((k === 'scope' && v === 'proj') || (k === 'view' && v === 'all')) continue;
    u.set(k, v);
  }
  const qs = u.toString();
  const base = screenHref('docs', { code: project });
  return qs ? `${base}?${qs}` : base;
}

/**
 * Document record drawer of `number`, opened over the vault of `project` (the record's own project; any project for a
 * company QMS document). Example: docHref('PID-HLT-026', 'HLT-026') → /projects/HLT-026/documents?doc=PID-HLT-026.
 */
export const docHref = (number: string, project: string) => documentsHref(project, { doc: number });

export interface DepositContext {
  /** Proposed type code (deposit types: RPT, REC, NCR, CER, COC, PV, LET, MIN, PHO). */
  type?: string | null;
  /** Linked purchase order ("PO-2026-118"). */
  po?: string | null;
  /** Linked article ("CR-RAIL-A100"). */
  part?: string | null;
  /** New revision of this existing record (type, project and title are the record's own). */
  revisionOf?: string | null;
}

/**
 * "Deposit in Codex" hand-off opened from any screen (`openDep`, e.g. the PLM part drawer's material certificate:
 * depositHref('HLT-026', { type: 'CER', part: 'CR-RAIL-A100' })). `keep` carries the vault state of the page that opens it.
 */
export function depositHref(project: string, ctx: DepositContext = {}, keep: DocsQuery = {}): string {
  if (ctx.revisionOf) return documentsHref(project, { ...keep, doc: null, deposit: ctx.revisionOf });
  return documentsHref(project, { ...keep, doc: null, deposit: 'new', dtype: ctx.type, po: ctx.po, part: ctx.part });
}

/** Alias of `depositHref` (`openDep(ctx)` of the prototype). */
export const openDepositHref = depositHref;
