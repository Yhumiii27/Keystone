// Home body (docs/spec/03 §1.1, template 163–195): greeting · 4 KPI tiles · two work-queue cards.
// Server Component: every string of the HomeView is English source text rendered through t().
import { CardGrid, EmptyState, KpiGrid, KpiTile, LO, ListRow, OK, SectionCard, Stack } from '@/components/app';
import { cx } from '@/components/ds/cx';
import { renderTxt, type HomeList, type HomeView, type Txt } from '@/domain/home';
import type { T } from '@/i18n/translate';
import styles from './home.module.css';

function QueueCard({ list, tx }: { list: HomeList; tx: (x: Txt) => string }) {
  return (
    <SectionCard title={tx(list.title)} titleGap={4} gap={4}>
      {list.rows.map((r, i) => (
        <ListRow
          key={i}
          // Two tracks even without a tag: the prototype keeps the 12px column gap (alert rows wrap at the same width).
          columns="minmax(0,1fr) auto"
          title={tx(r.title)}
          sub={tx(r.sub)}
          right={r.tag !== '' ? <span className={cx(r.tagClass, styles.tag)}>{tx(r.tag)}</span> : undefined}
          href={r.href}
        />
      ))}
      {!list.rows.length && <EmptyState>{tx('Nothing waiting')}</EmptyState>}
    </SectionCard>
  );
}

export function HomeScreen({ view, t }: { view: HomeView; t: T }) {
  const tx = (x: Txt) => renderTxt(x, t);
  return (
    <Stack gap={14}>
      <div className={styles.greeting}>
        <span className={styles.hello}>{tx(view.greeting)}</span>
        <span className={styles.date}>{tx(view.sub)}</span>
      </div>
      <KpiGrid min={170}>
        {view.kpis.map((k, i) => (
          <KpiTile key={i} size="lg" label={tx(k.label)} value={tx(k.value)} sub={tx(k.sub)} color={k.lo ? LO : OK} />
        ))}
      </KpiGrid>
      <CardGrid min={360} gap={14} align="start">
        <QueueCard list={view.left} tx={tx} />
        <QueueCard list={view.right} tx={tx} />
      </CardGrid>
    </Stack>
  );
}
