#!/bin/sh
# Which of these apps this Mac has, and a small copy of each one's icon to draw.
#   open-in-apps.sh <icon folder> <key>=<bundle name>...
# One line for each that's there: <key> <path to the app>, split by a tab.
icons=$1
shift
mkdir -p "$icons" || exit 1

icon_of() { # app output
  osascript -l JavaScript - "$1" "$2" >/dev/null 2>&1 <<'JS'
ObjC.import("AppKit");
function run(argv) {
  const side = 64, image = $.NSWorkspace.sharedWorkspace.iconForFile($(argv[0]));
  image.setSize($.NSMakeSize(side, side));
  image.lockFocus;
  const bitmap = $.NSBitmapImageRep.alloc.initWithFocusedViewRect($.NSMakeRect(0, 0, side, side));
  image.unlockFocus;
  bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).writeToFileAtomically($(argv[1]), true);
}
JS
}

for wanted in "$@"; do
  key=${wanted%%=*}
  bundle=${wanted#*=}
  for place in /System/Library/CoreServices /Applications "$HOME/Applications"; do
    app="$place/$bundle.app"
    [ -d "$app" ] || continue
    [ -s "$icons/$key.png" ] || icon_of "$app" "$icons/$key.png"
    printf '%s\t%s\n' "$key" "$app"
    break
  done
done
