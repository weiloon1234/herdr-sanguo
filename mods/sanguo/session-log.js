// Our own record of each project's coding sessions, so showing a history reads no CLI's files.
// Herdr's terminals say when a CLI is running, when it finishes a turn and what it calls itself.
// Only the CLI knows the id a session resumes by, so that's asked once (session-history.sh). The
// same script brings in a project's older sessions, the first time its history is opened and
// whenever you ask again. It's all kept on the machine it's about (machine-store.js).
import { agents, panes, run, setShared, shared, spaces, terminals, window } from "herdr";
import { runOn } from "./machine-script.js";
import { addToStore, applyToProjects, readStore, replaceStore, storeSize } from "./machine-store.js";
import { currentMachine, machineKey, machineLayout, machineNames } from "./machines.js";
import { projectId, setProjectsOf } from "./projects.js";
import { AUTO_NAMES, LIVE_TITLES, ownTabName, spokenTitle, tabIsNamed } from "./sessions.js";

export const TOOLS = {
  // `exact`: it can say which session a process is on, so that's asked again after every turn.
  claude: { key: "claude", name: "Claude Code", app: "claude-code", bin: "claude", exact: true, resume: (id) => ["--resume", id], flags: ["--resume", "-r", "--session-id"] },
  codex: { key: "codex", name: "Codex", app: "codex", bin: "codex", resume: (id) => ["resume", id], flags: ["resume"] },
  opencode: { key: "opencode", name: "OpenCode", app: "opencode", bin: "opencode", resume: (id) => ["--session", id], flags: ["--session", "-s"] },
  agy: { key: "antigravity", name: "Antigravity", app: "antigravity", bin: "agy", resume: (id) => ["--conversation", id], flags: ["--conversation"] },
};
const MY_TITLES = [...Object.values(TOOLS).flatMap((tool) => [tool.name, tool.bin]), "OC"].map((name) => name.toLowerCase()); // As a CLI writes its own name, in any case.

const MAX_SESSIONS = 1500, TITLE_MAX = 120, SHORTEN_AT = 600000; // A log past this size starts again from what it adds up to.
const IMPORT_EACH = 200; // Of each CLI.
const WATCH_MS = 1000, SAVE_AFTER_MS = 2000, RETRY_SAVE_MS = 30000, RETRY_IMPORT_MS = 60000;
const RENAME_WAIT_MS = 5000, TAB_NAME_MAX = 60; // A rename lands in a moment; a tab's name stays short.
const LOOK_SHOWN_MS = 5000, LOOK_BEHIND_MS = 30000, LOOK_ELSEWHERE_MS = 60000; // For what other windows added.
const LOOK_AGAIN_S = [10, 30, 60, 300]; // A record can appear a little after the turn that made it.

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const nowS = () => Math.floor(Date.now() / 1000);
const baseName = (path) => String(path ?? "").split("/").filter(Boolean).pop();
const cleanText = (text) => String(text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).replace(/[\ud800-\udbff]$/, ""); // Not half an emoji.

// A terminal's address as its own machine knows it, without this window's "home/" in front.
const addressThere = (address) => address.slice(address.indexOf("/") + 1);

const toolOf = (terminal) => Object.keys(TOOLS).find((name) => TOOLS[name].key === terminal.program?.key || TOOLS[name].app === terminal.report?.app);

// A first prompt's text. The record may be cut short, which still leaves the start of it.
function promptOf(record) {
  const content = parsed(record)?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.find((part) => part.type === "text")?.text;
  const cut = /"(?:content|text)":"((?:[^"\\]|\\.)*)/.exec(record ?? "")?.[1];
  return cut && (parsed(`"${cut}"`) ?? cut);
}

// The script's lines, newest first.
function readRows(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const [tool, ...rest] = line.split("\t");
    if (tool === "claude") {
      const title = parsed(rest[2]);
      rows.push({ tool, id: rest[0], at: Number(rest[1]), title: cleanText(title?.customTitle ?? title?.aiTitle ?? promptOf(rest[3])) });
    } else if (TOOLS[tool]) {
      for (const row of parsed(rest[0]) ?? []) rows.push({ tool, id: row.id, at: Number(row.at), title: cleanText(row.title) });
    }
  }
  return rows.filter((row) => row.id && row.at > 0).sort((a, b) => b.at - a.at);
}

const ask = (args, machine) => runOn("session-history.sh", machine, ...args);

