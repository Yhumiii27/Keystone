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
};
