// Document / photo preview (docs/spec/02 C-31, RT-IMAGESLOT). Read-only stand-in for the prototype's
// <image-slot>: shows the image when a source exists, otherwise the placeholder caption. Upload/storage
// comes with the document store (Q-18). Server-compatible.
import { ImageSquare } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './DocumentPreview.module.css';

export interface DocumentPreviewProps {
  /** Image URL (PDM export, receipt photo, issued PDF preview). */
  src?: string | null;
  /** Alternative text (translated). */
  alt?: string;
  /** Aspect ratio: '4/3' drawings, '16/9' receipt photos, '16/7' deliverables, '16/8' P&ID. */
  ratio?: '4/3' | '16/9' | '16/7' | '16/8';
  /** `contain` (documents) or `cover` (photos). */
  fit?: 'contain' | 'cover';
  /** Empty-state caption (translated), e.g. "Drop the PDM preview (PDF / PNG export)". */
  placeholder: ReactNode;
  className?: string;
}

export function DocumentPreview({ src, alt = '', ratio = '4/3', fit = 'contain', placeholder, className }: DocumentPreviewProps) {
  const vars = { '--dp-ratio': ratio.replace('/', ' / '), '--dp-fit': fit } as CSSProperties;
  return (
    <div className={cx(s.wrap, !src && s.empty, className)} style={vars}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- previews come from the document store, sizes unknown
        <img src={src} alt={alt} className={s.img} />
      ) : (
        <>
          <ImageSquare className={s.emptyIcon} aria-hidden />
          <span>{placeholder}</span>
        </>
      )}
    </div>
  );
}
