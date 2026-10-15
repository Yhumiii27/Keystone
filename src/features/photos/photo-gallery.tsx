'use client';
// Photos of a record stored by Keystone (R-126): a grid of thumbnails (each opens the full image in a new tab), download,
// "Add photos" (several files; images up to 20 MB, checked here first and again by POST /api/photos) and "Remove" after a
// confirmation, for viewers who may edit the record's screen. `PhotosButton` opens the same gallery in a dialog (table rows:
// daily reports, punch items). Labels come from the I18n provider.
import { Camera, DownloadSimple, ImageSquare, Trash, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Button, IconButton } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { useToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { MAX_FILE_BYTES, MAX_FILE_TEXT, acceptOf } from '@/domain/ch4-defaults';
import { MAX_PHOTOS_PER_OWNER, type PhotoOwnerKey } from '@/domain/photos';
import { useI18n } from '@/i18n/client';
import { removePhotoAction } from './actions';
import s from './photos.module.css';

export interface PhotoView {
  id: string;
  name: string;
  /** "1.2 MB · Julien Wagner". */
  meta: string;
}

export interface PhotoGalleryProps {
  owner: PhotoOwnerKey;
  photos: PhotoView[];
  canEdit: boolean;
  /** Empty-state caption (translated), e.g. "Drop receipt photos". */
  empty: string;
  /** Photos counted without a stored file (a receipt's photos taken on mobile before Keystone stored them). */
  legacyCount?: number;
}

const src = (id: string) => `/api/photos/${encodeURIComponent(id)}`;

const ACCEPT = acceptOf('photo');

export function PhotoGallery({ owner, photos, canEdit, empty, legacyCount = 0 }: PhotoGalleryProps) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<PhotoView | null>(null);
  const [pending, start] = useTransition();
  const full = photos.length >= MAX_PHOTOS_PER_OWNER;

  const upload = async (files: File[]) => {
    const room = MAX_PHOTOS_PER_OWNER - photos.length;
    if (files.length > room) toast.show(`${t('Too many photos')} · max ${MAX_PHOTOS_PER_OWNER}`);
    setUploading(true);
    let added = 0;
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        if (file.size > MAX_FILE_BYTES) {
          toast.show(`${file.name} · ${t(`The file is larger than ${MAX_FILE_TEXT}`)}`);
          continue;
        }
        const body = new FormData();
        body.set('kind', owner.kind);
        body.set('code', owner.code);
        body.set('ref', owner.ref);
        if (owner.register) body.set('register', owner.register);
        body.set('file', file);
        const res = await fetch('/api/photos', { method: 'POST', body });
        const r = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
        if (!r?.ok) toast.show(`${file.name} · ${r?.error ?? t('The file could not be saved')}`);
        else added++;
      }
      if (added) {
        toast.show(`${owner.ref} · ${added} ${t(added === 1 ? 'photo added' : 'photos added')}`);
        router.refresh();
      }
    } catch {
      toast.showEn('The file could not be saved');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = () => {
    if (!removing) return;
    start(async () => {
      try {
        const r = await removePhotoAction(removing.id);
        if (!r.ok) toast.show(r.error);
        else {
          toast.show(`${removing.name} · ${t('Removed')}`);
          setRemoving(null);
          router.refresh();
        }
      } catch {
        toast.showEn('The change could not be saved');
      }
    });
  };

  return (
    <div className={s.gallery}>
      {photos.length > 0 ? (
        <ul className={s.grid} aria-label={t('Photos')}>
          {photos.map((p) => (
            <li key={p.id} className={s.item}>
              <a href={src(p.id)} target="_blank" rel="noopener noreferrer" className={s.thumbLink} title={`${p.name} · ${p.meta}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- photos stored by Keystone, served by /api/photos with the viewer's rights */}
                <img src={src(p.id)} alt={p.name} loading="lazy" className={s.thumb} />
              </a>
              <span className={s.actions}>
                <a href={`${src(p.id)}?download=1`} download className={cx('btn', 'btn-icon', 'btn-ghost', s.iconBtn)} aria-label={`${t('Download')} ${p.name}`} title={t('Download')}>
                  <DownloadSimple aria-hidden />
                </a>
                {canEdit && <IconButton icon={Trash} size={24} muted label={`${t('Remove')} ${p.name}`} title={t('Remove')} onClick={() => setRemoving(p)} />}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.empty}>
          <ImageSquare className={s.emptyIcon} aria-hidden />
          <span>{empty}</span>
        </div>
      )}
      {legacyCount > 0 && <span className={s.note}>{`${legacyCount} ${t(legacyCount === 1 ? 'photo recorded without a stored file' : 'photos recorded without a stored file')}`}</span>}
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            aria-label={t('Add photos')}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) void upload(files);
            }}
          />
          <Button
            variant="ghost"
            size="compact"
            icon={UploadSimple}
            disabled={uploading || full}
            aria-busy={uploading || undefined}
            title={full ? `${t('Too many photos')} · max ${MAX_PHOTOS_PER_OWNER}` : undefined}
            onClick={() => input.current?.click()}
          >
            {uploading ? t('Uploading…') : t('Add photos')}
          </Button>
          <Dialog open={!!removing} onClose={() => setRemoving(null)} title={t('Remove photo')} subtitle={removing?.name} width={440} placement="center" maxHeight={null}>
            <p className={s.dialogText}>{t('The photo is deleted from Keystone.')}</p>
            <DialogActions variant="flush">
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t('Cancel')}
              </Button>
              <Button variant="primary" icon={Trash} disabled={pending} aria-busy={pending || undefined} onClick={remove}>
                {t('Remove')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </div>
  );
}

/** "Photos · 2" on a table row (camera icon) opening the record's gallery in a dialog. */
export function PhotosButton({ title, ...gallery }: PhotoGalleryProps & { /** Dialog title: "DR-003 · Photos". */ title: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const n = gallery.photos.length;
  if (!n && !gallery.canEdit) return null;
  return (
    <>
      <Button variant="ghost" size="mini" icon={Camera} nowrap aria-label={`${t('Photos')} · ${gallery.owner.ref}`} onClick={() => setOpen(true)}>
        {n ? String(n) : t('Add')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} width={640} placement="center" maxHeight="84vh">
        <PhotoGallery {...gallery} />
      </Dialog>
    </>
  );
}
