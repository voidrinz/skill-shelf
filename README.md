<div align="center">

<img src="website/public/apple-touch-icon.png" width="88" alt="Skill Shelf icon" />

# Skill Shelf

**Your agent skills, in one place.**

A Mac desktop app to organize, discover, update, and reuse skills across your AI coding agents.

[![Latest release](https://img.shields.io/github/v/release/voidrinz/skill-shelf-releases?label=download&color=ed7153)](https://voidrinz.github.io/skill-shelf/#download)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-555)

[Website](https://voidrinz.github.io/skill-shelf/) · [Download for Mac](https://voidrinz.github.io/skill-shelf/#download) · [Release notes](https://github.com/voidrinz/skill-shelf-releases/releases) · [简体中文](README_cn.md)

</div>

Skills are useful until they become hard to find. Skill Shelf gives your growing collection a home: browse what is installed, keep related skills together, and bring the ones you need into each project.

![Skill Shelf library illustration with sample folders and skills](docs/images/skills-library.svg)

<p align="center"><sub>Interface illustration using sample data.</sub></p>

## Why Skill Shelf?

- **Find what you already have.** Browse global and project skills in one app, with search, tags, and readable descriptions.
- **Organize like files.** Use folders, drag and drop, multi-selection, and icon, list, or column views.
- **Discover something useful.** Explore [skills.sh](https://skills.sh), read a skill, and review its installation command before installing.
- **Keep your collection current.** Check for skill updates and follow installation, update, and removal progress in the task queue.
- **Reuse your own skills.** Collect private skills into Packs and add them to projects by copying or linking them.
- **Stay within reach.** Open the menu bar panel for a quick overview, a rescan, or a shortcut back to your library.

Skill Shelf also supports English and Simplified Chinese, light and dark appearance, skill document previews, optional AI translation, and checks for missing or broken skill links.

## Download And Install

**[Download Skill Shelf for Mac →](https://voidrinz.github.io/skill-shelf/#download)**

Download **Apple Silicon** for M-series Macs. The website's download buttons start the installer download directly.

1. Open the downloaded `.dmg` file.
2. Drag **Skill Shelf** into **Applications**.
3. Open Skill Shelf from Applications.

The current Mac builds are not notarized by Apple, so macOS may show a warning on first launch. Follow [Apple's instructions for opening an app](https://support.apple.com/en-us/102445) if you choose to proceed.

All published installers and release notes are available in [skill-shelf-releases](https://github.com/voidrinz/skill-shelf-releases/releases). New releases starting with v0.1.8 support Apple Silicon only. Intel Macs can use the historical v0.1.6 downloads.

## Get Started

1. **Browse your library.** Open Skills to see your global collection, or add a project to view its skills.
2. **Make it yours.** Group related skills into folders, add tags, and choose the view that suits you.
3. **Add and reuse skills.** Find new skills in Discover, or create a Pack for skills you want to use across projects.

Close the main window to keep Skill Shelf in the menu bar. Use **Quit** when you want to exit completely.

## Questions

### Can I use it in a browser?

The website introduces Skill Shelf and includes a preview with sample data. Managing skills on your Mac requires the desktop app.

### Does organizing skills change their files?

Folders, tags, and layout are saved locally by Skill Shelf; organizing your library does not rewrite the original `SKILL.md` documents. Installing, updating, removing, or deploying skills changes the relevant files.

### Do I need an AI service?

You can browse and organize your library without configuring an AI provider. Optional AI translation sends the selected content to the provider you configure; saved translations remain on your Mac.

### How do I update the app?

Open **Settings → About** to check for a new version and go to the download page. Install the new Mac version over the existing app; your saved shelf data is retained. App updates and skill updates are separate.

## Feedback And Contributions

Found a problem or have an idea? [Open an issue](https://github.com/voidrinz/skill-shelf/issues).

To work on the project, see the [development guide](docs/development.md). Build, release, and website deployment instructions live there and in the linked guides.
