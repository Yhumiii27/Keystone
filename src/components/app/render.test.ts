// Static render smoke test of the DS / app components (server-compatible ones + client ones that render
// without a DOM). Overlays (Dialog, Drawer, CenteredModal) render nothing on the server by design.
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/x', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams('q=crane') }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Check, Eye, Warning } from '@phosphor-icons/react/dist/ssr';
import { I18nProvider } from '@/i18n/client';
import { Button, ButtonLink, Dialog, Field, IconButton, Input, Popover, Segmented, Select, Table, Tag, Td, Th, Tr, ToastViewport, MenuItem } from '@/components/ds';
import {
  Avatar,
  BulletBar,
  Callout,
  CountBadge,
  DataTable,
  EmptyState,
  FilterChips,
  FlowStepper,
  FormDialog,
  HealthTag,
  KeyValueList,
  KpiGrid,
  KpiTile,
  LO,
  LifecycleTag,
  ListRow,
  NumberedStepper,
  ProgressBar,
  SearchField,
  SectionCard,
  StatusTag,
  WizardSteps,
  statusTagButtonClass,
} from '@/components/app';
import { Sparkline } from '@/components/charts/primitives';

const html = (el: ReactElement, lang: 'fr' | 'en' = 'fr') => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));

describe('DS primitives render', () => {
  it('buttons carry the Nocturne classes and icons', () => {
    const out = html(h('div', null, h(Button, { variant: 'primary', icon: Check }, 'Approve'), h(ButtonLink, { href: '/a', variant: 'ghost' }, 'Open'), h(IconButton, { icon: Eye, label: 'Close', muted: true })));
    expect(out).toContain('class="btn btn-primary');
    expect(out).toContain('<svg');
    expect(out).toContain('href="/a"');
    expect(out).toMatch(/class="btn btn-icon btn-ghost[^"]*"/);
    expect(out).toContain('aria-label="Close"');
  });

  it('tag, field, select, table', () => {
    const out = html(
      h(
        'div',
        null,
        h(Tag, { tone: 'outline', icon: Eye, children: 'Consultation' }),
        h(Field, { label: 'Title', required: true, htmlFor: 't', children: h(Input, { id: 't', type: 'number' }) }),
        h(Select, { options: ['A', { value: 'b', label: 'B' }] }),
        h(Table, null, h('thead', null, h('tr', null, h(Th, { align: 'right' }, 'EAC'))), h('tbody', null, h(Tr, { selected: true }, h(Td, { numeric: true, color: LO }, '€5.11M')))),
      ),
    );
    expect(out).toContain('class="tag tag-outline');
    expect(out).toContain('class="field');
    expect(out).toContain('type="number"');
    expect(out).toContain('<option value="b">B</option>');
    expect(out).toContain('class="table');
    expect(out).toContain('color:var(--color-accent-300)');
  });

  it('segmented renders buttons or links with the selected state', () => {
    const out = html(h(Segmented, { value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 3 }, { value: 'c', label: 'C', href: '/x?view=c' }] }));
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('href="/x?view=c"');
    expect(out).toContain('>3<');
  });

  it('popover trigger, overlays closed on the server, toast viewport empty', () => {
    const out = html(
      h(
        'div',
        null,
        h(Popover, { trigger: 'Fabrication & Assemblage', triggerClassName: statusTagButtonClass('accent'), defaultOpen: true, children: h(MenuItem, { meta: 'gate', children: 'FAT' }) }),
        h(Dialog, { open: true, title: 'Never on the server' }),
        h(ToastViewport, null),
      ),
    );
    expect(out).toContain('class="tag tag-accent');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('FAT');
    expect(out).not.toContain('Never on the server');
    expect(out).toContain('role="status"');
  });
});

