import 'server-only';
// Access to the uploaded transcript file of a meeting (chapter 4, S-10 "stored by Keystone") for the download Route Handler
// (src/app/api/meetings/[number]/transcript/route.ts). Whoever may open the project's Meetings screen may download it — the
// same project context as the screen (getProjectContext(…, 'meetings')) — except a client contact on another organisation's
// project. A pasted transcript has no file (404).
import { getTranscriptFileRef } from '@/server/dal/meetings-transcripts';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';

const MEETING_RE = /^MTG-\d{1,6}$/;

export type TranscriptFileGate =
  | { ok: true; fileId: string; projectCode: string }
  /** `error`: EN source message. */
  | { ok: false; status: 403 | 404; error: string };

export async function transcriptFileGate(meeting: unknown): Promise<TranscriptFileGate> {
  const number = typeof meeting === 'string' ? decodeURIComponent(meeting).toUpperCase() : '';
  if (!MEETING_RE.test(number)) return { ok: false, status: 404, error: 'Unknown meeting' };
  const ref = await getTranscriptFileRef(number);
  // Checked before getProjectContext, whose unknown project is a notFound() (not usable in a Route Handler).
  if (!ref || !(await getProject(ref.projectCode))) return { ok: false, status: 404, error: 'File not found' };
  const ctx = await getProjectContext(ref.projectCode, 'meetings');
  if (ctx.viewer.role === 'client' && !ctx.isMine) return { ok: false, status: 403, error: 'You cannot open this file' };
  return { ok: true, fileId: ref.fileId, projectCode: ref.projectCode };
}
