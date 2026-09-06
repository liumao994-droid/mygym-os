import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDataStats } from '@/db/db'
import { sumAllVolume } from '@/services/stats'
import { clearDemoData, clearAllData } from '@/services/repo'
import { exportJSON, exportCSV, importJSON, downloadBlob } from '@/services/io'
import { DEFAULT_AI_CONFIG, getAIConfig, saveAIConfig, type AIConfig } from '@/services/ai'
import { fmtVolume, cn } from '@/lib/util'
import { Card, PageHeader, SectionTitle, Sheet, Button } from '@/components/ui/basic'
import { useSettings, type ThemeMode, type Unit, toast } from '@/store/settings'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'

/**
 * 我的:数据总览 / 通用设置(单位、主题、昵称、提醒)/
 * 功能入口(动作、模板、报告)/ 数据管理(导出导入清空)/ AI 设置 / 关于
 */
export default function MePage() {
  const navigate = useNavigate()
  const { unit, theme, nickname, remindersEnabled, setUnit, setTheme, setNickname, setReminders } = useSettings()
  const [stats, setStats] = useState<{ sessions: number; sets: number; exercises: number } | null>(null)
  const [volume, setVolume] = useState<number | null>(null)
  const [nameDraft, setNameDraft] = useState(nickname)
  const [aiOpen, setAiOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    refreshStats()
  }, [])

  function refreshStats() {
    getDataStats().then(setStats)
    sumAllVolume().then((v) => setVolume(Math.round(v)))
  }

  async function handleExportJSON() {
    const { blob, filename } = await exportJSON()
    downloadBlob(blob, filename)
    toast('已导出完整备份 (JSON)')
  }
  async function handleExportCSV() {
    const { blob, filename } = await exportCSV()
    downloadBlob(blob, filename)
    toast('已导出训练组明细 (CSV)')
  }
  async function handleImport(file: File) {
    try {
      const r = await importJSON(file, 'merge')
      toast(`导入完成:${r.sessions} 次训练 / ${r.sets} 组`)
      refreshStats()
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error')
    }
  }

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <BrandWatermark size="page" pos="tr" />
      <PageHeader title="我的" subtitle="Train · Track · Grow" />

      <main className="mx-auto max-w-2xl space-y-5 px-4">
        {/* 数据总览 */}
        <Card className={WM_PANEL + " !p-5"}>
          <BrandWatermark size="sm" pos="tl" opacity="opacity-[0.03]" />
          <div className="text-[13px] text-ink-3">数据总览</div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="num text-[22px] font-bold">{stats ? stats.sessions : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">训练次数</div>
            </div>
            <div>
              <div className="num text-[22px] font-bold">{stats ? stats.sets : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总组数</div>
            </div>
            <div>
              <div className="num text-[22px] font-bold">{stats ? stats.exercises : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">动作</div>
            </div>
            <div>
              <div className="num text-[22px] font-bold">{volume !== null ? fmtVolume(volume).replace('kg', '') : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总量 kg</div>
            </div>
          </div>
        </Card>

        {/* 功能入口 */}
        <div className="grid grid-cols-3 gap-3">
          <EntryCard icon="📚" label="我的动作" onClick={() => navigate('/exercises')} />
          <EntryCard icon="🔖" label="训练模板" onClick={() => navigate('/templates')} />
          <EntryCard icon="📊" label="报告" onClick={() => navigate('/reports')} />
        </div>

        <SectionTitle title="通用" />
        <Card className="divide-y divide-line !p-0">
          <div className="flex items-center gap-3 p-4">
            <span className="w-20 text-[15px] text-ink-2">昵称</span>
            <input
              value={nameDraft}
              maxLength={12}
              placeholder="怎么称呼你"
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => setNickname(nameDraft.trim())}
              className="flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="flex items-center gap-3 p-4">
            <span className="w-20 text-[15px] text-ink-2">重量单位</span>
            <div className="flex-1" />
            <div className="flex rounded-xl bg-surface-2 p-1">
              {(['kg', 'lb'] as Unit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={cn(
                    'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                    unit === u ? 'bg-accent text-accent-ink' : 'text-ink-3',
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-3">
            底层始终以 kg 存储,切换单位只影响显示,历史数据不会丢失。
          </p>
          <div className="flex items-center gap-3 p-4">
            <span className="w-20 text-[15px] text-ink-2">主题</span>
            <div className="flex-1" />
            <div className="flex rounded-xl bg-surface-2 p-1">
              {(
                [
                  { v: 'dark', label: '深色' },
                  { v: 'light', label: '浅色' },
                  { v: 'system', label: '系统' },
                ] as { v: ThemeMode; label: string }[]
              ).map((t) => (
                <button
                  key={t.v}
                  onClick={() => setTheme(t.v)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    theme === t.v ? 'bg-accent text-accent-ink' : 'text-ink-3',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setReminders(!remindersEnabled)}>
            <span className="w-20 text-[15px] text-ink-2">智能提醒</span>
            <span className="flex-1 text-right text-xs text-ink-3">温和 · 少量 · 可关闭</span>
            <span
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                remindersEnabled ? 'bg-accent' : 'bg-surface-3',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-5 rounded-full bg-[#F5EFEA] shadow-sm transition-all',
                  remindersEnabled ? 'left-[22px]' : 'left-0.5',
                )}
              />
            </span>
          </button>
          <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setAiOpen(true)}>
            <span className="w-20 text-[15px] text-ink-2">AI 分析</span>
            <span className="flex-1 text-right text-xs text-ink-3">配置自己的 AI 接口(可选)</span>
            <span className="text-ink-3">›</span>
          </button>
        </Card>

        <SectionTitle title="数据" />
        <Card className="space-y-2.5 !p-4">
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={handleExportJSON}>
              导出 JSON
            </Button>
            <Button variant="secondary" onClick={handleExportCSV}>
              导出 CSV
            </Button>
          </div>
          <Button variant="secondary" block onClick={() => fileInput.current?.click()}>
            导入 JSON 备份
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImport(f)
              e.target.value = ''
            }}
          />
          <p className="text-[11px] leading-relaxed text-ink-3">
            数据全部保存在本机浏览器,不上传任何服务器。建议定期导出 JSON 备份;换设备时用「导入」恢复。
          </p>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm('清除所有示例(Demo)数据?\n你自己记录的真实数据不受影响。')) return
                await clearDemoData()
                toast('示例数据已清除')
                refreshStats()
              }}
            >
              清除示例数据
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm('清空全部数据?\n包括所有训练记录、动作与设置。此操作不可恢复,建议先导出备份!')) return
                await clearAllData()
                toast('已清空全部数据')
                refreshStats()
              }}
            >
              清空全部数据
            </Button>
          </div>
        </Card>

        <SectionTitle title="关于" />
        <Card className="!p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold">
                MyGym<span className="text-accent">OS</span>
              </div>
              <div className="mt-0.5 text-xs tracking-widest text-ink-3">TRAIN · TRACK · GROW</div>
            </div>
            <span className="num rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-3">v0.1</span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            记录训练 → 自动沉淀数据 → 自动分析力量 → 发现进步 → 月度复盘 → 长期成长。
            本地优先 · 离线可用 · 数据可携带。
          </p>
        </Card>
      </main>

      <AISettingsSheet open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}

