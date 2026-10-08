// Body of the dev component gallery (server-compatible; `t` is passed in so it can also be rendered client-side).
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ArrowSquareOut,
  CalendarBlank,
  CalendarDots,
  Check,
  ClockCountdown,
  Eye,
  Factory,
  FilePdf,
  FileXls,
  Funnel,
  GlobeHemisphereEast,
  Heartbeat,
  Info,
  LockSimple,
  Package,
  Plus,
  SealCheck,
  Tag as TagIcon,
  TrendDown,
  Warning,
  Wrench,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { Button, ButtonLink, Card, CardTitle, CellStack, Ellipsis, Field, IconButton, IdText, Input, PseudoInput, Segmented, Select, Table, Tag, Td, Textarea, Th, Tr } from '@/components/ds';
import {
  AttachmentRow,
  Avatar,
  BulletBar,
  Callout,
  CapacityBar,
  CapacityStack,
  CardGrid,
  CheckCircle,
  CheckRow,
  ChoiceCard,
  CommentRow,
  CountBadge,
  DataTable,
  DocumentPreview,
  EmptyState,
  Eyebrow,
  FilterBar,
  FilterChips,
  FilterGroup,
  FilterLabel,
  FilterNote,
  FlowStepper,
  GridHead,
  GridRow,
  GridTable,
  GroupDivider,
  HatchedBar,
  HealthTag,
  HeatScale,
  IconCheck,
  IconTile,
  InsetPanel,
  KeyValueList,
  KpiGrid,
  KpiTile,
  LO,
  Legend,
  LegendItem,
  LifecycleTag,
  ListRow,
  NumberedStepper,
  OK,
  ObjectStatusTag,
  OverlayBar,
  ProgressBar,
  ReconStep,
  SectionCard,
  SelectFilter,
  SpendVsEarned,
  StackedShare,
  StatusDot,
  StatusTag,
  TimeEntryRow,
  TrendKpiCard,
  WizardSteps,
  approvalDot,
  levelColor,
  riskCell,
  shade,
  type DataColumn,
} from '@/components/app';
import { ChartFrame, DotRating, HGrid, Sparkline, XLabels, AreaGradient, PointMarker, trendDelta, trendFrame } from '@/components/charts/primitives';
import type { T } from '@/i18n/translate';
import { Interactive } from './interactive';
import s from './page.module.css';

function Section({ title, refs, children }: { title: string; refs: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.h}>
        {title}
        <span className={s.ref}>{refs}</span>
      </div>
      {children}
    </section>
  );
}

interface ProjRow {
  code: string;
  name: string;
  pm: string;
  due: string;
  health: 'on_track' | 'at_risk' | 'off_track';
  progress: number;
  spent: number;
  cpi: number;
  spi: number;
  eac: string;
}

const PROJ: ProjRow[] = [
  { code: 'HLT-026', name: 'Harbor Line Terminal Expansion', pm: 'R. Aubert', due: 'Dec 2026', health: 'at_risk', progress: 0.62, spent: 0.66, cpi: 0.94, spi: 0.95, eac: '€5.11M' },
  { code: 'WSA-044', name: 'Westfield Solar Array', pm: 'C. Morvan', due: 'Mar 2027', health: 'on_track', progress: 0.41, spent: 0.38, cpi: 1.03, spi: 1.01, eac: '€3.20M' },
  { code: 'NDC-031', name: 'North Data Center Fit-out', pm: 'S. Perrin', due: 'Nov 2026', health: 'off_track', progress: 0.78, spent: 0.91, cpi: 0.86, spi: 0.88, eac: '€7.42M' },
];

