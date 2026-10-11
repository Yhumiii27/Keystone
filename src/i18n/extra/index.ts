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
};
