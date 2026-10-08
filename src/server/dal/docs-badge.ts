import 'server-only';
// Sidebar badge of "Documents · Codex" (docs/spec/10 §0.2, logic 5150): number of vault records awaiting approval
// (status "Release proposed"), all projects, shown only when > 0. Seed → "1" (RPT-HLT-014). The shell calls it once.
import { docsBadgeText } from '@/domain/documents';
import { countDocumentsAwaitingApproval } from './documents';

/** Badge text of the Documents entry: "1", or '' when no record awaits approval. */
export async function docsBadge(): Promise<string> {
  return docsBadgeText(await countDocumentsAwaitingApproval());
}
