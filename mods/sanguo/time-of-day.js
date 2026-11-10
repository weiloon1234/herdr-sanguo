// The 校场's day and night: only what's painted there. The pill asks for auto, light or dark, and
// auto goes by this computer's clock. The rest of the window always stays in Herdr's dark theme.
import { setShared, shared } from "herdr";

const MODE = "sanguo.appearance";
const NOW = "sanguo.time-of-day"; // Only there to redraw what's painted when auto crosses dawn or dusk.
export const MODES = { auto: "Auto", light: "Light", dark: "Dark" };
export const DAWN = 7, DUSK = 19; // Hours of the day.
const CHECK_MS = 30000;

export const modeNow = () => (shared(MODE) in MODES ? shared(MODE) : "auto");

function wanted() {
  const mode = modeNow();
  if (mode !== "auto") return mode;
  const hour = new Date().getHours();
  return hour >= DAWN && hour < DUSK ? "light" : "dark";
}

export const isNight = () => wanted() === "dark";

export function setTimeOfDayMode(mode) {
  if (mode in MODES) setShared(MODE, mode);
}

// One copy keeps this up: the status bar, which is always shown.
export function keepTimeOfDay(cx) {
  cx.timer.every(CHECK_MS, () => {
    const now = wanted();
    if (shared(NOW) !== now) setShared(NOW, now);
  });
}