// The id on its command line, if it was started on a known session.
function idInArgv(tool, argv) {
  for (let i = 0; i < (argv?.length ?? 0); i++) {
    const [flag, value] = String(argv[i]).split(/=(.*)/s);
    if (!tool.flags.includes(flag)) continue;
    const id = value ?? argv[i + 1];
    if (/^[A-Za-z0-9_-]{8,}$/.test(id ?? "")) return id;
  }
  return null;
}

// What the session calls itself: a tab you named, or the CLI's title without its name and folder.
function titleOf(terminal, tab, folders) {
  const own = ownTabName(tab);
  if (own) return cleanText(own);
  const skip = new Set([...MY_TITLES, ...folders.map((folder) => baseName(folder)?.toLowerCase())]);
  return cleanText(spokenTitle(terminal.title).split(" | ").map((part) => part.trim()).filter((part) => part && !skip.has(part.toLowerCase())).join(" | "));
}

// What's known of one machine: its log, added up.
class MachineRecord {
  constructor(machine) { this.machine = machine; }
  sessions = new Map(); // "tool:id" -> { tool, id, folder, cwd, started, at, title, terminal }
  imported = new Set(); // The folders whose older sessions are in.
  projects = [];
  size = 0; // How much of the log this has read.
  state = "new"; // new, ready, failed
  sorted = null;
  pending = []; // On its way to the machine.
  saveAt = 0;
  saving = false;
  checking = false;
  checkedAt = 0;

  apply(record) {
    if (record.tool) {
      if (!TOOLS[record.tool] || !record.id) return; // From something else.
      const key = `${record.tool}:${record.id}`;
      this.sessions.set(key, { ...this.sessions.get(key), ...record });
      this.sorted = null;
    } else if (record.imported) this.imported.add(record.imported);
    else this.projects = applyToProjects(this.projects, record);
  }

  // Everything it adds up to, as a shorter log.
  summary() {
    const newest = [...this.sessions.values()].filter((s) => s.folder).sort((a, b) => b.at - a.at).slice(0, MAX_SESSIONS);
    return [...this.projects.map((project) => ({ project })), ...[...this.imported].map((imported) => ({ imported })), ...newest];
  }
}

// What a project's older sessions add to what its machine's record already has.
async function importedLines(project, record) {
  const output = await ask(["import", project.folder, String(IMPORT_EACH)], project.machine ?? null), lines = [];
  let added = 0;
  for (const row of readRows(output)) {
    const known = record.sessions.get(`${row.tool}:${row.id}`), line = { tool: row.tool, id: row.id };
    if (!known) {
      lines.push({ ...line, folder: project.folder, cwd: project.folder, started: row.at, at: row.at, title: row.title, terminal: null });
      added++;
      continue;
    }
    if (!known.title && row.title) lines.push({ ...line, title: row.title });
    if (row.at > known.at) lines.push({ ...line, at: row.at }); // Used somewhere else since.
  }
  if (!record.imported.has(project.folder)) lines.push({ imported: project.folder });
  const failed = output.split("\n").filter((line) => line.startsWith("failed\t")).map((line) => line.split("\t")[1]);
  return { lines, added, failed: [...new Set(failed)] };
}

// One project's sessions, newest first, read from its machine for whatever doesn't keep a log itself.
// Its older ones come in if no window has brought them in yet.
export async function readProjectSessions(project) {
  const machine = project.machine ?? null, record = new MachineRecord(machine);
  for (const line of (await readStore(machine, 0)).records) record.apply(line);
  if (!record.imported.has(project.folder)) {
    const { lines } = await importedLines(project, record);
    for (const line of lines) record.apply(line);
    await addToStore(machine, lines);
  }
  return [...record.sessions.values()].filter((s) => s.folder === project.folder).sort((a, b) => b.at - a.at);
}

// Looks up the tab a session on this machine is open in, for one look at many sessions.
export function tabFinder(machine) {
  const tabs = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p.tab]));
  const live = new Map(terminals().filter((t) => t.state === "live").map((t) => [t.address, t]));
  return (session) => {
    if (!session.terminal) return null;
    const address = machine ? `${machine}/${session.terminal}` : session.terminal, terminal = live.get(address);
    const same = terminal && toolOf(terminal) === session.tool && session.at * 1000 >= (terminal.created_ms ?? Infinity);
    return same ? tabs.get(address) ?? null : null;
  };
}

// Whether something running has this session open, and if it's in one of our terminals, which tab.
export async function whereRunning(session, machine) {
  const lines = (await ask(["open", session.tool, session.id], machine)).split("\n").filter((line) => line.startsWith("open\t"));
  if (!lines.length) return null;
  const chains = lines.map((line) => line.split("\t")[1].split(",").map(Number));
  const here = terminals().find((t) => chains.some((chain) => chain.includes(t.pid) || chain.includes(t.foreground?.pid)));
  return { tab: panes().find((p) => p.terminal === here?.address)?.tab ?? null };
}

