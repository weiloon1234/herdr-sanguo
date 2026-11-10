#!/bin/sh
# What only a CLI knows about its own sessions. Read only. It runs on the project's machine: the app
# sends this text there, so it stands alone.
#   session-history.sh import <folder> <how many of each CLI>   a folder's past sessions
#   session-history.sh find <tool> <folder> <since> [pid]       the sessions a terminal may be running
#   session-history.sh open <tool> <id>                         the processes that have a session open
# One line each, split by tabs:
#   claude <id> <unix time> <its title record> <its first prompt record>
#   codex|opencode|agy <JSON array of { id, at, title }>
#   failed <tool>   its records are there, but couldn't be read
#   open <pid,parent pid,...>
usage() { echo "usage: session-history.sh import|find|open ..." >&2; exit 2; }
number() { case "$1" in ''|*[!0-9]*) usage ;; esac; }

rows() { # tool database query
  [ -f "$2" ] || return 0
  out=$(sqlite3 -readonly -json -cmd '.timeout 1000' "$2" "$3" 2>/dev/null) || { printf 'failed\t%s\n' "$1"; return 0; }
  printf '%s\t%s\n' "$1" "$(printf %s "$out" | tr -d '\n')"
}

title_in() { # The name you gave a session, or else the one it was given.
  LC_ALL=C grep -E '"type":"(custom|ai)-title"' > "$titles"
  title=$(LC_ALL=C grep -F '"type":"custom-title"' "$titles" | tail -1)
  [ -n "$title" ] || title=$(tail -1 "$titles")
  printf %s "$title" | head -c 600
}

# A file per session, in a folder named after the project's. Headless runs don't count.
claude_rows() { # folder limit since
  dir="$HOME/.claude/projects/$(printf %s "$1" | sed 's/[^A-Za-z0-9]/-/g')"
  [ -d "$dir" ] || return 0
  titles=$(mktemp "${TMPDIR:-/tmp}/sanguo-titles.XXXXXX") || return 0
  found=0
  for file in $(ls -t "$dir" | grep '\.jsonl$'); do
    case " $running " in *" ${file%.jsonl} "*) continue ;; esac
    path="$dir/$file"
    at=$(date -r "$path" +%s)
    [ "$at" -ge "$3" ] || break
    first=$(LC_ALL=C grep -m1 -F '"type":"user"' "$path" | head -c 3000)
    [ -n "$first" ] || continue
    case "$(LC_ALL=C grep -m1 -o '"entrypoint":"[^"]*"' "$path")" in *sdk*) continue ;; esac
    # It writes its title again as it goes, so the end of the file usually has it. These can be huge.
    title=$(tail -c 262144 "$path" | title_in)
    [ -n "$title" ] || title=$(title_in < "$path")
    printf 'claude\t%s\t%s\t%s\t%s\n' "${file%.jsonl}" "$at" "$title" "$first"
    found=$((found + 1))
    [ "$found" -ge "$2" ] && break
  done
  rm -f "$titles"
}

# Its own runs and helpers aren't sessions you'd go back to.
codex_rows() { # folder limit since
  label="coalesce(nullif(name, ''), nullif(title, ''), preview, '')"
  rows codex "$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -1)" \
    "select id, updated_at as at, substr($label, 1, 160) as title from threads
     where cwd = '$(sql_text "$1")' and updated_at >= $3 and archived = 0 and source <> 'exec' and source not like '{%' and $label <> ''
     order by updated_at desc limit $2"
}

opencode_rows() { # folder limit since
  rows opencode "$HOME/.local/share/opencode/opencode.db" \
    "select id, time_updated / 1000 as at, substr(coalesce(nullif(title, ''), slug, ''), 1, 160) as title from session_v2
     where directory = '$(sql_text "$1")' and time_updated >= $3 * 1000 and parent_id is null and time_archived is null
     order by time_updated desc limit $2"
}

# The same records in two places, depending on which version wrote them.
agy_rows() { # folder limit since
  at="cast(strftime('%s', substr(last_modified_time, 1, 19)) as integer)"
  uri=$(sql_text "$1" | sed 's/ /%20/g')
  for store in antigravity-cli antigravity; do
    rows agy "$HOME/.gemini/$store/conversation_summaries.db" \
      "select conversation_id as id, $at as at, substr(coalesce(nullif(title, ''), preview, ''), 1, 160) as title from conversation_summaries
       where instr(workspace_uris, '\"file://$uri\"') > 0 and $at >= $3 and step_count > 0 and nesting_depth = 0 and killed = 0
         and source in ('', 'CORTEX_TRAJECTORY_SOURCE_CLI')
       order by last_modified_time desc limit $2"
  done
}

sql_text() { printf %s "$1" | sed "s/'/''/g"; }

claude_record() { # pid: the session that process is on now
  grep -o '"sessionId":"[^"]*"' "$HOME/.claude/sessions/$1.json" 2>/dev/null | head -1 | cut -d'"' -f4
}

claude_running() { # The sessions open now, each with a process of its own.
  for file in "$HOME"/.claude/sessions/*.json; do
    [ -f "$file" ] || continue
    pid=${file##*/}
    pid=${pid%.json}
    kill -0 "$pid" 2>/dev/null && claude_record "$pid"
  done
}

chain() { # A process and its parents, to find the terminal it's running in.
  at=$1
  out=$1
  hops=0
  while [ "$hops" -lt 6 ]; do
    at=$(ps -o ppid= -p "$at" 2>/dev/null | tr -d ' ')
    case "$at" in ''|0|1) break ;; esac
    out="$out,$at"
    hops=$((hops + 1))
  done
  printf %s "$out"
}

case "$1" in
  import)
    number "$3"
    claude_rows "$2" "$3" 1
    codex_rows "$2" "$3" 1
    opencode_rows "$2" "$3" 1
    agy_rows "$2" "$3" 1
    ;;
  find)
    number "$4"
    case "$2" in
      claude)
        # Its own record says exactly, while it runs. Once it's gone, the newest in the folder that
        # isn't still open somewhere else.
        id=$(claude_record "$5")
        if [ -n "$id" ]; then
          printf 'claude\t%s\t%s\t\t\n' "$id" "$(date +%s)"
        else
          running=$(claude_running | tr '\n' ' ')
          claude_rows "$3" 5 "$4"
        fi
        ;;
      codex|opencode|agy) "$2_rows" "$3" 5 "$4" ;;
      *) usage ;;
    esac
    ;;
  open)
    if [ "$2" = claude ]; then
      for file in "$HOME"/.claude/sessions/*.json; do
        [ -f "$file" ] || continue
        pid=${file##*/}
        pid=${pid%.json}
        [ "$(claude_record "$pid")" = "$3" ] && kill -0 "$pid" 2>/dev/null && printf 'open\t%s\n' "$(chain "$pid")"
      done
    else
      # Only a resume shows on the command line. This script's own has the id too.
      ps -axww -o pid=,command= 2>/dev/null | grep -F -- "$3" | grep -v -e session-history -e 'grep ' | while read -r pid command; do
        printf 'open\t%s\n' "$(chain "$pid")"
      done
    fi
    ;;
  *) usage ;;
esac
exit 0
