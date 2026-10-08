# macOS Releases

Skill Shelf builds Mac downloads without an Apple Developer membership,
Developer ID certificate, or notarization credentials. Applications use ad-hoc
signing. The release repository builds Apple Silicon (`arm64`) and Intel (`x64`)
separately and publishes both only after verification succeeds.

## Two Repositories

- [voidrinz/skill-shelf](https://github.com/voidrinz/skill-shelf) holds source,
  packaging configuration, and the workflow that requests a release on a stable
  `vMAJOR.MINOR.PATCH` tag.
- [voidrinz/skill-shelf-releases](https://github.com/voidrinz/skill-shelf-releases)
  runs builds and hosts downloads. `release-repository/` keeps its workflow and
  README templates; copy their contents when updating the release repository.

The release workflow checks the requested repository, tag, version, and commit
SHA before building. It refuses to overwrite a published release. A failed
draft can be retried. No Windows or Linux builds are part of this workflow.

## GitHub Setup

| Repository | Kind     | Name                  | Value                                                                                      |
| ---------- | -------- | --------------------- | ------------------------------------------------------------------------------------------ |
| Source     | Secret   | `RELEASES_REPO_TOKEN` | Fine-grained token with Contents write on the release repository, to dispatch the workflow |
| Source     | Variable | `RELEASES_REPOSITORY` | Optional; defaults to `voidrinz/skill-shelf-releases`                                      |
| Releases   | Variable | `SOURCE_REPOSITORY`   | Optional; defaults to `voidrinz/skill-shelf`                                               |
| Releases   | Secret   | `SOURCE_READ_TOKEN`   | Required only for a private source repository; Contents read on source                     |

The release repository's built-in `GITHUB_TOKEN` publishes its own Releases.
The Mac client checks the public latest-release page anonymously. No GitHub credentials
are embedded in an application. Apple certificate and notarization secrets are
not required, and the workflow does not depend on a `release` environment.

## Packaging

`electron-builder.release.mjs` explicitly sets the Mac signing identity to `-`,
disables hardened runtime and notarization, and does not require code signing
with a Developer ID. electron-builder signs the app and its nested binaries
ad hoc; the workflow verifies the resulting application with `codesign`.

Each public release includes:

- `skill-shelf-<version>-mac-arm64.dmg` and the corresponding `.zip`.
- `skill-shelf-<version>-mac-x64.dmg` and the corresponding `.zip`.

Only installers are uploaded. Build metadata, blockmaps, and a separate checksum
file are not published. GitHub adds its own asset digests and source archives;
the repository cannot hide those parts of GitHub's release interface.

The release workflow verifies that both architectures' installers
exist before publishing. macOS may block the first launch because these builds
do not have a Developer ID or Apple notarization. Follow Apple's
[instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445)
if needed; no system-wide security setting needs to be disabled.

## Publish A Version

Create and push a version tag only when the maintainer explicitly requests
a desktop release or names the tag to publish. Routine fixes, commits, pushes,
and website updates do not authorize a version bump, release tag, or manual
desktop build in GitHub Actions. Accumulate changes until a release is requested.

1. Set the version in `desktop/package.json`.
2. Add user-facing release notes in `docs/release-notes/<version>.md`.
3. Commit and push the source, including the lockfile and release configuration.
4. Push a matching tag, for example `v0.1.1`.
5. Follow Actions in `skill-shelf-releases`. Both Mac builds must pass before
   the GitHub Release becomes public.

For a manual run, enter an existing source tag or the full 40-character commit
SHA in **Build And Publish Skill Shelf**. A commit SHA permits a build-only
preview before creating any version tags. `publish` defaults to off: artifacts
appear in the workflow run without creating a Release. Publishing requires a
stable source tag matching the desktop version; it needs no Apple credentials.

## Local Builds

```bash
pnpm --filter @skill-shelf/desktop run dist --mac --arm64
```

On an Intel Mac, use `--x64`. Local builds never publish automatically.

`pnpm pack:desktop` remains a development packaging command, separate from the
release configuration and its ad-hoc signing policy.

## Updating The Application

The installed app checks for new versions after 45 seconds and every six hours.
On Mac, it sends a HEAD request to the public GitHub `releases/latest` page and
compares the resolved stable version tag with the installed version. It needs
neither updater YAML files nor a GitHub token, and does not use the GitHub API
rate limit. Network errors remain retryable; older versions never trigger a
downgrade.

Settings > About can check immediately. If a new version is available, **Open
download page** opens the public GitHub Release page. Quit Skill Shelf, download
the DMG for your Mac, and replace the application in Applications to update.
Your shelf data stays in the application's user-data directory.

The Mac release uses manual installation because Electron's Squirrel.Mac
updater requires a persistent trusted signing identity. Ad-hoc builds do not
offer **Restart and update** or invoke that installer. Development builds do
not check for releases. Keep the application ID unchanged across versions.

Version 0.1.0 used electron-updater YAML metadata. Install 0.1.1 from its
download page once to move to the metadata-free release checker. Keep old
published releases intact; do not remove their assets during this migration.
