// Platform seed: notifications (NOTIFS, audience roles expanded to the users holding them, seed read flag →
// readAt), activity feed (ACTIVITY) and audit trail (AUDIT). See schema/platform.ts.
import { PROTO } from '@/server/prototype';
import { parseStampText, type ActivityKind, type NotificationKind } from '../codes';
import { activityEvents, auditEntries, notificationRecipients, notifications } from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';

type ProtoNotif = [string, NotificationKind, string, string, string, boolean, string, Record<string, unknown> | null, string[]];

/** Notifications about a project: every seed notification describes Harbor Line except the portfolio-wide Lucca sync (n10). */
const NOTIF_PROJECT: Record<string, string | null> = { n10: null };

export async function seedPlatform(tx: Tx, ctx: SeedCtx): Promise<void> {
  const personOf = (name: string) => ctx.personByFull.get(name) ?? ctx.personByShort.get(name) ?? null;

  const notifs = (PROTO.NOTIFS as ProtoNotif[]).map(([code, kind, title, body, when, read, screen, extra, audience], i) => ({
    row: {
      id: newId(), code, kind, title, body, occurredAt: parseStampText(when),
      projectId: NOTIF_PROJECT[code] === null ? null : must(ctx.projectByCode, NOTIF_PROJECT[code] ?? 'HLT-026', 'project'),
      targetScreen: screen, targetParams: extra ?? {}, audienceRoles: audience, sortOrder: i + 1,
    },
    read,
    audience,
  }));
  await tx.insert(notifications).values(notifs.map((n) => n.row));
  await tx.insert(notificationRecipients).values(
    notifs.flatMap((n) =>
      n.audience.map((role) => ({ notificationId: n.row.id, userId: must(ctx.userByRole, role, 'user role'), readAt: n.read ? n.row.occurredAt : null })),
    ),
  );

  await tx.insert(activityEvents).values(
    (PROTO.ACTIVITY as [string, string, string, ActivityKind][]).map(([when, who, text, kind]) => ({
      id: newId(), occurredAt: parseStampText(when), actorPersonId: personOf(who), actorName: who, text, kind,
      projectId: null,
    })),
  );

  await tx.insert(auditEntries).values(
    (PROTO.AUDIT as [string, string, string, string, string][]).map(([when, who, objectRef, change, area]) => ({
      id: newId(), occurredAt: parseStampText(when), actorPersonId: personOf(who), actorName: who, objectRef, change, area,
    })),
  );
}
