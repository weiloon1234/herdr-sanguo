#!/bin/sh
# A real Terminal window outside Herdr.
#   open-terminal.sh "" <folder>        on this computer, in that folder (default: home)
#   open-terminal.sh <target> <folder>  ssh'd into that machine, in that folder if it's there
target=$1
folder=$2

if [ -z "$target" ]; then
  exec open -a Terminal "${folder:-$HOME}"
fi

quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Terminal runs a .command file in a new window, and needs no permission to be scripted.
stem=$(mktemp "${TMPDIR:-/tmp}/sanguo-terminal.XXXXXX") || exit 1
script="$stem.command"
mv "$stem" "$script" || exit 1

there='exec "$SHELL" -l'
[ -n "$folder" ] && there="cd $(quote "$folder") 2>/dev/null; $there"

cat > "$script" <<EOF
#!/bin/sh
rm -f "\$0"
exec ssh -t $(quote "$target") $(quote "$there")
EOF
chmod 700 "$script"
exec open -a Terminal "$script"
