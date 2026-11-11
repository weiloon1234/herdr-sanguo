import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";
import { uniqueMarks, kingdomChip, isFighter, dutyWord } from "./kingdoms.js";
import { showingField, showingChanges, showingNotes, openChanges, closeChanges, toggleNotes, openSession, backToField } from "./views.js";
import { openNewSession } from "./projects.js";
import { currentMachine, machineLabel, shownSpace, sessionNumbers, sessionsOn } from "./machines.js";
import { closeSession, sessionTitle } from "./sessions.js";
import { keyHint } from "./key-hints.js";
import { barButton, tabChip, tabClose, tabRow } from "./tab-strip.js";
import { openOutsideTerminal } from "./terminal.js";
import { KeepInView } from "./keep-in-view.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs {
  init() {
    this.pressed = null;
    this.inView = new KeepInView();
    this.panels =JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = shownSpace();
    const shown = sessionsOn(currentMachine());
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => barButton(id, label, action, t);
    const onField = showingField(), changesOn = showingChanges(), notesOn = showingNotes(), allPanes = panes(), numbers = sessionNumbers(currentMachine());
    const isOpen = ({ tab: c, space: project }) => c.active && project.active && !onField && !changesOn && !notesOn;
    const openAt = shown.findIndex(isOpen);
    this.inView.follow(shown[openAt]?.tab.id ?? null, openAt);
    const item = (session) => {
      const { tab: c, space: project } = session, open = isOpen(session), title = sessionTitle(c);
      const here = allPanes.filter(p => p.tab === c.id), fighters = here.filter(isFighter);
      const program = fighters[0]?.program ?? here[0]?.program;
      const banners = uniqueMarks(fighters);
      const number = numbers.get(c.id) ?? 0;
      return tabChip(`tab-${c.id}`, open, t)
        .tooltip(`${title ? `${title} · ` : ""}${program?.name ?? "Terminal"} · ${project.name}`)
        .on_hover((over, cx) => { const next = over ? c.id : this.hovered === c.id ? null : this.hovered; if (next !== this.hovered) { this.hovered = next; cx.notify(); } })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = c.id; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          // Tabs can only be dragged within their own project.
          if (from !== null && from !== c.id) { if (project.tabs.some(x => x.id === from)) run("tab.move", { id: from, index: project.tabs.findIndex(x => x.id === c.id) + 1 }); }
          else openSession(c.id);
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: project.id } } }); })
        .when(banners.length > 0, el => el.children(banners.map(holder => kingdomChip(holder))))
        .when(!banners.length && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().flex_none().text_color(t.dim).child(String(number)))
        .child(div().flex_1().min_w(0).truncate().child(c.zoomed ? `${project.name} Z` : project.name))
        .when(banners.length > 0 && Boolean(c.status), el => el.child(dutyWord(c.status, t)))
        .when(open || this.hovered === c.id, el => el.child(tabClose(`close-${c.id}`, "End this session", () => closeSession(c.id, c.status), t)));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled.filter((id) => id !== "changes"));
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .child(h_flex().id("field-back").h(29).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12.8).font_semibold()
        .bg(onField ? t.selected : t.chrome).text_color(onField ? t.foreground : t.muted).hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .tooltip(onField ? "Every session on this machine" : keyHint("sanguo.field", "Back to the 校场. The session keeps running."))
        .on_click(() => backToField()).child(onField ? "校场" : "× 回校场"))
      .child(tabRow("tab-scroll", shown.map(item), this.inView))
      .child(button("tab-new", "+", () => openNewSession({ machine: currentMachine() })).flex_none().tooltip(keyHint("sanguo.new-session", "New session. Right-click for Herdr's menu."))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }); }))
      .child(div().flex_1().min_w(0).h_full())
      .child(h_flex().id("open-terminal").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).tooltip(`Open Terminal${currentMachine() ? `, ssh to ${currentMachine()},` : ""} in ${onField ? "the home folder" : "this session's folder"}`)
        .on_click((_e, cx) => { cx.spawn(() => openOutsideTerminal()); }).child(svg("mods/workspace-chrome/terminal.svg").size(14)).child("Terminal"))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(h_flex().id("open-changes").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(changesOn ? t.selected : t.chrome).text_color(changesOn ? t.foreground : space ? t.muted : t.dim).when(Boolean(space), el => el.hover(s => s.bg(t.hover)))
        .on_mouse_down("left", stop).tooltip(space ? "Git for this project: commit, branches, pull and push" : "Open a project first")
        .on_click(() => (changesOn ? closeChanges() : openChanges())).child(svg("mods/changes/changes.svg").size(14)).child("Changes")))
      .child(h_flex().id("open-notes").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(notesOn ? t.selected : t.chrome).text_color(notesOn ? t.foreground : t.muted).hover(s => s.bg(t.hover))
        .on_mouse_down("left", stop).tooltip(keyHint("sanguo.notes", `Notes on ${machineLabel(currentMachine())}: saved as you type, the same in every window connected to it`))
        .on_click(() => toggleNotes()).child(svg("mods/workspace-chrome/square-pen.svg").size(14)).child("Notes"))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
