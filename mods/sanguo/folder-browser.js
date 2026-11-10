// Browsing folders on another machine, where the system's folder picker can't reach. It reads the
// folders there as you go, and only says which one when you choose it.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { listFolders } from "./projects.js";

const LIST_H = 216, ROW_H = 28, MAX_ROWS = 500;
const FOLDER_ICON = "mods/files/folder.svg", UP_ICON = "mods/workspace-chrome/chevron-left.svg", REPO_ICON = "mods/workspace-chrome/git-branch.svg";

export class FolderBrowser {
  constructor(onChoose) {
    this.onChoose = onChoose;
    this.isOpen = false;
    this.machine = null;
    this.at = null;
    this.folders = [];
    this.loading = false;
    this.error = null;
    this.asked = 0; // The last look wins, however the answers arrive.
  }

  open(path, machine, cx) {
    this.isOpen = true;
    this.machine = machine;
    this.at = null;
    this.folders = [];
    this.go(path, cx);
  }

  close() {
    this.isOpen = false;
    this.asked++;
  }

  go(path, cx) {
    const asked = ++this.asked, machine = this.machine;
    this.loading = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const { at, folders } = await listFolders(path, machine);
        if (asked !== this.asked) return;
        this.at = at;
        this.folders = folders;
      } catch (e) {
        if (asked !== this.asked) return;
        this.error = String(e.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
    cx.notify();
  }

  up(cx) {
    this.go(this.at.replace(/\/[^/]*$/, "") || "/", cx);
  }

  row(folder, t) {
    return h_flex().id(`folder-${folder.name}`).h(ROW_H).flex_none().px(8).gap(8).items_center().rounded(6).text_size(12.5).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.go(`${this.at === "/" ? "" : this.at}/${folder.name}`, cx))
      .child(svg(FOLDER_ICON).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(folder.name))
      .when(folder.git, (el) => el.child(svg(REPO_ICON).size(12).flex_none().text_color(t.dim).tooltip("A git repo")));
  }

  message(t) {
    const text = this.error ?? (this.loading ? "Looking…" : "No folders here");
    return div().p(8).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(text);
  }

  render(t) {
    const canGoUp = Boolean(this.at) && this.at !== "/", ready = Boolean(this.at) && !this.loading && !this.error;
    return v_flex().mt(8).flex_none().rounded(8).border(1).border_color(t.input).bg(t.background).overflow_hidden()
      .child(h_flex().h(36).flex_none().pl(5).pr(5).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().id("folder-up").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(canGoUp ? t.muted : t.dim)
          .when(canGoUp, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Up a folder").on_click((_e, cx) => this.up(cx)))
          .child(svg(UP_ICON).size(14)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(this.at ?? "").child(this.at ?? ""))
        .child(div().id("folder-use").h(26).px(10).flex_none().flex().items_center().rounded(6).text_size(12)
          .bg(ready ? t.solid : t.raised).text_color(ready ? t.solid_foreground : t.dim)
          .when(ready, (el) => el.cursor_pointer().on_click((_e, cx) => this.onChoose(this.at, cx)))
          .child("Use this folder")))
      .child(v_flex().id("folder-list").h(LIST_H).flex_none().p(4).overflow_y_scrollbar()
        .when(this.folders.length > 0 && !this.error, (el) => el.children(this.folders.slice(0, MAX_ROWS).map((folder) => this.row(folder, t))))
        .when(!this.folders.length || Boolean(this.error), (el) => el.child(this.message(t))));
  }
}
