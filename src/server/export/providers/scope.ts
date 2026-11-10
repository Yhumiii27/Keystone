import 'server-only';
// Current project of the exports of global screens (chapter 4). Every viewer exports what the screen shows: the client's row
// filter (P-10a) went with the Client role (D9-06, owner 10 Nov 2026).
import type { ExportContext } from '../types';
import { param } from './common';

/** Current project of a global screen (the header passes the shell's project as `?code=`): that code, else `fallback`. */
export function currentProjectCode(ctx: Pick<ExportContext, 'params'>, fallback: string): string {
  return param(ctx, 'code')?.toUpperCase() ?? fallback;
}
