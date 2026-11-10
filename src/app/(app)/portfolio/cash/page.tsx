// Cash flow & billing — next 6 months (docs/spec/03 §7; template 2143–2179, logic 4513–4520). Zone screen (zone bar,
// cookie): projects in execution with a billing plan (the contract when one exists, A-5), KPI tiles and the 6-month
// forecast scaled to the zone's share of contract value. No primary action. Margins are masked for viewers other
// than the director and project managers (never sent to the browser).
import { PageHeader } from '@/components/app/shell/page-header';
import { CashView } from '@/features/pfinance/cash-view';
import { pfT } from '@/features/pfinance/i18n';
import { cashView } from '@/features/pfinance/model';
import { getCashScreen } from '@/server/dal/pfinance';
import { getI18n, getViewer, getZone } from '@/server/session';
import { getScreenAccess } from '@/server/project-context';
import { canSeeFxExposure } from '@/domain/rights';
import { FxExposureCard } from '@/features/fx/fx-exposure-card';
import { businessToday } from '@/server/clock';
import { getPortfolioFxExposure } from '@/server/dal/fx';

export default async function CashFlowPage() {
  // R-042 (P-1): a client is sent home before anything is read.
  await getScreenAccess('cash');
  const [{ t: t0, lang }, zone, viewer] = await Promise.all([getI18n(), getZone(), getViewer()]);
  const t = pfT(t0, lang);
  const data = await getCashScreen(viewer.role, zone);
  const fx = canSeeFxExposure(viewer.role) ? await getPortfolioFxExposure(await businessToday()) : null;
  return (
    <>
      <PageHeader screen="cash" />
      <CashView view={cashView(data, t, lang)} t={t} />
      {/* R-162 (P4): the portfolio's FX exposure — one line per project and currency (Finance and the director). */}
      {fx && <FxExposureCard lines={fx.lines} thresholds={fx.thresholds} t={t0} lang={lang} portfolio />}
    </>
  );
}
