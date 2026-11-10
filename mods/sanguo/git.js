// What the Changes view asks of git, on whichever machine the project is. `repo` is { cwd, on }.
import { exec, readTextFile } from "herdr";

const MAX_FILES = 1000, MAX_DIFF_LINES = 1500, MAX_LINE = 4000, MAX_FILE_READ = 400000;

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

const gitRead = (repo, args) => exec("git", [...READ, ...args], repo);

// What git said, without the advice it adds for people at a terminal.
function said(r) {
  return [r.stdout, r.stderr].filter(Boolean).join("\n").split(/\r?\n|\r/).filter((line) => line.trim() && !line.startsWith("hint:")).join("\n");
}
function must(r) {
  if (r.code !== 0) throw new Error(said(r) || `git exited with ${r.code}`);
  return r.stdout;
}

// No editor can open here, so anything that would ask for one takes the message it has.
const gitRun = (repo, args) => exec("git", ["-c", "core.editor=true", ...args], repo).then(must);

// A push, a pull or a commit's hooks can take a while, so these get exec's longest wait: ten minutes.
// They aren't left running on their own: on another machine, what a command leaves behind is stopped
// when it returns. With nobody to answer a password prompt git would wait forever, so it fails and
// says so instead. A key the repo names for itself still applies.
const LONG = 'GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-$(git config core.sshCommand || echo ssh)} -o BatchMode=yes -o ConnectTimeout=15" exec git -c core.editor=true "$@" < /dev/null 2>&1';
const LONG_MS = 600000;

async function gitLong(repo, args) {
  const r = await exec("sh", ["-c", LONG, "git", ...args], { ...repo, timeout: LONG_MS })
    .catch((e) => { throw new Error(`Lost touch with that machine. Git may have finished there: look again in a moment. (${e.message ?? e})`); });
  return must({ code: r.code, stdout: r.stdout, stderr: "" });
}

export async function findRepoRoot(cwd, on) {
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  return r.code === 0 ? r.stdout.trim() : null;
}

// `## main...origin/main [ahead 1, behind 2]`, `## No commits yet on main`, `## HEAD (no branch)`
function readHead(line) {
  const text = (line ?? "").replace(/^## /, "");
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(text);
  if (unborn) return { branch: unborn[1], unborn: true, ahead: 0, behind: 0 };
  if (text.startsWith("HEAD (no branch)")) return { branch: null, detached: true, ahead: 0, behind: 0 };
  const [, branch, upstream, track = ""] = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(text) ?? [];
  return { branch, upstream, gone: track === "gone", ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0) };
}

// `ticked`: in the next commit. "some" when the file has changed again since it was staged.
function readFile(entry, stats) {
  const x = entry[0], y = entry[1], xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
  const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
  const status = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
  const ticked = conflict || fresh || x === " " ? "none" : y === " " ? "all" : "some";
  return { path, status, fresh, conflict, ticked, add: 0, del: 0, ...stats[path] };
}

async function lineCounts(repo, unborn) {
  const stats = {};
  const asked = unborn ? [["diff", "--cached"], ["diff"]] : [["diff", "HEAD"]];
  for (const args of asked) {
    const stdout = must(await gitRead(repo, [...args, "--numstat", "-z", "--no-renames"]));
    for (const entry of stdout.split("\0")) {
      const [a, d, ...parts] = entry.split("\t");
      if (!parts.length) continue;
      const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
      stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
    }
  }
  return stats;
}

export async function loadChanges(repo) {
  const stdout = must(await gitRead(repo, ["status", "--porcelain=v1", "-z", "--branch", "--no-renames", "--untracked-files=all"]));
  const entries = stdout.split("\0").filter(Boolean), head = readHead(entries.shift());
  const stats = await lineCounts(repo, head.unborn);
  return { head, limited: entries.length > MAX_FILES, files: entries.slice(0, MAX_FILES).map((entry) => readFile(entry, stats)) };
}

const STOPPED = 'git rev-parse --git-path rebase-merge --git-path rebase-apply --git-path MERGE_HEAD | while IFS= read -r path; do [ -e "$path" ] && basename "$path"; done; true';

// A merge or rebase that stopped part way, waiting for you.
export async function stoppedOperation(repo) {
  const { stdout } = await exec("sh", ["-c", STOPPED], repo);
  return stdout.includes("rebase") ? "rebase" : stdout.includes("MERGE_HEAD") ? "merge" : null;
}

const shortened = (lines) => lines.slice(0, MAX_DIFF_LINES).map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}… (line truncated)` : line));

export async function fileDiffLines(repo, file, unborn) {
  if (file.fresh || (unborn && file.status === "A")) {
    const text = await readTextFile(`${repo.cwd}/${file.path}`, { on: repo.on }).catch(() => null);
    if (text === null) return ["Cannot preview this file (binary, too large, or unreadable)"];
    if (text.includes("\0")) return ["Binary file · no text diff"];
    const lines = text.slice(0, MAX_FILE_READ).replace(/\n$/, "").split("\n");
    file.add = lines.length;
    return shortened([`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)]);
  }
  const stdout = must(await gitRead(repo, ["diff", ...(unborn ? [] : ["HEAD"]), "--no-ext-diff", "--no-textconv", "--no-color", "--", file.path]));
  const all = stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((line) => line.startsWith("@@"));
  return first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : shortened(all.slice(first));
}

