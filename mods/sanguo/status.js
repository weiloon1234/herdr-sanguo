// The status bar: where you are and what your agents are doing. Being always shown,
// it also receives this layout's keys (see `handle`).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, run, nextCommand, theme } from "herdr";
import { DUTIES, dutyWord } from "./kingdoms.js";
import { currentMachine, shownSpace, spacesOn, machineLabel, rememberSpace, syncShownMachine, switchMachine, selectSpaceAt, cycleSpace } from "./machines.js";
import { syncView, backToField, openSessionAt, showingChanges, openChanges, closeChanges, toggleNotes } from "./views.js";
import { openNewSession, openNewProject } from "./projects.js";
import { RemoteSaves } from "./remote-files.js";
import { keyHint } from "./key-hints.js";
import { keepTimeOfDay, setTimeOfDayMode } from "./time-of-day.js";
import { openOutsideTerminal } from "./terminal.js";
import { OpenInRow } from "./open-in.js";

export default class Status {
  init(_props, cx) {
    this.viewMemo = {};
    this.machineMemo = {};
    new RemoteSaves().start(cx);
    keepTimeOfDay(cx);
    this.openIn = new OpenInRow();
    cx.spawn(async (cx) => {
      for (;;) { this.handle(await nextCommand(), cx); cx.notify(); }
    });
  }

  handle(command, cx) {
    if (command === "switch-machine") switchMachine();
    else if (command === "field") backToField();
    else if (command === "changes") { if (showingChanges()) closeChanges(); else openChanges(); }
    else if (command === "notes") toggleNotes();
    else if (command.startsWith("appearance-")) setTimeOfDayMode(command.slice(11));
    else if (command === "open-terminal") cx.spawn(() => openOutsideTerminal());
    else if (command.startsWith("open-in-")) cx.spawn(() => this.openIn.open(command.slice(8)));
    else if (command === "new-session") openNewSession({ machine: currentMachine() });
    else if (command === "new-project") openNewProject();
    else if (command.startsWith("session-")) openSessionAt(Number(command.slice(8)));
    else if (command === "space-next") cycleSpace(1);
    else if (command === "space-prev") cycleSpace(-1);
    else if (command.startsWith("space-")) selectSpaceAt(Number(command.slice(6)));
  }

  render(cx) {
    const t = theme();
    this.openIn.load(cx);
    rememberSpace();
    syncShownMachine(this.machineMemo);
    syncView(this.viewMemo);
    const space = shownSpace(), machine = currentMachine();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // What's happening here; the machine buttons in the sidebar flag what needs you elsewhere.
    const here = new Set(spacesOn(machine).map((s) => s.id));
    const list = agents().filter((a) => here.has(a.space));
    const counts = Object.keys(DUTIES).map((status) => [status, list.filter((a) => a.status === status).length]).filter(([, n]) => n > 0);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(machine ? "server" : "monitor", machineLabel(machine)))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(10).items_center().children(counts.map(([status, n]) =>
        h_flex().gap(4).items_center().child(dutyWord(status, t)).child(String(n)))))
      .child(div().flex_1())
      .child(this.openIn.render(t))
      .child(div().w(1).h(14).flex_none().bg(t.border))
      .child(div().id("back-to-field").text_color(t.dim).on_click(() => backToField()).child(keyHint("sanguo.field", "校场")))
      .child(div().id("switch-machine").text_color(t.dim).on_click(() => switchMachine()).child(keyHint("sanguo.switch-machine", "switch machine")))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(keyHint("app.palette", "commands")));
  }
}
