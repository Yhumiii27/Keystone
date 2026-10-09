// Download of an uploaded meeting transcript (chapter 4, S-10) — the Route Handler against an in-memory database and a
// temporary file folder: the file comes back as stored (attachment), a paste / unknown meeting is a 404 and a client contact
// on another organisation's project is refused. Session and project context are mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'pm', isMine: true };
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: 'Romain Aubert', role: viewer.role }, isMine: viewer.isMine }),
}));

import { GET } from '@/app/api/meetings/[number]/transcript/route';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { createMeeting } from '@/server/dal/meetings';
import { importTranscript } from '@/server/dal/meetings-transcripts';
import { setFilesRoot } from '@/server/storage/files';

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Romain Aubert>On valide la grue de 300 tonnes.</v>\n';
const get = (n: string) => GET(new Request(`http://localhost/api/meetings/${n}/transcript`), { params: Promise.resolve({ number: n }) });

let dir = '';
let meeting = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-mtg-file-'));
  setFilesRoot(dir);
  setDb(await openDatabase());
  meeting = await createMeeting('HLT-026', { title: 'Levage', type: 'internal', series: 'one_off', date: '2026-10-07', time: '09:00', location: 'Teams', invitees: ['R. Aubert'], agenda: ['Levage'] }, 'Romain Aubert');
  await importTranscript(meeting, { file: { name: 'levage été.vtt', data: new TextEncoder().encode(VTT) } }, 'Romain Aubert');
  await importTranscript('MTG-119', { text: 'R. Aubert: pasted.' }, 'Romain Aubert');
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/meetings/[number]/transcript', () => {
  it('serves the uploaded file as stored, as an attachment', async () => {
    const res = await get(meeting.toLowerCase());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/vtt');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''levage%20%C3%A9t%C3%A9.vtt");
    expect(await res.text()).toBe(VTT);
  });

  it('a pasted transcript, an unknown or malformed meeting → 404', async () => {
    for (const n of ['MTG-119', 'MTG-999', "MTG-1'; drop", '..%2F..%2Fetc']) {
      const res = await get(n);
      expect(res.status, n).toBe(404);
    }
  });

  it('a client contact on another organisation’s project is refused; on their own project they may download', async () => {
    Object.assign(viewer, { role: 'client', isMine: false });
    const res = await get(meeting);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('You cannot open this file');
    Object.assign(viewer, { role: 'client', isMine: true });
    expect((await get(meeting)).status).toBe(200);
  });
});
