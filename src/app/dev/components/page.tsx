// Dev gallery of the design-system and shared app components (visual checks only; 404 in production
// unless KS_DEV_GALLERY=1 is set, e.g. for integration checks against `next start`).
import { notFound } from 'next/navigation';
import { getI18n } from '@/server/session';
import { GalleryBody } from './gallery-body';

export const metadata = { title: 'Components — Keystone PM (dev)' };

export default async function ComponentsGallery({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.KS_DEV_GALLERY !== '1') notFound();
  const { t } = await getI18n();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  return <GalleryBody t={t} view={one('view') ?? 'health'} cat={one('cat') ?? 'all'} sel={one('sel') ?? null} />;
}
