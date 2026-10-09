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

The release repository also needs the Actions secret `SKILL_SHELF_UPDATE_PRIVATE_KEY`. This is an Ed25519 update-signing key independent of Apple. Its public key is shipped in `desktop/build/update-signing-public-key.json`. Keep the private key outside the repository and back it up securely. Changing the public key without a key-transition release prevents existing clients from verifying later updates.

On this maintainer machine the private key is stored at `~/.config/skill-shelf/update-signing-private.pem` with owner-only permissions. After authenticating GitHub CLI, configure the release repository without printing the key:

```bash
gh auth login
node desktop/scripts/configure-update-secret.mjs
```

The script checks that the private key matches the public key before uploading it as the release repository Secret. Signing a release fails if the key is missing or mismatched.

## Packaging

`electron-builder.release.mjs` explicitly sets the Mac signing identity to `-`,
disables hardened runtime and notarization, and does not require code signing
with a Developer ID. electron-builder signs the app and its nested binaries
ad hoc; the workflow verifies the resulting application with `codesign`.

Each public release includes:

- `skill-shelf-<version>-mac-arm64.dmg` and the corresponding `.zip`.
- `skill-shelf-<version>-mac-x64.dmg` and the corresponding `.zip`.

Each release also includes `skill-shelf-update.json`: a signed manifest containing the stable version and both ZIP files' exact URLs, sizes, and SHA-256 digests. `desktop/scripts/sign-update.mjs` generates it after both architectures finish building. A release is published only after signing succeeds. Electron updater YAML and blockmaps are not required. GitHub adds its own asset digests and source archives.

The release workflow verifies that both architectures' installers
exist before publishing. macOS may block the first launch because these builds
do not have a Developer ID or Apple notarization. Follow Apple's
[instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445)
if needed; no system-wide security setting needs to be disabled.

## Publish A Version

Write each release-note paragraph or bullet on a single source line, and use
blank lines between paragraphs. GitHub Release descriptions render source
newlines as line breaks, so hard-wrapping prose makes the published text wrap
before it reaches the page edge.

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

Settings > About can check immediately. For a newer stable release, the app verifies the manifest with its pinned Ed25519 public key, downloads the ZIP for its architecture with progress, verifies its size and SHA-256, and validates the bundle identifier, version, architecture, ad-hoc code signature, ZIP paths, and symlinks. No Apple Developer identity is involved.

After downloading, **Restart and update** asks for confirmation because open terminal sessions will end. Installation verifies the cached ZIP again and extracts a fresh copy before replacing the application. A detached helper waits for the running app to exit, preserves the old bundle, installs the new bundle, and launches it. The new main process records startup and confirms readiness only when its renderer is ready. If launch or readiness fails within 90 seconds, the helper restores the old bundle and relaunches it. The previous bundle is removed only after successful readiness. Skills and configuration remain in the existing user-data directory.

Automatic installation requires a writable application directory. Apps launched directly from a DMG, a translocated directory, or a protected non-writable folder do not offer installation; copy the app into a writable Applications folder first. Network, verification, permission, installation, and rollback failures are distinguished in About. A failed download or pre-quit installation can be retried.

The original release checker opens the browser and cannot install this updater into itself. Install the first release containing this mechanism manually once; later signed releases can update in-app. Development builds remain offline. Do not change the application ID or remove previously published assets.
