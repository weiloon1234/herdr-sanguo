#!/bin/sh
# Editing another machine's file in an editor that runs on this one. The editor gets a private
# copy, and each save goes back to the machine. A save never replaces something the machine
# changed in the meantime: that's reported, and the edit stays here until you decide.
#
#   root                                print the folder of copies, to watch
#   open <editor> <machine> <path>      fetch the file and open it in the editor
#   sync                                send back whatever was saved
#   overwrite <machine> <path>          send this copy back, whatever the machine has now
#
# Prints one line per event: <event> TAB <machine> TAB <path> [TAB <detail>]
# File contents only ever travel through pipes and redirects, so bytes stay exact and nothing
# from inside a file reaches the caller.
umask 077

# Private to this user, not backed up by Time Machine, and not cleaned by the system behind our back.
CACHE=$(getconf DARWIN_USER_CACHE_DIR 2>/dev/null) || CACHE="${TMPDIR:-/tmp}/"
ROOT="${CACHE%/}/herdr-sanguo-remote"
COPIES="$ROOT/copies" # What the editor has open: copies/<machine>/<path>.
AGREED="$ROOT/agreed" # Checksum of the version both sides last had, laid out the same way.
KEPT="$ROOT/kept"     # Your edits, set aside when you ask for the machine's newer version.
LOCK="$ROOT/lock"
WORK="$ROOT/work.$$"
TIDY_AFTER_MINUTES=1440
MAX_BYTES=8000000 # `hc file write` takes at most 8 MB, so a bigger file could never be saved back.

say() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"; }

locate() { # machine path
  copy="$COPIES/$1$2"
  agreed="$AGREED/$1$2"
}

# Only one of us at a time: `sync` must never read a copy while `open` is replacing it.
lock() {
  find "$LOCK" -prune -mmin +15 -exec rmdir {} \; 2>/dev/null # Left behind by a crash.
  until mkdir "$LOCK" 2>/dev/null; do sleep 0.2; done
  trap 'rm -f "$WORK"; rmdir "$LOCK"' EXIT
}

sum_here() { cksum <"$1" | tr -s ' \t' ' '; }

# Prints "gone" if it isn't there. Fails if the machine can't be reached.
sum_there() {
  hc exec --on "$1" -- sh -c 'if [ -f "$1" ]; then cksum <"$1" | tr -s " \t" " "; else echo gone; fi' sum "$2" </dev/null 2>/dev/null
}

# `hc file write` is atomic on the machine and keeps the file's mode and symlinks.
send() { # machine path sum-of-WORK
  hc file write --on "$1" "$2" <"$WORK" >/dev/null 2>&1 || return 1
  [ "$(sum_there "$1" "$2")" = "$3" ] || return 1
  printf '%s\n' "$3" >"$agreed"
}

deliver() { # machine path sum-of-WORK
  if [ "$(wc -c <"$WORK")" -gt "$MAX_BYTES" ]; then say toolarge "$1" "$2" "$3"
  elif send "$1" "$2" "$3"; then say saved "$1" "$2" "$3"
  else say waiting "$1" "$2" "$3"; fi
}

fetch() { # machine path expected-sum
  hc exec --on "$1" --timeout 300 -- cat "$2" >"$WORK" </dev/null 2>/dev/null || return 1
  # A short read must never become the copy: saving it would cut the real file short too.
  [ "$(sum_here "$WORK")" = "$3" ] || return 1
  printf '%s\n' "$3" >"$agreed"
  mv -f "$WORK" "$copy"
}

open_file() { # editor machine path
  editor=$1 machine=$2 path=$3 beside=
  locate "$machine" "$path"
  lock
  there=$(sum_there "$machine" "$path")
  if [ $? -ne 0 ] || [ -z "$there" ]; then say failed "$machine" "$path" unreachable; return; fi
  if [ "$there" = gone ]; then say failed "$machine" "$path" missing; return; fi
  if [ "${there##* }" -gt "$MAX_BYTES" ]; then say failed "$machine" "$path" toolarge; return; fi
  mkdir -p "${copy%/*}" "${agreed%/*}" || { say failed "$machine" "$path" local; return; }

  need=yes
  if [ -f "$copy" ] && [ -f "$agreed" ]; then
    here=$(sum_here "$copy")
    was=$(cat "$agreed")
    if [ "$here" = "$there" ]; then
      printf '%s\n' "$there" >"$agreed"
      need=no
    elif [ "$here" != "$was" ]; then
      if [ "$there" = "$was" ]; then
        need=no # Only yours changed: `sync` sends it.
      else
        # Both changed, and asking for the file means you want the machine's: yours stays beside it.
        beside="$KEPT/$(date +%Y%m%d-%H%M%S)/$machine$path"
        mkdir -p "${beside%/*}" && mv -f "$copy" "$beside" || { say failed "$machine" "$path" local; return; }
      fi
    fi
  fi
  if [ "$need" = yes ] && ! fetch "$machine" "$path" "$there"; then say failed "$machine" "$path" copying; return; fi

  if ! open -a "$editor" "$copy" ${beside:+"$beside"} >/dev/null 2>&1; then say failed "$machine" "$path" editor; return; fi
  if [ -n "$beside" ]; then say kept "$machine" "$path" "$beside"; else say opened "$machine" "$path" ""; fi
}

sync_all() {
  [ -d "$COPIES" ] || return 0
  sleep 0.3 # Let an editor finish writing.
  lock
  find "$COPIES" -type f | while IFS= read -r file; do
    rel=${file#"$COPIES"/}
    machine=${rel%%/*}
    path=/${rel#*/}
    locate "$machine" "$path"
    [ -f "$agreed" ] || continue # An editor's temporary file, not one of ours.
    # Everything below works on this snapshot, so a save landing mid-way can't send half a file
    # and then look like a change on the machine.
    cp "$copy" "$WORK" 2>/dev/null || continue
    here=$(sum_here "$WORK")
    was=$(cat "$agreed")
    if [ "$here" = "$was" ]; then
      # Fully sent and left alone for a day: this copy has no reason to stay on this computer.
      # The checksum stays, so saving from a tab still open sends it, with the same safety check.
      [ -n "$(find "$copy" -mmin +"$TIDY_AFTER_MINUTES" 2>/dev/null)" ] && rm -f "$copy"
      continue
    fi
    there=$(sum_there "$machine" "$path")
    if [ $? -ne 0 ] || [ -z "$there" ]; then say waiting "$machine" "$path" "$here"; continue; fi
    if [ "$there" = "$here" ]; then
      printf '%s\n' "$here" >"$agreed"
    elif [ "$there" = "$was" ]; then
      deliver "$machine" "$path" "$here"
    else
      say conflict "$machine" "$path" "$here"
    fi
  done
}

overwrite() { # machine path
  locate "$1" "$2"
  lock
  cp "$copy" "$WORK" 2>/dev/null || { say failed "$1" "$2" local; return; }
  deliver "$1" "$2" "$(sum_here "$WORK")"
}

mkdir -p "$COPIES" "$AGREED" "$KEPT"
case "$1" in
  root) printf '%s\n' "$COPIES" ;;
  open) open_file "$2" "$3" "$4" ;;
  sync) sync_all ;;
  overwrite) overwrite "$2" "$3" ;;
  *) echo "usage: remote-edit.sh root | open <editor> <machine> <path> | sync | overwrite <machine> <path>" >&2; exit 2 ;;
esac
