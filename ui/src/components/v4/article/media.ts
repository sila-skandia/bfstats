/** An image or a looping clip on a long-form page (BattleView, blog posts). */
export interface ArticleMedia {
  kind: 'img' | 'video'
  src: string
  alt: string
  poster?: string
  width?: number
  height?: number
}

const VIDEO_EXT = /\.(mp4|webm)$/i

export const mediaKind = (file: string): ArticleMedia['kind'] => (VIDEO_EXT.test(file) ? 'video' : 'img')
