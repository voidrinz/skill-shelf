# Skill Shelf Releases

Mac downloads for [Skill Shelf](https://github.com/voidrinz/skill-shelf).
This repository builds tagged source revisions and hosts GitHub Releases.

Download from [Releases](https://github.com/voidrinz/skill-shelf-releases/releases/latest).
Installers will be available after the first release is published.

- Apple Silicon (M-series): `skill-shelf-<version>-mac-arm64.dmg`.
- Intel: `skill-shelf-<version>-mac-x64.dmg`.

Open the DMG and drag Skill Shelf into Applications. These builds use ad-hoc
signing without an Apple Developer certificate or notarization. If macOS blocks
the first launch, follow Apple's
[instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445).

Settings > About checks for new versions and opens this repository's download
page. To update, quit Skill Shelf and replace the app with the latest download.
Your Skill shelf is stored separately and is preserved. Closing the main window
keeps the app in the menu bar; use Quit to exit. In-app automatic installation
is not enabled for these Mac builds.

Each release includes both architectures' DMG and ZIP downloads, version-check
metadata, blockmaps, and `SHA256SUMS`.

## Maintainer Setup

The workflow trusts `voidrinz/skill-shelf` by default. Push the source and a
stable tag matching `desktop/package.json`, such as `v0.1.0`. **Build And Publish
Skill Shelf** also supports manual runs: leave `publish` off and enter the full
source commit SHA to test packaging before creating a tag. Publishing requires
a stable source tag; enable `publish` to create a GitHub Release.

Automatic tag-triggered publishing requires `RELEASES_REPO_TOKEN` in the source
repository's Actions secrets: a fine-grained token with Contents write access
to this repository. No Apple certificate, Apple account, notarization secret,
or `release` environment is required. Both Mac architectures must build and
pass signature verification before publishing.

See the source repository's
[release guide](https://github.com/voidrinz/skill-shelf/blob/main/docs/releases.md)
for the complete configuration and process.
