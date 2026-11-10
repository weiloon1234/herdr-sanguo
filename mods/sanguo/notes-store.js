// Notes, kept on each machine in its own Herdr folder (notes.sh), so every window connected to that
// machine shows the same ones. A note is its text; its title is its first line. Each belongs to a
// scope: the machine's general notes, or one project's.
import { runOn } from "./machine-script.js";

const run = (machine, ...args) => runOn("notes.sh", machine, ...args);
const PIECE = 30000; // Code units per argument: well under what one argument may hold.
export const MAX_NOTE_BYTES = 400000; // A note goes to its machine on one command line.

export const GENERAL = "general";
// A project's notes are kept by its folder's path, with everything but letters and digits as -.
export const projectScope = (folder) => `project/${folder.replace(/[^A-Za-z0-9]/g, "-")}`;

export async function listNotes(machine, scope) {
  return (await run(machine, "list", scope)).split("\n").filter(Boolean).map((line) => {
    const [id, version] = line.split(" ");
    return { id, version };
  });
}

// Those notes, or every one without ids.
export async function readNotes(machine, scope, ids = []) {
  return (await run(machine, "read", scope, ...ids)).split("\x1e").slice(1).map((record) => {
    const end = record.indexOf("\n"), [id, version] = record.slice(0, end).split(" ");
    return { id, version, text: record.slice(end + 1) };
  });
}

// Only over the version it was read at ("-" for one not written yet): { version } after, or
// { conflict } with the version another window left there first ("-" if it closed it).
export async function writeNote(machine, scope, id, was, text) {
  if (utf8Bytes(text) > MAX_NOTE_BYTES) throw new Error("Too long to save. Split it into two notes.");
  const said = (await run(machine, "write", scope, id, was, ...pieces(text))).trim();
  return said.startsWith("conflict ") ? { conflict: said.slice(9) } : { version: said };
}

export const closeNote = (machine, scope, id) => run(machine, "close", scope, id);
export const reopenNote = (machine, scope, id) => run(machine, "reopen", scope, id);
export const dropNote = (machine, scope, id) => run(machine, "drop", scope, id);

// Starts with the time, so sorting by id is the order they were made in.
export const newNoteId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;

// Its first line with words in it, without a heading's # or a list's marker.
export function noteTitle(text) {
  for (let at = 0; at <= text.length;) {
    const end = text.indexOf("\n", at), line = text.slice(at, end < 0 ? undefined : end).trim();
    if (line) return (line.replace(/^(#+|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/, "") || line).slice(0, 80);
    if (end < 0) break;
    at = end + 1;
  }
  return "Untitled";
}

function pieces(text) {
  const out = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + PIECE, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last < 0xdc00) end--; // Not between the halves of one character.
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xdc00 && c < 0xe000 ? 1 : 3; // A pair counts 3 + 1.
  }
  return n;
}
