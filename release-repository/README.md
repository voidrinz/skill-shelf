# Skill Shelf Releases

Mac downloads for [Skill Shelf](https://github.com/voidrinz/skill-shelf).

Download from [Releases](https://github.com/voidrinz/skill-shelf-releases/releases/latest).

- Apple Silicon (M-series): `skill-shelf-<version>-mac-arm64.dmg`.

New releases starting with v0.1.8 support Apple Silicon only. Intel downloads
remain available in historical releases through v0.1.6.

Open the installer and drag Skill Shelf into Applications. If macOS blocks
the first launch, follow Apple's
[instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445).

Settings > About checks for new versions, downloads a verified update in-app,
and offers Restart and update. Apple Silicon clients on v0.1.7 or earlier must
install v0.1.8 or later manually once to use updates with the new single-architecture
manifest. Your Skill shelf is stored separately and is preserved. Closing the main window
keeps the app in the menu bar; use Quit to exit.

Each new release includes DMG and ZIP downloads for Apple Silicon, plus
`skill-shelf-update.json`, an Ed25519-signed update manifest.

## Maintainer Setup

The workflow trusts `voidrinz/skill-shelf` by default. Push the source and a
stable tag matching `desktop/package.json`, such as `v0.1.0`. **Build And Publish
Skill Shelf** also supports manual runs: leave `publish` off and enter the full
source commit SHA to test packaging before creating a tag. Publishing requires
a stable source tag; enable `publish` to create a GitHub Release.

Automatic tag-triggered publishing requires `RELEASES_REPO_TOKEN` in the source
repository's Actions secrets: a fine-grained token with Contents write access
to this repository. No Apple certificate, Apple account, notarization secret,
or `release` environment is required. The Apple Silicon application must build
and pass signature verification before publishing.

Add the Actions secret `SKILL_SHELF_UPDATE_PRIVATE_KEY` to this repository. It
must match the public key shipped in the source repository. It signs the update
manifest and is independent of Apple certificates. Missing or mismatched keys
prevent publishing. Keep the private key out of source control and back it up.

Add user-facing notes in `docs/release-notes/<version>.md` in the source
repository before tagging a release. Mac updates follow the stable public
release tag, then verify its signed manifest; no Electron updater YAML is needed.

See the source repository's
[release guide](https://github.com/voidrinz/skill-shelf/blob/main/docs/releases.md)
for the complete configuration and process.
