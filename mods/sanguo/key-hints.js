// A key as it's actually bound, so what the app says can't drift from keys.json.
import { keys, window } from "herdr";

// "⌘E", or null without a binding.
export function keyName(action) {
  const mac = window()?.platform === "macos";
  const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const b = keys().find((k) => k.action === action);
  const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
  return parts ? parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("") : null;
}

// "⌘E  words", or just the words without a binding.
export function keyHint(action, words) {
  const key = keyName(action);
  return key ? `${key}  ${words}` : words;
}
