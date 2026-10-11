// Photos of a record as the galleries show them (R-126): the stored file id, its name and "1.2 MB · Julien Wagner". Pure.
import type { PhotoRow } from '@/server/dal/photos';
import type { PhotoView } from './photo-gallery';

export const photoViews = (rows: readonly PhotoRow[] | undefined): PhotoView[] => (rows ?? []).map((r) => ({ id: r.id, name: r.name, meta: `${r.sizeText} · ${r.uploadedBy}` }));
