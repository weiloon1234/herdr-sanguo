// A project's coding sessions, under its row in the sidebar, from our own record (session-log.js).
// A click goes back to a session: to its tab if it's open, otherwise resumed in a new one. The
// panel is also where a project is renamed or deleted, behind its ⋯, away from a row that's easy
// to misclick.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { notify, setShared, shared } from "herdr";
import { kingdomChip } from "./kingdoms.js";
import { currentMachine, machineKey, machineLabel } from "./machines.js";
import { openSession } from "./views.js";
import { KNOWN_AGENTS, checkProject, liveSpaceOf, openDeleteProject, openRenameProject, pickableProjects, projects, startSession } from "./projects.js";
import { plural } from "./sessions.js";
import { SessionLog, TOOLS, tabFinder, whereRunning } from "./session-log.js";

const OPEN = "sanguo.history-open"; // The ids of the projects showing theirs.
const PAGE = 10, CHECK_MS = 1000, RESUME_GAP_MS = 4000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROW_H = 28, MORE_H = 28, LIST_ROWS = 8; // So one long history can't push the other projects away; the count above says how many.

const holderOf = (tool) => ({ program: { key: tool.key, name: tool.name }, app: tool.app });
const isOpen = (id) => (shared(OPEN) ?? []).includes(id);

export function toggleHistory(id) {
  const known = new Set(pickableProjects().map((p) => p.id));
  const list = (shared(OPEN) ?? []).filter((other) => known.has(other));
  setShared(OPEN, list.includes(id) ? list.filter((other) => other !== id) : [...list, id]);
}

function ago(at) {
  const minutes = Math.floor((Date.now() / 1000 - at) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 14) return `${Math.floor(minutes / (60 * 24))}d ago`;
  if (minutes < 60 * 24 * 7 * 12) return `${Math.floor(minutes / (60 * 24 * 7))}w ago`;
  return new Date(at * 1000).toISOString().slice(0, 10);
}

// The same, short enough for the end of a row: "20m", "4d", then the date.
function shortAgo(at) {
  const minutes = Math.floor((Date.now() / 1000 - at) / 60), when = new Date(at * 1000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 14) return `${Math.floor(minutes / (60 * 24))}d`;
  if (minutes < 60 * 24 * 7 * 12) return `${Math.floor(minutes / (60 * 24 * 7))}w`;
  return when.getFullYear() === new Date().getFullYear() ? `${MONTHS[when.getMonth()]} ${when.getDate()}` : String(when.getFullYear());
}

// For a session that never gave itself a title.
function plainName(session) {
  const when = new Date(session.started * 1000), two = (n) => String(n).padStart(2, "0");
  return `${TOOLS[session.tool].name} · ${MONTHS[when.getMonth()]} ${when.getDate()}, ${two(when.getHours())}:${two(when.getMinutes())}`;
}

// Claude Code resumes a session only from the folder it began in, which can be below the project's.
const inFolder = (folder, argv) => ["sh", "-c", 'cd -- "$0" 2>/dev/null; exec "$@"', folder, ...argv];

// What an import found. If you didn't ask for it, only a CLI that couldn't be read is worth a word:
// the panel says when the whole machine can't be, and tries again by itself.
function sayImported(project, found, asked) {
  const where = machineLabel(project.machine ?? null);
  if (!found) {
    if (asked) notify({ title: `Couldn't read sessions on ${where}`, level: "error" });
    return;
  }
  const count = found.added ? plural(found.added, "new session") : "No new sessions";
  if (found.failed.length) {
    const names = found.failed.map((tool) => TOOLS[tool].name).join(", ");
    notify({ title: `Couldn't read ${names} on ${where}`, body: `${count}. Re-import to try again.`, level: "warning" });
  } else if (asked) notify({ title: count, body: project.name });
}

export const SESSION_ROW_H = ROW_H;

// One past session on one line: its CLI's mark (which says which CLI), its title, and when it was
// last used, or "open" while it is.
export function sessionRow(session, open, t, onPress) {
  const tool = TOOLS[session.tool], title = session.title || plainName(session);
  return h_flex().id(`session-${session.tool}-${session.id}`).h(ROW_H).flex_none().px(5).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip(`${title} · ${tool.name} · ${open ? "Open now. Click to go to it" : `${ago(session.at)}. Click to resume`}`)
    .on_click(onPress)
    .child(kingdomChip(holderOf(tool)))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(title))
    .child(open
      ? h_flex().flex_none().gap(4).items_center().text_size(11).text_color(t.working).child(div().size(6).flex_none().rounded(3).bg(t.working)).child("open")
      : div().flex_none().text_size(11).text_color(t.dim).child(shortAgo(session.at)));
}

// Back to a session: to its tab if it's open, otherwise resumed in a new one.
export async function resumeSession(project, session) {
  const tool = TOOLS[session.tool], machine = project.machine ?? null, tab = tabFinder(machine)(session);
  if (tab) { openSession(tab); return; }
  try {
    const running = await whereRunning(session, machine);
    if (running?.tab) { openSession(running.tab); return; }
    if (running) { notify({ title: "This session is already open", body: "It's running outside Herdr.", level: "warning" }); return; }
    const agent = shared(KNOWN_AGENTS)?.[machineKey(machine)]?.find((a) => a.key === tool.key);
    if (agent?.installed === false) { notify({ title: `${tool.name} isn't installed on ${machineLabel(machine)}`, level: "error" }); return; }
    await checkProject(project);
    const argv = [...(agent?.run ?? [tool.bin]), ...tool.resume(session.id)];
    startSession(project, session.cwd && session.cwd !== project.folder ? inFolder(session.cwd, argv) : argv);
  } catch (e) {
    notify({ title: "Cannot open this session", body: String(e.message ?? e), level: "error" });
  }
}

