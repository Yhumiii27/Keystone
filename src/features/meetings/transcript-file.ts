import 'server-only';
// Access to the uploaded transcript file of a meeting (chapter 4, S-10 "stored by Keystone") for the download Route Handler
// (src/app/api/meetings/[number]/transcript/route.ts). Whoever may open the project's Meetings screen may download it (internal
// roles read every project's meetings, P-1) — except the client: P-10b (R-043) hides every transcript from the client, of their
// own project too (403 before any project is read). A pasted transcript has no file (404).
import { getTranscriptFileRef } from '@/server/dal/meetings-transcripts';
import { getProject } from '@/server/dal/projects';
import { getViewer } from '@/server/session';

const MEETING_RE = /^MTG-\d{1,6}$/;

export type TranscriptFileGate =
  | { ok: true; fileId: string; projectCode: string }
  /** `error`: EN source message. */
  | { ok: false; status: 403 | 404; error: string };

export async function transcriptFileGate(meeting: unknown): Promise<TranscriptFileGate> {
  const number = typeof meeting === 'string' ? decodeURIComponent(meeting).toUpperCase() : '';
  if (!MEETING_RE.test(number)) return { ok: false, status: 404, error: 'Unknown meeting' };
  if ((await getViewer()).role === 'client') return { ok: false, status: 403, error: 'You cannot open this file' };
  const ref = await getTranscriptFileRef(number);
  if (!ref || !(await getProject(ref.projectCode))) return { ok: false, status: 404, error: 'File not found' };
  return { ok: true, fileId: ref.fileId, projectCode: ref.projectCode };
}
