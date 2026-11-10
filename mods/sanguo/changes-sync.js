// The menu of what goes to and from the remote, and the stash.
import { div } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { dropStash, fetchAll, loadStashes, popStash, pull, pullRebase, push, stashAll, stashTicked } from "./git.js";
import { Opening, confirmRow, icon, menuLine, menuNote, menuRow, surface } from "./changes-ui.js";

const WIDTH = 250, STASH_WIDTH = 330;

export class SyncMenu {
  constructor(view) {
    this.view = view;
    this.state = new Opening();
    this.page = "main"; // main, stash, force
    this.stashes = [];
    this.dropping = null;
  }

  close() { this.state.close(); }

  toggle(cx) {
    if (this.state.isOpen) this.state.close();
    else if (!this.state.justClosed()) {
      this.view.closeMenus();
      this.state.open();
      this.page = "main";
      this.dropping = null;
    }
    cx.notify();
  }

  // Closes first: what happens next shows in the view, not behind this.
  act(label, work, cx) {
    this.state.close();
    this.view.runGit(label, work, cx);
  }

  showStash(cx) {
    this.page = "stash";
    this.dropping = null;
    const repo = this.view.repo();
    cx.spawn(async (cx) => {
      this.stashes = await loadStashes(repo).catch(() => []);
      cx.notify();
    });
    cx.notify();
  }

  mainPage(t) {
    const repo = this.view.repo(), head = this.view.head;
    return surface("sync-menu", t, WIDTH).on_mouse_down_out((_e, cx) => { this.state.close(); cx.notify(); })
      .child(menuRow("sync-fetch", "Fetch", (_e, cx) => this.act("Fetching…", async () => { await fetchAll(repo); return "Fetched"; }, cx), t, { icon: "cloud" }))
      .child(menuRow("sync-pull", "Pull", (_e, cx) => this.act("Pulling…", async () => (/up to date/i.test(await pull(repo)) ? "Already up to date" : `Pulled ${head.branch}`), cx), t, { icon: "arrow-down", tip: "Only if it just moves your branch forward" }))
      .child(menuRow("sync-rebase", "Pull (rebase)", (_e, cx) => this.act("Pulling…", async () => (/up to date/i.test(await pullRebase(repo)) ? "Already up to date" : `Rebased ${head.branch}`), cx), t, { icon: "arrow-down", tip: "Puts your commits on top of what's on the remote" }))
      .child(menuRow("sync-push", "Push", (_e, cx) => this.act("Pushing…", () => this.view.pushNow(), cx), t, { icon: "arrow-up" }))
      .child(menuRow("sync-force", "Force Push (with lease)", (_e, cx) => { this.page = "force"; cx.notify(); }, t, { icon: "alert", danger: true, tip: "Replaces the remote branch with yours, unless someone else has pushed since your last fetch" }))
      .child(menuLine(t))
      .child(menuRow("sync-stash", "Stash", (_e, cx) => this.showStash(cx), t, { icon: "archive", tail: div().text_color(t.dim).child(icon("right", 12)) }));
  }

  forcePage(t) {
    const repo = this.view.repo(), head = this.view.head;
    return surface("sync-force-page", t, WIDTH + 30).on_mouse_down_out((_e, cx) => { this.state.close(); cx.notify(); })
      .child(div().flex_none().px(8).pt(5).font_semibold().child(`Force push ${head.branch ?? ""}?`))
      .child(menuNote(`This replaces ${head.upstream ?? "the remote branch"} with your branch. Commits only on the remote are lost. Git stops if someone else has pushed since your last fetch.`, t))
      .child(confirmRow("force", "Force Push", (_e, cx) => this.act("Pushing…", async () => { await push(repo, head, true); return `Force pushed ${head.branch}`; }, cx), (_e, cx) => { this.page = "main"; cx.notify(); }, t));
  }

  stashRow(entry, t) {
    const repo = this.view.repo(), asking = this.dropping === entry.ref;
    const chip = (id, label, danger, onPress) => div().id(id).h(22).px(7).flex_none().flex().items_center().rounded(5).text_size(11.5).cursor_pointer().text_color(danger ? t.ansi1 : t.muted).hover((s) => s.bg(t.hover)).on_click(onPress).child(label);
    return v_flex().flex_none()
      .child(h_flex().h(30).flex_none().pl(8).pr(2).gap(4).items_center().rounded(6)
        .child(div().flex_1().min_w(0).truncate().tooltip(entry.subject).child(entry.subject))
        .child(chip(`stash-pop-${entry.ref}`, "Pop", false, (_e, cx) => this.act("Popping stash…", async () => { await popStash(repo, entry.ref); }, cx)))
        .child(chip(`stash-drop-${entry.ref}`, "Drop", true, (_e, cx) => { this.dropping = asking ? null : entry.ref; cx.notify(); })))
      .when(asking, (el) => el.child(menuNote("Drop this stash? Its changes are gone for good.", t))
        .child(confirmRow(`drop-${entry.ref}`, "Drop", (_e, cx) => this.act("Dropping stash…", async () => { await dropStash(repo, entry.ref); return "Stash dropped"; }, cx), (_e, cx) => { this.dropping = null; cx.notify(); }, t)));
  }

  stashPage(t) {
    const repo = this.view.repo(), ticked = this.view.tickedCount(), changed = this.view.files.length > 0;
    return surface("sync-stash-page", t, STASH_WIDTH).on_mouse_down_out((_e, cx) => { this.state.close(); cx.notify(); })
      .child(menuRow("stash-back", "Stash", (_e, cx) => { this.page = "main"; cx.notify(); }, t, { icon: "left" }))
      .child(menuLine(t))
      .child(menuRow("stash-all", "Stash all changes", (_e, cx) => this.act("Stashing…", async () => { await stashAll(repo); return "Changes stashed"; }, cx), t, { enabled: changed, tip: "Includes new files" }))
      .child(menuRow("stash-ticked", `Stash ticked files (${ticked})`, (_e, cx) => this.act("Stashing…", async () => { await stashTicked(repo); return "Ticked files stashed"; }, cx), t, { enabled: ticked > 0 }))
      .when(this.stashes.length > 0, (el) => el.child(menuLine(t))
        .child(v_flex().id("stash-list").flex_none().max_h(190).overflow_y_scrollbar().children(this.stashes.map((entry) => this.stashRow(entry, t)))));
  }

  render(t) {
    const open = this.state.isOpen;
    const trigger = h_flex().id("sync-button").h(28).px(6).gap(3).flex_none().items_center().rounded(7).cursor_pointer()
      .text_color(open ? t.foreground : t.muted).when(open, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Fetch, pull, push and stash").on_click((_e, cx) => this.toggle(cx))
      .child(icon("sync")).child(icon("down", 11));
    const page = () => (this.page === "stash" ? this.stashPage(t) : this.page === "force" ? this.forcePage(t) : this.mainPage(t));
    return Popup.new("sync-popup", trigger).anchor("top_right").when(open, (el) => el.content(page()));
  }
}
