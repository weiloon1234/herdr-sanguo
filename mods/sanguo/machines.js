// Moving between machines. A machine is a place you can be, with or without anything open
// there. Herdr always has some space selected, so the machine being shown is kept here, and the
// rest of the mod asks currentMachine() and shownSpace() instead of looking at the selection.
// Terminals keep running on each machine's own core, so switching only changes what's shown.
import { spaces, machines, agents, run, shared, setShared } from "herdr";

const LAST = "sanguo.last"; // machine -> the space last shown there
const SHOWN = "sanguo.machine"; // The machine being shown; "" is this computer.
export const machineKey = (m) => m ?? "";
const activeSpace = () => spaces().find((s) => s.active);

export const machineLabel = (m) => m ?? "本机";
export const machineNames = () => [null, ...machines().map((m) => m.name).filter(Boolean)];
export const machineLayout = (m) => machines().find((k) => k.name === m)?.layout;
export const spacesOn = (m) => spaces().filter((s) => (s.machine ?? null) === m);

// Every session on a machine, project by project, in the sidebar's order. A session's number is
// its place here: what its bubble and tab show, and its ⌘ key.
export const sessionsOn = (m) => spacesOn(m).flatMap((space) => (space.tabs ?? []).map((tab) => ({ tab, space })));
export const sessionNumbers = (m) => new Map(sessionsOn(m).map(({ tab }, i) => [tab.id, i + 1]));

export function currentMachine() {
  const stored = shared(SHOWN);
  if (typeof stored === "string") {
    const shown = stored || null;
    if (machineNames().includes(shown)) return shown;
  }
  return activeSpace()?.machine ?? null;
}

// The selected space, if it's on the machine being shown.
export function shownSpace() {
  const space = activeSpace();
  return space && (space.machine ?? null) === currentMachine() ? space : null;
}

function setShown(m) {
  if (shared(SHOWN) !== machineKey(m)) setShared(SHOWN, machineKey(m));
}

const lastSpaceOn = (m) => {
  const there = spacesOn(m);
  return there.find((s) => s.id === shared(LAST)?.[machineKey(m)]) ?? there[0];
};

export function needsYou(m) {
  const ids = new Set(spacesOn(m).map((s) => s.id));
  return agents().filter((a) => ids.has(a.space) && a.status === "blocked").length;
}

export function rememberSpace() {
  const space = activeSpace();
  if (!space) return;
  const last = shared(LAST) ?? {};
  if (last[machineKey(space.machine)] !== space.id) setShared(LAST, { ...last, [machineKey(space.machine)]: space.id });
}

// Keeps the shown machine and Herdr's selection agreeing. `memo` is the caller's, kept between calls.
export function syncShownMachine(memo) {
  const active = activeSpace(), previous = memo.active;
  memo.active = active?.id ?? null;
  if (previous === undefined) {
    if (active) setShown(active.machine ?? null); // Opens where Herdr left off.
    return;
  }
  // You went to a space on purpose (a click, a new session, an agent that needs you): follow it.
  // If yours just closed, Herdr picked one for you, which is no reason to leave this machine.
  const moved = active && active.id !== previous && (previous === null || spaces().some((s) => s.id === previous));
  if (moved) { setShown(active.machine ?? null); return; }
  const shown = currentMachine(), there = lastSpaceOn(shown);
  if (active && (active.machine ?? null) !== shown && there) run("space.select", { id: there.id });
}

export function goToMachine(m) {
  setShown(m);
  const target = lastSpaceOn(m);
  if (target) run("space.select", { id: target.id });
}

// To the next machine, and round again: 1, 2, 3, 1...
export function switchMachine() {
  const names = machineNames();
  if (names.length < 2) return;
  goToMachine(names[(names.indexOf(currentMachine()) + 1) % names.length]);
}

// Space keys stay on the machine being shown; Herdr's own number across all of them.
export function selectSpaceAt(n) {
  const space = spacesOn(currentMachine())[n - 1];
  if (space) run("space.select", { id: space.id });
}

export function cycleSpace(step) {
  const list = spacesOn(currentMachine());
  const at = list.findIndex((s) => s.active);
  if (list.length > 1) run("space.select", { id: list[(at + step + list.length) % list.length].id });
}
