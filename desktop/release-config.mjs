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
  if (arch !== 'arm64')
    throw new Error('Mac releases support Apple Silicon (arm64) only.')
  return {
    artifactName: 'skill-shelf-${version}-${os}-${arch}.${ext}',
    publish: null,
  }
}
