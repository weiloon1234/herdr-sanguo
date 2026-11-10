// The row of machines at the top of the sidebar, the same on the 校场 and beside a session: where you
// are, what needs you elsewhere, and what to start. + is a new session, as it is on the tabs and on a
// project's row; a new project has its own button.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { currentMachine, goToMachine, machineLabel, machineLayout, machineNames, needsYou } from "./machines.js";
import { openNewProject, openNewSession } from "./projects.js";
import { keyHint } from "./key-hints.js";

function switcher(t) {
  const shown = currentMachine();
  return h_flex().flex_1().min_w(0).gap(3).items_center().children(machineNames().map((m) => {
    const on = m === shown, needs = needsYou(m), away = machineLayout(m) === "unavailable";
    return h_flex().id(`switch-${m ?? "local"}`).h(22).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : away ? t.dim : t.muted).hover((s) => s.bg(t.hover))
      .on_click(() => { if (!on) goToMachine(m); })
      .child(machineLabel(m))
      .when(needs > 0, (el) => el.child(div().h(14).px(4).flex().items_center().rounded(3).bg(t.blocked).text_color(t.background).text_size(10.5).font_bold().child(String(needs))));
  }));
}

const action = (t, id, icon, tip, press) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
  .hover((s) => s.bg(t.hover).text_color(t.foreground))
  .tooltip(tip).on_click(press).child(svg(icon).size(14));

// `collapsed`: a narrow sidebar has room for the + only. The New Session dialog starts on the
// project you're in, and can make a new one too.
export function machineBar(t, collapsed = false) {
  return h_flex().h(31).flex_none().pl(8).pr(10).gap(4).items_center().justify_between().text_size(11.5).text_color(t.dim)
    .when(!collapsed, (el) => el.child(switcher(t))
      .child(action(t, "project-new", "mods/workspace-chrome/folder-plus.svg", keyHint("sanguo.new-project", "New project"), () => openNewProject())))
    .child(action(t, "session-new", "mods/workspace-chrome/plus.svg", keyHint("sanguo.new-session", "New session, or resume one"), () => openNewSession({ machine: currentMachine() })));
}
