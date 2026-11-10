import 'server-only';
// Data of the Lessons learned & closure screen, read through the DAL and shaped by ./model (getRex). One call per page. The
// client portal's screen data went with the portal (D9-06).
import type { Lang, T } from '@/i18n/translate';
import { getRex } from '@/server/dal/rex';
import { rexScreenView, type RexScreenView } from './model';

export async function getRexScreen(code: string, t: T, lang: Lang): Promise<RexScreenView> {
  return rexScreenView(await getRex(code), t, lang);
}
