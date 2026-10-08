// "Coming soon" page for registry screens that are not built yet (catch-all routes).
import { Hammer } from '@phosphor-icons/react/dist/ssr';
import type { ScreenId } from '@/config/screens';
import { getI18n } from '@/server/session';
import { PageHeader } from './page-header';
import styles from './shell.module.css';

/** Module spec of each screen (docs/spec/00 §0). */
const SPEC: [string, ScreenId[]][] = [
  ['03-portfolio-home.md', ['home', 'myprojects', 'worldmap', 'overview', 'projects', 'portfolio', 'cash', 'client']],
  ['04-cost-contract.md', ['budget', 'trends', 'contract', 'billing', 'contingency']],
  ['05-planning-schedule.md', ['schedule', 'plan', 'pfplan', 'whatif', 'meetings', 'stakeholders']],
  ['06-resources-hr.md', ['resources', 'presources', 'rates', 'skills', 'leave', 'hours']],
  ['07-risk-change-quality-ops.md', ['risks', 'changes', 'quality', 'itp', 'interfaces', 'commissioning', 'rex', 'fleet', 'sav']],
  ['08-supply-chain-approvals.md', ['procurement', 'orders', 'deliveries', 'stock', 'requests', 'approvals', 'myapprovals']],
  ['09-engineering-plm.md', ['bom', 'plm', 'eco', 'drawings', 'pid', 'eng', 'eng-process', 'eng-meca', 'eng-elec', 'eng-auto', 'mtypes']],
  ['10-site-docs-mywork-settings.md', ['settings', 'plumbing', 'site', 'docs', 'doctypes', 'mywork', 'task']],
];

export const specOf = (id: ScreenId) => 'docs/spec/' + (SPEC.find(([, ids]) => ids.includes(id))?.[0] ?? '00-overview.md');

export async function ComingSoon({ screen, projectCode, taskId }: { screen: ScreenId; projectCode?: string; taskId?: string }) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader screen={screen} projectCode={projectCode} taskId={taskId} />
      <div className={styles.soon}>
        <Hammer size={20} className={styles.soonIcon} />
        <span className={styles.soonTitle}>{t('This module is being built')}</span>
        <span className={styles.soonSub}>{t('Specification') + ' · ' + specOf(screen)}</span>
      </div>
    </>
  );
}
