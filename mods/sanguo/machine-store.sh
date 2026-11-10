#!/bin/sh
# One machine's own record of its projects and coding sessions: a log on its disk, which every Herdr
# window connected to it adds to and reads. It runs on that machine: the app sends this text there.
#   machine-store.sh size              how long the log is
#   machine-store.sh read <from>       its length on the first line, then what's after that byte
#   machine-store.sh add <lines>       adds to the end
#   machine-store.sh replace-begin|replace-add|replace-end <name> [lines]   a shorter log, swapped in whole
folder="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/sanguo"
log="$folder/machine-log.jsonl"
size() { if [ -f "$log" ]; then wc -c < "$log" | tr -d ' '; else echo 0; fi; }

case "$1" in
  size) size ;;
  read)
    to=$(size)
    echo "$to"
    [ "$to" -gt "$2" ] && tail -c +"$(($2 + 1))" "$log" | head -c "$(($to - $2))"
    ;;
  add) mkdir -p "$folder" && printf '%s\n' "$2" >> "$log" ;;
  replace-begin) mkdir -p "$folder" && : > "$log.$2" ;;
  replace-add) printf '%s\n' "$3" >> "$log.$2" ;;
  replace-end) mv -f "$log.$2" "$log" ;;
  *) echo "usage: machine-store.sh size|read|add|replace-begin|replace-add|replace-end" >&2; exit 2 ;;
esac
exit 0
