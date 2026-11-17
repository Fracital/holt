#!/usr/bin/env bash
# holt deploy gate: the forced command for holt's CI key on amph. Installed by hand (never by CI) as
# /usr/local/sbin/holt-deploy-gate. The key logs in as the unprivileged `deploy` user, restricted in
# /home/deploy/.ssh/authorized_keys (owned by root, so deploy cannot change its own restrictions):
#
#   restrict,command="/usr/local/sbin/holt-deploy-gate" ssh-ed25519 AAAA… holt-ci@y9x/holt
#
# The key can do exactly two things, and nothing else (no shell, no pty, no forwarding):
#
#   rsync into /opt/holt   `rsync --server` receiving only (never --sender), destination under
#                          /opt/holt, only the flags deploy/deploy.sh sends. Runs as deploy.
#   activate               npm ci as deploy, then `sudo holt-deploy-root activate` installs the unit
#                          files, restarts holt and the bot, and proves both are healthy.
#
# deploy owns the code under /opt/holt and nothing else there: /opt/holt is root:deploy 1775, so
# deploy can add and replace its own files but cannot rename or replace root's (config.js, which is
# root 600 and unreadable to deploy). The only root it reaches is the two fixed sudo commands in
# /etc/sudoers.d/deploy (deploy/holt-deploy-root.sh). The services still run as root, so a deploy
# still runs repo code as root; giving each service its own user is the next step.
#
# Started as root (an old root key line, during the cutover) it drops to deploy first.

set -euo pipefail
if (( EUID == 0 )); then
  exec runuser -u deploy -- "$0" "$@"
fi
ROOT=/opt/holt
HELPER=/usr/local/sbin/holt-deploy-root
log() { logger -t holt-deploy -- "$*"; echo "holt-deploy: $*" >&2; }

cmd=${SSH_ORIGINAL_COMMAND:-}
read -r -a args <<< "$cmd"

deny() {
  log "refused: ${cmd:0:200}"
  exit 1
}

if [[ ${args[0]:-} == rsync ]]; then
  (( ${#args[@]} >= 4 )) || deny
  [[ ${args[1]} == --server ]] || deny
  dest=${args[-1]}
  [[ ${args[-2]} == . ]] || deny
  # Exactly the destinations deploy.sh writes. --delete only where the whole directory is ours, never
  # /opt/holt itself (config.js, node_modules).
  case $dest in
    /opt/holt/src/ | /opt/holt/dist/ | /opt/holt/loader/ | /opt/holt/chat-api-root/ | /opt/holt/lab/) may_delete=1 ;;
    /opt/holt/ | /opt/holt/deploy/) may_delete=0 ;;
    *) deny ;;
  esac
  for arg in "${args[@]:2:${#args[@]}-4}"; do
    # The option letters `rsync -az` sends (rlptgoD + z), then `e.` and the protocol capability
    # letters. Anything else (-K follows directory symlinks, -R, --log-file=, ...) is refused.
    if [[ $arg =~ ^-[rlptgoDz]+e\.[A-Za-z]+$ ]]; then continue; fi
    if [[ $arg == --delete && $may_delete == 1 ]]; then continue; fi
    deny
  done
  # Take back anything root wrote since the last deploy (a service, a root npm ci) before writing.
  sudo -n "$HELPER" prepare
  mkdir -p "$dest"
  # No symlink anywhere on the way: a link planted earlier must not carry a later write elsewhere.
  [[ $(realpath -e "$dest")/ == "$dest" ]] || deny
  log "rsync -> $dest"
  exec "${args[@]}"
fi

if [[ $cmd == activate ]]; then
  cd "$ROOT"
  [[ -f config.js ]] || { log 'config.js is missing; set up the host first (docs/DEPLOY.md)'; exit 1; }
  sudo -n "$HELPER" prepare
  log 'activate: npm ci'
  npm ci --no-audit --no-fund --loglevel=error
  exec sudo -n "$HELPER" activate
fi

deny
