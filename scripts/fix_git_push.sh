#!/usr/bin/env bash
# Fix "GH001: Large files detected" / "File ... exceeds GitHub's file size limit of 100 MB".
#
# Why `git rm --cached` + a new commit is NOT enough: the big file is still inside the earlier,
# unpushed commit, and GitHub rejects the push because of that commit. This script rewrites ONLY the
# commits that are not on the remote yet, removing the oversized files from them. Your commit
# messages and the files in your folder are kept. Commits already on GitHub are never touched.
#
# Usage (run inside your repository):
#   scripts/fix_git_push.sh --dry-run          # show what it found, change nothing
#   scripts/fix_git_push.sh                    # fix it
#   scripts/fix_git_push.sh --install-hook     # also block big files from future commits
#   scripts/fix_git_push.sh --cleanup          # after a successful push: delete backup + shrink .git
# Options: --threshold-mb N (default 50; GitHub warns at 50 and blocks at 100)
set -euo pipefail

THRESHOLD_MB=50; DRY=0; HOOK=0; CLEANUP=0
die() { echo "error: $*" >&2; exit 1; }
usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --threshold-mb) [ $# -ge 2 ] || die "--threshold-mb needs a number"; THRESHOLD_MB="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --install-hook) HOOK=1; shift ;;
    --cleanup) CLEANUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done
case "$THRESHOLD_MB" in ''|*[!0-9]*) die "--threshold-mb must be a whole number" ;; esac
LIMIT=$((THRESHOLD_MB * 1048576))

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run this inside a git repository"
cd "$(git rev-parse --show-toplevel)"
branch=$(git symbolic-ref --short -q HEAD) || die "detached HEAD: check out your branch first"
git rev-parse -q --verify HEAD >/dev/null || die "no commits yet; nothing to fix"

install_hook() {
  local hook; hook=$(git rev-parse --git-path hooks/pre-commit)
  mkdir -p "$(dirname "$hook")"
  if [ -e "$hook" ] && ! grep -q "fix_git_push large-file guard" "$hook"; then
    hook="$hook.large-files"
    echo "A pre-commit hook already exists; wrote ours to $hook (call it from your hook)."
  fi
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# fix_git_push large-file guard: refuse to commit files of ${THRESHOLD_MB} MB or more
limit=$LIMIT
bad=0
while IFS= read -r -d '' f; do
  size=\$(git cat-file -s ":\$f" 2>/dev/null || echo 0)
  if [ "\$size" -ge "\$limit" ]; then
    echo "pre-commit: '\$f' is \$((size / 1048576)) MB (limit ${THRESHOLD_MB} MB). Add it to .gitignore." >&2
    bad=1
  fi
done < <(git diff --cached --name-only --diff-filter=AM -z)
exit \$bad
EOF
  chmod +x "$hook"
  echo "Installed pre-commit guard: $hook"
}

if [ "$CLEANUP" = 1 ]; then
  for b in $(git for-each-ref --format='%(refname:short)' 'refs/heads/backup/before-large-file-fix-*'); do
    git branch -D "$b" >/dev/null && echo "Deleted $b"
  done
  git for-each-ref --format='%(refname)' refs/original | while read -r r; do git update-ref -d "$r"; done
  git reflog expire --expire=now --all
  git gc --prune=now --quiet
  echo "Cleaned up. .git is now $(du -sh .git | cut -f1)."
  exit 0
fi

# ---- 1. Which commits would GitHub receive? (those not on the remote yet) -------------------------
git fetch --quiet 2>/dev/null || echo "note: could not reach the remote; using the last known remote state."
base=""
if up=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then base="$up"
elif git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then base="origin/$branch"
fi
if [ -n "$base" ]; then range="$base..HEAD"; scope="commits not yet on $base"
else range="HEAD"; scope="all commits (this branch was never pushed)"; fi

