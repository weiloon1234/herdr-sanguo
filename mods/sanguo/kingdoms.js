// The 三国 reading of Herdr's data, in one place: which CLI serves which kingdom,
// and what each agent status is called. Every role reads it from here.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { textFrames } from "./actors.js";

export const BRUSH_FONT = "Baoli SC", DUTY_FONT = "Hannotate SC"; // Both ship with macOS.

// A kingdom gives a CLI its colors and helmet; its mark on flags and chips says which CLI it is.
export const KINGDOMS = {
  wu: { id: "wu", mark: "C", color: "#d9613f", match: /claude/ },
  wei: { id: "wei", mark: "X", color: "#5b8fc7", match: /codex/ }, // Not C: that's Claude's.
  shu: { id: "shu", mark: "A", color: "#5fa777", match: /agy|antigravity/ },
  qun: { id: "qun", color: "#c29f55", match: /$^/ }, // Everything else: OpenCode, pi... Marked by name.
};

// Takes an agent or a pane: both carry `program` and `app`.
export function kingdomOf({ program, app }) {
  const id = `${program?.key ?? ""} ${program?.name ?? ""} ${app ?? ""}`.toLowerCase();
  return Object.values(KINGDOMS).find((k) => k.match.test(id)) ?? KINGDOMS.qun;
}

// Takes an agent or a pane, like kingdomOf.
export const markOf = (holder) => kingdomOf(holder).mark ?? (holder.program?.name?.[0] ?? "?").toUpperCase();

// One of each mark, for a tab or camp with several of the same CLI.
export function uniqueMarks(holders) {
  const seen = new Set();
  return holders.filter((h) => { const mark = markOf(h); if (seen.has(mark)) return false; seen.add(mark); return true; });
}

// Herdr only calls a program an agent once it reports, so your CLIs are known by name too.
export const isFighter = (pane) => Boolean(pane.status || pane.program?.agent || kingdomOf(pane) !== KINGDOMS.qun);

export const DUTIES = {
  working: { word: "练兵", about: "Working" },
  blocked: { word: "候令", about: "Waiting for you" },
  done: { word: "报捷", about: "Finished" },
  idle: { word: "屯田", about: "Idle" },
};
// An agent at a startup prompt (trust this folder, update available) hasn't reported yet.
const NO_REPORT = { word: "未报", about: "Not reporting a status yet" };
export const NO_FIGHTER = { word: "闲置", about: "A plain terminal" };
export const dutyOf = (status) => (status === "none" ? NO_FIGHTER : DUTIES[status] ?? NO_REPORT);

// Status colors for dark ink on the 校场's parchment bubbles.
export const DUTY_INK = { working: "#2f6089", blocked: "#b3261e", done: "#2e7d46", idle: "#7a6a4f", none: "#7a6a4f" };

// A mark drawn, not typed: each is centered in the same 7x9 box, which type's side bearings never are.
function markGlyph(holder, color) {
  const mark = markOf(holder);
  return svg(`mods/sanguo/art/marks/${/^[A-Z]$/.test(mark) ? mark : "unknown"}.svg`).flex_none().w(7).h(9).text_color(color);
}

// The same mark softened, for painted cloth. Its box is 7.8 x 9.8 glyph cells.
export function softMark(holder, color, scale) {
  const mark = markOf(holder);
  return svg(`mods/sanguo/art/marks-soft/${/^[A-Z]$/.test(mark) ? mark : "unknown"}.svg`).flex_none().w(Math.round(7.8 * scale)).h(Math.round(9.8 * scale)).text_color(color);
}

// Odd, like the glyph, so the space around it divides into whole pixels.
const CHIP_SIZE = 15;

export function kingdomChip(holder) {
  return div().size(CHIP_SIZE).flex_none().flex().items_center().justify_center().rounded(2)
    .bg(kingdomOf(holder).color).child(markGlyph(holder, "#fff8e8"));
}

// The status as a word; only what needs you moves.
export function dutyWord(status, t) {
  const color = t[status] ?? t.dim;
  const word = div().flex_none().font_family(DUTY_FONT).text_size(12).line_height("15px").text_color(color).child(dutyOf(status).word);
  if (status !== "blocked") return word;
  // Needs you: a mark blinking through text frames, twice a second. A smooth pulse here would
  // redraw the whole window 30 times a second for as long as you're away.
  return h_flex().flex_none().gap(3).items_center().px(4).rounded(2).bg(color + "2e").child(word)
    .child(textFrames(div().flex_none().w(6).font_family(DUTY_FONT).text_size(12).line_height("15px").text_color(color), ["!", " "], 500));
}
