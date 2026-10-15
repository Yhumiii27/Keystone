// A fake clamd for the antivirus tests (R-175): speaks zINSTREAM / zPING on a random port of 127.0.0.1 (never one of the
// EPC2i ports, never clamd's 3310 — Keystone's smoke-test port on the Mac) or on a unix socket. Its behaviour is switched
// per test: scan (OK, or FOUND for the EICAR test string), error, size limit (answers and closes while the client is still
// writing), timeout (never answers), reset (drops the connection), silent close.
import fs from 'node:fs';
import net from 'node:net';

/** The EICAR antivirus test string, built at run time so this source file itself never carries the signature. */
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');
export const EICAR_SIGNATURE = 'Eicar-Test-Signature';

export type FakeClamdMode = 'scan' | 'error' | 'size-limit' | 'timeout' | 'reset' | 'silent-close';

const RESERVED = new Set([3000, 3100, 3110, 3200, 3210, 3217, 3310, 5173]);

export interface FakeClamd {
  host: '127.0.0.1';
  port: number;
  /** Unix socket path when started with one. */
  socket: string | null;
  mode: FakeClamdMode;
  /** INSTREAM bytes accepted in 'size-limit' mode. */
  sizeLimit: number;
  /** false: the EICAR string passes (IT allowed the signature — a false positive released). */
  detect: boolean;
  /** Streams scanned (byte counts), in order. */
  scanned: number[];
  close(): Promise<void>;
}

function handle(c: net.Socket, srv: FakeClamd): void {
  let buf = Buffer.alloc(0);
  let command: string | null = null;
  let stream = Buffer.alloc(0);
  let done = false;
  c.on('error', () => {});
  c.on('data', (b: Buffer) => {
    if (done) return;
    if (srv.mode === 'reset') {
      done = true;
      c.resetAndDestroy();
      return;
    }
    buf = Buffer.concat([buf, b]);
    if (command == null) {
      const nul = buf.indexOf(0);
      if (nul < 0) return;
      command = buf.subarray(0, nul).toString('utf8');
      buf = buf.subarray(nul + 1);
      if (command === 'zPING') {
        done = true;
        c.end('PONG\0');
        return;
      }
      if (command !== 'zINSTREAM') {
        done = true;
        c.end('UNKNOWN COMMAND\0');
        return;
      }
    }
    for (;;) {
      if (buf.length < 4) return;
      const len = buf.readUInt32BE(0);
      if (len === 0) {
        done = true;
        srv.scanned.push(stream.length);
        if (srv.mode === 'timeout') return;
        if (srv.mode === 'silent-close') return void c.end();
        if (srv.mode === 'error') return void c.end("stream: Can't allocate memory ERROR\0");
        return void c.end(srv.detect && stream.includes(EICAR) ? `stream: ${EICAR_SIGNATURE} FOUND\0` : 'stream: OK\0');
      }
      if (buf.length < 4 + len) return;
      stream = Buffer.concat([stream, buf.subarray(4, 4 + len)]);
      buf = buf.subarray(4 + len);
      if (srv.mode === 'size-limit' && stream.length > srv.sizeLimit) {
        done = true;
        c.write('INSTREAM size limit exceeded. ERROR\0', () => c.destroy());
        return;
      }
    }
  });
}

/** Starts the fake clamd; `socket` listens on a unix socket path instead of TCP. */
export async function startFakeClamd(opts: { socket?: string; mode?: FakeClamdMode } = {}): Promise<FakeClamd> {
  const sockets = new Set<net.Socket>();
  const srv: FakeClamd = {
    host: '127.0.0.1', port: 0, socket: opts.socket ?? null, mode: opts.mode ?? 'scan', sizeLimit: 1024, detect: true, scanned: [],
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      if (opts.socket) fs.rmSync(opts.socket, { force: true });
    },
  };
  const server = net.createServer((c) => {
    sockets.add(c);
    c.on('close', () => sockets.delete(c));
    handle(c, srv);
  });
  if (opts.socket) {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(opts.socket, () => resolve()));
    return srv;
  }
  for (;;) {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;
    if (!RESERVED.has(port)) {
      srv.port = port;
      return srv;
    }
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** Environment switching Keystone's antivirus to the fake (vi.stubEnv each pair). */
export const clamdEnv = (f: FakeClamd): Record<string, string> =>
  f.socket ? { KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_SOCKET: f.socket } : { KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_HOST: f.host, CLAMAV_PORT: String(f.port) };
