// What each session on a machine is up to, read once per update: Herdr redraws on any change
// anywhere. The 校场 and the sidebar's session list both show this.
import { panes, agents, terminals, openOverlay, run, shared } from "herdr";
import { SMALL_DIALOG_WIDTH } from "./projects.js";
import { kingdomOf, uniqueMarks, isFighter, dutyOf, NO_FIGHTER } from "./kingdoms.js";
import { sessionsOn } from "./machines.js";

// What each open session is called, by tab: the same title its history shows. The session log, which
// follows the CLIs, keeps this up to date.
export const LIVE_TITLES = "sanguo.live-titles";

export const sessionTitle = (tab) => shared(LIVE_TITLES)?.[tab.id] ?? (tabIsNamed(tab) ? tab.name : null);

const WAITING_ON = { permission: "Needs your permission", question: "Has a question", auth: "Needs you to sign in" };

// A title without the spinner or mark a CLI puts in front.
export const spokenTitle = (title) => String(title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Herdr numbers a tab until it's given a name.
export const tabIsNamed = (tab) => !/^\d*$/.test(tab?.name ?? "");

// What it's doing, in its own words if it said any.
function detail(lead, terminal) {
  const report = terminal?.report;
  if (report?.msg) return report.msg;
  if (WAITING_ON[report?.kind]) return WAITING_ON[report.kind];
  const title = spokenTitle(lead?.title);
  if (title && title !== lead?.program?.name && title !== lead?.address && title !== lead?.terminal) return title;
  return lead ? dutyOf(lead.status).about : "";
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (groups.has(key)) groups.get(key).push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function sessionFacts(machine) {
  const all = terminals(), panesOf = groupBy(panes(), (p) => p.tab), agentsOf = groupBy(agents(), (a) => a.tab);
  const terminalAt = new Map(all.map((t) => [t.address, t]));
  const kidsOf = groupBy(all.filter((t) => t.state === "live" && t.parent), (t) => t.parent);
  return sessionsOn(machine).map(({ tab, space }, i) => {
    const here = panesOf.get(tab.id) ?? [], fighters = here.filter(isFighter), reporting = agentsOf.get(tab.id) ?? [];
    const lead = reporting.find((a) => a.status === tab.status) ?? reporting[0] ?? fighters[0];
    const marks = uniqueMarks(fighters), holder = marks[0], k = holder && kingdomOf(holder);
    const status = tab.status ?? (k ? null : "none");
    const address = lead?.address ?? lead?.terminal ?? tab.id;
    return {
      tab, space, number: i + 1, fighters, marks, holder, status, address,
      who: k?.id ?? "min",
      kids: reporting.reduce((sum, a) => sum + (kidsOf.get(a.address)?.length ?? 0), 0),
      named: tabIsNamed(tab),
      title: sessionTitle(tab),
      program: lead?.program ?? here[0]?.program,
      line: status === "none" ? NO_FIGHTER.about : detail(lead, terminalAt.get(address)),
    };
  });
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const campSummary = (sessions) => `${plural(new Set(sessions.map((st) => st.space.id)).size, "project")} · ${plural(sessions.length, "session")}`;

// Ends a session. One that's busy or waiting on you asks first, because that stops its CLI mid-way;
// any other goes at once, and can be resumed from its project's history.
export function closeSession(tabId, status) {
  if (status === "working" || status === "blocked") openOverlay({ mod: "sanguo", kind: "dialog", width: SMALL_DIALOG_WIDTH, props: { role: "close-session", tab: tabId, status } });
  else run("tab.close", { id: tabId, confirmed: true });
}

// The tab menu, the same from a station or a tile.
export const sessionMenu = (st) => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: st.tab.id, space: st.space.id } } });
