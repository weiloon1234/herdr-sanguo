// Where a machine's projects and coding sessions are kept: on that machine, in one log. Every Herdr
// window connected to it reads and adds to the same log, so they all show the same thing, and nothing
// about a machine is stored anywhere else. Only ever adding lines means two windows can write at once
// without losing each other's: later lines add to what earlier ones said.
//   { tool, id, ...fields }    a session, or more about one
//   { imported: folder }       this folder's older sessions are in
//   { project: { name, folder, tool? } }, { forget: folder }, { order: [folder...] }
import { runOn } from "./machine-script.js";

const MAX_ARG = 60000; // A command line can only hold so much, so long additions go in pieces.

const run = (machine, ...args) => runOn("machine-store.sh", machine, ...args);

function pieces(records) {
  const out = [];
  let piece = "";
  for (const record of records) {
    const line = JSON.stringify(record);
    if (piece && piece.length + line.length > MAX_ARG) { out.push(piece); piece = ""; }
    piece += (piece ? "\n" : "") + line;
  }
  if (piece) out.push(piece);
  return out;
}

export const storeSize = async (machine) => Number((await run(machine, "size")).trim());

export async function readStore(machine, from) {
  const output = await run(machine, "read", String(from)), end = output.indexOf("\n");
  const records = [];
  for (const line of output.slice(end + 1).split("\n")) {
    try { if (line) records.push(JSON.parse(line)); } catch {} // Cut short, or from something else.
  }
  return { size: Number(output.slice(0, end)), records };
}

export async function addToStore(machine, records) {
  for (const piece of pieces(records)) await run(machine, "add", piece);
}

export async function replaceStore(machine, records) {
  const name = `new-${Date.now()}`;
  await run(machine, "replace-begin", name);
  for (const piece of pieces(records)) await run(machine, "replace-add", name, piece);
  await run(machine, "replace-end", name);
}

// What a line makes of a machine's list of projects.
export function applyToProjects(list, record) {
  if (record.project?.folder) {
    const at = list.findIndex((p) => p.folder === record.project.folder);
    return at < 0 ? [...list, record.project] : list.map((p, i) => (i === at ? record.project : p));
  }
  if (record.forget) return list.filter((p) => p.folder !== record.forget);
  if (record.order) {
    const place = new Map(record.order.map((folder, i) => [folder, i]));
    return [...list].sort((a, b) => (place.get(a.folder) ?? Infinity) - (place.get(b.folder) ?? Infinity));
  }
  return list;
}
