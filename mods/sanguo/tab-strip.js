// A browser's row of tabs, for the sessions along the top and for Notes. Tabs shrink to a floor, then
// the row scrolls sideways; the + after it stays beside the last tab, and at the far right once they overflow.
// Every tab has an outline, so one that isn't open still reads as a tab; the open one is filled.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

const TAB_MIN = 150, TAB_MAX = 230;
const stop = (_e, cx) => cx.stop_propagation();

export const tabChip = (id, open, t) => h_flex().id(id).h(29).min_w(TAB_MIN).max_w(TAB_MAX).px(10).gap(7).rounded(7).items_center().text_size(12.8)
  .border(1).border_color(open ? t.input : t.border).bg(open ? t.raised : t.chrome).text_color(open ? t.foreground : t.muted)
  .hover((s) => s.bg(t.hover));

// The × on a tab. A press on it never reaches the tab under it.
export const tabClose = (id, tip, onPress, t) => div().id(id).flex_none().tooltip(tip).text_color(t.dim).on_mouse_down("left", stop)
  .on_click((e, cx) => { cx.stop_propagation(); onPress(e, cx); }).child(svg("mods/pane/close.svg").size(12));

export const tabRow = (id, tabs) => h_flex().id(id).flex_shrink(1).min_w(0).h_full().items_center().gap(4).overflow_x_scroll().children(tabs);

// A small square button on a bar: the + after the tabs, and the window's own buttons.
export const barButton = (id, label, onPress, t) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
  .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(onPress).child(label);
