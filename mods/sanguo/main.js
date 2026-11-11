// 三国: one mod with a role per block of layouts/sanguo.json. They share a folder
// because a mod can only import from its own, and they all read kingdoms.js and machines.js.
import { View } from "gpui-kit";
import { props } from "herdr";
import Field from "./field.js";
import Camp from "./camp.js";
import Spaces from "./spaces.js";
import Tabs from "./tabs.js";
import Files from "./files.js";
import Changes from "./changes.js";
import Notes from "./notes.js";
import Status from "./status.js";
import Pane from "./pane.js";
import Chrome from "./chrome.js";
import Toast from "./toast.js";
import { NewSession, NewProject, RenameProject, DeleteProject, CloseSession } from "./dialogs.js";

const ROLES = { field: Field, camp: Camp, spaces: Spaces, tabs: Tabs, files: Files, changes: Changes, notes: Notes, status: Status, pane: Pane, chrome: Chrome, toast: Toast, "new-session": NewSession, "new-project": NewProject, "rename-project": RenameProject, "delete-project": DeleteProject, "close-session": CloseSession };
const DEFAULT_ROLE = "field";

// Herdr gives its own props to a pane's header, which name the pane, and to a notification, which
// has a title. Every other copy is told its role.
const roleOf = (p) => p?.role ?? (p?.pane ? "pane" : p?.title !== undefined ? "toast" : DEFAULT_ROLE);

export default class Sanguo extends View {
  init(_props, cx) {
    this.role = new ROLES[roleOf(props())]();
    this.role.init?.(props(), cx);
  }

  render(cx) {
    return this.role.render(cx);
  }
}
