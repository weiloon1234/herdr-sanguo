#!/bin/sh
# One machine's notes: a file each, in its Herdr folder, under a scope: "general", or
# "project/<key>" for one project (its folder's path, everything but letters and digits as -).
# Every window connected to the machine reads and writes these same files. It runs on that machine:
# the app sends this text there.
#   notes.sh list <scope>                   each note's id and version, a line each
#   notes.sh read <scope> [id...]           each note (all without ids): \036, its id and version, a newline, its text
#   notes.sh write <scope> <id> <was> [text pieces...]
#                                           only over the version it was read at ("-": not written yet);
#                                           prints the new version, or "conflict <version now>"
#   notes.sh close <scope> <id>             into the scope's closed/, which keeps the newest 50
#   notes.sh reopen <scope> <id>            back out of closed/; prints its version
#   notes.sh drop <scope> <id>              gone (an empty note)
root="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/sanguo/notes"
version() { if [ -f "$1" ]; then cksum < "$1" | awk '{ print $1 "-" $2 }'; else echo -; fi; }
valid() {
  case "$1" in n[0-9a-z]*) ;; *) return 1 ;; esac
  case "$1" in *[!0-9a-z]*) return 1 ;; esac
}
scoped() { # Sets dir.
  case "$1" in
    general) ;;
    project/*) case "${1#project/}" in ""|*[!A-Za-z0-9._-]*) return 1 ;; esac ;;
    *) return 1 ;;
  esac
  dir="$root/$1"
}
# Notes from before there were scopes were all general. Moved there by whichever call comes first,
# and again if an older copy of the app writes one the old way.
settle() {
  [ -d "$root" ] || return 0
  for f in "$root"/n*.md; do
    [ -f "$f" ] || continue
    mkdir -p "$root/general" && mv -f "$f" "$root/general/"
  done
  if [ -d "$root/closed" ]; then
    mkdir -p "$root/general/closed" || return 0
    for f in "$root/closed"/*.md; do [ -f "$f" ] && mv -f "$f" "$root/general/closed/"; done
    rmdir "$root/closed" 2>/dev/null
  fi
  return 0
}
one() { # A copy first, so its version and its text are the same moment's.
  copy="$dir/.read.$$"
  cp "$dir/$1.md" "$copy" 2>/dev/null || return 0
  printf '\036%s %s\n' "$1" "$(version "$copy")"
  cat "$copy"
  rm -f "$copy"
}

mode=$1
[ $# -gt 0 ] && shift
settle
case "$mode" in list|read|write|close|reopen|drop) scoped "$1" || { echo "Not a notes scope: $1" >&2; exit 2; }; shift ;; esac

case "$mode" in
  list)
    for f in "$dir"/*.md; do
      [ -f "$f" ] || continue
      id=${f##*/}; id=${id%.md}
      valid "$id" && echo "$id $(version "$f")"
    done
    ;;
  read)
    if [ $# -eq 0 ]; then
      for f in "$dir"/*.md; do
        [ -f "$f" ] || continue
        id=${f##*/}; id=${id%.md}
        valid "$id" && one "$id"
      done
    else
      for id in "$@"; do valid "$id" && one "$id"; done
    fi
    ;;
  write)
    id=$1 was=$2
    valid "$id" || { echo "Not a note: $id" >&2; exit 2; }
    shift 2
    mkdir -p "$dir" || exit 1
    now=$(version "$dir/$id.md")
    if [ "$now" != "$was" ]; then echo "conflict $now"; exit 0; fi
    tmp="$dir/.$id.$$"
    if printf '%s' "$@" > "$tmp" && mv -f "$tmp" "$dir/$id.md"; then version "$dir/$id.md"; else rm -f "$tmp"; exit 1; fi
    ;;
  close)
    valid "$1" || exit 2
    [ -f "$dir/$1.md" ] || exit 0
    mkdir -p "$dir/closed" && mv -f "$dir/$1.md" "$dir/closed/$1.md" || exit 1
    ls -t "$dir/closed" | tail -n +51 | while IFS= read -r old; do rm -f "$dir/closed/$old"; done
    ;;
  reopen)
    valid "$1" || exit 2
    [ -f "$dir/closed/$1.md" ] && mv -f "$dir/closed/$1.md" "$dir/$1.md"
    version "$dir/$1.md"
    ;;
  drop)
    valid "$1" || exit 2
    rm -f "$dir/$1.md"
    ;;
  *) echo "usage: notes.sh list|read|write|close|reopen|drop <scope> ..." >&2; exit 2 ;;
esac
exit 0
