#!/bin/sh
set -e

AUTH_FILE="/root/.config/obsidian-headless/auth.json"

# Auto-login if credentials provided and not yet authenticated
if [ -n "$OBSIDIAN_EMAIL" ] && [ ! -f "$AUTH_FILE" ]; then
  echo "[sync-entrypoint] Logging in to Obsidian account..."
  ob login --email "$OBSIDIAN_EMAIL" --password "$OBSIDIAN_PASSWORD"

  VAULT_NAME="${OBSIDIAN_VAULT_NAME:-default}"
  echo "[sync-entrypoint] Setting up vault sync: $VAULT_NAME"

  if [ -n "$OBSIDIAN_VAULT_PASSWORD" ]; then
    ob sync-setup --vault "$VAULT_NAME" --password "$OBSIDIAN_VAULT_PASSWORD"
  else
    ob sync-setup --vault "$VAULT_NAME"
  fi

  echo "[sync-entrypoint] Initial sync..."
  ob sync
  echo "[sync-entrypoint] Setup complete."
elif [ -f "$AUTH_FILE" ]; then
  echo "[sync-entrypoint] Using existing credentials from auth volume."
else
  echo "[sync-entrypoint] WARNING: No OBSIDIAN_EMAIL set and no existing credentials found."
  echo "[sync-entrypoint] Sync will not work. Set OBSIDIAN_EMAIL, OBSIDIAN_PASSWORD, OBSIDIAN_VAULT_NAME in .env"
  exit 1
fi

SYNC_INTERVAL="${OBSIDIAN_SYNC_INTERVAL:-30}"
echo "[sync-entrypoint] Starting periodic sync (every ${SYNC_INTERVAL}s)..."

while true; do
  rmdir /vault/.obsidian/.sync.lock 2>/dev/null || true
  ob sync 2>&1 || echo "[sync-entrypoint] Sync error, will retry..."
  sleep "$SYNC_INTERVAL"
done