describe('app components render', () => {
  it('KPI tiles and section card', () => {
    const out = html(
      h(KpiGrid, { min: 160 }, h(KpiTile, { label: 'CPI', value: '0.94', sub: 'sub', tone: 'alert', size: 'lg', icon: Warning })),
    );
    expect(out).toContain('--kpi-min:160px');
    expect(out).toContain('class="card elev-sm');
    expect(out).toContain('--kpi-color:var(--color-accent-300)');
    const card = html(h(SectionCard, { title: 'Active projects', hint: '6 projects · FY2026', scroll: true }, 'body'));
    expect(card).toContain('class="card-title');
    expect(card).toContain('6 projects · FY2026');
  });

  it('status tags follow the tone tables', () => {
    const out = html(h('div', null, h(HealthTag, { health: 'off_track', label: 'Hors trajectoire' }), h(HealthTag, { health: null }), h(LifecycleTag, { status: 'APS' }), h(StatusTag, { tone: 'neutral', size: 'xs' }, 'New')));
    expect(out).toContain('class="tag tag-accent');
    expect(out).toContain('class="text-muted');
    expect(out).toContain('class="tag tag-outline');
    expect(out).toContain('—');
  });

  it('data table, filter chips, list row, key-value list', () => {
    const rows = [{ id: 'R-07', title: 'Crane slot' }];
    const out = html(
      h(
        'div',
        null,
        h(DataTable<{ id: string; title: string }>, { columns: [{ key: 'id', header: 'ID', render: (r) => r.id }], rows, rowKey: (r) => r.id, rowHref: (r) => `?risk=${r.id}`, selectedKey: 'R-07' }),
        h(DataTable<{ id: string }>, { columns: [{ key: 'id', header: 'ID', render: (r) => r.id }], rows: [], rowKey: (r) => r.id, empty: 'Aucun risque' }),
        h(FilterChips, { value: 'all', options: [{ value: 'all', label: 'Tous', count: 12 }, { value: 'x', label: 'X', href: '/x' }] }),
        h(ListRow, { title: 'T', sub: 'S', right: h(Tag, { tone: 'accent', children: 'Late' }), href: '/t' }),
        h(KeyValueList, { title: 'Général', items: [{ k: 'Budget', v: '€420k', color: LO }] }),
      ),
    );
    expect(out).toContain('R-07');
    expect(out).toContain('aria-selected="true"');
    expect(out).toContain('Aucun risque');
    expect(out).toContain('>12<');
    expect(out).toContain('href="/t"');
    expect(out).toContain('Général');
  });

  it('steppers, progress, badges, callouts, empty states, sparkline, search', () => {
    const out = html(
      h(
        'div',
        null,
        h(FlowStepper, { steps: [{ label: 'Draft', reached: true }, { label: 'Ordered', reached: false }], meta: 'Raised by X' }),
        h(NumberedStepper, { steps: ['Source', 'Mapping'], current: 1 }),
        h(WizardSteps, { steps: ['Basics', 'Structure'], current: 1 }),
        h(ProgressBar, { variant: 'inline', value: 0.644, label: '64.4%' }),
        h(BulletBar, { actual: 310, committed: 90, budget: 420, forecast: 470 }),
        h(CountBadge, { variant: 'bell', children: '3' }),
        h(Avatar, { name: 'Marie Lefebvre', size: 30, tone: 'accent' }),
        h(Callout, { icon: Warning, variant: 'emphasis', children: 'Critical path' }),
        h(EmptyState, { variant: 'boxed', children: 'Rien' }),
        h(Sparkline, { values: [1, 3, 2] }),
        h(SearchField, { placeholder: 'Rechercher', param: 'q' }),
      ),
    );
    expect(out).toContain('Raised by X');
    expect(out).toContain('aria-current="step"');
    expect(out).toContain('--pb-w:64.4%');
    expect(out).toContain('ML');
    expect(out).toContain('d="M0.0 30.0 L60.0 2.0 L120.0 16.0"');
    expect(out).toContain('value="crane"');
  });

  it('FormDialog renders nothing until mounted on the client', () => {
    const out = html(h(FormDialog, { open: true, onClose: () => {}, onSubmit: () => {}, title: 'New risk', submit: 'Register risk', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] }));
    expect(out).toBe('');
  });
});
