#!/usr/bin/env bash
# Stop-hook drift check for the dual-harness rule.
# Both .claude/commands/<name>.md and .windsurf/workflows/<name>.md must exist
# and have byte-identical bodies (YAML frontmatter may differ).
# Prints DRIFT: ... lines on stdout; never fails the hook (exit 0).
# See docs/using-agents.md §8 for the manual-check equivalent.

set -uo pipefail

# commands -> workflows: missing or divergent
for f in .claude/commands/*.md; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  wf=".windsurf/workflows/$name"
  if [ ! -f "$wf" ]; then
    echo "DRIFT: $wf missing"
    continue
  fi
  if ! diff <(sed '/^---$/,/^---$/d' "$f") <(sed '/^---$/,/^---$/d' "$wf") >/dev/null 2>&1; then
    echo "DRIFT: $name differs between .claude/commands and .windsurf/workflows"
  fi
done

# workflows -> commands: catch workflows without a matching command
for f in .windsurf/workflows/*.md; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  cmd=".claude/commands/$name"
  if [ ! -f "$cmd" ]; then
    echo "DRIFT: $cmd missing"
  fi
done

exit 0
