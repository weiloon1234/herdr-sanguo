#!/bin/sh
# One machine's notes: a file each, in its Herdr folder. Every window connected to the machine reads and
# writes these same files. It runs on that machine: the app sends this text there.
#   notes.sh list                    each note's id and version, a line each
#   notes.sh read [id...]            each note (all without ids): \036, its id and version, a newline, its text
#   notes.sh write <id> <was> [text pieces...]
#                                    only over the version it was read at ("-": not written yet); prints
#                                    the new version, or "conflict <version now>"
#   notes.sh close <id>              into closed/, which keeps the newest 50
#   notes.sh reopen <id>             back out of closed/; prints its version
#   notes.sh drop <id>               gone (an empty note)
dir="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/sanguo/notes"
version() { if [ -f "$1" ]; then cksum < "$1" | awk '{ print $1 "-" $2 }'; else echo -; fi; }
valid() {
  case "$1" in n[0-9a-z]*) ;; *) return 1 ;; esac
  case "$1" in *[!0-9a-z]*) return 1 ;; esac
}
one() { # A copy first, so its version and its text are the same moment's.
  copy="$dir/.read.$$"
  cp "$dir/$1.md" "$copy" 2>/dev/null || return 0
  printf '\036%s %s\n' "$1" "$(version "$copy")"
  cat "$copy"
  rm -f "$copy"
}

case "$1" in
  list)
    for f in "$dir"/*.md; do
      [ -f "$f" ] || continue
      id=${f##*/}; id=${id%.md}
      valid "$id" && echo "$id $(version "$f")"
    done
    ;;
  read)
    shift
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
    id=$2 was=$3
    valid "$id" || { echo "Not a note: $id" >&2; exit 2; }
    shift 3
    mkdir -p "$dir" || exit 1
    now=$(version "$dir/$id.md")
    if [ "$now" != "$was" ]; then echo "conflict $now"; exit 0; fi
    tmp="$dir/.$id.$$"
    if printf '%s' "$@" > "$tmp" && mv -f "$tmp" "$dir/$id.md"; then version "$dir/$id.md"; else rm -f "$tmp"; exit 1; fi
    ;;
  close)
    valid "$2" || exit 2
    [ -f "$dir/$2.md" ] || exit 0
    mkdir -p "$dir/closed" && mv -f "$dir/$2.md" "$dir/closed/$2.md" || exit 1
    ls -t "$dir/closed" | tail -n +51 | while IFS= read -r old; do rm -f "$dir/closed/$old"; done
    ;;
  reopen)
    valid "$2" || exit 2
    [ -f "$dir/closed/$2.md" ] && mv -f "$dir/closed/$2.md" "$dir/$2.md"
    version "$dir/$2.md"
    ;;
  drop)
    valid "$2" || exit 2
    rm -f "$dir/$2.md"
    ;;
  *) echo "usage: notes.sh list|read|write|close|reopen|drop" >&2; exit 2 ;;
esac
exit 0