export function GalleryBody({ t, view, cat, sel }: { t: T; view: string; cat: string; sel: string | null }) {

  const cpiSeries = [0.99, 0.98, 0.97, 0.97, 0.96, 0.95, 0.95, 0.94, 0.95, 0.94, 0.94, 0.93, 0.94];
  const cpiDelta = trendDelta(cpiSeries, false);
  const tf = trendFrame(cpiSeries, 760, 220, 1);
  const weeks = ['3 Jul', '10 Jul', '17 Jul', '24 Jul', '31 Jul', '7 Aug', '14 Aug', '21 Aug', '28 Aug', '4 Sep', '11 Sep', '18 Sep', '25 Sep'];

  const columns: DataColumn<ProjRow>[] = [
    { key: 'name', header: t('Project'), render: (p) => <CellStack title={p.name} sub={`${p.pm} ${t('· due')} ${t(p.due)}`} /> },
    { key: 'health', header: t('Health'), render: (p) => <HealthTag health={p.health} label={t({ on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' }[p.health])} /> },
    { key: 'progress', header: t('Progress'), render: (p) => <ProgressBar variant="inline" value={p.progress} label={`${Math.round(p.progress * 1000) / 10}%`} /> },
    { key: 'spend', header: t('Spend vs earned'), render: (p) => <SpendVsEarned spent={p.spent} earned={p.progress} label={`${Math.round(p.spent * 1000) / 10}%`} /> },
    { key: 'cpi', header: t('CPI'), numeric: true, color: (p) => (p.cpi < 0.97 ? LO : OK), render: (p) => p.cpi.toFixed(2) },
    { key: 'spi', header: t('SPI'), numeric: true, color: (p) => (p.spi < 0.97 ? LO : OK), render: (p) => p.spi.toFixed(2) },
    { key: 'eac', header: t('EAC'), numeric: true, align: 'right', nowrap: true, render: (p) => p.eac },
  ];

  return (
    <main className={s.page}>
      <div>
        <h2 className={s.title}>Components</h2>
        <p className={s.lead}>Design-system primitives (components/ds), shared app components (components/app) and chart primitives — docs/spec/02.</p>
      </div>

      <Section title="Buttons" refs="DS-CLASSES · Buttons">
        <div className={s.row}>
          <Button variant="primary" icon={Plus}>{t('New risk')}</Button>
          <Button variant="primary" size="sm" icon={Check}>{t('Approve')}</Button>
          <Button variant="secondary" size="sm" icon={CalendarDots}>{t('Show in Gantt')}</Button>
          <Button variant="ghost" size="sm" iconRight={ArrowRight}>{t('Open plan')}</Button>
          <Button variant="primary" size="row" icon={Check}>{t('Approve')}</Button>
          <Button variant="ghost" size="row">{t('Reject')}</Button>
          <Button variant="ghost" size="compact" iconRight={ArrowRight}>{t('Plan intervention')}</Button>
          <Button variant="ghost" size="mini">{t('Mark all read')}</Button>
          <ButtonLink href="/dev/components?view=budget" variant="secondary" size="sm" iconRight={ArrowSquareOut}>{t('Open')}</ButtonLink>
          <Button variant="primary" disabled>{t('Register risk')}</Button>
        </div>
        <div className={s.row}>
          <IconButton icon={X} variant="secondary" label={t('Close')} />
          <IconButton icon={X} muted label={t('Close')} />
          <IconButton icon={CalendarBlank} variant="secondary" size={28} label="28" />
          <IconButton icon={Wrench} muted size={24} label="24" />
          <IconButton icon={Info} variant="secondary" label={t('Notifications')}>
            <CountBadge variant="bell">3</CountBadge>
          </IconButton>
        </div>
      </Section>

      <Section title="Tags & status tags" refs="DS-CLASSES · Tags · C-07 · DS-TONES">
        <div className={s.row}>
          <Tag tone="accent">{t('Off track')}</Tag>
          <Tag tone="outline">{t('At risk')}</Tag>
          <Tag tone="neutral">{t('On track')}</Tag>
          <Tag tone="outline" icon={Eye}>{t('Read-only')}</Tag>
          <Tag tone="accent" size="xs">{t('New')}</Tag>
          <Tag tone="neutral" size="sm">EMP</Tag>
          <StatusTag tone="muted" />
          <LifecycleTag status="Fabrication & Assemblage" />
          <LifecycleTag status="APS" />
          <LifecycleTag status="Clos" />
          <ObjectStatusTag kind="po" code="partially_received" label={t('Partially received')} />
          <ObjectStatusTag kind="ncr" code="containment" label={t('Containment')} />
          <ObjectStatusTag kind="eco" code="released" label={t('Released')} />
        </div>
      </Section>

      <Section title="Cards, KPI tiles" refs="DS-CLASSES · Cards · C-04 · C-05">
        <KpiGrid min={160}>
          <KpiTile size="lg" label={t('Active projects')} value="6" sub={t('2 need attention')} icon={Warning} />
          <KpiTile label="CPI" value="0.94" sub={t('Earning 94¢ per € spent')} color={LO} />
          <KpiTile label="SPI" value="1.01" sub={t('On plan')} />
          <KpiTile label={t('EAC')} value="€5.11M" sub={t('Budget') + ' €4.80M'} tone="alert" />
        </KpiGrid>
        <KpiGrid min={190}>
          <TrendKpiCard label="CPI" target="≥ 0.97" value="0.94" series={cpiSeries} delta={`${cpiDelta.delta >= 0 ? '+' : '−'}${Math.abs(cpiDelta.delta).toFixed(2)} · 4 wk`} worse={cpiDelta.worse} selected href="/dev/components" />
          <TrendKpiCard label="SPI" target="≥ 0.97" value="0.95" series={[1, 0.99, 0.98, 0.98, 0.97, 0.96, 0.96, 0.95]} delta="−0.02 · 4 wk" worse href="/dev/components" />
        </KpiGrid>
        <div className={s.row}>
          <ReconStep label={t('Original budget')} value="€4.80M" sub="BL1" arrow />
          <ReconStep label={t('Current budget')} value="€4.96M" sub="+ CR-006" highlight />
        </div>
        <CardGrid min={360}>
          <SectionCard title={t('Needs attention')} hint={t('6 projects · FY2026')}>
            <ListRow title={t('Steel erection — Bays 3–4')} sub="A1250 · R. Aubert" right={<Tag tone="accent">{t('Behind')}</Tag>} noBorder />
            <ListRow title={t('Crane delivery & rigging')} sub="A1320 · 12 Oct" right={<Tag tone="outline">{t('In progress')}</Tag>} />
            <ListRow
              leading={<IconTile icon={TrendDown} />}
              align="start"
              gap={10}
              padding={10}
              title={t('Cost overrun on structure')}
              sub={t('CPI 0.86 — forecast +€620k over budget')}
              strong
            >
              <Button variant="ghost" size="inline" iconRight={ArrowRight}>{t('Open budget')}</Button>
            </ListRow>
          </SectionCard>
          <SectionCard title={t('Budget by work package')} subtitle={t('Mapped to the WBS — every activity carries its share')} actions={<Button variant="ghost" size="sm" iconRight={ArrowRight}>{t('Open plan')}</Button>}>
            <KeyValueList
              title={t('General')}
              items={[
                { k: t('Owner'), v: 'R. Aubert' },
                { k: t('Planned finish'), v: '30 Oct', color: LO },
                { k: t('Float'), v: '−6 d', color: LO },
                { k: t('Budget'), v: '€420k' },
              ]}
            />
          </SectionCard>
          <SectionCard icon={Heartbeat} title={t('Project health')} subtitle={t('Computed from CPI and SPI')} variant="tinted">
            <KeyValueList layout="inline" items={[{ k: t('Status'), v: t('In progress') }, { k: t('Due'), v: '30 Oct', color: LO }, { k: t('Owner'), v: 'J. Wagner' }]} />
          </SectionCard>
          <SectionCard href="/dev/components" title={t('Harbor Line Terminal Expansion')} gap={10}>
            <ProgressBar variant="card" value={0.62} />
            <span className={s.lead}>{t('Open project')} →</span>
          </SectionCard>
        </CardGrid>
        <SectionCard variant="highlight">
          <IconTile variant="brand" icon={SealCheck} />
          <span>{t('Highlight card')}</span>
        </SectionCard>
        <Card className={s.w320}>
          <CardTitle>{t('Plain card')}</CardTitle>
          <span className={s.lead}>DS .card .elev-sm</span>
        </Card>
      </Section>

      <Section title="Eyebrows" refs="C-06">
        <div className={s.col}>
          <Eyebrow>{t('General')}</Eyebrow>
          <Eyebrow variant="muted">{t('Will be created')}</Eyebrow>
          <Eyebrow variant="sub">{t('Projects & BOMs')} · 3</Eyebrow>
          <Eyebrow variant="label">SPI</Eyebrow>
          <Eyebrow variant="menu">{t('Move to')}</Eyebrow>
          <GroupDivider label={t('In progress')} count={6} />
        </div>
      </Section>

      <Section title="Filters, segmented, search" refs="C-08 · C-09 · C-10">
        <FilterBar gap={6}>
          <FilterGroup>
            <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
            <Segmented
              wrap
              value={view}
              options={[
                { value: 'health', label: t('Health'), href: '/dev/components?view=health' },
                { value: 'progress', label: t('Progress'), href: '/dev/components?view=progress' },
                { value: 'budget', label: t('Budget'), href: '/dev/components?view=budget' },
              ]}
            />
          </FilterGroup>
          <FilterNote>{t('Score = probability × impact (1–5)')}</FilterNote>
        </FilterBar>
        <FilterBar>
          <FilterGroup>
            <FilterLabel icon={Funnel}>{t('Category')}</FilterLabel>
            <FilterChips
              value={cat}
              options={[
                { value: 'all', label: t('All'), count: 12, href: '/dev/components?cat=all' },
                { value: 'technical', label: t('Technical'), count: 5, href: '/dev/components?cat=technical' },
                { value: 'supplier_delivery', label: t('Supplier / delivery'), count: 4, href: '/dev/components?cat=supplier_delivery' },
                { value: 'hse', label: 'HSE', count: 3, href: '/dev/components?cat=hse' },
              ]}
            />
          </FilterGroup>
          <SelectFilter icon={TagIcon} label={t('Type')} options={[{ value: 'all', label: t('All') }, { value: 'structural', label: t('Structural') }]} />
          <SelectFilter icon={Factory} label={t('Supplier')} options={[{ value: 'all', label: t('All') }]} />
        </FilterBar>
        <Interactive part="filters" />
      </Section>

      <Section title="Tables" refs="DS-CLASSES · Table · C-11">
        <SectionCard title={t('Active projects')} hint={t('6 projects · FY2026')} scroll>
          <DataTable columns={columns} rows={PROJ} rowKey={(p) => p.code} selectedKey={sel} rowHref={(p) => (sel === p.code ? '/dev/components' : `/dev/components?sel=${p.code}`)} />
          <Legend variant="footer">
            <LegendItem kind="block" color="var(--color-neutral-300)" width={12} height={5}>{t('Budget spent')}</LegendItem>
            <LegendItem kind="tick" color="var(--color-accent)">{t('Work earned')}</LegendItem>
          </Legend>
        </SectionCard>
        <SectionCard title={t('Purchase orders')} scroll>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Order')}</Th>
                <Th>{t('Supplier')}</Th>
                <Th align="right">{t('Amount')}</Th>
                <Th>{t('Status')}</Th>
              </tr>
            </thead>
            <tbody>
              <Tr selected>
                <Td><IdText selected>PO-2026-0412</IdText></Td>
                <Td tone="secondary" maxWidth={200}><Ellipsis>Hallstrom Cranes — heavy lifting & rigging equipment</Ellipsis></Td>
                <Td align="right" numeric nowrap>€184,500</Td>
                <Td><ObjectStatusTag kind="po" code="awaiting_approval" label={t('Awaiting approval')} /></Td>
              </Tr>
              <Tr>
                <Td><IdText>PO-2026-0398</IdText></Td>
                <Td tone="secondary">Nordsteel</Td>
                <Td align="right" numeric nowrap>€92,140</Td>
                <Td><ObjectStatusTag kind="po" code="received" label={t('Received')} /></Td>
              </Tr>
            </tbody>
          </Table>
          <DataTable columns={columns.slice(0, 2)} rows={[]} rowKey={(p) => p.code} empty={t('No risk in this category')} hideHeaderWhenEmpty />
        </SectionCard>
        <SectionCard title={t('Grid table')} scroll>
          <GridTable columns="72px minmax(220px,1.6fr) 150px 84px" minWidth={600}>
            <GridHead>
              <span>WBS</span>
              <span>{t('Work package')}</span>
              <span>{t('Owner')}</span>
              <span>{t('Budget')}</span>
            </GridHead>
            <GridRow>
              <IdText>1.1</IdText>
              <span>{t('Design & permits')}</span>
              <span>R. Aubert</span>
              <span>€420k</span>
            </GridRow>
            <GridRow>
              <IdText>1.2</IdText>
              <span>{t('Steel structure')}</span>
              <span>J. Wagner</span>
              <span>€1.24M</span>
            </GridRow>
          </GridTable>
        </SectionCard>
      </Section>

      <Section title="Badges, avatars, dots, icon tiles" refs="C-14 · C-15 · C-16 · C-17">
        <div className={s.row}>
          <CountBadge>4</CountBadge>
          <CountBadge variant="section">12</CountBadge>
          <CountBadge variant="group">!</CountBadge>
          <CountBadge variant="outline" borderColor="var(--color-accent-700)" color="var(--color-accent-300)" dotColor="var(--color-accent)">3 {t('to confirm')}</CountBadge>
          {([30, 28, 26, 24, 22, 20] as const).map((z) => (
            <Avatar key={z} size={z} name="Marie Lefebvre" tone={z === 30 || z === 20 ? 'accent' : 'neutral'} />
          ))}
          <Avatar size={26} initials="CX" tone="soft" />
          <StatusDot />
          <StatusDot size={10} color="var(--color-neutral-700)" />
          <StatusDot size={8} {...(({ dot, ring }) => ({ color: dot, ring }))(approvalDot('na'))} />
          <IconTile icon={Warning} />
          <IconTile variant="file" icon={FilePdf} />
          <IconTile variant="brand" icon={SealCheck} />
          <IconTile variant="mark">Cx</IconTile>
        </div>
      </Section>

      <Section title="Progress bars" refs="C-18">
        <div className={s.grid2}>
          <div className={s.col}>
            <ProgressBar variant="inline" value={0.644} label="64.4%" />
            <ProgressBar variant="card" value={0.62} />
            <ProgressBar variant="thin" value={0.5} />
            <ProgressBar variant="md" value={0.8} />
            <SpendVsEarned spent={0.66} earned={0.62} label="66.0%" />
          </div>
          <div className={s.col}>
            <CapacityBar demand={132} capacity={120} />
            <CapacityStack committed={80} candidate={30} capacity={100} />
            <BulletBar actual={310} committed={90} budget={420} forecast={470} />
            <StackedShare segments={[{ value: 0.35, color: 'var(--color-accent)' }, { value: 0.2, color: 'var(--color-accent-700)' }]} />
            <OverlayBar layers={[{ value: 0.7, color: 'var(--color-neutral-400)' }, { value: 0.45, color: 'var(--color-accent)' }]} />
            <HatchedBar exposure={0.6} used={0.3} />
          </div>
        </div>
      </Section>

      <Section title="Callouts & empty states" refs="C-24 · C-25">
        <div className={s.col}>
          <Callout icon={GlobeHemisphereEast}>{t('No project in this zone for this view')}</Callout>
          <Callout variant="outlined" icon={Info} iconSize={16}>{t('No project is assigned to you — the whole portfolio is shown.')}</Callout>
          <Callout variant="emphasis" icon={Warning}>{t('Critical path: steel erection drives the finish date.')}</Callout>
          <Callout variant="compact" tone="accent" icon={LockSimple}>{t('Release locked until interchangeability and every disposition are set.')}</Callout>
          <Callout variant="compact" icon={Wrench} action={<Button variant="ghost" size="compact" iconRight={ArrowRight}>{t('Plan intervention')}</Button>}>
            {t('Retrofit interventions are planned manually in After-sales.')}
          </Callout>
          <Callout variant="compact" alignStart icon={Package}>{t('Pinned revisions keep their spare parts and stock — do not scrap:')} P-1043 rev C</Callout>
          <Callout variant="note">TCPI 1.08 — {t('the remaining work must be done 8% cheaper than planned')}</Callout>
          <InsetPanel title={t('Will be created')} padding="lg">
            <span>#045 · LOG001 · DAS 2 · EMP</span>
          </InsetPanel>
          <EmptyState>{t('Nothing waiting')}</EmptyState>
          <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
          <EmptyState variant="boxedLg">{t('Nothing waiting')}</EmptyState>
          <EmptyState variant="dropzone">{t('Drop a file or click to choose')}</EmptyState>
          <EmptyState variant="drop" icon={FileXls}>{t('Drop the xlsx / csv export here')}</EmptyState>
        </div>
      </Section>

      <Section title="Steppers, checks, choice cards" refs="C-26 · C-27 · C-21">
        <FlowStepper
          steps={[
            { label: t('Draft'), reached: true },
            { label: t('Impact analysis'), reached: true },
            { label: t('In approval'), reached: true, current: true },
            { label: t('Released'), reached: false },
          ]}
          meta={`${t('Raised by')} A. Girard`}
        />
        <NumberedStepper steps={[t('Source'), t('Column mapping'), t('Check & import')]} current={2} />
        <WizardSteps steps={[t('Basics'), t('Structure'), t('Budget'), t('Schedule')]} current={2} />
        <div className={s.row}>
          <CheckCircle done />
          <CheckCircle done={false} />
          <CheckCircle done size={14} />
          <IconCheck done />
          <IconCheck done={false} />
        </div>
        <div className={s.w320}>
          <CheckRow done>{t('Lifting plan approved')}</CheckRow>
          <CheckRow done={false}>{t('Crane certificate on site')}</CheckRow>
        </div>
        <CardGrid min={200} gap={10}>
          <ChoiceCard selected title="Planning EMP" description="Planning standard EMP : études, structure, montage mécanique, électricité & automatisme, essais, réception." />
          <ChoiceCard selected={false} title="Projet blank" description="WBS vide — vous définissez lots, catégories et calendriers." />
        </CardGrid>
      </Section>

      <Section title="Rows, legends, document preview" refs="C-28 · C-29 · C-31">
        <div className={s.grid2}>
          <div className={s.col}>
            <AttachmentRow icon={FilePdf} name="Lifting plan — Bay 3 rev B.pdf" meta="2.4 MB · J. Wagner · 22 Sep" />
            <CommentRow author="Romain Aubert" when="2 h">{t('Crane slot confirmed for Monday — please check the rigging plan.')}</CommentRow>
            <TimeEntryRow date="Thu 24 Sep" note={t('Bay 3 connections check')} hours="6 h" />
          </div>
          <div className={s.col}>
            <Legend>
              <LegendItem kind="line" lineStyle="dashed" color="var(--color-neutral-500)">PV</LegendItem>
              <LegendItem kind="line" color="var(--color-accent)">EV</LegendItem>
              <LegendItem kind="line" lineStyle="dotted" color="var(--color-neutral-100)">{t('Forecast')}</LegendItem>
              <LegendItem kind="bar" color="var(--color-accent-800)" edge="var(--color-accent)">{t('Critical path')}</LegendItem>
              <LegendItem kind="baseline" color="var(--color-neutral-600)">{t('Baseline')}</LegendItem>
              <LegendItem kind="diamond" color="var(--color-accent)">{t('Milestone')}</LegendItem>
              <LegendItem kind="hatched">{t('Group board')}</LegendItem>
              <LegendItem kind="dashedOutline">{t('Execution if approved')}</LegendItem>
            </Legend>
            <Legend variant="footer">
              <HeatScale under={t('Under')} over={t('Over')} />
            </Legend>
            <div className={s.row}>
              {[50, 75, 95, 105, 120].map((v) => (
                <span key={v} style={{ background: shade(v).bg, color: shade(v).fg, padding: '6px 10px', borderRadius: 5, fontSize: 12 }}>{v}%</span>
              ))}
              {[[5, 5], [3, 3], [2, 2], [1, 2]].map(([p, i]) => (
                <span key={`${p}${i}`} style={{ background: riskCell(p, i).bg, color: riskCell(p, i).fg, padding: '6px 10px', borderRadius: 5, fontSize: 10.5 }}>R-{p * i}</span>
              ))}
              <DotRating value={3} color={levelColor} />
              <DotRating value={4} />
            </div>
          </div>
        </div>
        <div className={s.w320}>
          <DocumentPreview ratio="16/9" placeholder={t('Drop receipt photos')} />
        </div>
      </Section>

      <Section title="Forms" refs="DS-CLASSES · Forms">
        <div className={s.grid2}>
          <Field label={t('Title')} required htmlFor="g-title">
            <Input id="g-title" placeholder={t('What needs doing')} />
          </Field>
          <Field label={t('Probability (1–5)')} htmlFor="g-p">
            <Input id="g-p" type="number" defaultValue="3" />
          </Field>
          <Field label={t('Response')} htmlFor="g-r">
            <Select id="g-r" options={['Mitigate', 'Accept', 'Transfer', 'Avoid'].map((o) => ({ value: o.toLowerCase(), label: t(o) }))} />
          </Field>
          <Field label={t('Planned start')}>
            <PseudoInput icon={CalendarBlank}>11 Jan 2027</PseudoInput>
          </Field>
          <Field label={t('Response plan')} span="full" htmlFor="g-plan">
            <Textarea id="g-plan" short />
          </Field>
          <Field label={t('Progress cycle (data date)')}>
            <PseudoInput icon={ClockCountdown}>{t('Weekly · Fridays')}</PseudoInput>
          </Field>
          <Field label="inline / cell / pill">
            <div className={s.row}>
              <Input size="inline" defaultValue="A1250" />
              <Input size="cell" defaultValue="12" alignRight />
              <Select size="pill" options={['WBS', 'Gantt']} />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Chart primitives" refs="DS-CHARTS · CH-3 · CH-4 · CH-12">
        <div className={s.row}>
          <Sparkline values={cpiSeries} />
          <Sparkline values={[3, 4, 2, 6, 5, 7, 9]} />
        </div>
        <SectionCard title={`CPI ${t('— 13 weekly snapshots')}`} subtitle={t('Status date every Friday · dashed line = target')}>
          <ChartFrame width={760} height={220} label="CPI">
            <AreaGradient id="g-trfill" />
            <HGrid rows={tf.grid.map((g) => ({ y: g.y, label: g.value.toFixed(2) }))} x1={48} x2={744} labelX={42} fontSize={10.5} baseline="middle" />
            <XLabels y={212} fontSize={10.5} labels={weeks.map((w, i) => ({ x: tf.x(i), label: t(w) }))} />
            {tf.targetY != null && <line x1={48} x2={744} y1={tf.targetY} y2={tf.targetY} stroke="var(--color-neutral-600)" strokeDasharray="5 4" />}
            <path d={tf.area} fill="url(#g-trfill)" />
            <path d={tf.path} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />
            {tf.last && <PointMarker cx={tf.last.cx} cy={tf.last.cy} />}
          </ChartFrame>
        </SectionCard>
      </Section>

      <Section title="Overlays & interactive" refs="C-19 · C-20 · C-21 · C-22 · C-23 · C-26">
        <Interactive part="overlays" />
      </Section>
    </main>
  );
}
