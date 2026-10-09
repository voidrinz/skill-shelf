const releaseBase =
  'https://github.com/voidrinz/skill-shelf-releases/releases/download/v0.1.1'

export const macDownloads = {
  arm64:
    import.meta.env.VITE_MAC_ARM64_DOWNLOAD ||
    `${releaseBase}/skill-shelf-0.1.1-mac-arm64.dmg`,
}
