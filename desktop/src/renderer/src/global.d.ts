import type {
  SkillShelfDesktopApi,
  SkillShelfTrayApi,
} from '../../shared/desktop-contract'

declare global {
  interface Window {
    skillShelf: SkillShelfDesktopApi
    skillShelfTray: SkillShelfTrayApi
  }
}

export {}
