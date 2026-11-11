// New Session: pick a project, pick a CLI, start. New Project: save a folder as a project.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup } from "gpui-base";
import { theme, props, closeOverlay, run, spaces, knownAgents, home, shared, setShared } from "herdr";
import { sessionTitle } from "./sessions.js";
import { kingdomOf } from "./kingdoms.js";
import { currentMachine, machineLabel, machineNames } from "./machines.js";
import { FolderBrowser } from "./folder-browser.js";
import { TOOLS, readProjectSessions, tabFinder } from "./session-log.js";
import { SESSION_ROW_H, resumeSession, sessionRow } from "./session-history.js";
import { KeepInView } from "./keep-in-view.js";
import { DIALOG_WIDTH, KNOWN_AGENTS, checkProject, startSession, renameProject, forgetProject, pickableProjects, liveSpaceOf, resolveFolder, saveProject, rememberTool, projectId, openNewProject, openNewSession } from "./projects.js";

const CHECKED = "sanguo.agents-checked"; // machine -> when its agents were last asked for.
const RECHECK_MS = 10 * 60 * 1000; // Asking starts a shell there, and now and then one gets stuck for good.
const TERMINAL = { key: "terminal", name: "Terminal", icon: "icons/shell.svg", tint: true };
const baseName = (path) => path.replace(/\/+$/, "").split("/").pop();
const ROW_H = 30, GROUP_H = 22, LIST_PAD = 4, LIST_ROWS_MAX = 7 * ROW_H, SEARCH_H = 34;
const HISTORY_ROWS = 100, HISTORY_MAX = 220, HISTORY_HEAD_H = 40; // Part of a row showing says there's more.
const DIALOG_PAD = 20, LIST_W = DIALOG_WIDTH - DIALOG_PAD * 2 - 2; // The select's width, inside the dialog's 1px frame.
// A press beside the open list only closes it, even when it lands on a control.
const CLOSING_MS = 600;

const fieldLabel = (t, text) => div().pt(16).pb(7).text_size(11).font_semibold().text_color(t.dim).child(text);

function button(t, id, text, primary, enabled, action) {
  return h_flex().id(id).h(32).px(14).flex_none().items_center().rounded(8)
    .bg(primary && enabled ? t.solid : t.raised)
    .text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
    .child(text);
}

const errorLine = (t, text) => div().pt(10).text_size(12).text_color(t.ansi1).child(text);

// Every word typed is somewhere in the fields.
function matches(query, ...fields) {
  const text = fields.filter(Boolean).join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

const searchIcon = (t) => svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim);

export class NewSession {
  init(_props, cx) {
    const given = props() ?? {};
    const all = pickableProjects();
    const active = spaces().find((s) => s.active);
    const on = given.machine === undefined ? currentMachine() : given.machine;
    const start = all.find((p) => p.id === given.project)
      ?? all.find((p) => active && (active.machine ?? null) === on && liveSpaceOf(p)?.id === active.id)
      ?? all.find((p) => (p.machine ?? null) === on) ?? all[0];
    this.projectId = start?.id;
    this.toolKey = null; // Until picked: the project's last, else the first installed.
    this.listOpen = false;
    this.rowsInView = new KeepInView(); // The highlighted project, as ↑↓ move past the list's seven rows.
    this.tools = {};
    this.history = [];
    this.historyAsked = 0;
    this.search = InputState.new({ placeholder: "Search projects" });
    this.search.on("change", (_e, cx) => { this.highlight = this.shownProjects()[0]?.id ?? null; cx.notify(); });
    this.search.on("submit", (_e, cx) => this.pickHighlighted(cx));
    this.sessionSearch = InputState.new({ placeholder: "Search sessions" });
    this.sessionSearch.on("change", (_e, cx) => cx.notify());
    this.sessionSearch.on("focus", () => { this.searchingSessions = true; });
    this.sessionSearch.on("blur", () => { this.searchingSessions = false; });
    this.sessionSearch.on("submit", (_e, cx) => { const first = this.shownHistory()[0], project = this.selected(); if (first && project) this.resume(project, first, cx); });
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.loadTools(start?.machine ?? null, cx);
    this.loadHistory(start, cx);
  }

