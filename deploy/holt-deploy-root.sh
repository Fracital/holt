#!/usr/bin/env bash
# The root half of holt's deploy. Installed by hand (never by CI) as /usr/local/sbin/holt-deploy-root,
# root-owned 0755, and allowed to the deploy user with exactly these arguments by /etc/sudoers.d/deploy:
#
#   deploy ALL=(root) NOPASSWD: /usr/local/sbin/holt-deploy-root prepare, /usr/local/sbin/holt-deploy-root activate
#
#   prepare    /opt/holt is root:deploy 1775; the code paths deploy ships are deploy's, config.js
#              stays root 600. Re-owns whatever root wrote there since (a service, a root npm ci).
#   activate   install the four unit files, restart holt-lab, holt-chat, holt and the bot, and prove
#              each is healthy; install holt's two OpenResty routes (sync_openresty). If the bot
#              does not log in, abulxt-discord is started again (Conflicts= stops holt-discord)
#              and the deploy fails.
#
# It takes no other input: the unit names, paths and health checks are fixed here, not by the caller.

set -euo pipefail
ROOT=/opt/holt
# What deploy/deploy.sh ships, plus what npm ci writes.
OWNED=(src dist loader chat-api-root lab deploy node_modules package.json package-lock.json vite.chat.config.ts schema.sql)
log() { logger -t holt-deploy -- "$*"; echo "holt-deploy: $*" >&2; }
# amph's OpenResty (/etc/openresty links here). holt owns these two conf.d files; abulxt's deploy
# owns the rest and keeps these as they are. The lock is shared with abulxt-deploy-root.
OR=/usr/local/openresty/nginx/conf
OR_FILES=(55-holt.conf 56-holtlab.conf)
OR_LOCK=/run/lock/openresty-config.lock

prepare() {
  shopt -s nullglob
  chown root:deploy "$ROOT"
  chmod 1775 "$ROOT"
  local secret
  for secret in "$ROOT"/config.js*; do
    chown -h root:root "$secret"
    chmod 600 "$secret"
  done
  local p
  for p in "${OWNED[@]}"; do
    [[ -e $ROOT/$p || -L $ROOT/$p ]] || continue
    # -P and -h: never follow a link, so one planted in the tree cannot hand deploy a file elsewhere.
    find -P "$ROOT/$p" \( ! -user deploy -o ! -group deploy \) -exec chown -h deploy:deploy {} +
  done
}

# Make holt's two conf.d files on amph match the repo: test the whole config with the new files,
# reload, check holt answers through OpenResty, and put the old files back if anything fails.
sync_openresty() {
  local f changed=0
  for f in "${OR_FILES[@]}"; do
    [[ -f deploy/$f && ! -L deploy/$f ]] || { log "deploy/$f is missing or a link"; exit 1; }
    cmp -s "deploy/$f" "$OR/conf.d/$f" || changed=1
  done
  if ((!changed)); then log 'openresty: holt routes already match the repo'; return 0; fi
  exec 8>"$OR_LOCK"
  flock -w 300 8
  local bak
  bak=$OR/.backup/holt-$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 700 "$bak"
  for f in "${OR_FILES[@]}"; do
    [[ -e $OR/conf.d/$f ]] && cp -p "$OR/conf.d/$f" "$bak/"
    install -m 0644 -o root -g root "deploy/$f" "$OR/conf.d/$f"
  done
  if openresty -q -t && systemctl reload openresty && sleep 2 &&
    curl -fsS -o /dev/null -m 10 -k --resolve holt.abstracteducation.loan:443:127.0.0.1 https://holt.abstracteducation.loan/healthz; then
    log "openresty: holt routes synced (backup $bak)"
    return 0
  fi
  log "openresty: holt routes failed; restoring $bak"
  for f in "${OR_FILES[@]}"; do
    if [[ -e $bak/$f ]]; then cp -p "$bak/$f" "$OR/conf.d/$f"; else rm -f "$OR/conf.d/$f"; fi
  done
  openresty -q -t && systemctl reload openresty
  exit 1
}

activate() {
  cd "$ROOT"
  [[ -f config.js ]] || { log 'config.js is missing; set up the host first (docs/DEPLOY.md)'; exit 1; }
  local unit
  for unit in holt holt-discord holt-chat holt-lab; do
    # deploy owns deploy/: a link there must not copy a root-only file into world-readable /etc.
    [[ -f deploy/$unit.service && ! -L deploy/$unit.service ]] || { log "deploy/$unit.service is missing or a link"; exit 1; }
    install -m 0644 -o root -g root "deploy/$unit.service" "/etc/systemd/system/$unit.service"
  done
  systemctl daemon-reload
  systemctl enable holt holt-discord holt-chat holt-lab >/dev/null 2>&1
  # The test partner (lab/server.mjs). Its data lives outside /opt/holt, so a deploy never touches it.
  install -d -m 700 /opt/holt-lab-data
  systemctl restart holt-lab

  # The chat API first: holt-service proxies to it, and a platform may already route chat traffic here.
  log 'activate: restart holt-chat'
  systemctl restart holt-chat
  for _ in $(seq 1 60); do
    [[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8831/api/discord/bridge/guilds) == 200 ]] && break
    sleep 0.5
  done
  if [[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8831/api/discord/bridge/guilds) != 200 ]]; then
    log 'holt-chat did not become healthy'; journalctl -u holt-chat -n 30 --no-pager >&2; exit 1
  fi

  log 'activate: restart holt'
  systemctl restart holt
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null http://127.0.0.1:8830/healthz && break
    sleep 0.5
  done
  curl -fsS -o /dev/null http://127.0.0.1:8830/healthz || { log 'holt did not become healthy'; journalctl -u holt -n 30 --no-pager >&2; exit 1; }

  # holt's OpenResty routes, after holt itself is up so the check through them can pass.
  sync_openresty

  # The bot exits cleanly when config.js has no discord.botToken; nothing to cut over then.
  if ! node --input-type=module -e "const c = (await import('file://$ROOT/config.js')).default; process.exit(c?.discord?.botToken ? 0 : 1)"; then
    log 'activate: no discord.botToken in config.js; bot not started'
    exit 0
  fi
  # abulxt's deploy re-enables its copy on every run until it stops shipping the unit; keep it from
  # racing holt-discord at boot.
  systemctl disable abulxt-discord >/dev/null 2>&1 || true

  log 'activate: restart holt-discord'
  local since
  since=$(date '+%Y-%m-%d %H:%M:%S')
  systemctl restart holt-discord
  for _ in $(seq 1 60); do
    if journalctl -u holt-discord --since "$since" --no-pager -o cat 2>/dev/null | grep -q 'logged in as'; then
      log 'holt-discord logged in'
      exit 0
    fi
    sleep 1
  done
  log 'holt-discord did not log in within 60s; handing the bot back to abulxt-discord'
  journalctl -u holt-discord --since "$since" --no-pager -o cat | tail -30 >&2
  if systemctl cat abulxt-discord >/dev/null 2>&1; then
    systemctl enable abulxt-discord >/dev/null 2>&1 || true
    systemctl start abulxt-discord
  fi
  exit 1
}

case ${1:-} in
  prepare) prepare ;;
  activate) activate ;;
  *) echo "usage: holt-deploy-root prepare|activate" >&2; exit 64 ;;
esac
