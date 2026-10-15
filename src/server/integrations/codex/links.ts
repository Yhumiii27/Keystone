// Links from Keystone to Codex (Delivery 8, R-033; I-3a, D-1a, A-15). Pure and client-safe: every Codex URL of Keystone is
// built here, like the Cursus and Vigie links. Codex owns the documents and their files; Keystone opens them in Codex in a
// new tab (render the links with CODEX_LINK_ATTRS: the Mac app hands target=_blank links to the browser).
//
// TODO(codex) — OPEN QUESTION D-1: Codex publishes no deep links yet. Until it does, every link opens Codex's home with
// query parameters Codex ignores today (`project`, `document`, `revision`, `documents`, `view`): a proposal to agree with
// Codex. Once the index read (R-033, mirror.ts `applyCodexIndex`) fills `documents.codex_url`, Codex's own link of a record
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
 * read brought one, else Codex's home with the number and revision (TODO(codex) D-1: ignored by Codex today).
 */
export function codexDocumentUrl(number: string, revision?: string | null, codexUrl?: string | null): string {
  return safeCodexUrl(codexUrl) ?? `${codexPublicUrl()}/${qs({ document: number, revision })}`;
}

/** Codex's document types register ("Edit in Codex"; TODO(codex) D-1: `view` is ignored today). */
export function codexTypeRegisterUrl(): string {
  return `${codexPublicUrl()}/${qs({ view: 'document-types' })}`;
}

/** The records of a selection ("Download zip" hand-off: the files are in Codex; TODO(codex) D-1: ignored today). */
export function codexSelectionUrl(numbers: readonly string[]): string {
  return `${codexPublicUrl()}/${qs({ documents: [...new Set(numbers)].join(',') })}`;
}