  // Its past sessions, from its machine. With none, the dialog has nothing more to show.
  loadHistory(project, cx) {
    const asked = ++this.historyAsked;
    this.history = [];
    if (!project?.folder) return;
    cx.spawn(async (cx) => {
      const sessions = await readProjectSessions(project).catch(() => []);
      if (asked !== this.historyAsked) return;
      this.history = sessions;
      cx.notify();
    });
  }

  resume(project, session, cx) {
    if (this.busy || this.listBusy()) return;
    this.busy = true;
    cx.spawn(async () => {
      await resumeSession(project, session);
      closeOverlay(props().overlay);
    });
    cx.notify();
  }

  shownHistory() {
    const query = this.sessionSearch.value().trim();
    return (query ? this.history.filter((s) => matches(query, s.title, TOOLS[s.tool]?.name)) : this.history).slice(0, HISTORY_ROWS);
  }

  // Sized by all of its sessions, so searching doesn't resize the dialog.
  historyHeight() {
    return 18 + 1 + HISTORY_HEAD_H + Math.min(HISTORY_MAX, Math.min(HISTORY_ROWS, this.history.length) * SESSION_ROW_H);
  }

  historySection(project, t) {
    const tabOf = tabFinder(project.machine ?? null), shown = this.shownHistory(), query = this.sessionSearch.value().trim();
    return v_flex().h(this.historyHeight()).flex_none()
      .child(div().h(1).mt(18).flex_none().bg(t.border))
      .child(h_flex().h(HISTORY_HEAD_H).flex_none().gap(10).items_center()
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child("RESUME A SESSION"))
        .child(h_flex().w(210).h(28).flex_none().px(8).gap(6).items_center().rounded(7).border(1).border_color(this.searchingSessions ? t.accent : t.input).bg(t.background)
          .child(searchIcon(t)).child(Input.new(this.sessionSearch).flex_1().min_w(0).text_size(12).text_color(t.foreground))))
      .child(v_flex().id("ns-history").flex_1().min_h(0).overflow_y_scrollbar()
        .when(!shown.length, (el) => el.child(div().h(SESSION_ROW_H).flex_none().px(5).flex().items_center().text_size(12).text_color(t.dim).child(`No session matches “${query}”`)))
        .children(shown.map((session) => sessionRow(session, Boolean(tabOf(session)), t, (_e, cx) => this.resume(project, session, cx)))));
  }

  loadTools(machine, cx) {
    const where = machine ?? "";
    if (this.tools[where]?.fresh) return;
    const known = shared(KNOWN_AGENTS)?.[where] ?? [];
    if (known.length && Date.now() - (shared(CHECKED)?.[where] ?? 0) < RECHECK_MS) { this.tools[where] = { fresh: true, list: known }; return; }
    this.tools[where] = { fresh: true, list: known, checking: true };
    cx.spawn(async (cx) => {
      try {
        const list = await knownAgents({ on: machine });
        this.tools[where] = { fresh: true, list };
        setShared(KNOWN_AGENTS, { ...shared(KNOWN_AGENTS), [where]: list });
        setShared(CHECKED, { ...shared(CHECKED), [where]: Date.now() });
      } catch { this.tools[where] = { fresh: true, list: this.tools[where].list, failed: true }; }
      cx.notify();
    });
  }

  selected() {
    return pickableProjects().find((p) => p.id === this.projectId);
  }

  // The projects the search leaves, in the list's order.
  shownProjects() {
    const query = this.search.value().trim(), all = pickableProjects();
    const left = query ? all.filter((p) => matches(query, p.name, p.folder, machineLabel(p.machine ?? null))) : all;
    return machineNames().flatMap((m) => left.filter((p) => (p.machine ?? null) === m));
  }

  pickHighlighted(cx) {
    if (!this.listOpen) return;
    const chosen = this.shownProjects().find((p) => p.id === this.highlight);
    if (chosen) this.pick(chosen, cx); else this.closeList(cx);
  }

  toolChoices(project) {
    const known = this.tools[project?.machine ?? ""]?.list ?? [];
    return [...known.filter((a) => a.installed), TERMINAL];
  }

  selectedTool(project) {
    const choices = this.toolChoices(project);
    return choices.find((a) => a.key === this.toolKey) ?? choices.find((a) => a.key === project?.tool) ?? choices[0];
  }

  listBusy() {
    return this.listOpen || Date.now() - (this.listClosedAt ?? 0) < CLOSING_MS;
  }

  closeList(cx) {
    this.listOpen = false; this.listClosedAt = Date.now();
    this.handle.focus();
    cx.notify();
  }

  // Opens with the keyboard in its search.
  toggleList(cx) {
    if (this.listBusy() && !this.listOpen) return;
    if (this.listOpen) { this.closeList(cx); return; }
    this.search.set_value("");
    this.listOpen = true; this.highlight = this.projectId;
    this.rowsInView.forget();
    cx.timer.after(40, () => this.search.focus());
    cx.notify();
  }

  pick(project, cx) {
    if (project.id !== this.projectId) this.sessionSearch.set_value("");
    this.projectId = project.id; this.listOpen = false; this.listClosedAt = Date.now(); this.toolKey = null; this.error = null;
    this.handle.focus();
    this.loadTools(project.machine ?? null, cx);
    this.loadHistory(project, cx);
    cx.notify();
  }

  step(list, current, by) {
    const at = list.findIndex((x) => x === current);
    return list[(at + by + list.length) % list.length];
  }

  key(e, cx) {
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const project = this.selected();
    if (this.listOpen) {
      const shown = this.shownProjects();
      if (e.key === "up" || e.key === "down") {
        this.highlight = this.step(shown, shown.find((p) => p.id === this.highlight), e.key === "up" ? -1 : 1)?.id;
        cx.notify();
      } else if (e.key === "enter") this.pickHighlighted(cx);
      else if (e.key === "escape") this.closeList(cx);
      else return;
      cx.stop_propagation();
      return;
    }
    // Typing in the session search: Enter resumes the first match, Escape leaves the search.
    if (this.searchingSessions) {
      if (e.key === "escape") { this.handle.focus(); cx.stop_propagation(); }
      return;
    }
    if (e.key === "enter") { this.create(cx); cx.stop_propagation(); }
    else if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
    else if (e.key === "up" || e.key === "down") {
      const next = this.step(pickableProjects(), project, e.key === "up" ? -1 : 1);
      if (next) this.pick(next, cx);
      cx.stop_propagation();
    } else if (e.key === "left" || e.key === "right") {
      const choices = this.toolChoices(project);
      this.toolKey = this.step(choices, this.selectedTool(project), e.key === "left" ? -1 : 1).key;
      cx.notify();
      cx.stop_propagation();
    }
  }

  create(cx) {
    const project = this.selected();
    if (!project || this.busy) return;
    const tool = this.selectedTool(project);
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        await checkProject(project);
        await rememberTool(project.id, tool.key); // If that fails you're told, and the session starts anyway.
        closeOverlay(props().overlay);
        startSession(project, tool.run);
      } catch (e) {
        this.busy = false;
        this.error = String(e.message ?? e);
        cx.notify();
      }
    });
    cx.notify();
  }

  folderLine(project) {
    if (!project) return "";
    const folder = project.machine ? project.folder : project.folder.replace(home(), "~");
    return project.machine ? `${project.machine}: ${folder}` : folder;
  }

  projectRow(project, t) {
    const live = liveSpaceOf(project);
    const on = project.id === this.highlight;
    return h_flex().id(`pick-${project.id}`).h(ROW_H).flex_none().px(8).gap(10).items_center().rounded(6).text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.pick(project, cx))
      .child(svg("mods/files/folder.svg").size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(210).truncate().child(project.name))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(this.folderLine(project)))
      .when(Boolean(live), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.ansi2).tooltip("Has open sessions")));
  }

  // A search on top, at most seven rows, and New project at the bottom.
  projectList(t) {
    const all = this.shownProjects(), query = this.search.value().trim();
    const groups = machineNames().map((m) => [m, all.filter((p) => (p.machine ?? null) === m)]).filter(([, list]) => list.length);
    const headed = groups.length > 1 || machineNames().length > 1;
    const rows = all.length * ROW_H + (headed ? groups.length * GROUP_H : 0);
    // The list's rows in order: each machine's name, when they're headed, then its projects.
    const entries = groups.flatMap(([m, list]) => [...(headed ? [{ heading: m }] : []), ...list]);
    this.rowsInView.follow(this.highlight, entries.findIndex((entry) => entry.id === this.highlight));
    return v_flex().id("project-list").w(LIST_W).mt(4).p(LIST_PAD).rounded(8).border(1).border_color(t.input).bg(t.background).shadow_lg()
      .on_mouse_down_out((_e, cx) => this.closeList(cx))
      // The search in here holds the keyboard, and a key pressed in a popup never reaches the dialog's
      // own handler, so ↑↓ are caught here. Enter comes through the search's submit.
      .on_key_down((e, cx) => { if (e.key === "up" || e.key === "down") this.key(e, cx); })
      .child(h_flex().h(SEARCH_H).flex_none().px(8).mb(4).gap(8).items_center().border_b(1).border_color(t.border)
        .child(searchIcon(t)).child(Input.new(this.search).flex_1().min_w(0).text_size(12.5).text_color(t.foreground)))
      .child(v_flex().id("project-rows").h(Math.max(ROW_H, Math.min(LIST_ROWS_MAX, rows))).flex_none().overflow_y_scrollbar().track_scroll(this.rowsInView.handle)
        .when(!all.length, (el) => el.child(div().h(ROW_H).flex_none().px(8).flex().items_center().text_size(12).text_color(t.dim).child(`No project matches “${query}”`)))
        .children(entries.map((entry) => ("heading" in entry
          ? div().h(GROUP_H).flex_none().px(8).flex().items_center().text_size(11).text_color(t.dim).child(machineLabel(entry.heading))
          : this.projectRow(entry, t)))))
      .child(div().h(1).flex_none().my(4).bg(t.border))
      .child(h_flex().id("pick-new").h(ROW_H).flex_none().px(8).gap(10).items_center().rounded(6).text_size(12.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => { const machine = this.selected()?.machine ?? null; closeOverlay(props().overlay); openNewProject({ machine }); })
        .child(svg("mods/workspace-chrome/plus.svg").size(13).flex_none())
        .child("New project…"));
  }

  toolChip(tool, on, t) {
    const color = tool === TERMINAL ? t.muted : kingdomOf({ program: tool }).color;
    return h_flex().id(`tool-${tool.key}`).h(32).px(8).gap(6).flex_none().items_center().rounded(8).border(1).cursor_pointer()
      .border_color(on ? color : t.raised).bg(on ? color + "2e" : t.raised)
      .text_size(12).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? color + "2e" : t.hover))
      .on_click((_e, cx) => { if (this.listBusy()) return; this.toolKey = tool.key; cx.notify(); })
      .child(tool.icon ? (tool.tint ? svg(tool.icon).size(15).flex_none().text_color(t.foreground) : image(tool.icon).size(15).flex_none()) : div())
      .child(tool.name);
  }

  render() {
    const t = theme();
    const project = this.selected();
    const state = this.tools[project?.machine ?? ""];
    const tool = this.selectedTool(project);
    return v_flex().id("new-session").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(DIALOG_PAD).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child("New Session"))
      .child(fieldLabel(t, "PROJECT"))
      .child(Popup.new("project-popup", h_flex().id("project-select").w_full().h(38).flex_none().px(10).gap(8).items_center().rounded(8).border(1).border_color(this.listOpen ? t.accent : t.input).bg(t.background).text_size(13).cursor_pointer()
          .on_click((_e, cx) => this.toggleList(cx))
          .child(svg("mods/files/folder.svg").size(15).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(project?.name ?? "Choose a project"))
          .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.dim)))
        .anchor("top_left").w_full()
        .when(this.listOpen, (el) => el.content(this.projectList(t))))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).truncate().child(this.folderLine(project)))
      .child(fieldLabel(t, "TOOL"))
      .child(h_flex().flex_wrap().gap(6).children(this.toolChoices(project).map((a) => this.toolChip(a, a.key === tool.key, t))))
      .when(Boolean(state?.checking), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.dim).child(`Checking what's installed on ${machineLabel(project?.machine ?? null)}…`)))
      .when(Boolean(state?.failed), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.dim).child(`Couldn't ask ${machineLabel(project?.machine ?? null)} what's installed.`)))
      .when(Boolean(this.error), (el) => el.child(errorLine(t, this.error)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button(t, "ns-cancel", "Cancel", false, true, () => { if (!this.listBusy()) closeOverlay(props().overlay); }))
        .child(button(t, "ns-create", this.busy ? "Starting…" : "Create", true, Boolean(project) && !this.busy, (_e, cx) => { if (!this.listBusy()) this.create(cx); })))
      // While the list is open the history keeps its place but isn't drawn: its scrolling list would paint over the list.
      .when(Boolean(project) && this.history.length > 0, (el) => el.child(this.listOpen ? div().h(this.historyHeight()).flex_none() : this.historySection(project, t)));
  }
}

