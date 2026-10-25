// Extra EN → FR entries not present in the prototype dictionary (gaps listed in docs/spec/01 §13.4).
// One JSON file per feature so parallel work never edits the same file.
import shell from './shell.json';
import home from './home.json';
import portfolio from './portfolio.json';
import projects from './projects.json';
import plan from './plan.json';
import schedule from './schedule.json';
import budget from './budget.json';
import common from './common.json';
import requests from './requests.json';
import myapprovals from './myapprovals.json';
import changes from './changes.json';
import risks from './risks.json';
import hr from './hr.json';
import resources from './resources.json';
import mywork from './mywork.json';
import meetings from './meetings.json';
import team from './team.json';
import pfplan from './pfplan.json';
import worldmap from './worldmap.json';
import pfinance from './pfinance.json';
import contract from './contract.json';
import docs from './docs.json';
import stock from './stock.json';
import plm from './plm.json';
import orders from './orders.json';
import eco from './eco.json';
import procurement from './procurement.json';
import deliveries from './deliveries.json';
import bom from './bom.json';
import admin from './admin.json';
import rexclient from './rexclient.json';
import aftersales from './aftersales.json';
import itpcom from './itpcom.json';
import site from './site.json';
import quality from './quality.json';
import eng from './eng.json';
import pid from './pid.json';
import ch4Foundation from './ch4-foundation.json';
import ch4Settings from './ch4-settings.json';
import ch4Planning from './ch4-planning.json';
import ch4Misc from './ch4-misc.json';
import ch4Kpis from './ch4-kpis.json';
import ch4Interchange from './ch4-interchange.json';
import ch4Meetings from './ch4-meetings.json';
import ch4Whatif from './ch4-whatif.json';
import ch4Exports from './ch4-exports.json';
import d7Auth from './d7-auth.json';
import d7Rights from './d7-rights.json';
import d7PlatformData from './d7-platform-data.json';
import d7PlatformWeb from './d7-platform-web.json';
import d7CostControl from './d7-cost-control.json';
import d7ContractPortfolio from './d7-contract-portfolio.json';
import d7Operations from './d7-operations.json';
import d7QualitySite from './d7-quality-site.json';
import d7DebtUx from './d7-debt-ux.json';
// Delivery 8: one file per lot (docs/DELIVERY-8-PLAN.md), registered here once so the lots never edit this index.
import d8AuditI18nShell from './d8-audit-i18n-shell.json';
import d8PlatformOps from './d8-platform-ops.json';
import d8RolesRatesHr from './d8-roles-rates-hr.json';
import d8CostChange from './d8-cost-change.json';
import d8SupplyEngineering from './d8-supply-engineering.json';
import d8Connectors from './d8-connectors.json';
import d8DocsClientPortfolio from './d8-docs-client-portfolio.json';
import d8WorkPlanning from './d8-work-planning.json';
import d8SiteQuality from './d8-site-quality.json';
// Delivery 9: one file per lot.
import d9LoadWindow from './d9-load-window.json';
import d9PrereqAlert from './d9-prereq-alert.json';
import d9PlanningLoad from './d9-planning-load.json';
import d9CursusTasks from './d9-cursus-tasks.json';
import d9ShareViews from './d9-share-views.json';
import d9Equipment from './d9-equipment.json';
import d9Catalogue from './d9-catalogue.json';
import d9EstimateClass from './d9-estimate-class.json';
import d9CapexMilestones from './d9-capex-milestones.json';
import d9EngineeringPack from './d9-engineering-pack.json';
import d9Shipments from './d9-shipments.json';
import d9CapexNeeds from './d9-capex-needs.json';
import d9InternalClient from './d9-internal-client.json';
import d9MatrixSubsidiaries from './d9-matrix-subsidiaries.json';
import d9CatalogueScreen from './d9-catalogue-screen.json';

export const EXTRA_FR: Record<string, string> = {
  ...common,
  ...shell,
  ...home,
  ...portfolio,
  ...projects,
  ...plan,
  ...schedule,
  ...budget,
  ...requests,
  ...myapprovals,
  ...changes,
  ...risks,
  ...hr,
  ...resources,
  ...mywork,
  ...meetings,
  ...pfplan,
  ...team,
  ...worldmap,
  ...pfinance,
  ...contract,
  ...docs,
  ...stock,
  ...plm,
  ...orders,
  ...eco,
  ...procurement,
  ...deliveries,
  ...bom,
  ...admin,
  ...rexclient,
  ...aftersales,
  ...itpcom,
  ...site,
  ...quality,
  ...eng,
  ...pid,
  ...ch4Foundation,
  ...ch4Settings,
  ...ch4Planning,
  ...ch4Misc,
  ...ch4Kpis,
  ...ch4Interchange,
  ...ch4Meetings,
  ...ch4Whatif,
  ...ch4Exports,
  ...d7Auth,
  ...d7Rights,
  ...d7PlatformData,
  ...d7PlatformWeb,
  ...d7CostControl,
  ...d7ContractPortfolio,
  ...d7Operations,
  ...d7QualitySite,
  ...d7DebtUx,
  ...d8AuditI18nShell,
  ...d8PlatformOps,
  ...d8RolesRatesHr,
  ...d8CostChange,
  ...d8SupplyEngineering,
  ...d8Connectors,
  ...d8DocsClientPortfolio,
  ...d8WorkPlanning,
  ...d8SiteQuality,
  ...d9PrereqAlert,
  ...d9LoadWindow,
  ...d9PlanningLoad,
  ...d9CursusTasks,
  ...d9ShareViews,
  ...d9Equipment,
  ...d9Catalogue,
  ...d9EstimateClass,
  ...d9CapexNeeds,
  ...d9InternalClient,
  ...d9MatrixSubsidiaries,
  ...d9CatalogueScreen,
  ...d9CapexMilestones,
  ...d9EngineeringPack,
  ...d9Shipments,
};
