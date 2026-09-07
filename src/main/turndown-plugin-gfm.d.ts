// turndown-plugin-gfm 未内置类型声明，这里提供最小环境声明
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  export const gfm: (turndown: TurndownService) => void
  export const tables: (turndown: TurndownService) => void
  export const strikethrough: (turndown: TurndownService) => void
  export const taskListItems: (turndown: TurndownService) => void
  export const highlightedCodeBlock: (turndown: TurndownService) => void
}
