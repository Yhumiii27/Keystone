// Exclusive use of a PGlite data folder by a maintenance command — `npm run worker` with KEYSTONE_WORKER_PGLITE=exclusive
// (R-006) and `npm run backup` on PGlite (R-004): one lock file, <data dir>/worker.lock, keeps a second command out of the
// same database folder. A lock left by a process that no longer runs is taken over. The web server does not take it: the
// operator states with KEYSTONE_WORKER_PGLITE=exclusive that the server is stopped (only one process may open the folder).
import fs from 'node:fs';
import path from 'node:path';

/** Takes the folder's lock; returns its release. Throws when another live process holds it. */
export function lockPgliteFolder(dir: string): () => void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'worker.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      let alive = false;
      try {
        if (pid > 0) process.kill(pid, 0);
        alive = pid > 0;
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`Another maintenance command (pid ${pid}) uses ${dir}`);
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error(`Cannot lock ${dir}`);
}
