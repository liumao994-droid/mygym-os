import { useEffect, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/util'

/* =============== Card =============== */

export function Card({
  children,
  className,
  onClick,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  delay?: number
}) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'w-full rounded-3xl bg-surface p-4 text-left ring-1 ring-line',
        onClick && 'cursor-pointer transition-transform active:scale-[0.985]',
        className,
      )}
    >
      {children}
    </Comp>
  )
}

/* =============== Button =============== */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg' | 'sm'
  block?: boolean
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', block, loading, className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-all select-none',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-9 px-3.5 text-sm',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'lg' && 'h-13 px-6 text-base',
        variant === 'primary' && 'bg-accent text-accent-ink font-semibold',
        variant === 'secondary' && 'bg-surface-2 text-ink ring-1 ring-line-strong',
        variant === 'ghost' && 'bg-transparent text-ink-2 hover:text-ink',
        variant === 'danger' && 'bg-danger/15 text-danger ring-1 ring-danger/30',
        block && 'w-full',
        className,
      )}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  )
}

/* =============== Section 标题 =============== */

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-2 pt-1">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {action && (
        <button onClick={onAction} className="text-[13px] font-medium text-ink-3 transition-colors hover:text-ink">
          {action}
        </button>
      )}
    </div>
  )
}

/* =============== Chip / Tag =============== */

export function Chip({
  children,
  selected,
  color,
  onClick,
  className,
}: {
  children: ReactNode
  selected?: boolean
  color?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={
        selected && color
          ? { backgroundColor: color, color: '#F5EFEA', borderColor: 'transparent' }
          : undefined
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-all active:scale-95',
        selected
          ? color
            ? ''
            : 'bg-accent text-accent-ink'
          : 'bg-surface-2 text-ink-2 ring-1 ring-line hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function PartBadge({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs')}
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  )
}

/* =============== 大标题页面头 =============== */

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between px-5 pb-3 pt-2">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

/* =============== Empty State =============== */

export function EmptyState({
  icon,
  title,
  desc,
  actionText,
  onAction,
}: {
  icon: ReactNode
  title: string
  desc?: string
  actionText?: string
  onAction?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center px-8 py-14 text-center"
    >
      <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-surface-2 text-3xl">{icon}</div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {desc && <p className="mt-1.5 max-w-60 text-sm leading-relaxed text-ink-3">{desc}</p>}
      {actionText && (
        <Button className="mt-6" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </motion.div>
  )
}

/* =============== 数值动画 =============== */

export function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="num"
    >
      {format ? format(value) : value}
    </motion.span>
  )
}

/* =============== Sheet(底部弹层) =============== */

export function Sheet({
  open,
  onClose,
  title,
  children,
  full,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  full?: boolean
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-[#081331]/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%', opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 380 }}
        className={cn(
          'relative z-10 w-full max-w-lg rounded-t-3xl bg-bg-elev px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 shadow-2xl sm:rounded-3xl',
          full ? 'h-[88dvh]' : 'max-h-[80dvh]',
        )}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-surface-3 sm:hidden" />
        {title && (
          <div className="flex items-center justify-between px-1 pb-2">
            <h3 className="text-base font-semibold">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1.5 text-ink-3 hover:bg-surface-2">
              ✕
            </button>
          </div>
        )}
        <div className={cn('overflow-y-auto overscroll-contain', full ? 'h-[calc(88dvh-56px)]' : 'max-h-[calc(80dvh-56px)]')}>
          {children}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

/* =============== SegmentedControl =============== */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-2xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex-1 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'text-accent-ink' : 'text-ink-3',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join()}`}
              className="absolute inset-0 rounded-xl bg-accent"
              transition={{ type: 'spring', damping: 28, stiffness: 400 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
