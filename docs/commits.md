# Commit Messages

Use Conventional Commits so Git history explains changes and can support
release notes later. Commit titles and descriptions use English.

```text
<type>(<scope>): <short imperative summary>

Explain what changes and why. Include a concrete before/after example when
useful. Keep the description proportional to the change.

Validation: relevant checks and their result.

Closes #123
```

The scope, body, and issue footer are optional. A meaningful description is
recommended for behavior changes, releases, and larger changes. Titles should
usually stay within 72 characters. Use one commit for each coherent change.

## Types And Scopes

| Type       | Use                                            |
| ---------- | ---------------------------------------------- |
| `feat`     | Add user-visible behavior                      |
| `fix`      | Correct a bug                                  |
| `refactor` | Change structure without changing behavior     |
| `perf`     | Improve performance                            |
| `docs`     | Update documentation                           |
| `test`     | Add or improve tests                           |
| `build`    | Change dependencies or packaging configuration |
| `ci`       | Change GitHub Actions and other automation     |
| `chore`    | Other maintenance                              |

Common scopes are `desktop`, `website`, `ui`, `i18n`, and `release`. Omit the
scope for a change that spans the entire project, such as the initial import.

## Examples

```text
feat(desktop): add menu bar actions

Keep Skill Shelf available after the main window closes. Add a compact panel
for scanning the local environment and opening the main application.

Validation: tray lifecycle tests and a macOS UI check pass.
```

```text
ci(release): build Mac installers without Apple credentials

Publish separate Apple Silicon and Intel downloads using ad-hoc signatures.
Remove the Developer ID and notarization requirements from the workflow.

Validation: workflow lint and an Apple Silicon installer build pass.
```

For incompatible changes, add `!` after the type/scope and a `BREAKING CHANGE:`
footer describing the migration. Commit descriptions explain source changes;
release notes separately explain changes to application users.

## Local Template

To use the checked-in template when running `git commit` without `-m` or `-F`:

```bash
git config --local commit.template .gitmessage
```

This setting applies only to this checkout. The convention is documented rather
than enforced by a commit hook.
