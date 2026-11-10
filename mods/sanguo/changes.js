// A project's git, filling the center of the window: what's changed and its diff, which files go in
// the next commit, branches, and the remote. Herdr's own Changes panel only commits everything, so
// this grew out of it. Git runs on the project's machine, and only when asked to touch anything.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { focused, notify, panes, settings, theme, watchFolder } from "herdr";
import { abortOperation, commit, commitDiffLines, continueOperation, fileDiffLines, findRepoRoot, loadChanges, loadCommits, push, stage, stageAll, stoppedOperation, unstage, unstageAll } from "./git.js";
import { machineLabel, shownSpace } from "./machines.js";
import { plural } from "./sessions.js";
import { closeChanges, showingChanges } from "./views.js";
import { BranchPicker } from "./changes-branches.js";
import { SyncMenu } from "./changes-sync.js";
import { CommitWriter } from "./commit-writer.js";
import { icon, iconButton, spinner, stopPress } from "./changes-ui.js";

const REFRESH_MS = 10000, HISTORY_PAGE = 50;
const LIST_W = 300, FILE_H = 30, COMMIT_H = 46, DIFF_H = 20;
const STATUS_COLOR = { A: "ansi2", D: "ansi1", U: "ansi1", M: "blocked" };

// The repo of the session you're on, which may be below the project's folder.
function location() {
  const space = shownSpace(), f = space ? focused() : null;
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes {
  init(_props, cx) {
    this.files = []; this.head = { ahead: 0, behind: 0 }; this.stopped = null; this.limited = false;
    this.history = false; this.commits = []; this.commitCount = HISTORY_PAGE; this.moreCommits = false;
    this.open = null; this.commitShown = null; this.rows = []; this.diffWidth = 0;
    this.message = ""; this.note = null; this.error = null;
    this.staging = 0; this.stageQueue = Promise.resolve();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.message.trim());
      this.message = this.input.value();
      if (had !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.makeCommit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.branches = new BranchPicker(this);
    this.sync = new SyncMenu(this);
    this.writer = new CommitWriter(this);
    cx.timer.every(REFRESH_MS, (cx) => { if (showingChanges()) this.refresh(cx); });
  }

  repo() { return this.root ? { cwd: this.root, on: this.on } : null; }
  say(e) { this.note = String(e?.message ?? e); }
  clearNote() { this.note = null; }
  tickedCount() { return this.files.filter((f) => f.ticked !== "none").length; }
  closeMenus() { this.branches.close(); this.sync.close(); this.writer.close(); }
  menuIsOpen() { return this.branches.state.isOpen || this.sync.state.isOpen || this.writer.state.isOpen; }
  setMessage(text) { this.message = text; this.input.set_value(text); }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root && showingChanges()) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // A different repo starts clean; the same one keeps what you were doing.
  arriveAt(root, on) {
    if (root === this.root && on === this.on) return;
    this.root = root; this.on = on; this.watched = null;
    this.files = []; this.head = { ahead: 0, behind: 0 }; this.stopped = null; this.commits = []; this.commitShown = null; this.open = null; this.history = false;
    this.setLines([]); this.setMessage(""); this.note = null; this.closeMenus();
  }

  refresh(cx) {
    if (this.loading || this.busy || this.staging) { this.again = true; return; }
    const { cwd, on } = location(), context = key();
    this.context = context;
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const root = await findRepoRoot(cwd, on);
        if (key() !== context) { this.again = true; return; }
        if (!root) { this.arriveAt(null, on); this.error = "Not a git repository"; return; }
        const repo = { cwd: root, on }, { head, files, limited } = await loadChanges(repo), stopped = await stoppedOperation(repo);
        if (key() !== context) { this.again = true; return; }
        // A tick still on its way would be undone by what git said before it.
        if (this.staging) { this.again = true; return; }
        this.arriveAt(root, on);
        this.head = head; this.files = files; this.limited = limited; this.stopped = stopped; this.error = null;
        this.watch(root, cx);
        if (this.history) await this.loadHistory(repo);
        else await this.showOpenFile(context);
      } catch (e) {
        if (key() === context) this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        if (this.again) { this.again = false; this.refresh(cx); }
        cx.notify();
      }
    });
  }

  // The first file's diff shows until you pick another.
  async showOpenFile(context) {
    if (this.open && !this.files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
    if (!this.open && this.files.length) this.open = this.files[0].path;
    if (!this.open) return;
    const path = this.open, file = this.files.find((f) => f.path === path);
    const lines = await fileDiffLines(this.repo(), file, this.head.unborn).catch(() => ["Cannot preview this diff (too large or unreadable)"]);
    if (key() === context && this.open === path) this.setLines(lines);
  }

  async loadHistory(repo) {
    if (this.head.unborn) { this.commits = []; this.moreCommits = false; return; }
    const commits = await loadCommits(repo, this.commitCount + 1);
    this.moreCommits = commits.length > this.commitCount;
    this.commits = commits.slice(0, this.commitCount);
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map((line) => line.length * 7 + 60));
  }

  pick(path, cx) {
    if (this.open === path) return;
    this.open = path;
    this.setLines([]);
    const context = this.context;
    cx.spawn(async (cx) => {
      await this.showOpenFile(context);
      cx.notify();
    });
    cx.notify();
  }

  toggleHistory(cx) {
    this.history = !this.history;
    this.commitShown = null; this.open = null; this.commits = []; this.commitCount = HISTORY_PAGE;
    this.setLines([]);
    this.closeMenus();
    this.refresh(cx);
    cx.notify();
  }

  pickCommit(entry, cx) {
    if (this.commitShown?.sha === entry.sha) return;
    this.commitShown = entry;
    this.setLines([]);
    const repo = this.repo();
    cx.spawn(async (cx) => {
      const lines = await commitDiffLines(repo, entry.sha).catch((e) => [`Cannot show this commit: ${e.message ?? e}`]);
      if (this.commitShown?.sha === entry.sha) this.setLines(lines);
      cx.notify();
    });
    cx.notify();
  }

  // Anything that changes the repo, one at a time. A short word comes back as a toast; what git
  // refused stays on screen until it's dismissed.
  runGit(label, work, cx) {
    if (this.busy) return;
    this.busy = label; this.note = null;
    cx.notify();
    const root = this.root;
    cx.spawn(async (cx) => {
      try {
        const word = await work();
        if (word) notify({ title: word });
      } catch (e) {
        if (root === this.root) this.say(e);
      }
      this.busy = null;
      this.refresh(cx);
      cx.notify();
    });
  }

  async pushNow() {
    await push(this.repo(), this.head, false);
    return `Pushed ${this.head.branch}`;
  }

  makeCommit(cx) {
    const message = this.message.trim(), repo = this.repo();
    if (!message || !repo || this.busy || !this.tickedCount()) return;
    this.runGit("Committing…", async () => {
      await this.stageQueue; // A tick from just now goes in.
      await commit(repo, message);
      this.setMessage("");
    }, cx);
  }

  // The tick shows at once. Git follows in order, so quick clicks can't trip over each other.
  queueStage(work, cx) {
    this.staging++;
    const before = this.stageQueue;
    this.stageQueue = (async () => {
      await before;
      try { await work(); } catch (e) { this.say(e); }
    })();
    const done = this.stageQueue;
    cx.spawn(async (cx) => {
      await done;
      this.staging--;
      if (!this.staging) this.refresh(cx);
      cx.notify();
    });
    cx.notify();
  }

  toggleTick(file, cx) {
    if (this.busy) return;
    const repo = this.repo(), turnOn = file.ticked !== "all", unborn = this.head.unborn;
    file.ticked = turnOn ? "all" : "none";
    this.queueStage(() => (turnOn ? stage(repo, [file.path]) : unstage(repo, [file.path], unborn)), cx);
  }

  tickAll(turnOn, cx) {
    if (this.busy) return;
    const repo = this.repo(), unborn = this.head.unborn;
    for (const file of this.files) file.ticked = turnOn ? "all" : "none";
    this.queueStage(() => (turnOn ? stageAll(repo) : unstageAll(repo, unborn)), cx);
  }

  tickBox(file, t) {
    const on = file.ticked !== "none";
    return div().id(`tick-${file.path}`).size(24).flex_none().flex().items_center().justify_center().cursor_pointer()
      .tooltip(file.conflict ? "Has conflicts. Fix them first: ticking marks it as fixed." : file.ticked === "some" ? "Changed again since ticked. Tick to include the rest." : on ? "In the next commit" : "Not in the next commit")
      .on_mouse_down("left", stopPress)
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleTick(file, cx); })
      .child(div().size(15).flex().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent)).text_color(t.accent_foreground)
        .when(file.ticked === "all", (el) => el.child(icon("check", 11)))
        .when(file.ticked === "some", (el) => el.child(icon("minus", 11))));
  }

  fileRow(file, t) {
    const parts = file.path.split("/"), name = parts.pop();
    return h_flex().id(`change-${file.path}`).h(FILE_H).flex_none().pl(5).pr(10).gap(4).items_center().cursor_pointer()
      .when(this.open === file.path, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).tooltip(file.path)
      .on_click((_e, cx) => this.pick(file.path, cx))
      .child(this.tickBox(file, t))
      .child(div().w(14).flex_none().text_size(11).font_semibold().text_color(t[STATUS_COLOR[file.status]]).child(file.fresh ? "?" : file.status))
      .child(h_flex().flex_1().min_w(0).gap(7).items_center()
        .child(div().flex_shrink(0).max_w(190).truncate().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parts.join("/"))));
  }

  fileList(t) {
    const files = this.files;
    if (!files.length) return div().flex_1().min_h(0).p(14).text_color(t.dim).child(this.loading && !this.root ? "Loading changes…" : "No uncommitted changes");
    // Not a virtual list: its rows can't have handlers, and these are all handlers.
    return v_flex().id("changes-files").flex_1().min_h(0).overflow_y_scrollbar().children(files.map((file) => this.fileRow(file, t)));
  }

  tickFooter(t) {
    const chip = (id, label, turnOn) => div().id(id).h(24).px(9).flex_none().flex().items_center().rounded(6).text_size(11.5).text_color(t.muted).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.tickAll(turnOn, cx)).child(label);
    return h_flex().h(40).flex_none().px(10).gap(6).items_center().border_t(1).border_color(t.border)
      .child(chip("stage-all", "Stage All", true)).child(chip("unstage-all", "Unstage All", false))
      .child(div().flex_1())
      .when(this.limited, (el) => el.child(div().text_size(11).text_color(t.dim).child("First 1,000")));
  }

  commitRow(entry, t) {
    return v_flex().id(`commit-${entry.sha}`).h(COMMIT_H).flex_none().px(12).justify_center().gap(2).cursor_pointer()
      .when(this.commitShown?.sha === entry.sha, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).tooltip(entry.subject)
      .on_click((_e, cx) => this.pickCommit(entry, cx))
      .child(div().truncate().child(entry.subject))
      .child(h_flex().gap(6).text_size(11).text_color(t.dim).child(div().flex_none().child(entry.sha)).child(div().flex_none().child(entry.when)).child(div().min_w(0).truncate().child(entry.author)));
  }

  commitList(t) {
    return v_flex().id("changes-commits").flex_1().min_h(0).overflow_y_scrollbar()
      .children(this.commits.map((entry) => this.commitRow(entry, t)))
      .when(!this.commits.length, (el) => el.child(div().p(14).text_color(t.dim).child(this.loading ? "Loading commits…" : "No commits yet")))
      .when(this.moreCommits, (el) => el.child(h_flex().id("commits-more").h(34).flex_none().justify_center().items_center().text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.commitCount += HISTORY_PAGE; this.refresh(cx); }).child("Load more")));
  }

  leftPane(t) {
    const title = this.history ? "HISTORY" : `CHANGES (${this.files.length})`;
    return v_flex().w(LIST_W).flex_none().h_full().min_h(0).border_r(1).border_color(t.border)
      .child(h_flex().h(30).flex_none().px(12).items_center().text_size(11).font_semibold().text_color(t.dim).child(title))
      .child(this.history ? this.commitList(t) : this.fileList(t))
      .when(!this.history && this.files.length > 0, (el) => el.child(this.tickFooter(t)));
  }

  diffHeader(t) {
    const base = h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12);
    if (this.history) {
      const c = this.commitShown;
      if (!c) return base.text_color(t.dim).child("No commit selected");
      return base.child(div().flex_1().min_w(0).truncate().child(c.subject)).child(div().flex_none().text_size(11).text_color(t.dim).child(`${c.sha} · ${c.author} · ${c.when}`));
    }
    const file = this.files.find((f) => f.path === this.open);
    if (!file) return base.text_color(t.dim).child("No file selected");
    const parts = file.path.split("/"), name = parts.pop();
    return base.child(h_flex().flex_1().min_w(0).child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? `${parts.join("/")}/` : "")).child(div().flex_shrink(0).child(name)))
      .when(file.add > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${file.add}`)))
      .when(file.del > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${file.del}`)));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(DIFF_H).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(DIFF_H).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(38).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  emptyDiff(t) {
    const text = this.history ? "Select a commit to see what it changed" : this.files.length ? "Select a file to view its diff" : "Nothing to commit";
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).text_color(t.dim).child(icon("file", 26)).child(div().text_size(12.5).child(text));
  }

  diffBody(t) {
    if (!this.rows.length) return this.emptyDiff(t);
    return div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5)
      .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, DIFF_H, (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
      .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0());
  }

  stoppedBar(t) {
    const what = this.stopped === "rebase" ? "Rebase" : "Merge", conflicts = this.files.filter((f) => f.conflict).length, repo = this.repo(), operation = this.stopped;
    const text = conflicts ? `${what} stopped: ${plural(conflicts, "file")} with conflicts. Fix them in a session, tick them, then continue.` : `${what} is waiting to be finished.`;
    const chip = (id, label, onPress) => div().id(id).h(24).px(10).flex_none().flex().items_center().rounded(6).text_size(12).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onPress).child(label);
    return h_flex().min_h(38).flex_none().px(12).gap(8).items_center().bg(t.blocked + "22").border_b(1).border_color(t.border)
      .child(div().text_color(t.blocked).child(icon("alert", 14)))
      .child(div().flex_1().min_w(0).text_size(12.5).child(text))
      .child(chip("stopped-continue", "Continue", (_e, cx) => this.runGit("Continuing…", async () => { await continueOperation(repo, operation); }, cx)))
      .child(chip("stopped-abort", "Abort", (_e, cx) => this.runGit("Aborting…", async () => { await abortOperation(repo, operation); return `${what} aborted`; }, cx)));
  }

  noteBar(t) {
    return h_flex().flex_none().pl(12).pr(6).py(6).gap(6).items_start().bg(t.ansi1 + "18").border_t(1).border_color(t.border)
      .child(v_flex().id("changes-note").flex_1().min_w(0).max_h(110).overflow_y_scrollbar().text_size(12).text_color(t.foreground).font_family(settings().font_family ?? "JetBrains Mono")
        .children(this.note.split("\n").map((line) => div().flex_none().child(line))))
      .child(iconButton("note-close", "x", "Dismiss", (_e, cx) => { this.note = null; cx.notify(); }, t));
  }

  commitBar(t) {
    const ticked = this.tickedCount(), head = this.head;
    const canCommit = Boolean(this.message.trim()) && ticked > 0 && !this.busy;
    const canPush = Boolean(head.branch) && !head.unborn && !this.busy && (head.ahead > 0 || !head.upstream || head.gone);
    const commitTip = !ticked ? "Tick the files to commit" : !this.message.trim() ? "Write a message, or press ✨" : `Commit ${plural(ticked, "file")}`;
    const pushTip = !head.branch ? "This checkout isn't on a branch" : canPush ? `Push ${head.branch}` : head.upstream ? "Nothing to push" : "Make a commit first";
    return h_flex().flex_none().p(10).gap(8).items_center().border_t(1).border_color(t.border)
      .child(this.writer.render(t))
      .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", stopPress)
        .child(Input.new(this.input).h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().id("commit").h(32).px(14).flex_none().flex().items_center().rounded(8).text_size(12.5).tooltip(commitTip)
        .bg(canCommit ? t.solid : t.raised).text_color(canCommit ? t.solid_foreground : t.dim)
        .when(canCommit, (el) => el.cursor_pointer().on_click((_e, cx) => this.makeCommit(cx)))
        .child(`Commit (${ticked})`))
      .child(h_flex().id("push").h(32).px(12).gap(6).flex_none().items_center().rounded(8).text_size(12.5).tooltip(pushTip)
        .bg(t.raised).text_color(canPush ? t.foreground : t.dim)
        .when(canPush, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.runGit("Pushing…", () => this.pushNow(), cx)))
        .child(icon("arrow-up", 13))
        .child(head.ahead > 0 ? `Push ${head.ahead}` : "Push"));
  }

  header(t) {
    const space = shownSpace(), head = this.head, counted = (text, tip) => div().flex_none().text_size(11.5).text_color(t.muted).tooltip(tip).child(text);
    return h_flex().h(46).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().max_w(240).truncate().text_size(14).font_semibold().tooltip(this.root ?? "").child(space?.name ?? ""))
      .when(Boolean(this.on), (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(machineLabel(this.on))))
      .when(Boolean(this.root), (el) => el.child(this.branches.render(t)))
      .when(head.ahead > 0, (el) => el.child(counted(`↑${head.ahead}`, `${plural(head.ahead, "commit")} to push`)))
      .when(head.behind > 0, (el) => el.child(counted(`↓${head.behind}`, `${plural(head.behind, "commit")} to pull`)))
      .when(Boolean(head.gone), (el) => el.child(counted("upstream gone", "Its branch on the remote has been deleted")))
      .when(Boolean(this.root && head.branch && !head.upstream && !head.gone && !head.unborn), (el) => el.child(counted("not pushed yet", "This branch isn't on a remote")))
      .child(div().flex_1())
      .when(Boolean(this.busy), (el) => el.child(h_flex().gap(6).items_center().pr(6).text_size(12).text_color(t.muted).child(spinner(t)).child(this.busy)))
      .when(Boolean(this.root), (el) => el
        .child(iconButton("changes-history", "clock", this.history ? "Back to changes" : "Commit history", (_e, cx) => this.toggleHistory(cx), t, this.history))
        .child(this.sync.render(t))
        .child(iconButton("changes-refresh", "refresh", "Look again", (_e, cx) => this.refresh(cx), t)))
      .child(iconButton("changes-close", "x", "Close", () => closeChanges(), t));
  }

  onKey(e, cx) {
    if (e.key !== "escape") return;
    if (this.menuIsOpen()) this.closeMenus();
    else if (this.typing) { this.typing = false; this.handle.focus(); }
    else closeChanges();
    cx.stop_propagation();
    cx.notify();
  }

  render(cx) {
    const showing = showingChanges();
    if (!showing) { this.holding = false; return div().id("changes").size_full(); }
    // Holds the keyboard while shown, so typing never lands in a hidden terminal.
    if (!this.holding) { this.holding = true; cx.spawn(async () => this.handle.focus()); this.refresh(cx); }
    else if (key() !== this.context) this.refresh(cx);
    const t = theme();
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.header(t))
      .when(Boolean(this.stopped), (el) => el.child(this.stoppedBar(t)))
      .when(!this.root, (el) => el.child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(8).text_color(t.dim)
        .child(icon("branch", 26)).child(this.loading ? "Looking for the repo…" : this.error ?? "Not a git repository").child(div().text_size(11.5).child(location().cwd ?? ""))))
      .when(Boolean(this.root), (el) => el
        .child(h_flex().flex_1().min_h(0)
          .child(this.leftPane(t))
          .child(v_flex().flex_1().min_w(0).h_full().child(this.diffHeader(t)).child(this.diffBody(t))))
        .when(Boolean(this.note), (bar) => bar.child(this.noteBar(t)))
        .when(!this.history, (bar) => bar.child(this.commitBar(t))));
  }
}
