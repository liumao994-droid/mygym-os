import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDataStats, getLegacyDataCounts } from '@/db/db'
import { sumAllVolume } from '@/services/stats'
import { clearDemoData, clearAllData } from '@/services/repo'
import { exportJSON, exportCSV, importJSON, downloadBlob } from '@/services/io'
import { api, type AIQuotaResponse } from '@/services/api'
import { migrateLegacyToCloud, restoreFromCloud, syncToCloud } from '@/services/cloud'
import { fmtVolume, cn } from '@/lib/util'
import { Card, PageHeader, SectionTitle, Sheet, Button } from '@/components/ui/basic'
import { useSettings, type ThemeMode, type Unit, toast } from '@/store/settings'
import { useAuth } from '@/store/auth'
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
  const { user, status, loginWithNickname, logout } = useAuth()
  const [loginName, setLoginName] = useState(nickname)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [legacyCounts, setLegacyCounts] = useState<{ sessions: number; sets: number; activities: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    refreshStats()
  }, [])

  useEffect(() => {
    if (status === 'loggedIn') void getLegacyDataCounts().then(setLegacyCounts)
  }, [status])

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
      toast(
        r.skippedActivities > 0
          ? `导入完成:${r.sessions} 次训练 / ${r.sets} 组(已跳过 ${r.skippedActivities} 条未知运动类型的记录)`
          : `导入完成:${r.sessions} 次训练 / ${r.sets} 组`,
      )
      refreshStats()
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error')
    }
  }

  async function handleLogin() {
    try {
      await loginWithNickname(loginName)
      await setNickname(loginName.trim())
      toast('已登录，本机数据已切换到该账号')
    } catch (e) {
      toast(e instanceof Error ? e.message : '登录失败', 'error')
    }
  }

  async function handleCloud(action: 'migrate' | 'upload' | 'restore') {
    setCloudBusy(true)
    try {
      if (action === 'migrate') {
        await migrateLegacyToCloud()
        setLegacyCounts({ sessions: 0, sets: 0, activities: 0 })
        toast('旧数据已认领并上传到云端')
      } else if (action === 'upload') {
        await syncToCloud()
        toast('已上传当前本机资料')
      } else {
        const result = await restoreFromCloud()
        toast(`已从云端合并 ${result.sessions} 次训练 / ${result.sets} 组`)
        refreshStats()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '云端操作失败', 'error')
    } finally {
      setCloudBusy(false)
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

        <SectionTitle title="账号与云端" />
        <Card className="space-y-3 !p-4">
          {status === 'loggedIn' && user ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{user.nickname}</div>
                  <div className="mt-0.5 text-xs text-ink-3">已登录 · 资料按账号隔离</div>
                </div>
                <Button variant="secondary" size="sm" onClick={logout}>退出</Button>
              </div>
              {legacyCounts && (legacyCounts.sessions > 0 || legacyCounts.sets > 0 || legacyCounts.activities > 0) ? (
                <Button block loading={cloudBusy} onClick={() => void handleCloud('migrate')}>
                  认领旧本机数据并上传
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <Button variant="secondary" loading={cloudBusy} onClick={() => void handleCloud('upload')}>上传到云端</Button>
                  <Button variant="secondary" loading={cloudBusy} onClick={() => void handleCloud('restore')}>从云端恢复</Button>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-ink-3">迁移和恢复均为合并操作，不会删除原有本机资料。</p>
            </>
          ) : (
            <>
              <div className="text-[13px] leading-relaxed text-ink-3">登录后可隔离不同账号资料，并手动同步至云端。</div>
              <div className="flex gap-2">
                <input
                  value={loginName}
                  maxLength={24}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="输入昵称登录"
                  className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none ring-1 ring-line focus:ring-accent/50"
                />
                <Button loading={cloudBusy} onClick={() => void handleLogin()}>登录</Button>
              </div>
            </>
          )}
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
            <span className="flex-1 text-right text-xs text-ink-3">云端代理 · 按账号限额</span>
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
            本机备份独立可用；登录后可手动上传或从云端恢复。认证信息和 AI Key 不会写入备份。
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

/* =============== AI 设置(服务端代理) =============== */

function AISettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const [quota, setQuota] = useState<AIQuotaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user) return
    setQuota(null)
    setError(null)
    api.aiQuota().then(setQuota).catch((e) => setError(e instanceof Error ? e.message : '无法读取 AI 状态'))
  }, [open, user])

  return (
    <Sheet open={open} onClose={onClose} title="AI 分析设置">
      <div className="space-y-4 pb-6">
        <p className="text-xs leading-relaxed text-ink-3">
          基础统计(1RM、PR、容量)始终在本机计算。AI 分析仅在你主动点击时发送结构化摘要，服务端按账号限额并安全保管 Provider Key。
        </p>
        {!user ? <Card className="text-sm text-ink-3">请先登录，才能使用 AI 深度分析。</Card> : error ? <Card className="text-sm text-warn">{error}</Card> : quota ? <Card className="space-y-1 text-sm"><div>服务状态：{quota.enabled ? '可用' : '暂未配置'}</div><div className="text-ink-3">今日剩余 {quota.daily.remaining} / {quota.daily.limit} · 本月剩余 {quota.monthly.remaining} / {quota.monthly.limit}</div></Card> : <Card className="text-sm text-ink-3">正在读取服务状态…</Card>}
        <Button variant="secondary" block onClick={onClose}>关闭</Button>
      </div>
    </Sheet>
  )
}
