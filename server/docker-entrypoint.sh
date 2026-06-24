#!/bin/sh
set -e

# Apply any pending DB migrations before the API starts. Forward-only and safe
# to run on every boot (no-op when the DB is already up to date).
echo "→ prisma migrate deploy"
npx prisma migrate deploy

# First run only: seed venues/tables/menu/staff with
#   docker compose exec server npm run prisma:seed
# (kept out of the boot path so it can't overwrite live menu/admin edits).

echo "→ starting API"
exec node dist/src/index.js