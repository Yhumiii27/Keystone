import 'server-only';
// R-199 / R-036 — how Keystone sends an e-mail (KEYSTONE_MAIL_TRANSPORT, src/server/config/parse.ts):
// - `none` (default): nothing is sent; the caller records "no_transport" and the bell notice stays the only channel;
// - `file`: the message is written as one .eml file in KEYSTONE_MAIL_DIR (demonstrations, tests; a pick-up folder an MTA could
//   read). Written to a temporary name then renamed, so a reader never sees half a message.
// SMTP (a relay) and Microsoft Graph (sendMail with the Entra application) await IT and are refused by the configuration; Teams
// is not a channel yet (X-6b chose Keystone + e-mail). A new transport implements `MailTransport` here.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { buildMime, type MailMessage } from './mime';

export type MailSendResult = { status: 'sent'; ref: string } | { status: 'no_transport' } | { status: 'failed'; error: string };

export interface MailTransport {
  mode: 'none' | 'file';
  send: (m: Omit<MailMessage, 'from'>) => Promise<MailSendResult>;
}

/** "20260928T050000Z-1a2b3c4d-a-garnier-epc2i-fr.eml": sortable by time, unique, ASCII. */
export function emlFileName(at: Date, to: string, rand: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const who = to.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${stamp}-${rand}-${who || 'recipient'}.eml`;
}

/** The file transport writing into `dir` (created when missing). */
export function fileTransport(dir: string, from: string, now: () => Date = () => new Date()): MailTransport {
  return {
    mode: 'file',
    send: async (m) => {
      try {
        const at = now();
        const rand = randomBytes(4).toString('hex');
        const host = (/@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? 'keystone.invalid').toLowerCase();
        const raw = buildMime({ ...m, from }, { date: at, messageId: `${at.getTime()}.${rand}@${host}`, boundary: `ks-${rand}-${at.getTime().toString(36)}` });
        await fs.mkdir(dir, { recursive: true });
        const name = emlFileName(at, m.to, rand);
        const tmp = path.join(dir, `.${name}.tmp`);
        await fs.writeFile(tmp, raw, 'utf8');
        await fs.rename(tmp, path.join(dir, name));
        return { status: 'sent', ref: name };
      } catch (e) {
        return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

const NONE: MailTransport = { mode: 'none', send: async () => ({ status: 'no_transport' }) };

/** The transport of the configuration (read at each call: tests switch it with the environment). */
export function mailTransport(): MailTransport {
  const { mail } = getConfig();
  return mail.transport === 'file' && mail.dir ? fileTransport(mail.dir, mail.from) : NONE;
}
