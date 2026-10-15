# Keystone PM — one image for the web server, the job worker and the deploy-time migration (R-003). It replaces the single
# container of PR #1 (merged into main on 10 Oct 2026) and keeps its settings: port 3000, data on /data, the sibling apps' public
# URLs as build arguments. Runbook: docs/EXPLOITATION.md (French).
#   web server  : the default command (next start on port 3000)
#   migration   : npm run db:migrate     (PostgreSQL: before the new version starts; KEYSTONE_SEED explicit on an empty base)
#   job worker  : npm run worker         (PostgreSQL; with PGlite set KEYSTONE_JOBS=inprocess on the web server instead)
#   backups     : npm run backup / npm run restore -- … (R-004; pg_dump / pg_restore 16 are installed below)
# Data: /data (PGlite in /data/pg without DATABASE_URL, stored files in /data/files, antivirus quarantine in
# /data/quarantine). Mount a persistent volume there, or every deployment starts empty.
# Coolify: deploy/compose.yaml (PostgreSQL + migration + web server + worker from this one image).
FROM node:22-bookworm-slim

# PostgreSQL 16 client tools for the backups (Debian bookworm ships 15, which cannot dump a 16 server) and the time zone data
# TZ needs. curl is only used here and removed again: the health check below uses node's fetch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
# Development dependencies are kept on purpose: tsx runs db:migrate, the worker, backup and restore (a bundled worker for a
# slimmer image is an open question, R-006).
RUN npm ci --no-audit

COPY . .

# Public URLs of the sibling apps, inlined in the browser bundles by `next build`: the ONLY build arguments (Coolify:
# variables marked "Available at build time"). Left empty they are unset, so the links keep their localhost defaults.
# Nothing else may reach the build: with NODE_ENV=production the start-up check opens the database, so DATABASE_URL, the
# seed and the sign-in settings are runtime variables only. The database the build creates is removed.
ARG NEXT_PUBLIC_CODEX_URL
ARG NEXT_PUBLIC_CURSUS_URL
ARG NEXT_PUBLIC_VIGIE_URL
RUN if [ -z "$NEXT_PUBLIC_CODEX_URL" ]; then unset NEXT_PUBLIC_CODEX_URL; fi; \
    if [ -z "$NEXT_PUBLIC_CURSUS_URL" ]; then unset NEXT_PUBLIC_CURSUS_URL; fi; \
    if [ -z "$NEXT_PUBLIC_VIGIE_URL" ]; then unset NEXT_PUBLIC_VIGIE_URL; fi; \
    npm run build && rm -rf .data

ENV NODE_ENV=production \
    KEYSTONE_DATA_DIR=/data \
    TZ=Europe/Paris \
    LOG_FORMAT=json \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# A non-root user owns the data folder, the backup folder (a named volume mounted there takes this ownership) and Next's
# runtime cache; the code stays read-only to it.
RUN mkdir -p /data /backups && chown node:node /data /backups && chown -R node:node /app/.next
USER node

EXPOSE 3000
# GET /api/health: 200 when the database answers and has no pending migration (R-009). No curl or wget in the slim image.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
