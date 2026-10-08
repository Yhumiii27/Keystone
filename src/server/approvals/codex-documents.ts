import 'server-only';
// Kind "Codex document" (prototype data, TODO(db): the Codex index is not modelled yet): documents in "Release
// proposed" whose next circuit step names the viewer (00 §7.8; DOC_TYPE circuit, DOC_WHO approver per step), all
// projects. Not in the prototype inbox; approved in Codex from the document drawer only (no inline decision).
import { codexDocItems, type ProtoDoc } from '@/domain/approvals';
import { DEFAULT_PROJECT } from '@/config/screens';
import { PROTO } from '@/server/prototype';
import type { ApprovalProvider } from './types';

export const codexDocumentProvider: ApprovalProvider = {
  kind: 'doc',
  scope: 'global',
  source: 'prototype',
  async items({ viewer, project }) {
    return codexDocItems(PROTO.DOCS as ProtoDoc[], PROTO.DOC_TYPE, PROTO.DOC_WHO, viewer.short, project?.code ?? DEFAULT_PROJECT);
  },
  async decided() {
    return 0;
  },
};