export class SessionHistory {
  log = new SessionLog();
  limits = new Map(); // Project id -> how many it's showing.
  pressedAt = new Map(); // Session -> when it was last asked for: a second click mustn't open another before the first shows.
  shownVersion = 0;
  checkedAt = 0;

  // Called often, whether or not the sidebar's list is showing.
  tick(cx) {
    this.log.tick(cx);
    const now = Date.now(), wanted = shared(OPEN) ?? [];
    if (wanted.length && now - this.checkedAt >= CHECK_MS) {
      this.checkedAt = now;
      const machine = currentMachine();
      for (const project of pickableProjects()) {
        if (wanted.includes(project.id) && project.folder && (project.machine ?? null) === machine) this.log.importIfNeeded(project, cx, (found) => sayImported(project, found, false));
      }
    }
    if (this.shownVersion !== this.log.version) {
      this.shownVersion = this.log.version;
      if (wanted.length) cx.notify();
    }
  }

  press(project, session, cx) {
    const key = `${session.tool}:${session.id}`;
    if (Date.now() - (this.pressedAt.get(key) ?? 0) < RESUME_GAP_MS) return;
    this.pressedAt.set(key, Date.now());
    cx.spawn(() => resumeSession(project, session));
  }

  // For the project's row. A press here mustn't select or drag it.
  chevron(project, t) {
    if (!project?.folder) return div().w(14).mr(-5).flex_none();
    return div().id(`history-toggle-${project.id}`).w(14).h(22).mr(-5).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(isOpen(project.id) ? "Hide sessions" : "Show sessions, rename or delete")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); toggleHistory(project.id); })
      .child(svg(`mods/workspace-chrome/chevron-${isOpen(project.id) ? "down" : "right"}.svg`).size(12));
  }

  row(project, session, t) {
    return sessionRow(session, Boolean(this.log.tabOf(session, project.machine ?? null)), t, (_e, cx) => this.press(project, session, cx));
  }

  // The project's ⋯ shows its actions in place of the count, and closes them again.
  actionsShown = null;

  action(id, label, enabled, tip, onPress, t) {
    return div().id(id).h(22).px(7).flex_none().flex().items_center().rounded(5).text_size(11.5).tooltip(tip)
      .text_color(enabled ? t.muted : t.dim).when(!enabled, (el) => el.opacity(0.6))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onPress))
      .child(label);
  }

  // How many it has, or why there's nothing to show yet.
  count(project, total) {
    const state = this.log.stateOf(project.machine ?? null);
    const importing = state !== "ready" || this.log.importState(project) !== "done";
    const failed = state === "failed" || this.log.importState(project) === "failed";
    if (total) return plural(total, "session");
    return failed ? `Couldn't read sessions on ${machineLabel(project.machine ?? null)}` : importing ? "Reading past sessions…" : "No coding sessions yet";
  }

  head(project, total, t) {
    const shown = this.actionsShown === project.id, machine = project.machine ?? null;
    const saved = projects().some((p) => p.id === project.id), running = Boolean(liveSpaceOf(project));
    const importing = this.log.importState(project) === "importing";
    const toggle = div().id(`history-actions-${project.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(shown ? t.foreground : t.dim).when(shown, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(shown ? "Done" : "Rename, delete or re-import")
      .on_click((_e, cx) => { this.actionsShown = shown ? null : project.id; cx.notify(); })
      .child(svg(shown ? "mods/workspace-chrome/x.svg" : "mods/sanguo/icons/more.svg").size(13));
    return h_flex().h(24).flex_none().pl(5).gap(2).items_center()
      .when(!shown, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.count(project, total))))
      .when(shown, (el) => el
        .child(this.action(`rename-${project.id}`, "Rename", true, "Rename this project", () => openRenameProject(project.id), t))
        .child(this.action(`reimport-${project.id}`, importing ? "Importing…" : "Re-import", this.log.stateOf(machine) === "ready" && !importing,
          "Look through each CLI's records again, for sessions run outside Herdr",
          (_e, cx) => this.log.importNow(project, cx, (found) => sayImported(project, found, true)), t))
        .when(saved, (el) => el.child(this.action(`delete-${project.id}`, "Delete", !running,
          running ? "Close its sessions first" : "Remove from saved projects. The folder isn't touched.", () => openDeleteProject(project.id), t)))
        .child(div().flex_1()))
      .child(toggle);
  }

  // What goes under the project's row: nothing while it's closed.
  panel(project, t) {
    if (!project || !isOpen(project.id)) return [];
    const all = this.log.sessionsOf(project), limit = this.limits.get(project.id) ?? PAGE, shown = all.slice(0, limit), more = all.length > limit;
    const height = Math.min(LIST_ROWS * ROW_H, shown.length * ROW_H + (more ? MORE_H : 0));
    return [v_flex().id(`history-${project.id}`).flex_none().ml(14).mb(6).pl(6).border_l(1).border_color(t.border)
      .child(this.head(project, all.length, t))
      .when(shown.length > 0, (el) => el.child(v_flex().id(`history-list-${project.id}`).h(height).flex_none().overflow_y_scrollbar()
        .children(shown.map((session) => this.row(project, session, t)))
        .when(more, (list) => list.child(h_flex().id(`history-more-${project.id}`).h(MORE_H).flex_none().justify_center().items_center().rounded(6).text_size(12).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.limits.set(project.id, limit + PAGE); cx.notify(); })
          .child(`Show ${Math.min(PAGE, all.length - limit)} more`)))))];
  }
}
