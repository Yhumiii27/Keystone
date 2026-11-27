// Links from Keystone to Codex (Delivery 8, R-033; I-3a, D-1a, A-15). Pure and client-safe: every Codex URL of Keystone is
// built here, like the Cursus and Vigie links. Codex owns the documents and their files; Keystone opens them in Codex in a
// new tab (render the links with CODEX_LINK_ATTRS: the Mac app hands target=_blank links to the browser).
//
// A document opens on Codex's deep link `/documents/{id}` (Codex's contract CX-08). TODO(codex) — D-1: the other links (home with
// `project`, `documents`, `view`) still carry query parameters Codex ignores today: a proposal to agree with Codex. Once the index read (R-033, mirror.ts `applyCodexIndex`) fills `documents.codex_url`, Codex's own link of a record
// wins over the guess. In production without NEXT_PUBLIC_CODEX_URL the links point at Codex's local address (start-up
// warning, as for Cursus and Vigie).
import { codexPublicUrl } from './config';

/** Anchor attributes of every link to Codex (opens outside Keystone). */
export const CODEX_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && String(v).trim()) p.set(k, String(v).trim());
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** A link Codex gave for a record, kept only when it is an absolute http(s) URL (never `javascript:` and the like). */
export function safeCodexUrl(u: string | null | undefined): string | null {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Codex's home ("Open Codex"), with the project the vault shows (TODO(codex) D-1: `project` is ignored today). */
export function codexHomeUrl(project?: string | null): string {
  return `${codexPublicUrl()}/${qs({ project: project && project !== 'QMS' ? project : null })}`;
}

/**
 * A document record in Codex ("Open in Codex", My approvals, the drawer's history link): Codex's own link when the index
 * read brought one, else Codex's deep link `/documents/{id}` (Codex's contract CX-08, docs/api.md « Lien profond »: it opens
 * the record under its current identifier or any former one). The contract has no revision parameter: `revision` is kept in
 * the signature for the callers but not sent — Codex shows the record with its revisions.
 */
export function codexDocumentUrl(number: string, _revision?: string | null, codexUrl?: string | null): string {
  return safeCodexUrl(codexUrl) ?? `${codexPublicUrl()}/documents/${encodeURIComponent(number.trim())}`;
}

/** Codex's document types register ("Edit in Codex"; TODO(codex) D-1: `view` is ignored today). */
export function codexTypeRegisterUrl(): string {
  return `${codexPublicUrl()}/${qs({ view: 'document-types' })}`;
}

/** The records of a selection ("Download zip" hand-off: the files are in Codex; TODO(codex) D-1: ignored today). */
export function codexSelectionUrl(numbers: readonly string[]): string {
  return `${codexPublicUrl()}/${qs({ documents: [...new Set(numbers)].join(',') })}`;
}
