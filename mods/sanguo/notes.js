// Notes: a scratchpad in the session area, opened like Changes, with a tab per note. Each machine keeps
// its own notes on its disk (notes-store.js), so every window connected to it shows and edits the same
// ones. Typing saves by itself, and what another window writes shows up here within seconds.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { settings, shared, setShared, theme, window } from "herdr";
import { currentMachine, machineKey, machineLabel, machineLayout } from "./machines.js";
import { closeNotes, showingNotes } from "./views.js";
import { closeNote, dropNote, listNotes, newNoteId, noteTitle, readNotes, reopenNote, writeNote } from "./notes-store.js";
import { icon, iconButton, spinner } from "./changes-ui.js";
import { barButton, tabChip, tabClose, tabRow } from "./tab-strip.js";
import { keyHint } from "./key-hints.js";

const TICK_MS = 400;
const SAVE_PAUSE_MS = 600, SAVE_EVERY_MS = 4000; // After a pause in typing, and at least this often during it.
const LOOK_MS = 3000, LOOK_BEHIND_MS = 20000, RETRY_MS = 8000; // For what other windows wrote.
const UNDO_MS = 10000, SAY_MS = 12000;
const SELECTED = "sanguo.notes-tab"; // machine -> the note this window shows there
const PLACEHOLDER = "Anything to keep at hand: a todo, a key, a command. It saves as you type.";

// One machine's notes, as this window has them.
class Book {
  constructor(machine) { this.machine = machine; }
  notes = []; // In the order they were made.
  gone = new Set(); // Closed here: whatever a look already on its way says, they stay closed.
  loaded = false;
  busy = false; // Reading from the machine.
  error = null;
  lookedAt = 0;
}

