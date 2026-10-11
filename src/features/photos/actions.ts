'use server';
// "Remove photo" (R-126): the viewer must be able to edit the screen that governs the photo's record (the same rule as
// adding, src/features/photos/access.ts); the stored file (and a receipt's attachment row) is deleted, audited, then the
// project's pages are revalidated. Adding goes through POST /api/photos (files above the Server Functions' 1 MB limit).
import { revalidatePath } from 'next/cache';
import { photoOwnerOf, removePhoto } from '@/server/dal/photos';
import { getI18n } from '@/server/session';
import { photoGate } from './access';

export type PhotoResult = { ok: true } | { ok: false; error: string };

export async function removePhotoAction(fileId: string): Promise<PhotoResult> {
  const { t } = await getI18n();
  const fail = (english: string): PhotoResult => ({ ok: false, error: t(english) });
  if (typeof fileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(fileId)) return fail('Invalid request');
  const owner = await photoOwnerOf(fileId);
  if (!owner) return fail('File not found');
  const g = await photoGate(owner, 'edit');
  if (!g.ok) return fail(g.error);
  try {
    await removePhoto(fileId, g.viewer.name);
  } catch (e) {
    console.error('removePhotoAction', e);
    return fail('The change could not be saved');
  }
  revalidatePath(`/projects/${g.owner.code}`, 'layout');
  return { ok: true };
}
