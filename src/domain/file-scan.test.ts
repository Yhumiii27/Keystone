// R-175 — the pure antivirus rules: clamd's replies (fail-closed on anything unexpected), the files the daily rescan reads
// (never scanned first, flagged, then the last 30 days), and the quarantine entries that expire (refused uploads after 30
// days; a flagged stored file's note never).
import { describe, expect, it } from 'vitest';
import { QUARANTINE_RETENTION_DAYS, RESCAN_WINDOW_DAYS, filesToRescan, parseClamdReply, quarantineToPurge, type ScanCandidate } from './file-scan';

const DAY = 86_400_000;
const NOW = new Date('2026-10-12T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('parseClamdReply', () => {
  it('OK, FOUND (with the signature), ERROR — NUL-terminated or not, with an IDSESSION prefix', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamdReply('1: stream: OK')).toEqual({ status: 'clean' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR\0')).toEqual({ status: 'error', message: 'INSTREAM size limit exceeded. ERROR' });
    expect(parseClamdReply("stream: Can't allocate memory ERROR")).toMatchObject({ status: 'error' });
  });

  it('anything else is an error (fail-closed): empty, unknown command, an OK without the stream prefix', () => {
    expect(parseClamdReply('')).toEqual({ status: 'error', message: 'empty reply' });
    expect(parseClamdReply('\0')).toEqual({ status: 'error', message: 'empty reply' });
    expect(parseClamdReply('UNKNOWN COMMAND')).toMatchObject({ status: 'error', message: expect.stringContaining('unexpected reply') });
    expect(parseClamdReply('OK')).toMatchObject({ status: 'error' });
    expect(parseClamdReply('PONG')).toMatchObject({ status: 'error' });
  });
});

describe('filesToRescan', () => {
  const f = (id: string, scanStatus: ScanCandidate['scanStatus'], days: number): ScanCandidate => ({ id, scanStatus, createdAt: ago(days) });

  it(`never scanned (oldest first), then flagged, then clean files of the last ${RESCAN_WINDOW_DAYS} days; old clean files are not reread`, () => {
    const files = [f('clean-new', 'clean', 2), f('clean-old', 'clean', 45), f('un-new', 'unscanned', 1), f('un-old', 'unscanned', 400), f('flag-old', 'infected', 90), f('clean-edge', 'clean', 29.9)];
    expect(filesToRescan(files, NOW).map((x) => x.id)).toEqual(['un-old', 'un-new', 'flag-old', 'clean-edge', 'clean-new']);
  });

  it('caps a run (the rest waits for the next day, never-scanned files first)', () => {
    const files = Array.from({ length: 10 }, (_, i) => f(`u${i}`, i % 2 ? 'unscanned' : 'clean', i));
    expect(filesToRescan(files, NOW, 30, 3).map((x) => x.id)).toEqual(['u9', 'u7', 'u5']);
    expect(filesToRescan(files, NOW, 30, 0)).toEqual([]);
  });
});

describe('quarantineToPurge', () => {
  it(`refused uploads after ${QUARANTINE_RETENTION_DAYS} days; flagged stored files' notes are kept until IT acts`, () => {
    const entries = [
      { name: 'a', kind: 'refused-upload' as const, at: ago(31) },
      { name: 'b', kind: 'refused-upload' as const, at: ago(29) },
      { name: 'c', kind: 'flagged-stored-file' as const, at: ago(400) },
    ];
    expect(quarantineToPurge(entries, NOW).map((e) => e.name)).toEqual(['a']);
    expect(quarantineToPurge(entries, NOW, 0).map((e) => e.name)).toEqual(['a', 'b']);
  });
});
