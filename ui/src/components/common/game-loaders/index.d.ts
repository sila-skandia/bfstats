export interface GameLoader {
  /** The loader's root: the stage, the words and the slow-wait line. */
  element: HTMLElement
  /** The id of the scene on the stage. */
  readonly scene: string | null
  readonly running: boolean
  /** Start, on the scene `id` if given, else one at random. */
  start(id?: string): void
  stop(): void
}

export function createGameLoader(words: string, pick?: string): GameLoader
