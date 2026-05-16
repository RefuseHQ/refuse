#!/usr/bin/env sh
# Entrypoint — make sure the data dir is writable, then exec the command.
# (Migrations run on boot inside the server itself; no explicit migrate step
# here.)

set -e

DATA_DIR=$(dirname "${REFUSE_DB_PATH:-/data/refuse.db}")
mkdir -p "$DATA_DIR"

exec "$@"
