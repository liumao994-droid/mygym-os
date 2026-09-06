import { cn } from '@/lib/util'

/**
 * 「畅」品牌水印系统 —— 全局统一的品牌纹理。
 *
 * 背景层规则:pointer-events-none、absolute、-z-10(容器需 relative isolate),
 * 轻微出血裁切,绝不在交互元素之上。
 *
 * size 按底板面积分级:
 * - page  页面背景(200/340px)
 * - hero  大型 Hero 底板(120/170px)
 * - md    中型统计/主卡(88/116px)
 * - sm    小型功能卡/图表卡(58/76px)
 * pos 四角出血;opacity 可覆盖默认(默认随屏幕分级)。
 */
type WMSize = 'page' | 'hero' | 'md' | 'sm'
type WMPos = 'tr' | 'tl' | 'br' | 'bl'

const SIZE: Record<WMSize, string> = {
  page: 'text-[200px] sm:text-[340px]',
  hero: 'text-[124px] sm:text-[172px]',
  md: 'text-[88px] sm:text-[116px]',
  sm: 'text-[58px] sm:text-[76px]',
}

const POS: Record<WMPos, string> = {
  tr: '-top-8 -right-5 sm:-top-12 sm:-right-8',
  tl: '-top-8 -left-5 sm:-top-12 sm:-left-8',
  br: '-bottom-10 -right-5 sm:-bottom-14 sm:-right-8',
  bl: '-bottom-10 -left-5 sm:-bottom-14 sm:-left-8',
}

export function BrandWatermark({
  size = 'page',
  pos = 'tr',
  opacity = 'opacity-[0.035] sm:opacity-[0.05]',
  className,
}: {
  size?: WMSize
  pos?: WMPos
  /** 低透明度底;如需更强/更弱可覆盖,例如 'opacity-[0.028]' */
  opacity?: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute -z-10 select-none font-black leading-none tracking-tight text-accent-hi',
        SIZE[size],
        POS[pos],
        opacity,
        className,
      )}
    >
      畅
    </span>
  )
}

/** 底板容器所需的三件套:建立隔离上下文 + 裁切出血 */
export const WM_PANEL = 'relative isolate overflow-clip'
