#!/usr/bin/env bash
# Opt-in installer for the repository's Git hooks (SL-015). Local config only; changes no files.
#   scripts/install-hooks.sh            install
#   scripts/install-hooks.sh --remove   uninstall
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
current_hooks="$(git config --local --get core.hooksPath || true)"
current_tpl="$(git config --local --get commit.template || true)"

if [ "${1:-}" = "--remove" ]; then
  [ "$current_hooks" = ".githooks" ] && git config --local --unset core.hooksPath
  [ "$current_tpl" = ".gitmessage" ] && git config --local --unset commit.template
  echo "Hooks removed (core.hooksPath and commit.template unset where they pointed at this repo)."
  exit 0
fi

[ -d .githooks ] || { echo "install-hooks: .githooks not found" >&2; exit 1; }
if [ -n "$current_hooks" ] && [ "$current_hooks" != ".githooks" ]; then
  echo "install-hooks: core.hooksPath is already set to '$current_hooks'; not overriding it." >&2
  exit 1
fi
git config --local core.hooksPath .githooks
if [ -z "$current_tpl" ]; then git config --local commit.template .gitmessage; fi
echo "Installed: pre-commit (staged-file checks + affected test groups) and commit-msg (Conventional Commits)."
echo "Emergency bypass (logged to .git/hooks-bypass.log): SKIP_HOOKS=\"reason\" git commit ..."
echo "Remove with: pnpm hooks:uninstall"
