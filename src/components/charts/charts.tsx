import {
  Line,
  LineChart,
  Pie,
  PieChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'
import { fmtMonthCN, fmtNum } from '@/lib/util'

const AXIS = { fill: 'var(--text-3)', fontSize: 11 }
const GRID = 'var(--border)'

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-surface-3/95 px-3 py-2 text-xs shadow-xl ring-1 ring-line-strong backdrop-blur">
      <div className="mb-0.5 text-ink-3">{formatter?.label ?? label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="font-semibold text-ink">
          {p.name}: {formatter?.value ? formatter.value(p.value) : fmtNum(p.value)}
        </div>
      ))}
    </div>
  )
}

/** 力量趋势折线图 */
export function TrendChart({
  data,
  color = 'var(--accent)',
  height = 200,
  valueFormatter,
}: {
  data: { x: string; y: number }[]
  color?: string
  height?: number
  valueFormatter?: (v: number) => string
}) {
  if (data.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-ink-3">暂无数据</div>
  }
  if (data.length === 1) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1">
        <span className="text-2xl font-bold num">{valueFormatter ? valueFormatter(data[0].y) : fmtNum(data[0].y)}</span>
        <span className="text-xs text-ink-3">{data[0].x} · 记录一次后可见趋势</span>
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 6" vertical={false} />
        <XAxis
          dataKey="x"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={44} />
        <Tooltip
          content={<ChartTooltip formatter={{ value: valueFormatter }} />}
          cursor={{ stroke: 'var(--border-strong)' }}
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={2.5}
          dot={data.length <= 30 ? { r: 3, fill: color, strokeWidth: 0 } : false}
          activeDot={{ r: 5 }}
          animationDuration={600}
          isAnimationActive
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** 部位分布环形图 */
export function DonutChart({
  data,
  height = 200,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color: string }[]
  height?: number
  centerLabel?: string
  centerValue?: string
}) {
  const hasData = data.some((d) => d.value > 0)
  if (!hasData) {
    return <div className="flex h-40 items-center justify-center text-sm text-ink-3">本月还没有记录</div>
  }
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data.filter((d) => d.value > 0)}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="92%"
            paddingAngle={3}
            cornerRadius={6}
            strokeWidth={0}
            animationDuration={700}
          >
            {data
              .filter((d) => d.value > 0)
              .map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-bold">{centerValue}</span>
          <span className="text-xs text-ink-3">{centerLabel}</span>
        </div>
      )}
    </div>
  )
}

/** 柱状图(周分布 / 月度会话) */
export function BarsChart({
  data,
  height = 160,
  color = 'var(--accent)',
  valueFormatter,
}: {
  data: { x: string; y: number }[]
  height?: number
  color?: string
  valueFormatter?: (v: number) => string
}) {
  const hasData = data.some((d) => d.y > 0)
  if (!hasData) {
    return <div className="flex h-32 items-center justify-center text-sm text-ink-3">暂无数据</div>
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="35%">
        <CartesianGrid stroke={GRID} strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTooltip formatter={{ value: valueFormatter }} />} cursor={{ fill: 'var(--accent-dim)' }} />
        <Bar dataKey="y" fill={color} radius={[6, 6, 4, 4]} animationDuration={600} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export { fmtMonthCN }
