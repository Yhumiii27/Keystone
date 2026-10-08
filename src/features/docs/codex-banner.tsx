// Codex banner (docs/spec/10 §4.4a template 2312, §5.3 template 2377): `card elev-sm` row with an accent-800 border —
// the 34px "Cx" tile, title and explanation, then the screen's own trailing content (sync line and buttons).
// Server-compatible; the buttons are client islands passed as children.
import type { ReactNode } from 'react';
import { SectionCard } from '@/components/app/SectionCard';
import s from './docs.module.css';

/** 34×34 "Cx" tile (banner, deposit dialog header). */
export function CxTile() {
  return (
    <span className={s.cx} aria-hidden>
      Cx
    </span>
  );
}

export function CodexBanner({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <SectionCard variant="highlight">
      <CxTile />
      <div className={s.bannerText}>
        <span className={s.bannerTitle}>{title}</span>
        <span className={s.bannerSub}>{text}</span>
      </div>
      {children}
    </SectionCard>
  );
}
