#!/usr/bin/env bash
# Installs the repository's Git hooks (pre-commit, commit-msg, pre-push). Local Git config only; changes no files.
#   scripts/install-hooks.sh            install, and report what was done
#   scripts/install-hooks.sh --auto     what `pnpm install` runs (the root `prepare` script): same, but quiet, and it
#                                       NEVER fails an install (outside a repository, without .githooks, or when
#                                       another hooks path is configured it simply does nothing)
#   scripts/install-hooks.sh --remove   uninstall
# The hooks have no bypass switch; CI applies the same checks to every pull request.
set -uo pipefail

MODE="${1:-}"
quiet() { [ "$MODE" = "--auto" ]; }
say() { quiet || echo "$@"; }
# In --auto mode a problem is reported on stderr but never fails the install.
problem() { echo "install-hooks: $*" >&2; quiet && exit 0; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2> /dev/null)" || { quiet && exit 0; problem "not inside a Git repository"; }
cd "$ROOT" || exit 0
current_hooks="$(git config --local --get core.hooksPath || true)"
current_tpl="$(git config --local --get commit.template || true)"

if [ "$MODE" = "--remove" ]; then
  [ "$current_hooks" = ".githooks" ] && git config --local --unset core.hooksPath
  [ "$current_tpl" = ".gitmessage" ] && git config --local --unset commit.template
  echo "Hooks removed (core.hooksPath and commit.template unset where they pointed at this repository)."
  exit 0
fi

[ -d .githooks ] || { quiet && exit 0; problem ".githooks not found"; }
if [ -n "$current_hooks" ] && [ "$current_hooks" != ".githooks" ]; then
  problem "core.hooksPath is already set to '$current_hooks'; not overriding it, so this repository's hooks are NOT active."
fi
git config --local core.hooksPath .githooks
if [ -z "$current_tpl" ] && [ -f .gitmessage ]; then git config --local commit.template .gitmessage; fi
say "Installed Git hooks: pre-commit (staged-file safety, strict test rules, affected test groups), commit-msg (Conventional Commits) and pre-push (hygiene and tests for the whole outgoing range)."
say "There is no bypass switch. Remove with: pnpm hooks:uninstall"
exit 0
