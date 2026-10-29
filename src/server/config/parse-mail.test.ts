// R-199 / R-036 — the e-mail configuration: none by default, the file transport and its folder, smtp / graph refused until IT
// provides them, the sender, Keystone's address in the links.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_FROM, formatIssues, mailAddressOf, parseConfig } from './parse';

const cwd = '/srv/keystone';
const parse = (env: Record<string, string | undefined>) => parseConfig(env, { cwd });

describe('e-mail transport (R-199, R-036)', () => {
  it('none by default: nothing sent, the default sender, links to localhost:3000', () => {
    const r = parse({});
    expect(r.errors).toEqual([]);
    expect(r.config.mail).toEqual({ transport: 'none', dir: null, from: DEFAULT_MAIL_FROM, publicUrl: 'http://localhost:3000' });
  });

  it('file: the .eml folder (default <data dir>/mail, or KEYSTONE_MAIL_DIR relative to the working directory)', () => {
    expect(parse({ KEYSTONE_MAIL_TRANSPORT: 'file' }).config.mail.dir).toBe(path.join(cwd, '.data', 'mail'));
    const r = parse({ KEYSTONE_MAIL_TRANSPORT: 'FILE', KEYSTONE_MAIL_DIR: 'outbox', KEYSTONE_MAIL_FROM: 'Keystone <keystone@epc2i.fr>', KEYSTONE_PUBLIC_URL: 'https://keystone.epc2i.fr/' });
    expect(r.errors).toEqual([]);
    expect(r.config.mail).toEqual({ transport: 'file', dir: path.join(cwd, 'outbox'), from: 'Keystone <keystone@epc2i.fr>', publicUrl: 'https://keystone.epc2i.fr' });
  });

  it('smtp and graph await IT: refused with a clear message (production stops, elsewhere the default none applies)', () => {
    for (const v of ['smtp', 'graph']) {
      const r = parse({ KEYSTONE_MAIL_TRANSPORT: v });
      expect(formatIssues(r.errors)).toEqual([
        `KEYSTONE_MAIL_TRANSPORT "${v}" awaits IT (an SMTP relay or the Microsoft 365 registration of Keystone, R-036): use "none" or "file" until then`,
      ]);
      expect(r.config.mail.transport).toBe('none');
    }
    expect(formatIssues(parse({ KEYSTONE_MAIL_TRANSPORT: 'pigeon' }).errors)).toEqual(['KEYSTONE_MAIL_TRANSPORT must be "none" or "file" ("smtp" and "graph" await IT)']);
  });

  it('the folder is never inside the stored files or the PGlite folder; a folder without the file transport is ignored (warning)', () => {
    expect(formatIssues(parse({ KEYSTONE_MAIL_TRANSPORT: 'file', KEYSTONE_MAIL_DIR: '.data/files/mail' }).errors)).toEqual([
      "KEYSTONE_MAIL_DIR must be outside the data directory's files and pg folders",
    ]);
    expect(formatIssues(parse({ KEYSTONE_MAIL_DIR: '/tmp/mail' }).warnings)).toEqual(['KEYSTONE_MAIL_DIR is ignored unless KEYSTONE_MAIL_TRANSPORT=file']);
  });

  it('the sender must be an address; the links follow KEYSTONE_PUBLIC_URL, else the Entra redirect origin', () => {
    expect(formatIssues(parse({ KEYSTONE_MAIL_FROM: 'Keystone' }).errors)).toEqual(['KEYSTONE_MAIL_FROM must be an e-mail address, optionally with a name: Keystone <keystone@epc2i.fr>']);
    expect([mailAddressOf('a@b.fr'), mailAddressOf('Name <a@b.fr>'), mailAddressOf('a@b'), mailAddressOf('<a@b.fr')]).toEqual(['a@b.fr', 'a@b.fr', null, null]);
    expect(parse({ ENTRA_REDIRECT_URI: 'https://pm.epc2i.fr/api/auth/callback' }).config.mail.publicUrl).toBe('https://pm.epc2i.fr');
    expect(formatIssues(parse({ KEYSTONE_PUBLIC_URL: 'ftp://x' }).errors)).toEqual(['KEYSTONE_PUBLIC_URL must be an http:// or https:// URL']);
  });

  it('production: the file transport warns (written, not delivered); links without an address warn', () => {
    const r = parse({ NODE_ENV: 'production', KEYSTONE_AUTH: 'demo', KEYSTONE_FILE_SCAN: 'off', KEYSTONE_MAIL_TRANSPORT: 'file' });
    expect(r.errors).toEqual([]);
    expect(formatIssues(r.warnings)).toEqual(expect.arrayContaining([
      'KEYSTONE_MAIL_TRANSPORT is "file": e-mails are written to a folder, not delivered (an SMTP relay or Microsoft 365 awaits IT, R-036)',
      'KEYSTONE_PUBLIC_URL is not set: the links of the e-mails open http://localhost:3000',
    ]));
  });
});