export class SessionLog {
  records = new Map(); // Machine -> what's known of it.
  tracks = new Map(); // Terminal address -> the session running there.
  renamed = new Map(); // Tab -> { name, at }: asked for, and not landed yet.
  importing = new Set();
  failedImport = new Map(); // Project -> when.
  version = 0; // Goes up with anything a history would show.
  watchedAt = 0;

  recordOf(machine) {
    const key = machineKey(machine);
    if (!this.records.has(key)) this.records.set(key, new MachineRecord(machine));
    return this.records.get(key);
  }

  stateOf(machine) { return this.recordOf(machine).state; }

  // Says something new about a machine: here at once, and on its way there.
  note(record, line) {
    record.apply(line);
    record.pending.push(line);
    record.saveAt ||= Date.now() + SAVE_AFTER_MS;
    this.version++;
  }

  tick(cx) {
    const now = Date.now(), shown = currentMachine(), active = window()?.active !== false;
    // Coming back to a machine, or to the window, shows what's happened since.
    const place = `${machineKey(shown)}|${active}`;
    if (place !== this.place) { this.place = place; this.recordOf(shown).checkedAt = 0; }
    for (const machine of machineNames()) {
      const record = this.recordOf(machine);
      if (record.pending.length && now >= record.saveAt && !record.saving) { record.saving = true; cx.spawn(() => this.save(record)); }
      if (machine && machineLayout(machine) === "unavailable") continue; // Its last copy stands.
      const every = record.state !== "ready" || (machine === shown && active) ? LOOK_SHOWN_MS : machine === shown ? LOOK_BEHIND_MS : LOOK_ELSEWHERE_MS;
      if (!record.checking && now - record.checkedAt >= every) {
        record.checking = true;
        record.checkedAt = now;
        cx.spawn(() => this.lookIn(record));
      }
    }
    if (now - this.watchedAt >= WATCH_MS) {
      this.watchedAt = now;
      this.watch(cx, now);
    }
  }

  // Reads what's been added to a machine's log since last time.
  async lookIn(record) {
    try {
      const size = record.state === "ready" ? await storeSize(record.machine) : null;
      if (size === record.size) return;
      const anew = size === null || size < record.size;
      if (size !== null && size < record.size) { // Another window shortened it.
        record.sessions = new Map(); record.imported = new Set(); record.projects = []; record.sorted = null; record.size = 0;
      }
      const { size: to, records } = await readStore(record.machine, record.size);
      for (const line of records) record.apply(line);
      record.size = to;
      record.state = "ready";
      // Only lines about projects change the list. Sessions and imports leave alone a project this
      // window has just shown, whose own line may still be on its way.
      if (anew || records.some((line) => !line.tool && !line.imported)) setProjectsOf(record.machine, record.projects);
      this.version++;
      if (to > SHORTEN_AT && !record.pending.length) await replaceStore(record.machine, record.summary());
    } catch {
      if (record.state !== "ready") record.state = "failed";
    } finally {
      record.checking = false;
    }
  }

  async save(record) {
    const lines = record.pending;
    record.pending = [];
    record.saveAt = 0;
    try {
      await addToStore(record.machine, lines);
    } catch {
      record.pending = [...lines, ...record.pending];
      record.saveAt = Date.now() + RETRY_SAVE_MS;
    } finally {
      record.saving = false;
    }
  }

