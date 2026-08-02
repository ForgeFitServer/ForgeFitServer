#!/bin/sh
# ForgeFitServer API entrypoint — chown the runtime-mounted /data volume
# (which may be root-owned from a previous root-container run) then drop
# privileges to the pre-created 'node' user before starting the server.
set -e
if [ "$(id -u)" = "0" ]; then
    mkdir -p /data
    chown -R node:node /data 2>/dev/null || true
    echo "[entrypoint] Dropping privileges to node user..."
    exec su-exec node node server.js "$@"
fi
exec node server.js "$@"
