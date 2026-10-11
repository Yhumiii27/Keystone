import 'server-only';
// Who may add, remove and see the photos of a record (R-126, X-15: "adding is reserved to those who can edit the screen").
// Edit: the screen that governs the record (Deliveries, Site or Inspections & punch list) is editable for the viewer on
// that project (not outside their workspace, not a read-only project) and the viewer is not the client (the photos are
// the team's records). View: internal viewers; the client only for the ITP punch list of their own organisation's project
// (P-10a/P-10b).
import { clientSeesPhotos, photoScreenOf, type PhotoOwnerKey } from '@/domain/photos';
import { getDb } from '@/server/db/client';
import { resolvePhotoOwner } from '@/server/dal/photos';
import { getProject } from '@/server/dal/projects';
import { clientRefusedProject, clientRefusedScreen } from '@/domain/rights';
import { getProjectContext } from '@/server/project-context';
import { getViewer, type Viewer } from '@/server/session';

export type PhotoGate =
  | { ok: true; owner: PhotoOwnerKey; viewer: Viewer }
  /** `error`: English source message. */
  | { ok: false; status: 403 | 404; error: string };

export async function photoGate(o: PhotoOwnerKey, need: 'view' | 'edit'): Promise<PhotoGate> {
  const project = await getProject(o.code);
  if (!project) return { ok: false, status: 404, error: 'Unknown project' };
  const owner = { ...o, code: project.code };
  if (!(await resolvePhotoOwner(await getDb(), owner))) return { ok: false, status: 404, error: 'File not found' };
  const screen = photoScreenOf(owner);
  // The client is answered here (403) rather than sent home by getProjectContext (R-042): a Route Handler answers JSON or
  // a file, not a redirect.
  const viewer = await getViewer();
  if (viewer.role === 'client') {
    if (need === 'edit') return { ok: false, status: 403, error: 'Photos are read-only for you' };
    if (!clientSeesPhotos(owner) || clientRefusedScreen(viewer.role, screen) || clientRefusedProject(viewer, project)) return { ok: false, status: 403, error: 'You cannot open this file' };
    return { ok: true, owner, viewer };
  }
  const ctx = await getProjectContext(project.code, screen);
  if (need === 'edit' && !ctx.canEdit(screen)) return { ok: false, status: 403, error: 'Photos are read-only for you' };
  return { ok: true, owner, viewer: ctx.viewer };
}
