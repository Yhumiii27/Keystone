// R-011: the Home of a database without project (new production database) — no invented figure, translated texts.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { renderTxt } from './home';
import { NO_PROJECT_SUB, NO_PROJECT_TITLE, noProjectHome } from './home-empty';

describe('noProjectHome', () => {
  it('greets the viewer, shows no KPI, explains why the queues are empty', () => {
    const v = noProjectHome({ name: 'Marie Lefebvre', title: 'Portfolio director' });
    expect(v.kpis).toEqual([]);
    expect(v.greeting).toBe('Good morning, Marie');
    expect(v.left).toEqual({ title: 'My projects', rows: [{ title: NO_PROJECT_TITLE, sub: NO_PROJECT_SUB, tag: '', tagClass: '', href: '' }] });
    expect(v.right).toEqual({ title: 'Waiting for me', rows: [] });
  });

  it('is translated (FR default)', () => {
    const t = makeT('fr');
    const v = noProjectHome({ name: 'Marie Lefebvre', title: 'Portfolio director' });
    expect([renderTxt(v.greeting, t), renderTxt(v.left.title, t), renderTxt(v.left.rows[0].title, t), renderTxt(v.left.rows[0].sub, t), renderTxt(v.right.title, t)]).toEqual([
      'Bonjour, Marie', 'Mes projets', 'Aucun projet pour l’instant', 'Les projets apparaissent ici dès leur création', 'En attente de ma part',
    ]);
  });
});