export default class Notes {
  init(_props, cx) {
    this.cx = cx; // Lasts as long as this build of the mod.
    this.books = new Map();
    this.handle = cx.focus_handle();
    this.typing = false;
    this.shownOn = null; // The machine whose notes are on screen, while they are.
    this.focusNext = null; // A note to put the keyboard in once drawn, or "view".
    this.closed = null; // { machine, id, title, until }: what Undo brings back.
    this.said = null; // { text, until }
    this.hovered = null;
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  book(machine = currentMachine()) {
    const key = machineKey(machine);
    if (!this.books.has(key)) this.books.set(key, new Book(machine));
    return this.books.get(key);
  }

  selected(book) {
    const want = shared(SELECTED)?.[machineKey(book.machine)];
    return book.notes.find((n) => n.id === want) ?? book.notes[book.notes.length - 1] ?? null;
  }

  select(book, note) {
    setShared(SELECTED, { ...(shared(SELECTED) ?? {}), [machineKey(book.machine)]: note.id });
    if (machineKey(book.machine) === this.shownOn) this.focusNext = note;
  }

  say(text) {
    this.said = { text, until: Date.now() + SAY_MS };
  }

  // `version` "-": not on the machine yet. A note never typed in stays off it.
  makeNote(book, { id, version, text }) {
    const note = { id, version, saved: text, title: noteTitle(text), changedAt: 0, dirtySince: null, saving: false, error: null, retryAt: 0, gone: false, wroteAt: 0, filler: false };
    note.state = TextareaState.new({ value: text, placeholder: PLACEHOLDER });
    note.state.on("change", (_e, cx) => this.changed(note, cx));
    note.state.on("focus", () => { this.typing = true; });
    note.state.on("blur", () => {
      this.typing = false;
      if (note.dirtySince !== null && !note.saving && !note.gone) this.save(book, note);
    });
    return note;
  }

  add(book, note) {
    book.notes.push(note);
    book.notes.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // Off the screen. Its text box goes once the writes waiting on it are done.
  remove(book, note) {
    const at = book.notes.indexOf(note);
    if (at >= 0) book.notes.splice(at, 1);
    note.gone = true;
    this.later(note, async () => note.state.release());
    this.fill(book);
    return at;
  }

  // A machine with no notes still shows one, blank, to type in.
  fill(book) {
    if (book.notes.length) return;
    const note = this.makeNote(book, { id: newNoteId(), version: "-", text: "" });
    note.filler = true;
    this.add(book, note);
  }

  changed(note, cx) {
    const was = note.dirtySince, title = noteTitle(note.state.value());
    note.changedAt = Date.now();
    note.dirtySince ??= note.changedAt;
    if (title !== note.title || was === null) { note.title = title; cx.notify(); }
  }

  // One write at a time for each note, each over the version the one before it left.
  later(note, job) {
    const before = note.queue ?? Promise.resolve();
    let done;
    note.queue = new Promise((resolve) => { done = resolve; });
    this.cx.spawn(async (cx) => {
      try { await before; await job(cx); } catch {} finally { done(); }
    });
  }

  save(book, note) {
    note.saving = true;
    this.later(note, async (cx) => {
      try {
        const text = note.state.value(); // As it is when its turn comes.
        if (text !== note.saved) {
          const r = await writeNote(book.machine, note.id, note.version, text);
          if (r.conflict !== undefined) await this.keepBoth(book, note, r.conflict);
          else { note.version = r.version; note.saved = text; note.wroteAt = Date.now(); }
        }
        note.error = null; note.retryAt = 0;
      } catch (e) {
        note.error = String(e.message ?? e); note.retryAt = Date.now() + RETRY_MS;
      } finally {
        note.saving = false;
        if (!note.gone && note.state.value() === note.saved) note.dirtySince = null;
        cx.notify();
      }
    });
  }

  // Another window wrote this note, or closed it, after this one read it. What you typed becomes a
  // note of its own beside it, and this tab shows theirs.
  async keepBoth(book, note, theirs) {
    const mine = note.state.value(), id = newNoteId();
    const { version } = await writeNote(book.machine, id, "-", mine);
    const fresh = theirs === "-" ? null : (await readNotes(book.machine, [note.id]))[0];
    const copy = this.makeNote(book, { id, version, text: mine });
    copy.wroteAt = note.wroteAt = Date.now();
    this.add(book, copy);
    if (fresh) {
      note.version = fresh.version; note.saved = fresh.text; note.title = noteTitle(fresh.text);
      note.state.set_value(fresh.text);
    } else this.remove(book, note);
    this.select(book, copy);
    this.say(`“${copy.title}” was changed in another window too. Yours is kept as a tab of its own.`);
  }

  tick(cx) {
    const now = Date.now();
    for (const book of this.books.values()) {
      for (const note of book.notes) {
        if (note.dirtySince === null || note.saving || now < note.retryAt) continue;
        if (now - note.changedAt >= SAVE_PAUSE_MS || now - note.dirtySince >= SAVE_EVERY_MS) this.save(book, note);
      }
    }
    if (this.closed && now >= this.closed.until) { this.closed = null; cx.notify(); }
    if (this.said && now >= this.said.until) { this.said = null; cx.notify(); }
    if (!showingNotes()) return;
    const book = this.book();
    if (book.busy || (book.machine && machineLayout(book.machine) === "unavailable")) return;
    const every = !book.loaded ? (book.error ? RETRY_MS : 0) : window()?.active !== false ? LOOK_MS : LOOK_BEHIND_MS;
    if (now - book.lookedAt >= every) (book.loaded ? this.look(book) : this.load(book));
  }

  load(book) {
    book.busy = true;
    const since = Date.now();
    this.cx.spawn(async (cx) => {
      try {
        const all = await readNotes(book.machine);
        this.merge(book, all, all.map((n) => n.id), since);
        book.loaded = true; book.error = null;
        if (this.shownOn === machineKey(book.machine)) this.focusNext = this.selected(book);
      } catch (e) {
        book.error = String(e.message ?? e);
      } finally {
        book.busy = false; book.lookedAt = Date.now();
        cx.notify();
      }
    });
  }

  // Only the notes whose version changed are read again.
  look(book) {
    book.busy = true;
    const since = Date.now();
    this.cx.spawn(async (cx) => {
      try {
        const listed = await listNotes(book.machine);
        const have = new Map(book.notes.map((n) => [n.id, n.version]));
        const changed = listed.filter((l) => !book.gone.has(l.id) && have.get(l.id) !== l.version).map((l) => l.id);
        const fresh = changed.length ? await readNotes(book.machine, changed) : [];
        this.merge(book, fresh, listed.map((l) => l.id), since);
        book.error = null;
      } catch (e) {
        book.error = String(e.message ?? e);
      } finally {
        book.busy = false; book.lookedAt = Date.now();
        cx.notify();
      }
    });
  }

  // What the machine had when the look began (`since`). A note with typing not saved yet keeps it,
  // and its save finds out; one this window wrote after the look began is newer than what it saw.
  merge(book, fresh, present, since) {
    const newer = (note) => note.saving || note.dirtySince !== null || note.wroteAt >= since;
    for (const n of fresh) {
      if (book.gone.has(n.id)) continue;
      const note = book.notes.find((x) => x.id === n.id);
      if (!note) { this.add(book, this.makeNote(book, n)); continue; }
      if (newer(note) || note.version === n.version) continue;
      note.version = n.version; note.saved = n.text; note.title = noteTitle(n.text);
      if (note.state.value() !== n.text) note.state.set_value(n.text);
    }
    const there = new Set(present);
    for (const note of [...book.notes]) {
      if (note.version !== "-" && !there.has(note.id) && !newer(note)) this.remove(book, note);
    }
    this.dropBlank(book);
  }

  // The blank one shown for a machine with no notes goes once others arrive, unless it's the open tab.
  // A tab made with + stays until you close it.
  dropBlank(book) {
    const open = this.selected(book);
    for (const note of [...book.notes]) {
      if (book.notes.length > 1 && note.filler && note !== open && note.version === "-" && note.dirtySince === null && !note.state.value()) this.remove(book, note);
    }
    this.fill(book);
  }

  addNote(cx) {
    const book = this.book();
    if (!book.loaded) return;
    const note = this.makeNote(book, { id: newNoteId(), version: "-", text: "" });
    this.add(book, note);
    this.select(book, note);
    cx.notify();
  }

  // Its last words are saved first. An empty one is simply gone; one with words in it goes to the
  // machine's closed notes, and Undo brings it back for a few seconds.
  closeTab(book, note, cx) {
    const shown = this.selected(book) === note, text = note.state.value();
    book.gone.add(note.id);
    const at = this.remove(book, note);
    if (shown) this.select(book, book.notes[Math.min(at, book.notes.length - 1)]);
    this.later(note, async (cx) => {
      try {
        if (!text.trim()) {
          if (note.version !== "-") await dropNote(book.machine, note.id);
          return;
        }
        let id = note.id;
        if (text !== note.saved) {
          const r = await writeNote(book.machine, id, note.version, text);
          if (r.conflict !== undefined) { // Changed elsewhere too: theirs stays, and yours is what closes.
            book.gone.delete(note.id);
            id = newNoteId();
            await writeNote(book.machine, id, "-", text);
          }
        }
        await closeNote(book.machine, id);
        this.closed = { machine: book.machine, id, title: noteTitle(text), until: Date.now() + UNDO_MS };
      } catch (e) {
        book.gone.delete(note.id); // Still there: the next look brings it back.
        this.say(`Couldn't close it on ${machineLabel(book.machine)}: ${e.message ?? e}`);
      } finally {
        cx.notify();
      }
    });
    cx.notify();
  }

  undo(cx) {
    const closed = this.closed;
    this.closed = null;
    if (!closed) return;
    const book = this.book(closed.machine);
    cx.spawn(async (cx) => {
      try {
        await reopenNote(closed.machine, closed.id);
        book.gone.delete(closed.id);
        const [n] = await readNotes(closed.machine, [closed.id]);
        if (n && !book.notes.some((x) => x.id === n.id)) {
          const note = this.makeNote(book, n);
          this.add(book, note);
          this.select(book, note);
          this.dropBlank(book);
        }
      } catch (e) {
        this.say(`Couldn't bring it back: ${e.message ?? e}`);
      } finally {
        cx.notify();
      }
    });
    cx.notify();
  }

  hover(id, over, cx) {
    const next = over ? id : this.hovered === id ? null : this.hovered;
    if (next !== this.hovered) { this.hovered = next; cx.notify(); }
  }

  onKey(e, cx) {
    if (e.key !== "escape") return;
    if (this.typing) { this.typing = false; this.handle.focus(); } else closeNotes();
    cx.stop_propagation();
    cx.notify();
  }

  strip(book, shown, t) {
    const chip = (note) => {
      const open = note === shown, waiting = note.dirtySince !== null || note.saving;
      return tabChip(`note-${note.id}`, open, t)
        .tooltip(note.error ? `Not saved: ${note.error}` : note.title)
        .on_hover((over, cx) => this.hover(note.id, over, cx))
        .on_click((_e, cx) => { this.select(book, note); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().child(note.title))
        .child(open || this.hovered === note.id
          ? tabClose(`note-close-${note.id}`, "Close this note", (_e, cx) => this.closeTab(book, note, cx), t)
          : div().w(12).flex_none().text_color(note.error ? t.blocked : t.dim).child(note.error || waiting ? "•" : ""));
    };
    return h_flex().h(42).flex_none().px(8).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().flex_none().pl(4).pr(8).gap(6).items_center().text_color(t.muted)
        .child(icon("pen", 14))
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Notes"))
        .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
          .tooltip(`Kept on ${machineLabel(book.machine)}, the same in every window connected to it`).child(machineLabel(book.machine))))
      .when(book.loaded, (el) => el.child(tabRow("note-tabs", book.notes.map(chip)))
        .child(barButton("note-new", "+", (_e, cx) => this.addNote(cx), t).tooltip("New note")))
      .child(div().flex_1())
      .child(iconButton("notes-close", "x", keyHint("sanguo.notes", "Close notes"), () => closeNotes(), t));
  }

  page(book, note, t) {
    const where = machineLabel(book.machine);
    const middle = (...lines) => v_flex().flex_1().min_h(0).items_center().justify_center().gap(8).text_color(t.dim).children(lines);
    if (!book.loaded || !note) {
      if (book.machine && machineLayout(book.machine) === "unavailable") return middle(icon("pen", 24), div().child(`${where} isn't reachable now. Its notes are on it.`));
      if (book.error) return middle(icon("pen", 24), div().child(`Couldn't read the notes on ${where}.`), div().text_size(11.5).child(book.error),
        div().id("notes-retry").text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { book.error = null; book.lookedAt = 0; cx.notify(); }).child("Try again"));
      return middle(spinner(t, 16), div().child(`Reading the notes on ${where}…`));
    }
    return Textarea.new(note.state).flex_1().min_h(0).w_full().px(24).py(18).bg(t.background).text_color(t.foreground)
      .font_family(settings().font_family).text_size(13.5);
  }