export class NewProject {
  init(_props, cx) {
    const given = props() ?? {};
    this.machine = given.machine === undefined ? currentMachine() : given.machine;
    this.folder = InputState.new({ placeholder: "~/Projects/my-app" });
    this.name = InputState.new({ placeholder: "Named after the folder" });
    this.folder.on("submit", (_e, cx) => this.save(cx));
    this.name.on("submit", (_e, cx) => this.save(cx));
    this.folder.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.browser = new FolderBrowser((path, cx) => {
      this.folder.set_value(path);
      this.browser.close();
      this.error = null;
      cx.notify();
    });
    this.handle = cx.focus_handle();
    this.folder.focus();
    cx.timer.after(600, () => this.folder.focus());
  }

  save(cx) {
    // Where you've browsed to counts, if you press Next there.
    const typed = this.browser.isOpen && this.browser.at ? this.browser.at : this.folder.value().trim();
    if (!typed || this.busy) { if (!typed) { this.error = "Choose the project's folder."; cx.notify(); } return; }
    const machine = this.machine;
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const folder = await resolveFolder(typed, machine);
        if (!folder) throw new Error(`${typed} isn't there on ${machineLabel(machine)}.`);
        const id = projectId(machine, folder);
        if (!(await saveProject({ id, name: this.name.value().trim() || baseName(folder), folder, machine }))) throw new Error(`Couldn't save it on ${machineLabel(machine)}. Try again.`);
        closeOverlay(props().overlay);
        openNewSession({ project: id });
      } catch (e) {
        this.busy = false;
        this.error = String(e.message ?? e);
        cx.notify();
      }
    });
    cx.notify();
  }

  // The same browser on every machine, this one too: it can make a new folder where you are.
  browse(cx) {
    if (this.browser.isOpen) this.browser.close();
    else this.browser.open(this.folder.value().trim(), this.machine, cx);
    cx.notify();
  }

  render() {
    const t = theme();
    const field = (input) => Input.new(input).h(36).flex_1().min_w(0).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    const names = machineNames();
    return v_flex().id("new-project").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.browser.stopNaming(cx)) { /* Only the new folder's name goes. */ }
        else if (this.browser.isOpen) { this.browser.close(); cx.notify(); } else closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .w_full().min_h(0).p(DIALOG_PAD).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child("New Project"))
      .when(names.length > 1, (el) => el.child(fieldLabel(t, "MACHINE"))
        .child(h_flex().gap(8).children(names.map((m) => {
          const on = m === this.machine;
          return h_flex().id(`machine-${m ?? "local"}`).h(30).px(12).flex_none().items_center().rounded(8).border(1).cursor_pointer().text_size(12.5)
            .border_color(on ? t.accent : t.raised).bg(on ? t.accent + "2e" : t.raised).text_color(on ? t.foreground : t.muted)
            .on_click((_e, cx) => { this.machine = m; this.error = null; this.browser.close(); cx.notify(); })
            .child(machineLabel(m));
        }))))
      .child(fieldLabel(t, "FOLDER"))
      .child(h_flex().gap(8).items_center().child(field(this.folder))
        .child(button(t, "np-browse", "Browse…", false, true, (_e, cx) => this.browse(cx))))
      .when(this.browser.isOpen, (el) => el.child(this.browser.render(t)))
      .child(fieldLabel(t, "NAME"))
      .child(h_flex().child(field(this.name)))
      .when(Boolean(this.error), (el) => el.child(errorLine(t, this.error)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button(t, "np-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button(t, "np-save", this.busy ? "Checking…" : "Next", true, !this.busy, (_e, cx) => this.save(cx))));
  }
}

const projectGiven = () => pickableProjects().find((p) => p.id === props()?.project);

export class RenameProject {
  init(_props, cx) {
    const name = projectGiven()?.name ?? "";
    this.name = InputState.new({ value: name });
    if (name) this.name.set_selected_range({ start: 0, end: name.length });
    this.name.on("submit", (_e, cx) => this.save(cx));
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.handle = cx.focus_handle();
    this.name.focus();
    cx.timer.after(600, () => this.name.focus());
  }

  save(cx) {
    const project = projectGiven(), name = this.name.value().trim();
    if (!name) { this.error = "Give it a name."; cx.notify(); return; }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      if (!project || (await renameProject(project, name))) { closeOverlay(props().overlay); return; }
      this.busy = false;
      this.error = `Couldn't save the name on ${machineLabel(project.machine ?? null)}. Try again.`;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().id("rename-project").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(DIALOG_PAD).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child("Rename Project"))
      .child(fieldLabel(t, "NAME"))
      .child(h_flex().child(Input.new(this.name).h(36).flex_1().min_w(0).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(errorLine(t, this.error)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button(t, "rp-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button(t, "rp-save", "Save", true, true, (_e, cx) => this.save(cx))));
  }
}

export class CloseSession {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    cx.spawn(async () => this.handle.focus());
  }

  confirm() {
    run("tab.close", { id: props()?.tab, confirmed: true });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme(), tabId = props()?.tab, project = spaces().find((s) => s.tabs?.some((tab) => tab.id === tabId));
    const tab = project?.tabs?.find((c) => c.id === tabId), title = tab && sessionTitle(tab);
    const doing = props()?.status === "blocked" ? "is waiting for you" : "is still working";
    return v_flex().id("close-session").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter") this.confirm();
        else return;
        cx.stop_propagation();
      })
      .w_full().min_h(0).p(DIALOG_PAD).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child("End this session?"))
      .child(div().pt(10).text_size(12.5).line_height("18px").text_color(t.muted).child(`${title ?? project?.name ?? "This session"} ${doing}. Ending it stops its CLI now. You can resume it later from the project's history.`))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button(t, "cs-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button(t, "cs-end", "End Session", true, true, () => this.confirm())));
  }
}

export class DeleteProject {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    cx.spawn(async () => this.handle.focus());
  }

  // If it can't reach its machine you're told, and the project stays.
  confirm(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      await forgetProject(props()?.project);
      closeOverlay(props().overlay);
    });
  }

  render() {
    const t = theme(), project = projectGiven();
    return v_flex().id("delete-project").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter") this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .w_full().min_h(0).p(DIALOG_PAD).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child(`Delete ${project?.name ?? "this project"}?`))
      .child(div().pt(10).text_size(12.5).line_height("18px").text_color(t.muted).child("It leaves your saved projects. Its folder and session history stay on disk, and you can add it back with New Project."))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button(t, "dp-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button(t, "dp-delete", "Delete", true, true, (_e, cx) => this.confirm(cx))));
  }
}
