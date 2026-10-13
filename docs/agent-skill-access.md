# Agent Skill Access

The Workbench's Agent overview opens a dedicated **Agent access** workspace
for managing **global** shared Skills from `~/.agents/skills` in Agent-specific
directories. Project deployments and independent Pack copies continue to use
their existing workflows.

## Workspace

The overview remains a compact inventory without expandable Agent rows. Opening
an Agent shows a searchable Agent sidebar and three flat views: shared access,
local files, and Agent information. Shared access uses a compact Skill table and
a separate inspector for paths, ownership, status, and available operations.
On narrow windows, the inspector moves below the table instead of expanding rows.

Skills with names absent from the shared directory are marked **Outside the
shared directory** in local files. This is a name-based inventory distinction,
not a restriction on which Agents can use a Skill. The overview shows an
additional-local-Skills note only when this count is nonzero, without a separate
column or changing the shared-coverage denominator.

Operation previews replace the shared-access content in place; they do not open
another dialog. Returning from a preview preserves the search, status filter,
connection mode, selected Skills, and inspected Skill. Returning to the overview
preserves its filters and restores focus to the entry that opened the workspace.
Agent selection, view switching, and the workspace's Back action are disabled
while filesystem changes are being applied.

## Reading Modes

- **Shared directory:** Agents listed as universal readers by the bundled
  `skills` CLI registry read the shared directory without another deployment.
  Their shared access is read-only in this panel.
- **Symbolic link:** Each selected Skill gets its own link in the Agent's
  directory. Source edits are visible through the link, and editing through
  the link also edits the source. Removing the link preserves the source.
- **Independent copy:** The Agent gets separate files. Later source changes
  require an explicit update. There is no background copying or automatic
  conflict resolution.

Agent paths and reading rules come from the bundled CLI registry, including
supported configuration-directory environment variables. Program detection,
filesystem access, and successful execution of a Skill are separate facts.

## Ownership And Status

Only connections explicitly created by Skill Shelf are recorded as managed
in `agent-skill-access.json` under the application's data directory. Existing
links and folders remain external, even if they point to the same source or
contain identical files. Scanning does not adopt them.

For links, the panel shows the source path, Agent path, and actual link target.
For managed copies, full file-content and executable-bit fingerprints distinguish
an unchanged copy, an updated source, and locally modified files. Local changes
block both automatic replacement and removal from this panel. Inspect those
files and resolve the changes manually first.

Workbench coverage counts are a name-based inventory, not proof of identical
content or successful execution. Use access details for relationship and copy
status.

## Preview And Apply

Every connection, copy update, link repair, and disconnection has a preview
showing the selected Skills, source and target paths, operations, and blocked
entries. A blocked entry prevents the entire preview from being applied.

Previews are short-lived server-side plans, not editable filesystem commands.
Before applying a plan, the main process checks the current source, target,
parent-directory identities, and stored ownership again. Changed or expired
plans must be regenerated. Updates do not overwrite external files, and
disconnections do not delete the shared source.

The service rejects unsafe Skill names, nested symbolic links in copied trees,
and redirected destinations that could write back into the shared source.
Mutation requests are serialized and failed file changes are rolled back.
If concurrent edits prevent a safe rollback, recovery files are retained and
their location is shown in the panel. A committed change with unsuccessful
backup cleanup is also reported with its retained recovery path. If the
post-operation scan fails, the panel requests a recheck instead of claiming
the current files have been verified.

Later scans rediscover physical transaction directories with the exact generated
recovery-folder naming pattern, including after an application restart. These
notices identify retained files, not whether a previous operation succeeded.
Discovery is read-only: the service does not adopt or delete recovery folders.

## Limits

- This panel manages global shared access, not every possible Agent search path.
- External relationships are visible but cannot be modified or adopted here.
- Copy updates and link repairs are manual, previewed operations.
- Runtime Skill invocation and Agent-specific execution validation are not performed.
- Whole-directory linking is not offered: it can hide local Skills outside the shared directory and
  turn local operations into unexpected source modifications.
- Changing configuration-directory environment variables after creating managed
  connections can invalidate the stored paths. The access panel fails closed;
  it does not silently migrate ownership or broaden permission to modify files.
  This does not prevent the rest of the application from starting.
