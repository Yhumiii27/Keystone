import 'server-only';
// Kind "Codex document": records of the Codex index (database, Delivery 3) in "Release proposed" whose circuit step
// open in Keystone names the viewer (00 §7.8; DOC_TYPE circuit, DOC_WHO approver per step), all projects. Not in the
// prototype inbox. Delivery 7 (P-7b = a, D-1b = a, R-124): decided inline — Approve, or Reject with the reason — and
// sent to Codex through the outbox ("pending sync with Codex"); "Open in Codex" opens the record in Codex (Delivery 8,
// R-033: Codex's own link once the index read brought it, else Codex's home with the number — TODO(codex) D-1).
import { codexVaultItems } from '@/domain/approvals';
import { DEFAULT_PROJECT } from '@/config/screens';
import { getDb } from '@/server/db/client';
import { listVaultDocuments } from '@/server/dal/documents';
import { codexDocumentUrl } from '@/server/integrations/codex/links';
import { codexDecisionsBy } from '@/server/integrations/codex/outbox';
import type { ApprovalProvider } from './types';

export const codexDocumentProvider: ApprovalProvider = {
  kind: 'doc',
  scope: 'global',
  source: 'db',
  async items({ viewer, project }) {
    const docs = await listVaultDocuments();
    const byNumber = new Map(docs.map((d) => [d.number, d]));
    return codexVaultItems(docs, viewer.short, project?.code ?? DEFAULT_PROJECT, (d) => codexDocumentUrl(d.number, d.revision, byNumber.get(d.number)?.codexUrl));
  },
  // Circuit decisions the viewer recorded in Keystone (pending sync with Codex or delivered).
  async decided({ viewer }) {
    return codexDecisionsBy(await getDb(), viewer.name);
  },
};
