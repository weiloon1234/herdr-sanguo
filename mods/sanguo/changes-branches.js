// The branch picker: search, switch, make a new one, and the ... menu on each branch.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Popup } from "gpui-base";
import { checkoutRemote, createBranch, deleteBranch, listBranches, merge, mergeInto, pushTo, rebase, renameBranch, switchBranch } from "./git.js";
import { Opening, confirmRow, icon, menuLine, menuNote, menuRow, spinner, stopPress, surface } from "./changes-ui.js";

const WIDTH = 340, MENU_WIDTH = 300, LIST_MAX = 372, MAX_ROWS = 200;

export class BranchPicker {
  constructor(view) {
    this.view = view;
    this.state = new Opening();
    this.local = []; this.remote = [];
    this.loading = false;
    this.query = "";
    this.naming = null; // null, "new" or "rename"
    this.menu = null; // The branch whose ... menu is open.
    this.confirmingDelete = false;
    this.search = InputState.new({ placeholder: "Search branches" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("submit", (_e, cx) => this.pickFirstMatch(cx));
    this.name = InputState.new({ placeholder: "Branch name" });
    this.name.on("submit", (_e, cx) => this.submitName(cx));
  }

  // A press in the ... menu is outside the picker too, and mustn't close it from under the menu.
  close() {
    this.menu = null;
    this.state.close();
  }

  toggle(cx) {
    if (this.state.isOpen) this.close();
    else if (!this.state.justClosed()) this.open(cx);
    cx.notify();
  }

  open(cx) {
    this.view.closeMenus();
    this.state.open();
    this.query = ""; this.search.set_value(""); this.naming = null; this.menu = null; this.confirmingDelete = false;
    this.loading = true;
    const repo = this.view.repo();
    cx.spawn(async (cx) => {
      try {
        const { local, remote } = await listBranches(repo);
        this.local = local; this.remote = remote;
      } catch (e) { this.view.say(e); }
      this.loading = false;
      cx.notify();
    });
    cx.timer.after(40, () => this.search.focus());
  }

  act(label, work, cx) {
    this.close();
    this.view.runGit(label, work, cx);
  }

  startNaming(mode, cx) {
    this.naming = mode; this.menu = null;
    this.name.set_value(mode === "rename" ? this.view.head.branch ?? "" : "");
    cx.timer.after(40, () => this.name.focus());
    cx.notify();
  }

  cancelNaming(cx) {
    this.naming = null;
    cx.timer.after(40, () => this.search.focus());
    cx.notify();
  }

  submitName(cx) {
    const name = this.name.value().trim(), repo = this.view.repo();
    if (!name) return;
    if (this.naming === "rename") this.act("Renaming…", async () => { await renameBranch(repo, name); }, cx);
    else this.act("Creating branch…", async () => { await createBranch(repo, name); }, cx);
  }

  matches(list) {
    const wanted = this.query.trim().toLowerCase();
    return (wanted ? list.filter((b) => b.name.toLowerCase().includes(wanted)) : list).slice(0, MAX_ROWS);
  }

  isCurrent(branch) { return !branch.remote && branch.name === this.view.head.branch; }

  // A click goes to it. A remote branch you don't have yet comes down as a local one.
  go(branch, cx) {
    const repo = this.view.repo();
    if (this.isCurrent(branch)) { this.close(); cx.notify(); return; }
    if (branch.remote) {
      const hasLocal = this.local.some((b) => b.name === branch.branch);
      this.act("Switching…", async () => { await checkoutRemote(repo, branch, hasLocal); }, cx);
    } else this.act("Switching…", async () => { await switchBranch(repo, branch.name); }, cx);
  }

  pickFirstMatch(cx) {
    const first = this.matches(this.local)[0] ?? this.matches(this.remote)[0];
    if (first) this.go(first, cx);
  }

  actionsFor(branch, t) {
    const repo = this.view.repo(), current = this.view.head.branch, name = branch.name;
    const row = (id, label, work, busy, said) => menuRow(`branch-${id}-${name}`, label, (_e, cx) => this.act(busy, async () => { await work(); return said; }, cx), t, { tip: label });
    if (this.isCurrent(branch)) return [menuRow(`branch-rename-${name}`, "Rename…", (_e, cx) => this.startNaming("rename", cx), t)];
    if (branch.remote) {
      return [
        menuRow(`branch-checkout-${name}`, "Checkout as local branch", (_e, cx) => this.go(branch, cx), t),
        ...(current ? [
          menuLine(t),
          row("merge", `Merge ${name} into ${current}`, () => merge(repo, name), "Merging…", `Merged ${name}`),
          row("push", `Push ${current} to ${name}`, () => pushTo(repo, current, branch), "Pushing…", `Pushed ${current} to ${name}`),
          row("rebase", `Rebase ${current} onto ${name}`, () => rebase(repo, name), "Rebasing…", `Rebased ${current}`),
        ] : []),
      ];
    }
    if (this.confirmingDelete) {
      return [
        menuNote(`Delete ${name}? Git refuses if it has commits that aren't merged.`, t),
        confirmRow(`branch-delete-${name}`, "Delete", (_e, cx) => this.act("Deleting branch…", async () => { await deleteBranch(repo, name); return `Deleted ${name}`; }, cx), (_e, cx) => { this.confirmingDelete = false; cx.notify(); }, t),
      ];
    }
    return [
      menuRow(`branch-switch-${name}`, `Switch to ${name}`, (_e, cx) => this.go(branch, cx), t),
      ...(current ? [
        menuLine(t),
        row("merge", `Merge ${name} into ${current}`, () => merge(repo, name), "Merging…", `Merged ${name}`),
        row("merge-into", `Merge ${current} into ${name}`, () => mergeInto(repo, current, name), "Merging…", `On ${name}, merged ${current}`),
        row("rebase", `Rebase ${current} onto ${name}`, () => rebase(repo, name), "Rebasing…", `Rebased ${current}`),
      ] : []),
      menuLine(t),
      menuRow(`branch-delete-${name}`, `Delete ${name}`, (_e, cx) => { this.confirmingDelete = true; cx.notify(); }, t, { danger: true }),
    ];
  }

  moreButton(branch, t) {
    const open = this.menu === branch.name;
    const dots = div().id(`branch-more-${branch.name}`).size(22).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(open ? t.input : t.border).cursor_pointer()
      .text_color(open ? t.foreground : t.muted).when(open, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("More for this branch").on_mouse_down("left", stopPress)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.menu = open ? null : branch.name;
        this.confirmingDelete = false;
        cx.notify();
      })
      .child(icon("more", 13));
    return Popup.new(`branch-popup-${branch.name}`, dots).anchor("top_right").when(open, (el) => el.content(
      surface(`branch-menu-${branch.name}`, t, MENU_WIDTH).on_mouse_down_out((_e, cx) => { this.menu = null; this.confirmingDelete = false; cx.notify(); })
        .children(this.actionsFor(branch, t))));
  }

  row(branch, t) {
    const current = this.isCurrent(branch);
    return h_flex().id(`branch-row-${branch.name}`).h(32).flex_none().pl(8).pr(4).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(current ? "You're on this branch" : branch.remote ? "Click to check it out here" : "Click to switch to it")
      .on_click((_e, cx) => this.go(branch, cx))
      .child(div().w(15).flex_none().flex().items_center().justify_center().text_color(current ? t.accent : t.dim)
        .when(current, (el) => el.child(icon("check", 14))).when(Boolean(branch.remote), (el) => el.child(icon("cloud", 14))))
      .child(div().flex_1().min_w(0).truncate().when(current, (el) => el.font_semibold()).child(branch.name))
      .when(branch.ahead > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`↑${branch.ahead}`)))
      .when(branch.behind > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`↓${branch.behind}`)))
      .child(this.moreButton(branch, t));
  }

  section(title, rows, t) {
    return rows.length ? [div().h(24).flex_none().px(8).flex().items_center().text_size(10.5).font_semibold().text_color(t.dim).child(title), ...rows.map((b) => this.row(b, t))] : [];
  }

  topRow(t) {
    if (this.naming) {
      const renaming = this.naming === "rename", current = this.view.head.branch;
      return v_flex().flex_none().gap(4)
        .child(div().px(6).pt(2).text_size(11).text_color(t.dim).child(renaming ? `Rename ${current} to` : `New branch from ${current ?? "here"}`))
        .child(h_flex().h(30).flex_none().pl(6).pr(4).gap(6).items_center()
          .child(div().flex_1().min_w(0).child(Input.new(this.name).text_size(12.5).text_color(t.foreground)))
          .child(div().id("branch-name-cancel").size(24).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover)).tooltip("Cancel").on_click((_e, cx) => this.cancelNaming(cx)).child(icon("x", 13))));
    }
    return h_flex().h(30).flex_none().pl(6).pr(4).gap(6).items_center()
      .child(div().text_color(t.dim).child(icon("search", 13)))
      .child(div().flex_1().min_w(0).child(Input.new(this.search).text_size(12.5).text_color(t.foreground)))
      .child(div().id("branch-new").size(24).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("New branch").on_click((_e, cx) => this.startNaming("new", cx)).child(icon("plus", 14)));
  }

  content(t) {
    const local = this.matches(this.local), remote = this.matches(this.remote);
    return surface("branch-picker", t, WIDTH)
      .on_mouse_down_out((_e, cx) => { if (!this.menu) { this.close(); cx.notify(); } })
      .child(this.topRow(t))
      .when(!this.naming, (el) => el.child(div().h(1).flex_none().mx(2).my(4).bg(t.border))
        .child(v_flex().id("branch-list").flex_none().max_h(LIST_MAX).overflow_y_scrollbar()
          .children(this.section("LOCAL", local, t)).children(this.section("REMOTE", remote, t))
          .when(!local.length && !remote.length, (list) => list.child(h_flex().h(40).flex_none().px(8).gap(8).items_center().text_color(t.dim)
            .when(this.loading, (row) => row.child(spinner(t))).child(this.loading ? "Loading branches…" : "No branch matches")))));
  }

  render(t) {
    const head = this.view.head, open = this.state.isOpen;
    const label = head.branch ?? (head.detached ? "Detached HEAD" : "…");
    const trigger = h_flex().id("branch-button").h(26).px(7).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
      .text_color(open ? t.foreground : t.muted).when(open, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Branches").on_click((_e, cx) => this.toggle(cx))
      .child(icon("branch", 13)).child(div().max_w(280).truncate().text_color(t.foreground).child(label)).child(icon("down", 11));
    return Popup.new("branch-popup", trigger).anchor("top_left").when(open, (el) => el.content(this.content(t)));
  }
}
