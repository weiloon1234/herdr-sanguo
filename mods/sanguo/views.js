// The center of the window shows the machine's 校场, the open session, its project's Changes, or the
// machine's Notes, remembered per machine, so moving between machines comes back to whatever each one
// was showing.
import { spaces, panes, layout, machines, run, shared, setShared } from "herdr";
import { currentMachine, shownSpace, sessionsOn, machineKey } from "./machines.js";

const VIEWS = "sanguo.view"; // machine -> "field" | "session" | "changes" | "notes"
const CAME_FROM = "sanguo.changes-from"; // machine -> the view Changes or Notes was opened over
const FIELD = "field", SESSION = "session", CHANGES = "changes", NOTES = "notes";
const CHILD = { [FIELD]: "field", [SESSION]: "main", [CHANGES]: "changes", [NOTES]: "notes" }; // Child ids of the "center" stack.

export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function showNode(root, id, shown) {
  const node = findNode(root, id);
  if (node && Boolean(node.hidden) === shown) run(shown ? "layout.show" : "layout.hide", { id });
}

export const sidebarIsNarrow = () => (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const viewOn = (machine) => shared(VIEWS)?.[machineKey(machine)] || FIELD;
function setView(view, machine = currentMachine()) {
  if (viewOn(machine) !== view) setShared(VIEWS, { ...(shared(VIEWS) ?? {}), [machineKey(machine)]: view });
}

// What the center shows now. A machine with nothing open has only its 校场 and its notes to show.
function viewNow() {
  const view = viewOn(currentMachine());
  return shownSpace() || view === NOTES ? view : FIELD;
}

export const showingField = () => viewNow() === FIELD;
export const showingChanges = () => viewNow() === CHANGES;
export const showingNotes = () => viewNow() === NOTES;

// Changes and Notes open over the 校场 or a session, and close back to it. One opened over the
// other closes back to what that one was over.
function openOver(view) {
  const machine = currentMachine(), now = viewNow();
  if (now === view) return;
  if (now !== CHANGES && now !== NOTES) setShared(CAME_FROM, { ...(shared(CAME_FROM) ?? {}), [machineKey(machine)]: now });
  setView(view, machine);
}

function closeOver() {
  const machine = currentMachine();
  setView(shared(CAME_FROM)?.[machineKey(machine)] ?? FIELD, machine);
}

export function openChanges() {
  if (shownSpace()) openOver(CHANGES);
}

export const closeChanges = closeOver;
export const closeNotes = closeOver;
export const toggleNotes = () => (showingNotes() ? closeOver() : openOver(NOTES));

// Any session, which may be in another project than the selected one, or on another machine.
export function openSession(tabId) {
  const space = spaces().find((s) => s.tabs?.some((tab) => tab.id === tabId));
  setView(SESSION, space ? space.machine ?? null : currentMachine());
  if (space && !space.active) run("space.select", { id: space.id });
  run("tab.select", { id: tabId });
}

// The nth session on this machine, if it has one.
export function openSessionAt(n) {
  const session = sessionsOn(currentMachine())[n - 1];
  if (session) openSession(session.tab.id);
}

export function backToField() {
  setView(FIELD);
}

// A session is being started in this space, which may not be on the machine being shown yet.
export function showSessionsOf(spaceId) {
  setView(SESSION, spaces().find((s) => s.id === spaceId)?.machine ?? null);
}

// Makes the window match the wanted view. Reaching another session by any other route (the
// sidebar, a key, a notification) opens it. `memo` is the caller's, kept between calls.
export function syncView(memo) {
  const machine = currentMachine(), space = shownSpace();
  const tab = space?.tabs?.find((c) => c.active)?.id;
  let view = viewNow();
  const known = memo.known, loaded = memo.loaded;
  memo.known = new Set(spaces().map((s) => s.id));
  memo.loaded = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
  if (space) {
    // A project just made goes straight to its terminal: you made it to work in it. One that only
    // now arrived with its machine's list isn't new. If what you were on has just closed, Herdr
    // picked what's selected now, which is no reason to leave the 校场.
    const justMade = known && !known.has(space.id) && loaded?.has(machine);
    const movedTab = memo.space === space.id && memo.tab && tab && memo.tab !== tab && space.tabs.some((c) => c.id === memo.tab);
    const movedSpace = memo.machine === machine && memo.space && memo.space !== space.id && spaces().some((s) => s.id === memo.space);
    if ((justMade || movedTab || movedSpace) && view !== SESSION) {
      view = SESSION;
      setView(view, machine);
    }
  }
  const arrived = view === SESSION && (memo.view !== SESSION || memo.space !== space?.id || memo.tab !== tab);
  memo.space = space?.id; memo.tab = tab; memo.view = view; memo.machine = machine;

  const root = layout(), center = findNode(root, "center");
  if (center && center.active !== CHILD[view]) run("layout.select", { stack: "center", child: CHILD[view] });
  // Beside a session or its Changes the sidebar's list is that machine's sessions; on the 校场, its projects.
  const sessionOpen = view !== FIELD;
  showNode(root, sessionOpen ? "agents" : "spaces", true);
  showNode(root, sessionOpen ? "spaces" : "agents", false);
  // The field takes the keyboard while shown; a session gets it back when opened.
  if (arrived) {
    const here = panes().filter((p) => p.tab === tab);
    const pane = here.find((p) => p.focused) ?? here.find((p) => p.terminal) ?? here[0];
    if (pane) run("pane.focus", { pane: pane.pane });
  }
}
