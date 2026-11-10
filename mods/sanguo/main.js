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
import { NewSession, NewProject, RenameProject, DeleteProject, CloseSession } from "./dialogs.js";

const ROLES = { field: Field, camp: Camp, spaces: Spaces, tabs: Tabs, files: Files, changes: Changes, notes: Notes, status: Status, pane: Pane, chrome: Chrome, "new-session": NewSession, "new-project": NewProject, "rename-project": RenameProject, "delete-project": DeleteProject, "close-session": CloseSession };
const DEFAULT_ROLE = "field";

export default class Sanguo extends View {
  init(_props, cx) {
    // A pane's header gets its props from Herdr, which name the pane.
    this.role = new ROLES[props()?.role ?? (props()?.pane ? "pane" : DEFAULT_ROLE)]();
    this.role.init?.(props(), cx);
  }

  render(cx) {
    return this.role.render(cx);
  }
}
