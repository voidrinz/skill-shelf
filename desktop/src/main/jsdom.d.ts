declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html?: string,
      options?: { runScripts?: 'outside-only'; url?: string }
    )
    readonly window: {
      eval(script: string): unknown
    }
  }
}
