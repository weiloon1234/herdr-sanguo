// Animating the painted art: cutting between frames, and keeping soldiers out of step.
// Everything here runs natively once drawn; nothing asks for a redraw to animate.
import { div, image } from "gpui-kit";
import { window } from "herdr";
import { isNight } from "./time-of-day.js";
import { PAINT } from "./art/paint/sizes.js";

export const ART = "mods/sanguo/art/paint";

// Nothing moves unless someone's watching: with another app in front or the window hidden, motion
// only spends battery. Herdr redraws when this changes, so it all starts again on coming back.
export const moving = () => window()?.active !== false;

// Native loops only swing smoothly, but a swing far past 0..1 spends nearly all its time
// clamped at one end, so opposite swings cut between frames with almost no fade.
//
// A cut must never let both frames dip at once, or the figure blinks. So the frame coming in
// reaches full opacity at the cut, and the one going out only starts to fade from there: at
// every moment one of them is solid. `at` is where in the swing (0..1) the cut falls.
const HARD = 48;
const comeIn = (at, period) => ({ from: HARD * (1 / HARD - at), to: HARD * (1 + 1 / HARD - at), period, easing: "linear" });
const goOut = (at, period) => ({ from: HARD * (at + 1 / HARD), to: HARD * (at + 1 / HARD - 1), period, easing: "linear" });

// Two drawn frames in turn.
export const frames2 = (first, second, period) => (moving() ? [first.loop("opacity", goOut(0.5, period)), second.loop("opacity", comeIn(0.5, period))] : [first]);

// Three frames from one swing: the ends of it show the first and last, and the middle frame
// sits inside two nested fades, so it's only visible between them. It plays 1, 2, 3, 2, 1...
// Pass null for a frame with nothing in it.
export function frames3(first, middle, last, period) {
  if (!moving()) return first ? [first] : [];
  const layers = [];
  if (first) layers.push(first.loop("opacity", goOut(1 / 3, period)));
  if (middle) layers.push(div().absolute().inset_0().loop("opacity", comeIn(1 / 3, period))
    .child(div().absolute().inset_0().loop("opacity", goOut(2 / 3, period)).child(middle)));
  if (last) layers.push(last.loop("opacity", comeIn(2 / 3, period)));
  return layers;
}

// Something that's meant to blink: on for one half of the swing, gone for the other.
export const blinking = (element, period) => (moving() ? element.loop("opacity", comeIn(0.5, period)) : element);

// Text taking turns. While nothing moves it holds the first.
export const textFrames = (element, frames, period) => (moving() ? element.frames(frames, period) : element.child(frames[0]));

// A picture by name, by day or by night. Night's set has the same names and sizes.
export const artPath = (name) => `${ART}/${isNight() ? "night/" : ""}${name}.png`;

export function pic(name, x, y, s) {
  const [w, h] = PAINT[name];
  return image(artPath(name)).absolute().left(x).top(y).w(Math.round(w * s)).h(Math.round(h * s));
}

// Standing on a line, in unscaled stage units.
export const on = (name, x, foot, s) => pic(name, Math.round(x * s), Math.round((foot - PAINT[name][1]) * s), s);

// Breathing: he settles and rises a little, with his feet staying put.
export function breathing(name, x, foot, s, period) {
  const [w, h] = PAINT[name], W = Math.round(w * s), H = Math.round(h * s), breath = Math.max(1, Math.round(H * 0.022));
  return div().absolute().left(Math.round(x * s)).top(Math.round((foot - h) * s)).w(W).h(H)
    .child(image(artPath(name)).absolute().left(0).top(0).w(W).h(H)
      .when(moving(), (body) => body.loop("top", { from: 0, to: breath, period }).loop("height", { from: H, to: H - breath, period })));
}

// Resting: breathing, with a soft bob.
function resting(name, x, foot, s, address) {
  const [, h] = PAINT[name], top = Math.round((foot - h) * s), bob = Math.max(1, Math.round(h * s * 0.017));
  return breathing(name, x, foot, s, beat(address, 1800)).when(moving(), (body) => body.loop("top", { from: top, to: top - bob, period: beat(address, 2300) }));
}

// What each status acts out. `who`: a kingdom id, or "min" for a plain shell, who only stands by.
const ACTIONS = { working: { pose: "drill", ms: 900 }, blocked: { pose: "kneel", ms: 1300 }, done: { pose: "cheer", ms: 1000 } };
const actionOf = (status, who) => (who === "min" ? null : ACTIONS[status]);
export const actionBeat = (status, address) => beat(address, ACTIONS[status].ms);

// The art a soldier's pose starts on. `art`: "mini/" for the small files.
export function firstFrame(status, who, art = "") {
  const action = actionOf(status, who);
  return `${art}${who}-${action ? `${action.pose}-1` : status === "idle" ? "rest" : "awake"}`;
}

// A soldier acting out his status, standing on a line.
export function soldier(status, who, x, foot, s, address, art = "") {
  const action = actionOf(status, who);
  if (!action) return [resting(firstFrame(status, who, art), x, foot, s, address)];
  const frame = (n) => on(`${art}${who}-${action.pose}-${n}`, x, foot, s);
  return frames3(frame(1), frame(2), frame(3), actionBeat(status, address));
}

// Figures keep their own time, so a camp doesn't move in lockstep.
export function beat(address, base) {
  let sum = 0;
  for (const c of address) sum = (sum * 31 + c.charCodeAt(0)) % 997;
  return Math.round(base * (0.88 + (sum % 25) / 100));
}