  footer(book, note, t) {
    const where = machineLabel(book.machine);
    const status = !book.loaded || !note ? "" : note.error ? `Not saved: ${note.error}`
      : note.saving || note.dirtySince !== null ? "Saving…" : note.version === "-" ? `Saves to ${where} as you type` : `Saved on ${where}`;
    const closed = this.closed && machineKey(this.closed.machine) === machineKey(book.machine) ? this.closed : null;
    return h_flex().h(28).flex_none().px(14).gap(10).items_center().border_t(1).border_color(t.border).bg(t.chrome).text_size(11.5).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().text_color(note?.error ? t.blocked : t.dim).child(status))
      .when(Boolean(this.said), (el) => el.child(div().flex_none().max_w(460).truncate().text_color(t.muted).child(this.said.text)))
      .when(Boolean(closed), (el) => el.child(div().flex_none().max_w(260).truncate().child(`Closed “${closed.title}”`))
        .child(div().id("notes-undo").flex_none().text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.undo(cx)).child("Undo")));
  }

  render(cx) {
    if (!showingNotes()) { this.shownOn = null; return div().id("notes").size_full(); }
    const t = theme(), book = this.book(), key = machineKey(book.machine);
    // Holds the keyboard while shown, so typing never lands in a hidden terminal.
    if (this.shownOn !== key) { this.shownOn = key; this.focusNext = book.loaded ? this.selected(book) : "view"; }
    const note = book.loaded ? this.selected(book) : null;
    if (this.focusNext) {
      const target = this.focusNext === "view" ? null : this.focusNext;
      this.focusNext = null;
      cx.spawn(async () => (target && !target.gone ? target.state.focus() : this.handle.focus()));
    }
    return v_flex().id("notes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.strip(book, note, t))
      .child(this.page(book, note, t))
      .child(this.footer(book, note, t));
  }
}
