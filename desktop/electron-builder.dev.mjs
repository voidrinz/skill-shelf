import releaseConfig from './electron-builder.release.mjs'

export default {
  ...releaseConfig,
  appId: 'app.skillshelf.desktop.dev',
  productName: 'Skill Shelf Dev',
  artifactName: 'skill-shelf-dev-${version}-${os}-${arch}.${ext}',
  directories: { ...releaseConfig.directories, output: 'release-dev' },
  extraMetadata: { skillShelfChannel: 'development' },
  extraResources: [
    { from: 'build/trayDevTemplate.png', to: 'trayTemplate.png' },
    { from: 'build/trayDevTemplate@2x.png', to: 'trayTemplate@2x.png' },
    { from: 'build/icon-dev.png', to: 'icon.png' },
  ],
  mac: { ...releaseConfig.mac, icon: 'build/icon-dev.icns' },
}
