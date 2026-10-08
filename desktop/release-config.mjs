export function getReleaseTarget(repository, arch) {
  if (
    typeof repository !== 'string' ||
    repository !== repository.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
      repository ?? ''
    )
  )
    throw new Error(
      'Set SKILL_SHELF_RELEASES_REPOSITORY to the public owner/skill-shelf-releases repository.'
    )
  if (!['x64', 'arm64'].includes(arch))
    throw new Error('Release architecture must be x64 or arm64.')
  const [owner, repo] = repository.split('/')
  return {
    artifactName: 'skill-shelf-${version}-${os}-${arch}.${ext}',
    generateUpdatesFilesForAllChannels: false,
    publish: {
      provider: 'github',
      owner,
      repo,
      channel: `latest-${arch}`,
      releaseType: 'draft',
    },
  }
}