  // Terminals in panes are sessions; anything else in the core isn't ours to record.
  watch(cx, now) {
    const shown = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p])), seen = new Set();
    for (const terminal of terminals()) {
      const pane = shown.get(terminal.address), toolName = pane && terminal.state === "live" && toolOf(terminal);
      if (!toolName) continue;
      const space = spaces().find((s) => s.tabs?.some((tab) => tab.id === pane.tab));
      if (!space?.folder) continue;
      seen.add(terminal.address);
      if (this.stateOf(space.machine ?? null) !== "ready") continue; // Until its record's in, there's nothing to add to.
      let track = this.tracks.get(terminal.address);
      if (track && track.tool !== toolName) { this.finished(track, cx); track = null; }
      if (!track) track = this.begin(terminal, toolName, space);
      this.update(track, terminal, pane, space, now, cx);
    }
    for (const [address, track] of this.tracks) if (!seen.has(address)) this.finished(track, cx);
    this.publishTitles();
  }

  // For whatever shows open sessions. Only when one changes: every mod redraws for it.
  publishTitles() {
    const titles = {};
    for (const track of this.tracks.values()) {
      const title = track.title || (track.id && this.recordOf(track.machine).sessions.get(`${track.tool}:${track.id}`)?.title);
      if (title && track.tab) titles[track.tab] ??= title;
    }
    this.nameTabs(titles);
    const text = JSON.stringify(titles);
    if (text === this.publishedTitles) return;
    this.publishedTitles = text;
    setShared(LIVE_TITLES, titles);
  }

  // Herdr's own alerts call a session by its project and tab ("web-app / 1"), so a tab still called
  // by its number takes its session's title, and follows it as it changes. A name you gave a tab is
  // yours and stays; so is one another window gave it, which that window looks after. Once no CLI
  // is left in the tab, it's called by its number again.
  nameTabs(titles) {
    const mine = { ...(shared(AUTO_NAMES) ?? {}) }, now = Date.now();
    const tabs = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, tab])));
    // A CLI still in the tab, whether or not it has reported, or been looked at since a restart.
    const cli = new Set(terminals().filter((t) => t.state === "live" && toolOf(t)).map((t) => t.address));
    const withCli = new Set([...agents().map((a) => a.tab), ...panes().filter((p) => cli.has(p.terminal)).map((p) => p.tab)]);
    const ask = (id, name) => {
      const asked = this.renamed.get(id);
      if (asked && asked.name === name && now - asked.at < RENAME_WAIT_MS) return;
      this.renamed.set(id, { name, at: now });
      run("tab.rename", { id, name });
    };
    for (const [id, tab] of tabs) {
      // Ours: still numbered, or a name this window gave it or asked for.
      const ours = !tabIsNamed(tab) || tab.name === mine[id] || tab.name === this.renamed.get(id)?.name;
      if (!ours) { delete mine[id]; continue; }
      const want = titles[id] ? spokenTitle(titles[id]).slice(0, TAB_NAME_MAX) : "";
      if (want) {
        if (tab.name === want) mine[id] = want;
        else ask(id, want);
      } else if (tabIsNamed(tab) && !withCli.has(id)) {
        ask(id, ""); // Called by its number again.
        delete mine[id];
      }
    }
    for (const id of Object.keys(mine)) if (!tabs.has(id)) delete mine[id];
    for (const id of this.renamed.keys()) if (!tabs.has(id)) this.renamed.delete(id);
    if (JSON.stringify(mine) !== JSON.stringify(shared(AUTO_NAMES) ?? {})) setShared(AUTO_NAMES, mine);
  }

  // A CLI in a terminal, new to us. After a restart the record says which session it was on.
  begin(terminal, toolName, space) {
    const machine = space.machine ?? null, tool = TOOLS[toolName], there = addressThere(terminal.address);
    const track = { address: terminal.address, tool: toolName, machine, folder: space.folder, id: null, tab: null, title: "", cwd: null, pid: null, since: nowS() - 5, turn: terminal.turn ?? 0, working: false, looking: false, lookAt: 0, misses: 0 };
    const earlier = [...this.recordOf(machine).sessions.values()].find((s) => s.terminal === there && s.tool === toolName && s.folder === space.folder && s.at * 1000 >= (terminal.created_ms ?? Infinity));
    const id = idInArgv(tool, terminal.foreground?.argv) ?? idInArgv(tool, terminal.argv) ?? earlier?.id;
    this.tracks.set(terminal.address, track);
    if (id) {
      track.cwd = terminal.foreground?.cwd ?? terminal.cwd ?? space.folder;
      this.claim(track, { id, at: nowS(), title: "" });
    }
    return track;
  }

  update(track, terminal, pane, space, now, cx) {
    const tool = TOOLS[track.tool], tab = space.tabs.find((t) => t.id === pane.tab), working = terminal.status === "working";
    track.tab = pane.tab;
    track.cwd = terminal.foreground?.cwd ?? terminal.cwd ?? space.folder;
    track.pid = terminal.foreground?.pid ?? terminal.pid;
    const turn = terminal.turn ?? 0, turnEnded = !working && (track.working || turn !== track.turn);
    track.working = working;
    if (!working) track.turn = turn;

    const record = this.recordOf(track.machine), session = track.id && record.sessions.get(`${track.tool}:${track.id}`);
    if (!working) {
      const title = titleOf(terminal, tab, [space.folder, track.cwd]);
      if (title) track.title = title;
      if (session && title && session.title !== title) this.note(record, { tool: track.tool, id: track.id, title });
    }
    if (session && turnEnded) this.note(record, { tool: track.tool, id: track.id, at: nowS() });

    // Claude Code has a record before its first prompt, so it waits for a turn. A CLI that doesn't
    // say when its turns end has none until it has been used, so that's looked for now and then.
    if (turnEnded) { track.misses = 0; track.lookAt = now; }
    else if (!track.id && !track.lookAt && !tool.exact) track.lookAt = now + LOOK_AGAIN_S[0] * 1000;
    if (track.lookAt && now >= track.lookAt && !track.looking && (!track.id || tool.exact)) this.look(track, cx);
  }

  look(track, cx) {
    track.looking = true;
    track.lookAt = 0;
    cx.spawn(async () => {
      try {
        const rows = readRows(await ask(["find", track.tool, track.cwd, String(track.since), String(track.pid ?? "")], track.machine));
        const others = new Set([...this.tracks.values()].filter((t) => t !== track && t.tool === track.tool).map((t) => t.id));
        const free = rows.filter((row) => row.tool === track.tool && !others.has(row.id));
        const row = free.find((r) => r.title && r.title === track.title) ?? free[0];
        // While it runs it's in use now, whatever its CLI last wrote.
        if (row) this.claim(track, track.pid === null ? row : { ...row, at: nowS() });
      } catch {} // Asked again below.
      track.looking = false;
      if (!track.id) track.lookAt = Date.now() + LOOK_AGAIN_S[Math.min(track.misses++, LOOK_AGAIN_S.length - 1)] * 1000;
    });
  }

  // This terminal is running this session.
  claim(track, row) {
    const record = this.recordOf(track.machine), known = record.sessions.get(`${track.tool}:${row.id}`);
    track.id = row.id;
    this.note(record, {
      tool: track.tool, id: row.id, folder: known?.folder ?? track.folder,
      cwd: known?.cwd ?? track.cwd,
      started: known?.started ?? track.since,
      at: Math.max(known?.at ?? 0, row.at),
      title: track.title || known?.title || row.title,
      terminal: addressThere(track.address),
    });
  }

  // It ended. A session that never got an id has one last chance: a quick one can end before
  // its CLI has written anything. If it still has none, nothing happened in it.
  finished(track, cx) {
    this.tracks.delete(track.address);
    track.pid = null;
    if (!track.id && !track.looking) this.look(track, cx);
  }

  // The tab this session is open in, if any. `machine`: the one it's on.
  tabOf(session, machine) {
    const track = this.tracks.get(machine && session.terminal ? `${machine}/${session.terminal}` : session.terminal);
    return track?.id === session.id ? track.tab : null;
  }

  sessionsOf(project) {
    const record = this.recordOf(project.machine ?? null);
    if (!record.sorted) {
      record.sorted = new Map();
      for (const session of [...record.sessions.values()].filter((s) => s.folder).sort((a, b) => b.at - a.at)) {
        if (!record.sorted.has(session.folder)) record.sorted.set(session.folder, []);
        record.sorted.get(session.folder).push(session);
      }
    }
    return record.sorted.get(project.folder) ?? [];
  }

  importState(project) {
    const key = projectId(project.machine ?? null, project.folder);
    if (this.importing.has(key)) return "importing";
    return this.recordOf(project.machine ?? null).imported.has(project.folder) ? "done" : this.failedImport.has(key) ? "failed" : "none";
  }

  // Once per project, when it comes to be needed: whichever window gets there first.
  importIfNeeded(project, cx, done) {
    const key = projectId(project.machine ?? null, project.folder);
    if (this.recordOf(project.machine ?? null).imported.has(project.folder) || Date.now() - (this.failedImport.get(key) ?? 0) < RETRY_IMPORT_MS) return;
    this.importNow(project, cx, done);
  }

  // Again whenever you ask, for what's come since. `done` gets what importProject found.
  importNow(project, cx, done) {
    const key = projectId(project.machine ?? null, project.folder);
    if (this.stateOf(project.machine ?? null) !== "ready" || this.importing.has(key)) return;
    this.importing.add(key);
    this.version++;
    cx.spawn(async () => done(await this.importProject(project, key)));
  }

  // How many sessions are new and which CLIs' records couldn't be read; null if nothing could be asked.
  async importProject(project, key) {
    const record = this.recordOf(project.machine ?? null);
    try {
      const { lines, added, failed } = await importedLines(project, record);
      for (const line of lines) this.note(record, line);
      this.failedImport.delete(key);
      return { added, failed };
    } catch {
      this.failedImport.set(key, Date.now());
      return null;
    } finally {
      this.importing.delete(key);
      this.version++;
    }
  }
}