function EntryCard({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-3xl bg-surface p-4 ring-1 ring-line active:scale-[0.97]"
    >
      <span className="text-xl">{icon}</span>
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  )
}

/* =============== AI 设置(用户自己的 OpenAI 兼容接口) =============== */

function AISettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<AIConfig>(DEFAULT_AI_CONFIG)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (open && !loaded) {
      getAIConfig().then((c) => {
        setCfg(c)
        setLoaded(true)
      })
    }
  }, [open, loaded])

  return (
    <Sheet open={open} onClose={onClose} title="AI 分析设置">
      <div className="space-y-4 pb-6">
        <p className="text-xs leading-relaxed text-ink-3">
          可选功能。填入你自己的 OpenAI 兼容接口(OpenAI / DeepSeek / Claude 中转等)后,才能使用「AI 深度分析」。
          基础统计(1RM、PR、容量)永远由本地计算,AI 只在你主动点击时被调用一次,结果缓存,不会自动消耗 Token。
        </p>
        <label className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
          <span className="text-[15px]">启用 AI 深度分析</span>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
            className="size-5 accent-[var(--accent)]"
          />
        </label>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">接口地址(Base URL)</div>
          <input
            value={cfg.baseURL}
            onChange={(e) => setCfg({ ...cfg, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[14px] outline-none ring-1 ring-line focus:ring-accent/50"
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">API Key(仅保存在本机)</div>
          <input
            value={cfg.apiKey}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            type="password"
            placeholder="sk-…"
            className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[14px] outline-none ring-1 ring-line focus:ring-accent/50"
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">模型</div>
          <input
            value={cfg.model}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            placeholder="gpt-4o-mini"
            className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[14px] outline-none ring-1 ring-line focus:ring-accent/50"
          />
        </div>
        <Button
          block
          onClick={async () => {
            await saveAIConfig(cfg)
            toast('AI 设置已保存')
            onClose()
          }}
        >
          保存
        </Button>
      </div>
    </Sheet>
  )
}