// A commit's patch without git's per-file headers, which would read as changed lines.
export async function commitDiffLines(repo, sha) {
  const stdout = must(await gitRead(repo, ["show", "--no-ext-diff", "--no-textconv", "--no-color", "--format=", sha]));
  const out = [];
  let header = false;
  for (const line of stdout.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) { header = true; out.push(`▸ ${/ b\/(.*)$/.exec(line)?.[1] ?? line}`); continue; }
    if (header && !line.startsWith("@@")) continue;
    header = false;
    out.push(line);
  }
  return shortened(out);
}

export async function loadCommits(repo, count) {
  const stdout = must(await gitRead(repo, ["log", "-n", String(count), "--no-color", "--pretty=format:%h%x1f%cr%x1f%an%x1f%s"]));
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, when, author, subject] = line.split("\x1f");
    return { sha, when, author, subject };
  });
}

// The next commit.
export const stage = (repo, paths) => gitRun(repo, ["add", "-A", "--", ...paths]);
export const stageAll = (repo) => gitRun(repo, ["add", "-A"]);
// With a path, so a merge or rebase that's waiting on you stays in progress.
export const unstage = (repo, paths, unborn) => gitRun(repo, unborn ? ["rm", "--cached", "-q", "--", ...paths] : ["reset", "-q", "--", ...paths]);
export const unstageAll = (repo, unborn) => gitRun(repo, unborn ? ["rm", "-r", "--cached", "-q", "."] : ["reset", "-q", "--", "."]);
export const commit = (repo, message) => gitLong(repo, ["commit", "-m", message]);

// Branches, most recently used first. A remote's HEAD is only a pointer to one of them.
export async function listBranches(repo) {
  const format = "%(refname)%00%(refname:short)%00%(upstream:track)";
  const stdout = must(await gitRead(repo, ["for-each-ref", "--sort=-committerdate", `--format=${format}`, "refs/heads", "refs/remotes"]));
  const local = [], remote = [];
  for (const line of stdout.split("\n")) {
    const [ref, name, track = ""] = line.split("\0");
    if (!ref || ref.endsWith("/HEAD")) continue;
    if (ref.startsWith("refs/heads/")) local.push({ name, ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0) });
    else { const slash = name.indexOf("/"); remote.push({ name, remote: name.slice(0, slash), branch: name.slice(slash + 1) }); }
  }
  return { local, remote };
}

export const switchBranch = (repo, name) => gitRun(repo, ["switch", name]);
export const createBranch = (repo, name) => gitRun(repo, ["switch", "-c", name]);
export const renameBranch = (repo, name) => gitRun(repo, ["branch", "-m", name]);
export const deleteBranch = (repo, name) => gitRun(repo, ["branch", "-d", name]);
// A remote branch you already have a local copy of is that copy.
export const checkoutRemote = (repo, branch, hasLocal) => gitRun(repo, hasLocal ? ["switch", branch.branch] : ["switch", "--track", branch.name]);
export const merge = (repo, ref) => gitLong(repo, ["merge", ref]);
export const rebase = (repo, ref) => gitLong(repo, ["rebase", ref]);
export async function mergeInto(repo, from, into) {
  await switchBranch(repo, into);
  return merge(repo, from);
}

export const abortOperation = (repo, operation) => gitRun(repo, [operation, "--abort"]);
export const continueOperation = (repo, operation) => gitLong(repo, operation === "rebase" ? ["rebase", "--continue"] : ["commit", "--no-edit"]);

// The remote a branch with no upstream yet goes to: origin if it's there.
async function pushRemote(repo) {
  const names = must(await gitRead(repo, ["remote"])).split("\n").filter(Boolean);
  if (!names.length) throw new Error("This repo has no remote to push to.");
  return names.includes("origin") ? "origin" : names[0];
}

export const fetchAll = (repo) => gitLong(repo, ["fetch", "--all", "--prune"]);
export const pull = (repo) => gitLong(repo, ["pull", "--ff-only"]);
export const pullRebase = (repo) => gitLong(repo, ["pull", "--rebase"]);
export async function push(repo, head, force) {
  if (!head.branch) throw new Error("Switch to a branch first: this checkout isn't on one.");
  const lease = force ? ["--force-with-lease"] : [];
  if (head.upstream && !head.gone) return gitLong(repo, ["push", ...lease]);
  return gitLong(repo, ["push", ...lease, "-u", await pushRemote(repo), head.branch]);
}
// Git refuses this unless it only moves the remote branch forward.
export const pushTo = (repo, from, branch) => gitLong(repo, ["push", branch.remote, `${from}:${branch.branch}`]);

export async function loadStashes(repo) {
  const stdout = must(await gitRead(repo, ["stash", "list", "--format=%gd%x1f%s"]));
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [ref, subject] = line.split("\x1f");
    return { ref, subject };
  });
}
export const stashAll = (repo) => gitRun(repo, ["stash", "push", "--include-untracked"]);
export const stashTicked = (repo) => gitRun(repo, ["stash", "push", "--staged"]);
export const popStash = (repo, ref) => gitRun(repo, ["stash", "pop", ref]);
export const dropStash = (repo, ref) => gitRun(repo, ["stash", "drop", ref]);
