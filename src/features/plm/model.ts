// View models of the PLM — parts catalogue (docs/spec/09 §3, template 2535–2580, logic 4267–4292) and of the shared
// part record drawer (§2, template 2582–2613, logic 4293–4304 + 5062): the domain figures (src/domain/parts.ts) and the
// DAL rows turned into the translated strings, tag classes and links the components render. Pure (no I/O): `t` and
// `lang` come from the caller.
import type { KeyValue } from '@/components/app/KeyValueList';
import { LO, OK, lifecycleTone } from '@/components/app/tones';
import { canSee, type RoleKey } from '@/config/screens';
import {
  clearPlmFilter, commercialLines, diffChangeText, diffKindTone, hasPlmFilter, identificationLines, nextPlmSort, partStatusNote, partStatusTone,
  plmKpis, plmOptions, plmRows, restrictionCell, stockSummary, usedCountText, wearSpareTone, canCompletePartRecord, canValidatePart, partValidationErrors,
  type PartFacts, type PlmSortKey, type PlmState,
} from '@/domain/parts';
import { yearOfIso } from '@/domain/clock';
import type { Lang, T } from '@/i18n/translate';
import { moneyEur } from '@/lib/format';
import { depositHref, docHref } from '@/features/docs/links';
import { vaultRowView } from '@/features/docs/model';
import { DRAWING_STATE_TAG, ECO_STATUS_TAG, displayOfIso, fmtDOfIso, revisionDiffKind } from '@/server/db/codes';
import type { PartRow } from '@/server/dal/parts';
import type { PartDrawerData } from '@/server/dal/plm';
import { vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { belowMinT, countT, inStockT, leadLongT, leadShortT, qtyT, reservedT, revStepT, revT, totalQuantityT, unitsT } from './i18n';
import { bomHref, drawingHref, ecoHref, fleetHref, openInPlmHref, plmHref, stockHref, withPart } from './links';
import { PRICE_MASK, canSeeSupplierPrices } from '@/domain/rights';
import { dataText } from '@/i18n/data-text';
import { duplicateOfText } from '@/features/bom/i18n';

const tag = (tone: string) => `tag tag-${tone}`;

// ── Catalogue ──────────────────────────────────────────────────────────────────────────────────────────

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface SelectView {
  /** Search param written by the select. */
  param: 'type' | 'status' | 'pu' | 'mb';
  label: string;
  value: string;
  options: { value: string; label: string }[];
}

export interface HeaderView {
  key: string;
  label: string;
  align?: 'right';
  /** Sortable column: link to the next sort state and its caret. */
  sort: { href: string; icon: 'up' | 'down' | 'updown'; active: boolean } | null;
}

export interface CatalogueRowView {
  ref: string;
  /** Row click toggles the drawer (`part === ref ? null : ref`). */
  href: string;
  selected: boolean;
  name: string;
  type: string;
  makeBuy: string;
  pu: string;
  puClass: string;
  manufacturer: string;
  manufacturerRef: string;
  price: string;
  lead: string;
  status: string;
  statusClass: string;
  /** First open Vigie ECO of the part (outline tag → the ECO screen). */
  eco: { number: string; href: string } | null;
  restriction: string;
  restrictionAlert: boolean;
  usedIn: string;
}

export interface CatalogueView {
  kpis: KpiView[];
  q: string;
  searchPlaceholder: string;
  selects: SelectView[];
  restricted: { on: boolean; label: string; href: string };
  clear: { label: string; href: string } | null;
  title: string;
  count: string;
  headers: HeaderView[];
  rows: CatalogueRowView[];
}

export interface CatalogueInput {
  parts: readonly PartRow[];
  openEco: Record<string, string>;
  state: PlmState;
  /** `?part=` (open drawer). */
  part: string | null;
  /** Catalogue prices shown (R-046, NEW-D2-1: director, PMs, procurement); masked otherwise (no price sort). Default true. */
  prices?: boolean;
}

/** Part name as the prototype translates it (deepTr: "Safety PLC" → "Automate sécurité"). */
/** R-148: a part name as typed (or its seeded demo entry). */
const nameT = (p: Pick<PartFacts, 'name'>, lang: Lang) => dataText(p.name, lang);

export function catalogueView({ parts, openEco, state, part, prices = true }: CatalogueInput, t: T, lang: Lang): CatalogueView {
  const href = (s: PlmState, p: string | null = part) => plmHref(s, p);
  const f = state.filter;
  const rows = plmRows(parts, state, lang === 'fr' ? (p) => nameT(p, lang) : undefined);
  const o = plmOptions(parts);
  const select = (param: SelectView['param'], label: string, value: string, options: { value: string; label: string }[]): SelectView => ({
    param, label, value, options: options.map((x) => ({ value: x.value, label: t(x.label) })),
  });
  // A masked price is not sortable either (the order would reveal it).
  const sortable: Record<string, PlmSortKey> = { ref: 'ref', name: 'name', type: 'type', ...(prices ? { price: 'price' as const } : {}), status: 'status' };
  const head = (key: string, label: string, align?: 'right'): HeaderView => {
    const k = sortable[key];
    const active = !!k && state.sort.key === k;
    const icon: 'up' | 'down' | 'updown' = active ? (state.sort.dir === 1 ? 'up' : 'down') : 'updown';
    return { key, label: t(label), align, sort: k ? { href: href({ ...state, sort: nextPlmSort(state.sort, k) }), icon, active } : null };
  };
  return {
    kpis: plmKpis(parts).map((k) => ({ label: t(k.label), value: k.value === '—' ? '—' : t(k.value), sub: t(k.sub), color: k.alert ? LO : OK })),
    q: f.q,
    searchPlaceholder: t('Search reference, name, manufacturer, manufacturer ref'),
    selects: [
      select('type', t('Type'), f.type ?? '', o.types),
      select('status', t('Status'), f.status ?? '', o.statuses),
      select('pu', t('PU/PR'), f.pu ?? '', o.pu),
      select('mb', t('Make / buy'), f.mb ?? '', o.mb),
    ],
    restricted: { on: f.restricted, label: t('Export-restricted only'), href: href({ ...state, filter: { ...f, restricted: !f.restricted } }) },
    clear: hasPlmFilter(f) ? { label: t('Clear filters'), href: href(clearPlmFilter(state)) } : null,
    title: t('Parts catalogue'),
    count: countT(rows.length, parts.length, lang),
    headers: [
      head('ref', 'Reference'), head('name', 'Part'), head('type', 'Type'), head('mb', 'Make / buy'), head('pu', 'PU/PR'), head('mfr', 'Manufacturer'),
      head('price', 'Unit price', 'right'),
      // "Discipline lead" in the prototype (key k239, 00 §7.16 / 09 OQ2): the column shows the lead time.
      head('lead', 'Lead time'), head('status', 'Status'), head('restr', 'Restrictions'), head('used', 'Used in'),
    ],
    rows: rows.map((p) => {
      const eco = openEco[p.ref] ?? null;
      return {
        ref: p.ref, href: href(state, part === p.ref ? null : p.ref), selected: part === p.ref, name: nameT(p, lang), type: t(p.typeLabel), makeBuy: t(p.makeBuyLabel),
        pu: p.wearSpare ?? '—', puClass: tag(wearSpareTone(p.wearSpare)), manufacturer: p.manufacturer ?? '—', manufacturerRef: p.manufacturerRef ?? '',
        price: prices ? moneyEur(p.listPriceEur, lang) : PRICE_MASK, lead: leadShortT(p.leadWeeks, t), status: t(p.statusLabel), statusClass: tag(partStatusTone(p.status)),
        eco: eco ? { number: eco, href: ecoHref(eco) } : null, restriction: t(restrictionCell(p)), restrictionAlert: !!p.exportRestriction,
        usedIn: t(usedCountText(p.usage.length)),
      };
    }),
  };
}

// ── Part record drawer ─────────────────────────────────────────────────────────────────────────────────

export interface DrawerRow {
  key: string;
  /** Line 1 (tabular ref / name). */
  title: string;
  /** Line 2 (11px neutral-400, ellipsis). */
  sub: string;
  /** Middle column (11.5px neutral-400), e.g. a document type or "× 4". */
  aside?: string;
  tagLabel?: string;
  tagClass?: string;
  href: string;
  /** Opens outside Keystone (Vigie). */
  external?: boolean;
  /** Trailing arrow (navigation to another screen). */
  arrow?: boolean;
  /** Stays on the page (another part's drawer): no scroll to top. */
  samePage?: boolean;
}

export interface EcoRowView extends DrawerRow {
  /** "Pending sync with Vigie" while progress recorded in Keystone waits for Vigie; null otherwise. */
  syncNote: string | null;
  vigieHref: string;
  vigieLabel: string;
}

export interface RevisionEventView {
  key: string;
  /** "ASM-RMG-250 · rev B → rev C". */
  title: string;
  /** "12 Sep 2026 · ECO-2026-014". */
  sub: string;
  ecoHref: string | null;
  lines: { key: string; path: string; name: string; change: string; kind: string; kindClass: string }[];
}

export interface PartDrawerView {
  ref: string;
  name: string;
  status: string;
  statusClass: string;
  closeHref: string;
  /** "Open in PLM"; `samePage` on the catalogue itself (the drawer stays as it is). */
  openPlm: { label: string; href: string; samePage: boolean };
  /** STATUS_NOTE banner; null for validated parts. */
  warn: string | null;
  /** R-111 (NEW-D4-5 = c): "Possible duplicate of … · to be checked by the engineering office" in the project's BOM; null otherwise. */
  duplicate: string | null;
  documents: { label: string; deposit: { label: string; href: string }; rows: DrawerRow[] };
  identification: { label: string; items: KeyValue[] };
  commercial: { label: string; items: KeyValue[] };
  equivalents: { label: string; rows: DrawerRow[]; empty: string | null; register: { label: string; candidates: { ref: string; name: string }[] } | null };
  spares: { label: string; rows: DrawerRow[]; open: { label: string; href: string } } | null;
  stock: { label: string; rows: DrawerRow[]; empty: string | null; totals: KeyValue[] };
  projects: { label: string; rows: DrawerRow[]; empty: string | null };
  usedIn: { label: string; chains: string[] } | null;
  machines: { label: string; rows: DrawerRow[]; empty: string | null };
  revisions: { label: string; current: KeyValue; events: RevisionEventView[]; empty: string | null };
  drawings: { label: string; rows: DrawerRow[]; empty: string | null };
  ecos: { label: string; rows: EcoRowView[]; empty: string | null; raise: { label: string; title: string; href: string } | null } | null;
  /**
   * R-102 (E-1a, E-1b): engineering's validation — who validated and when, what is still missing, "Complete the record" (the
   * catalogue's editors while Not validated, the validators afterwards) and "Validate part" (engineering lead, director).
   * Null when there is nothing to show or do (a seed Validated part, for a viewer who cannot change it).
   */
  qualification: PartQualificationView | null;
}

export interface PartQualificationView {
  label: string;
  items: KeyValue[];
  /** Translated reasons the part cannot be validated yet ([] = complete). */
  missing: string[];
  complete: { label: string } | null;
  /** Offered to the validators on a Not validated part; disabled while `missing` is not empty. */
  validate: { label: string; enabled: boolean } | null;
}

export interface DrawerContext {
  role: RoleKey;
  /** URL of the page without the drawer (`?part=` removed); selecting another part keeps it. */
  closeHref: string;
  /** Project of the page (project screens) — prefills Raise ECO and the Codex deposit; null on global screens. */
  projectCode: string | null;
  /** Fallback project for the Codex deposit and the BOM links (the last project used). */
  fallbackProject: string;
  /** Candidates of "Register equivalent" (null when the viewer may not edit the catalogue). */
  equivalentCandidates: { ref: string; name: string }[] | null;
  /** R-111: lines of the page's project BOM the part may duplicate (only with `projectCode`; nothing on global screens). */
  duplicateOf?: string[];
}

const kv = (k: string, v: string, alert = false): KeyValue => ({ k, v, color: alert ? LO : OK });

/** R-102: the drawer's Qualification section for this viewer (role in force), or null; the date's year shown outside the business year `year`. */
export function partQualificationView(p: PartRow, role: RoleKey, t: T, year: number): PartQualificationView | null {
  const edits = canSee(role, 'plm');
  const complete = canCompletePartRecord(p.status, role, edits);
  const validating = p.status === 'not_validated';
  if (!validating && !p.validatedAt && !complete) return null;
  const missing = validating ? partValidationErrors(p).map((m) => t(m)) : [];
  const items: KeyValue[] = [];
  if (p.validatedAt) items.push(kv(t('Validated'), [t(fmtDOfIso(p.validatedAt.slice(0, 10), year)), p.validatedBy].filter(Boolean).join(' · ')));
  if (validating) items.push(kv(t('Before validation'), missing.length ? missing.join(' · ') : t('Record complete'), missing.length > 0));
  return {
    label: t('Qualification'),
    items,
    missing,
    complete: complete ? { label: t('Complete the record') } : null,
    validate: canValidatePart(p.status, role) ? { label: t('Validate part'), enabled: !missing.length } : null,
  };
}

export function partDrawerView(data: PartDrawerData, ctx: DrawerContext, t: T, lang: Lang): PartDrawerView {
  const p = data.record;
  const select = (ref: string) => withPart(ctx.closeHref, ref);
  const project = ctx.projectCode ?? ctx.fallbackProject;
  const canSeeEco = canSee(ctx.role, 'eco');
  // Projects equipped: BOM of the project with the drawer kept; PU/PR list of the system in a project that uses it.
  const spareProject = p.usage.find((u) => u.projectCode === project)?.projectCode ?? p.usage[0]?.projectCode ?? project;
  const ecosShown = data.ecos.filter((e) => e.status !== 'rejected');
  const stock = stockSummary(data.stock);
  const machineState = (s: string) => (s === 'decision_pending' ? 'accent' : s === 'pinned' || s === 'retrofit_pending' ? 'outline' : 'neutral');

  return {
    ref: p.ref,
    name: nameT(p, lang),
    status: t(p.statusLabel),
    statusClass: tag(partStatusTone(p.status)),
    closeHref: ctx.closeHref,
    openPlm: (() => {
      const here = withPart(ctx.closeHref, p.ref);
      const href = openInPlmHref(p.ref, here);
      return { label: t('Open in PLM'), href, samePage: href === here };
    })(),
    warn: partStatusNote(p.status) ? t(partStatusNote(p.status)!) : null,
    duplicate: ctx.projectCode && ctx.duplicateOf?.length ? duplicateOfText(ctx.duplicateOf, lang) : null,

    // Codex records citing the part — the prototype labelled this section «Freeze» (key misuse, 09 OQ3).
    documents: {
      label: t('Documents'),
      deposit: { label: t('Propose release'), href: depositHref(project, { type: 'CER', part: p.ref }) },
      rows: data.documents.map((d) => {
        const r = vaultRowView(d, '', false, t, lang);
        return {
          key: d.number, title: `${d.number} · ${revT(d.revision, lang)}`, sub: r.title, aside: r.kind, tagLabel: r.status, tagClass: r.statusClass,
          href: docHref(d.number, d.project === 'QMS' ? project : d.project),
        };
      }),
    },

    identification: {
      label: t('Identification'),
      items: identificationLines(p).map((l) => kv(t(l.k), l.k === 'Lead time' ? leadLongT(p.leadWeeks, t) : l.translate ? t(l.v) : l.v, l.alert)),
    },
    commercial: {
      label: t('Commercial & export'),
      // R-046 (NEW-D2-1): catalogue prices only for the director, the PMs and procurement.
      items: commercialLines(p, (v) => (canSeeSupplierPrices(ctx.role) ? moneyEur(v, lang) : PRICE_MASK), (n) => qtyT(n, lang)).map((l) =>
        kv(t(l.k), l.k === 'Total quantity' ? totalQuantityT(p.totalQuantity, p.usage.length, lang) : l.translate ? t(l.v) : l.v, l.alert),
      ),
    },

    equivalents: {
      label: t('Equivalent parts'),
      rows: p.equivalentParts.map((e) => ({
        key: e.ref, title: e.ref, sub: dataText(e.name, lang), tagLabel: t(e.statusLabel), tagClass: tag(partStatusTone(e.status)), href: select(e.ref), samePage: true,
      })),
      empty: p.equivalentParts.length ? null : t('No equivalent registered'),
      // Candidate names displayed as the catalogue displays them (French part names in French).
      register: ctx.equivalentCandidates ? { label: t('Register equivalent'), candidates: ctx.equivalentCandidates.map((c) => ({ ref: c.ref, name: dataText(c.name, lang) })) } : null,
    },

    spares: p.spareList.length
      ? {
          label: t('Spare parts list'),
          rows: p.spareList.map((s) => ({
            key: s.ref, title: s.ref, sub: dataText(s.name, lang), aside: `× ${qtyT(s.qtyPerSystem, lang)}`, tagLabel: s.kind, tagClass: tag(wearSpareTone(s.kind)), href: select(s.ref), samePage: true,
          })),
          open: { label: t('Open PU/PR list'), href: bomHref(spareProject, { spares: p.ref }) },
        }
      : null,

    stock: {
      label: t('Stock by location'),
      rows: data.stock.map((s) => {
        const sub = [t(s.locationTypeLabel), s.reserved > 0 ? reservedT(s.reserved, s.reservedForShort, lang) : null, s.belowMin ? belowMinT(s.minQty, lang) : null]
          .filter(Boolean)
          .join(' · ');
        return { key: s.id, title: dataText(s.location, lang), sub, aside: inStockT(s.onHand, lang), href: stockHref(s.id), arrow: true, tagLabel: s.belowMin ? t('Below minimum') : undefined, tagClass: s.belowMin ? tag('accent') : undefined };
      }),
      empty: data.stock.length ? null : t('None in stock'),
      totals: data.stock.length
        ? [kv(t('On hand'), qtyT(stock.onHand, lang)), kv(t('Reserved'), qtyT(stock.reserved, lang)), kv(t('Available'), qtyT(stock.available, lang), stock.available < 0)]
        : [],
    },

    projects: {
      label: t('Projects equipped'),
      rows: p.projects.map((pr) => ({
        key: pr.code, title: dataText(pr.name, lang), sub: `${pr.shortCode} · ${unitsT(pr.quantity, lang)}`, tagLabel: t(pr.stageLabel), tagClass: tag(lifecycleTone(pr.stage)),
        href: bomHref(pr.code, { part: p.ref }), arrow: true,
      })),
      empty: p.projects.length ? null : t('Not used in any project yet'),
    },

    usedIn: data.usedInAssemblies.length ? { label: t('Used in'), chains: data.usedInAssemblies.map((c) => c.join(' › ')) } : null,

    // Machines of the installed base fitted with the part (machines added in Keystone included).
    machines: {
      label: t('Installed base'),
      rows: data.machines.map((m) => ({
        key: m.id, title: dataText(m.name, lang), sub: `${m.id} · ${t(m.generation)} · ${revT(m.revision, lang)}`,
        tagLabel: t(m.stateLabel) + (m.ecoNumber ? ` · ${m.ecoNumber}` : ''), tagClass: tag(machineState(m.state)),
        href: m.ecoNumber ? ecoHref(m.ecoNumber) : fleetHref(), arrow: true,
      })),
      empty: data.machines.length ? null : t('Not fitted on any machine in service.'),
    },

    revisions: {
      label: t('Revisions'),
      current: kv(t('Current revision'), p.revision ?? '—'),
      events: data.revisions.map((e) => ({
        key: `${e.assemblyRef}-${e.fromRevision}-${e.toRevision}`,
        title: `${e.assemblyRef} · ${revStepT(e.fromRevision, e.toRevision, lang)}`,
        sub: [t(displayOfIso(e.date)), e.ecoNumber].filter(Boolean).join(' · '),
        ecoHref: e.ecoNumber ? ecoHref(e.ecoNumber) : null,
        lines: e.lines.map((l, i) => ({
          key: `${i}`, path: l.path, name: dataText(l.name, lang), change: diffChangeText(l), kind: t(revisionDiffKind.label(l.kind)), kindClass: tag(diffKindTone(l.kind)),
        })),
      })),
      empty: data.revisions.length ? null : t('No revision comparison recorded'),
    },

    drawings: {
      label: t('Drawings'),
      rows: data.drawings.map((d) => ({
        key: d.number, title: `${d.number} · ${revT(d.revision, lang)}`, sub: dataText(d.title, lang), aside: d.revisions.length > 1 ? d.revisions.map((r) => r.revision).join(' · ') : undefined,
        tagLabel: t(d.stateLabel), tagClass: `tag ${DRAWING_STATE_TAG[d.state]}`, href: drawingHref(d.number), arrow: true,
      })),
      empty: data.drawings.length ? null : t('No drawing linked to this part'),
    },

    // Vigie owns the ECOs: rows open the ECO screen (progress is recorded there), "Open in Vigie" the record in
    // Vigie; "Raise ECO" opens Vigie's new-ECO form prefilled with the part — nothing is created in Keystone.
    ecos:
      ecosShown.length || canSeeEco
        ? {
            label: t('Engineering changes'),
            rows: ecosShown.map((e) => ({
              key: e.number, title: e.number, sub: dataText(e.title, lang), tagLabel: t(e.statusLabel), tagClass: `tag ${ECO_STATUS_TAG[e.status]}`, href: ecoHref(e.number), arrow: true,
              syncNote: e.pendingSyncLabel ? t(e.pendingSyncLabel) : null, vigieHref: e.vigieUrl, vigieLabel: t('Open in Vigie'),
            })),
            empty: ecosShown.length ? null : t('No engineering change on this part'),
            raise: canSeeEco
              ? { label: t('Raise ECO'), title: t('Opens Vigie’s new ECO form, prefilled with this part'), href: vigieNewEcoUrl({ partRef: p.ref, projectCode: ctx.projectCode }) }
              : null,
          }
        : null,
    qualification: partQualificationView(p, ctx.role, t, yearOfIso(data.today)),
  };
}
