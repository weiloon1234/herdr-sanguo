// Saved projects. Herdr's spaces only exist while they have a session, so this list is what
// outlives them: a project is a name and a folder on a machine, and its space comes and goes.
import { shared, setShared, spaces, openOverlay, exec, notify, run } from "herdr";
import { machineKey, machineLabel, machineLayout, machineNames } from "./machines.js";
import { addToStore, applyToProjects } from "./machine-store.js";
import { showSessionsOf } from "./views.js";

// machine -> [{ name, folder, tool }]. Only this window's copy, for drawing at once and for machines
// that are offline: each machine's own log is what counts (machine-store.js).
const PROJECTS = "sanguo.projects-by-machine";
export const KNOWN_AGENTS = "new-menu.agents"; // Herdr's own cache of each machine's agents.
export const DIALOG_WIDTH = 540;
export const SMALL_DIALOG_WIDTH = 400;

export const projectId = (machine, folder) => `${machine ?? ""}:${folder}`;
export const projects = () => machineNames().flatMap((machine) => (shared(PROJECTS)?.[machineKey(machine)] ?? [])
  .map((project) => ({ ...project, machine, id: projectId(machine, project.folder) })));

// What the machine's log says now.
export function setProjectsOf(machine, list) {
  const all = shared(PROJECTS) ?? {}, key = machineKey(machine);
  if (JSON.stringify(all[key] ?? []) !== JSON.stringify(list)) setShared(PROJECTS, { ...all, [key]: list });
}

// Shows at once here, and goes to the machine it's about. Settles on whether it got there; if it
// didn't, the list goes back. A dialog waits for it before closing: closing ends the dialog's code,
// and a write still on its way ends with it.
function changeProjects(machine, record) {
  const key = machineKey(machine), before = shared(PROJECTS)?.[key] ?? [], after = applyToProjects(before, record);
  setProjectsOf(machine, after);
  return addToStore(machine, [record]).then(() => true, (e) => {
    if (JSON.stringify(shared(PROJECTS)?.[key] ?? []) === JSON.stringify(after)) setProjectsOf(machine, before);
    notify({ title: `Couldn't save this on ${machineLabel(machine)}`, body: String(e.message ?? e), level: "error" });
    return false;
  });
}

export function saveProject({ name, folder, machine, tool }) {
  return changeProjects(machine ?? null, { project: { name, folder, ...(tool ? { tool } : {}) } });
}

export async function forgetProject(id) {
  const project = projects().find((p) => p.id === id);
  return project ? changeProjects(project.machine, { forget: project.folder }) : true;
}

// Puts a project where another one on its machine is. It lands after a project below it, and before one above it.
export function moveProject(id, onto) {
  const all = projects(), project = all.find((p) => p.id === id), target = all.find((p) => p.id === onto);
  if (!project || !target || project === target || project.machine !== target.machine) return;
  const list = all.filter((p) => p.machine === project.machine).map((p) => p.folder), from = list.indexOf(project.folder), to = list.indexOf(target.folder);
  list.splice(to, 0, ...list.splice(from, 1));
  changeProjects(project.machine, { order: list });
}

export async function rememberTool(id, tool) {
  const project = projects().find((p) => p.id === id);
  return project && project.tool !== tool ? saveProject({ ...project, tool }) : true;
}

// Its space, if it has one now. `space` is only set on an unsaved space offered as a project.
export function liveSpaceOf(project) {
  if (project.space) return spaces().find((s) => s.id === project.space);
  return spaces().find((s) => (s.machine ?? null) === (project.machine ?? null) && s.folder === project.folder);
}

// Saved projects with no space right now: the sidebar lists them under the live ones.
export const dormantProjects = (machine) =>
  projects().filter((p) => (p.machine ?? null) === machine && !liveSpaceOf(p));

// What New Session offers: saved projects, and any open space that isn't one of them.
export function pickableProjects() {
  const saved = projects();
  const claimed = new Set(saved.map((p) => liveSpaceOf(p)?.id).filter(Boolean));
  const loose = spaces().filter((s) => !claimed.has(s.id))
    .map((s) => ({ id: `space:${s.id}`, name: s.name, folder: s.folder, machine: s.machine ?? null, space: s.id }));
  return [...saved, ...loose];
}

