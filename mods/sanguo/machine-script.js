// Runs one of the mod's shell scripts on a machine. The app sends the script's text there, so the
// machine needs nothing of this mod on its disk. A script that fails throws its own words.
import { appHome, exec, readTextFile } from "herdr";
import { machineLabel } from "./machines.js";

const scripts = {};

export async function runOn(file, machine, ...args) {
  scripts[file] ??= await readTextFile(`${appHome()}/mods/sanguo/${file}`);
  const r = await exec("sh", ["-c", scripts[file], file, ...args], { on: machine });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `Couldn't reach ${machineLabel(machine)}.`);
  return r.stdout;
}
