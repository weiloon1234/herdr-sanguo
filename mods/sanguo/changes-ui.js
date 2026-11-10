// The small parts the Changes view is drawn from.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const SHIPPED = {
  archive: "mods/workspace-chrome/archive.svg", branch: "mods/workspace-chrome/git-branch.svg", check: "mods/workspace-chrome/check.svg",
  clock: "mods/workspace-chrome/clock.svg", down: "mods/workspace-chrome/chevron-down.svg", file: "mods/workspace-chrome/file-text.svg",
  left: "mods/workspace-chrome/chevron-left.svg", minus: "mods/workspace-chrome/minus.svg", pen: "mods/workspace-chrome/square-pen.svg", plus: "mods/workspace-chrome/plus.svg",
  right: "mods/workspace-chrome/chevron-right.svg", search: "mods/workspace-chrome/search.svg", x: "mods/workspace-chrome/x.svg",
};

export const icon = (name, size = 15) => svg(SHIPPED[name] ?? `mods/sanguo/icons/${name}.svg`).size(size).flex_none();

export const spinner = (t, size = 13) => svg("mods/workspace-chrome/spinner.svg").size(size).flex_none().text_color(t.muted).spin(900);

export const stopPress = (_e, cx) => cx.stop_propagation();

export function iconButton(id, name, tip, onPress, t, on = false) {
  return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).cursor_pointer()
    .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(tip).on_click(onPress).child(icon(name));
}

// A floating surface: a menu, or the branch picker.
export const surface = (id, t, width) => v_flex().id(id).w(width).mt(4).p(5).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg().text_color(t.foreground).text_size(12.5);

export function menuRow(id, label, onPress, t, { icon: name, danger, enabled = true, tip, tail } = {}) {
  const color = danger ? t.ansi1 : t.foreground;
  return h_flex().id(id).h(28).flex_none().px(8).gap(9).items_center().rounded(6).text_color(color)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onPress))
    .when(!enabled, (el) => el.opacity(0.45))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(Boolean(name), (el) => el.child(div().text_color(danger ? t.ansi1 : t.muted).child(icon(name, 13))))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(tail), (el) => el.child(tail));
}

export const menuLine = (t) => div().h(1).flex_none().mx(4).my(4).bg(t.border);

export const menuNote = (text, t) => div().flex_none().px(8).py(5).text_size(11.5).text_color(t.muted).child(text);

// The pair at the end of a question: "Force push main?"
export function confirmRow(prefix, yes, onYes, onNo, t) {
  const chip = (id, label, solid, onPress) => h_flex().id(id).h(26).px(10).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
    .when(solid, (el) => el.bg(t.ansi1).text_color("#ffffff"))
    .when(!solid, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_click(onPress).child(label);
  return h_flex().flex_none().px(4).pt(3).pb(2).gap(4).justify_end().child(chip(`${prefix}-no`, "Cancel", false, onNo)).child(chip(`${prefix}-yes`, yes, true, onYes));
}

// A press on its trigger also lands outside the surface, so it closes first and would reopen at once.
export class Opening {
  isOpen = false;
  closedAt = 0;
  open() { this.isOpen = true; }
  close() { if (this.isOpen) { this.isOpen = false; this.closedAt = Date.now(); } }
  justClosed() { return Date.now() - this.closedAt < 250; }
}
