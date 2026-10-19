#!/bin/sh
# Keystone PM container entrypoint. Started as root, it gives the data and backup folders to the non-root user `node`, then
# runs the command as `node`. A volume created by an older image that ran as root (PR #1) holds a PGlite database owned by
# root, which `node` cannot open ("PGlite failed to initialize properly"); a host folder mounted on /data is owned by root too.
# Started as another user (docker run --user, Kubernetes runAsUser) it changes nothing and runs the command as is.
set -e

if [ "$(id -u)" = "0" ]; then
  for dir in "${KEYSTONE_DATA_DIR:-/data}" "${KEYSTONE_BACKUP_DIR:-/backups}"; do
    mkdir -p "$dir"
    # Only when something there is not owned by node: a large folder already in order is not walked twice.
    if [ -n "$(find "$dir" ! -user node -print -quit)" ]; then
      echo "entrypoint: giving $dir to the user node" >&2
      chown -R node:node "$dir"
    fi
  done
  exec env HOME=/home/node setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