# ---- 2. Find oversized blobs in that range ---------------------------------------------------------
big=$(git rev-list --objects "$range" | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
      | awk -v t="$LIMIT" '$1=="blob" && $3+0>=t')
if [ -z "$big" ]; then
  echo "No file of ${THRESHOLD_MB} MB or more in: $scope. Nothing to rewrite."
  echo "If the push still fails, read the error text: it names the offending file and commit."
  [ "$HOOK" = 1 ] && install_hook
  exit 0
fi
shas=$(echo "$big" | awk '{print $2}' | sort -u)
# Every path (in any of those commits) that points at one of the oversized blobs.
paths=$(for c in $(git rev-list "$range"); do git ls-tree -r -l -z "$c"; done | tr '\0' '\n' \
        | awk -F'\t' -v S="$shas" 'BEGIN{n=split(S,a,"\n"); for(i=1;i<=n;i++) s[a[i]]=1} {split($1,m," "); if (m[3] in s) print $2}' | sort -u)

echo "Oversized files found in: $scope"
echo "$big" | awk '{sz=$3; $1=$2=$3=""; printf "  %7.1f MB  %s\n", sz/1048576, substr($0,4)}' | sort -u
echo
if [ "$DRY" = 1 ]; then
  echo "Dry run: would remove these from the unpushed commits (history rewritten for: $range)."
  echo "The files themselves stay in your folder. Run again without --dry-run to fix."
  exit 0
fi

git diff --quiet && git diff --cached --quiet || die "you have uncommitted changes to tracked files. Commit or stash them first."

# ---- 3. Back up, rewrite, restore ------------------------------------------------------------------
backup="backup/before-large-file-fix-$(date +%Y%m%d-%H%M%S)"
git branch "$backup"
echo "Backup of your current commits: branch '$backup'  (do not 'git push --all')"

list=$(mktemp); trap 'rm -f "$list"' EXIT
echo "$paths" > "$list"
export FILTER_BRANCH_SQUELCH_WARNING=1
if [ -n "$base" ]; then spec=("$base..HEAD"); else spec=(HEAD); fi
GIT_LITERAL_PATHSPECS=1 git filter-branch -f --prune-empty \
  --index-filter "GIT_LITERAL_PATHSPECS=1 git rm --cached --ignore-unmatch -q --pathspec-from-file='$list'" \
  -- "${spec[@]}" >/dev/null 2>&1 || { echo "rewrite failed; your work is safe on '$backup'" >&2; exit 1; }

# filter-branch may delete files that are no longer tracked from the working folder. Put them back.
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if [ ! -e "$p" ] && git cat-file -e "$backup:$p" 2>/dev/null; then
    mkdir -p "$(dirname "$p")"; git show "$backup:$p" > "$p"; echo "Restored $p in your folder"
  fi
done < "$list"

# Keep them from being re-added.
added=0
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if ! git check-ignore -q -- "$p"; then
    [ "$added" = 0 ] && { printf '\n# Large files (GitHub rejects > 100 MB)\n' >> .gitignore; added=1; }
    echo "/$p" >> .gitignore
  fi
done < "$list"
if [ "$added" = 1 ]; then
  git add .gitignore && git commit -q -m "Ignore large files"
  echo "Added them to .gitignore"
fi

# ---- 4. Verify -------------------------------------------------------------------------------------
left=$(git rev-list --objects "$range" | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
       | awk -v t="$LIMIT" '$1=="blob" && $2+0>=t')
if [ -n "$left" ]; then
  echo "Still found oversized files:"; echo "$left"; die "not fully fixed. Your original work is on '$backup'."
fi
echo
echo "Fixed. No file of ${THRESHOLD_MB} MB or more remains in the commits to be pushed."
[ "$HOOK" = 1 ] && install_hook
if [ -n "$base" ]; then echo "Now run:  git push"; else echo "Now run:  git push -u origin $branch"; fi
echo "After it succeeds, run:  scripts/fix_git_push.sh --cleanup"
