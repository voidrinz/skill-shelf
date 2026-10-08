# Skill Shelf

Skill Shelf is a local-first desktop GUI for [skills.sh](https://skills.sh). It
uses the official `skills` CLI to list, install, update, and remove skills, then
adds a private organization layer for tags and groups without modifying the
skills themselves.

## Repository

```text
skill-shelf/
├── desktop/       Electron Main + typed Preload + React Renderer
├── website/       Static launchpad website
├── packages/i18n/ Typed English and Simplified Chinese catalogs
└── packages/ui/   Shared visual tokens and UI primitives
```

There is deliberately no backend in the first product phase. Installed skills
remain on the user's machine, and Skill Shelf metadata is stored under the
Electron application data directory.

The desktop and website both support English and Simplified Chinese. Desktop
language preferences are stored in `shelf.json`; the website stores language
and appearance preferences in browser storage.

## Development

Requirements: Node.js 24+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Electron desktop app and the website together. The website
opens automatically in your default browser at <http://localhost:17130>.
The website is the product landing page; desktop features run in Electron.
It includes an interactive workspace preview with sample skills, search,
description views, and Pack deployment examples. The preview does not access
local skill files or run installation commands.

To run either app separately:

```bash
pnpm dev:desktop
pnpm dev:website
```

Keep the development command running while editing code:

- Desktop renderer (React/CSS) and website changes update through Vite HMR.
- Desktop main-process changes rebuild and restart Electron automatically.
- Desktop preload changes rebuild and reload the Electron window automatically.
- Main-process restarts and full window reloads reset in-memory UI state and may
  interrupt running tasks or terminal sessions; saved data remains on disk.

Restart the development command after changing dependencies, startup scripts,
or the Electron Vite configuration. Routine source edits do not require manually
closing and relaunching the app.

Run the full verification suite with:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For commit titles and descriptions, see [the commit convention](docs/commits.md).

## Menu Bar And System Tray

Skill Shelf keeps running when its main window is closed. Click the menu bar
icon on macOS, or the system tray icon on Windows/Linux, to open a compact panel
with local skill, Agent, project, and link-health information. The panel can
rescan the local environment, check skill updates through the existing task
queue, and open Skills, Discover, Packs, or Settings in the main window.

Click outside the panel or press Escape to dismiss it. After 30 seconds hidden,
the panel releases its renderer and recreates it when opened again. Right-click
the icon for the native menu. Use Quit in the panel/menu or the application's
Quit command to exit completely.

## Desktop Releases And Updates

Desktop release builds use a separate public `skill-shelf-releases` repository.
Installed apps check for application updates in the background; Settings >
About opens the download page for manually installing Mac updates. Skill
updates remain separate and use the existing Skill task queue.

See [the release setup guide](docs/releases.md) for the two-repository workflow,
GitHub variables, ad-hoc Mac signing, local installer builds, and verification.

## Application Icons

The desktop and website share the three-book mark defined in
`packages/ui/src/brand-mark.ts`. The React brand component uses the same geometry
with theme-aware colors. Generated app icons use the light-theme brand colors.

After changing the mark, regenerate the checked-in icon assets with:

```bash
pnpm icons:generate
```

This generates macOS ICNS, Windows ICO, Linux PNG, and website favicon/touch icons.
macOS app icons include transparent margins for Dock sizing. Development uses
`desktop/build/icon.png`; packaged apps include it as an Electron resource and use
the platform icons configured in `desktop/electron-builder.yml`.

Restart the desktop development command to refresh its Dock icon after
regenerating assets. Repackage the desktop app to update its installed app icon.
