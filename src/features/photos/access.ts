import 'server-only';
// Who may add, remove and see the photos of a record (R-126, X-15: "adding is reserved to those who can edit the screen").
// Edit: the screen that governs the record (Deliveries, Site or Inspections & punch list) is editable for the viewer on
// that project (not outside their workspace, not a read-only project). View: every viewer of the project (D9-06: no client
// viewer any more). R-117: a punch item is found by its number in the project and its ORIGIN is the stored one — a `register`
// sent by the request is ignored.
import { photoScreenOf, type PhotoOwnerKey } from '@/domain/photos';
import { getDb } from '@/server/db/client';
import { resolvePhotoOwner } from '@/server/dal/photos';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import type { Viewer } from '@/server/session';

export type PhotoGate =
  | { ok: true; owner: PhotoOwnerKey; viewer: Viewer }
  /** `error`: English source message. */
  | { ok: false; status: 403 | 404; error: string };

export async function photoGate(o: PhotoOwnerKey, need: 'view' | 'edit'): Promise<PhotoGate> {
  const project = await getProject(o.code);
  if (!project) return { ok: false, status: 404, error: 'Unknown project' };
  const resolved = await resolvePhotoOwner(await getDb(), { ...o, code: project.code });
  if (!resolved) return { ok: false, status: 404, error: 'File not found' };
  const owner: PhotoOwnerKey = { ...o, code: project.code, register: o.kind === 'punch_item' ? (resolved.register ?? null) : null };
  const screen = photoScreenOf(owner);
  const ctx = await getProjectContext(project.code, screen);
  if (need === 'edit' && !ctx.canEdit(screen)) return { ok: false, status: 403, error: 'Photos are read-only for you' };
  return { ok: true, owner, viewer: ctx.viewer };
}
