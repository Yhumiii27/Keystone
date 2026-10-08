import 'server-only';
// Kind "Codex document": records of the Codex index (database, Delivery 3) in "Release proposed" whose next pending
// circuit step names the viewer (00 §7.8; DOC_TYPE circuit, DOC_WHO approver per step), all projects. Not in the
// prototype inbox; approved from the document drawer of Documents · Codex only (no inline decision).
import { codexVaultItems } from '@/domain/approvals';
import { DEFAULT_PROJECT } from '@/config/screens';
import { listVaultDocuments } from '@/server/dal/documents';
import type { ApprovalProvider } from './types';

export const codexDocumentProvider: ApprovalProvider = {
  kind: 'doc',
  scope: 'global',
  source: 'db',
  async items({ viewer, project }) {
    return codexVaultItems(await listVaultDocuments(), viewer.short, project?.code ?? DEFAULT_PROJECT);
  },
  async decided() {
    return 0;
  },
};
