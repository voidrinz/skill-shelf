# Skill Shelf Releases

Mac downloads for [Skill Shelf](https://github.com/voidrinz/skill-shelf).

Download from [Releases](https://github.com/voidrinz/skill-shelf-releases/releases/latest).

- Apple Silicon (M-series): `skill-shelf-<version>-mac-arm64.dmg`.
- Intel: `skill-shelf-<version>-mac-x64.dmg`.

Open the installer and drag Skill Shelf into Applications. If macOS blocks
the first launch, follow Apple's
[instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445).

Settings > About checks for new versions and opens this repository's download
page. To update, quit Skill Shelf and replace the app with the latest download.
Your Skill shelf is stored separately and is preserved. Closing the main window
keeps the app in the menu bar; use Quit to exit.

Each release includes DMG and ZIP downloads for Apple Silicon and Intel.

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

Add user-facing notes in `docs/release-notes/<version>.md` in the source
repository before tagging a release. Public assets contain installers only.
Mac update checks follow the latest public release tag, without YAML metadata.

See the source repository's
[release guide](https://github.com/voidrinz/skill-shelf/blob/main/docs/releases.md)
for the complete configuration and process.
