// R-010 — the "Record modified meanwhile" notice: the refusal as the server wrote it, with a "Reload" action (French by default).
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { StaleRecordCallout, isConflict } from './StaleRecord';

describe('StaleRecordCallout', () => {
  it('shows the refusal and a Reload button', () => {
    const msg = 'Fiche modifiée entre-temps par Romain Aubert le 29 oct. 2026 à 14:05 — rechargez pour voir ses changements';
    const out = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(StaleRecordCallout, { message: msg }) }));
    expect(out).toContain(msg);
    expect(out).toContain('role="alert"');
    expect(out).toMatch(/<button[^>]*>.*Recharger<\/button>/);
  });

  it('isConflict: only a { error, conflict: true } answer', () => {
    expect(isConflict({ error: 'x', conflict: true })).toBe(true);
    for (const r of [{ error: 'x' }, { ok: true }, { conflict: true }, 'x', null, undefined]) expect(isConflict(r)).toBe(false);
  });
});