// The project a space belongs to, saved or not.
export const projectOfSpace = (id) => pickableProjects().find((p) => liveSpaceOf(p)?.id === id);

// The folder as that machine knows it (~ expanded, no trailing slash); null if it isn't there.
const EXPAND_HOME = 'case "$1" in "~"|"~/"*) set -- "$HOME${1#\\~}";; esac; ';

export async function resolveFolder(path, machine) {
  const r = await exec("sh", ["-c", `${EXPAND_HOME}cd -- "$1" 2>/dev/null && pwd`, "sh", path], { on: machine });
  return r.code === 0 ? r.stdout.trim() : null;
}

// Where a folder really is on that machine and the folders inside it, each saying if it's a git repo.
// With no such folder, the home folder. Hidden ones stay hidden, as in a system's picker.
const LIST_FOLDERS = 'cd -- "${1:-$HOME}" 2>/dev/null || cd "$HOME" || exit 1; pwd; for d in */; do [ -d "$d" ] || continue; if [ -e "$d.git" ]; then git=1; else git=0; fi; printf "%s\\t%s\\n" "$git" "${d%/}"; done';

export async function listFolders(path, machine) {
  const r = await exec("sh", ["-c", EXPAND_HOME + LIST_FOLDERS, "sh", path], { on: machine });
  if (r.code !== 0) throw new Error(`Couldn't read folders on ${machineLabel(machine)}.`);
  const [at, ...lines] = r.stdout.split("\n").filter(Boolean);
  return { at, folders: lines.map((line) => ({ git: line[0] === "1", name: line.slice(2) })) };
}

// Can a session start in this project now? Throws saying why not.
export async function checkProject(project) {
  const machine = project.machine ?? null;
  if (machine && machineLayout(machine) === "unavailable") throw new Error(`${machineLabel(machine)} is unavailable. Check that it's awake.`);
  if (!liveSpaceOf(project) && !(await resolveFolder(project.folder, machine))) throw new Error(`${project.folder} isn't there on ${machineLabel(machine)}.`);
}

// Starts a session in a project: a new tab in its open space, or a new space. Without argv, a shell.
export function startSession(project, argv) {
  const live = liveSpaceOf(project), program = argv ? { argv } : {};
  if (live) {
    showSessionsOf(live.id);
    run("space.select", { id: live.id });
    run("tab.new", { space: live.id, ...(project.folder ? { folder: project.folder } : {}), ...program });
  } else run("space.new", { name: project.name, folder: project.folder, machine: project.machine ?? "", ...program });
}

export async function renameProject(project, name) {
  const saved = projects().some((p) => p.id === project.id) ? saveProject({ ...project, name }) : true;
  const live = liveSpaceOf(project);
  if (live) run("space.rename", { id: live.id, name });
  return saved;
}

export const openRenameProject = (project) => openOverlay({ mod: "sanguo", kind: "dialog", width: SMALL_DIALOG_WIDTH, props: { role: "rename-project", project } });
export const openDeleteProject = (project) => openOverlay({ mod: "sanguo", kind: "dialog", width: SMALL_DIALOG_WIDTH, props: { role: "delete-project", project } });

export function openNewProject({ machine } = {}) {
  openOverlay({ mod: "sanguo", kind: "dialog", width: DIALOG_WIDTH, props: { role: "new-project", machine } });
}

// `machine`: offer that machine's projects (null: this computer). With none, make one first.
export function openNewSession({ project, machine } = {}) {
  const offered = pickableProjects();
  const none = machine === undefined ? !offered.length : !offered.some((p) => (p.machine ?? null) === machine);
  if (!project && none) { openNewProject({ machine }); return; }
  openOverlay({ mod: "sanguo", kind: "dialog", width: DIALOG_WIDTH, props: { role: "new-session", project, machine } });
}
