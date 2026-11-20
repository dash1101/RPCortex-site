#!/usr/bin/env bash
# Copy the RPCortex browser tool into this site.
#
#   tools/sync-vela-tool.sh [RPCortex checkout]      default: ../RPCortex-v2, beside this repository
#
# The tool is tools/web in the RPCortex (v2) repository: a static Web Serial page. This replaces
# vela-tool/ with a copy of it, whole, so a file removed there is removed here too, and writes
# vela-tool/SOURCE.json naming the commit it came from (tool.html shows it). Tests, notes and
# version-control files are left out. Then rebuild, look at tool.html and vela-tool/, and commit
# vela-tool/ on its own:
#
#   python3 site/build.py && python3 site/build.py --check
#   git add vela-tool && git commit -m "Tool: <what changed>"
set -euo pipefail

site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="${1:-$site/../RPCortex-v2}"
src="$repo/tools/web"
dest="$site/vela-tool"

if [ ! -d "$src" ]; then
  echo "No tools/web in $repo. Pass the path of an RPCortex (v2) checkout." >&2
  exit 1
fi
if [ ! -f "$src/index.html" ]; then
  echo "$src has no index.html, so there is no page to publish yet." >&2
  exit 1
fi

commit="$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo unknown)"
date="$(git -C "$repo" log -1 --format=%cs 2>/dev/null || echo "")"
dirty=false
if [ -n "$(git -C "$repo" status --porcelain -- tools/web 2>/dev/null)" ]; then
  dirty=true
  echo "Note: tools/web has uncommitted changes; the copy includes them and SOURCE.json says so." >&2
fi

stage="$site/.vela-tool.new"
rm -rf "$stage"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage"
( cd "$src" && tar -cf - \
    --exclude='.git' --exclude='.gitignore' --exclude='CLAUDE*' --exclude='AGENTS*' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='node_modules' --exclude='.DS_Store' \
    --exclude='./test' --exclude='./tests' . ) | ( cd "$stage" && tar -xf - )

cat > "$stage/SOURCE.json" <<JSON
{
  "note": "Copied from tools/web in the RPCortex repository by tools/sync-vela-tool.sh. Change it there, not here.",
  "commit": "$commit",
  "date": "$date",
  "dirty": $dirty
}
JSON

rm -rf "$dest"
mv "$stage" "$dest"
trap - EXIT

count="$(find "$dest" -type f | wc -l | tr -d ' ')"
echo "vela-tool/: $count files from ${commit:0:8}${date:+ ($date)}$([ "$dirty" = true ] && echo ', with uncommitted changes')"
echo "Next: python3 site/build.py && python3 site/build.py --check, look at tool.html, then commit vela-tool/."
