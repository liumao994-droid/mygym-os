import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { toast, useSettings } from '@/store/settings'
import { useAuth } from '@/store/auth'
import { bootstrapDB } from '@/services/io'
import { getAppState, getLegacyDataCounts, setAppState } from '@/db/db'
import { adoptLegacyData } from '@/services/cloud'
import { BottomNav } from '@/components/BottomNav'
import { Button, Sheet } from '@/components/ui/basic'
import HomePage from '@/pages/HomePage'
import TrainPage from '@/pages/TrainPage'
import ActiveWorkoutPage from '@/pages/ActiveWorkoutPage'
import HistoryPage from '@/pages/HistoryPage'
import MePage from '@/pages/MePage'
import ExercisesPage from '@/pages/ExercisesPage'
import ExerciseDetailPage from '@/pages/ExerciseDetailPage'
import TemplatesPage from '@/pages/TemplatesPage'
import ReportsPage from '@/pages/ReportsPage'
import MonthlyReportPage from '@/pages/MonthlyReportPage'
import YearlyReportPage from '@/pages/YearlyReportPage'
import MilestonesPage from '@/pages/MilestonesPage'
import { BadmintonPage, BadmintonFormPage } from '@/pages/BadmintonPages'
import { SwimmingPage, SwimmingFormPage } from '@/pages/SwimmingPages'
import { TennisPage, TennisFormPage } from '@/pages/TennisPages'
import { VolleyballDetailPage, VolleyballFormPage, VolleyballPage } from '@/pages/VolleyballPages'
import AuthPage from '@/pages/AuthPage'

/** 全局错误边界:数据/渲染异常不让整个页面白屏 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MyGym OS error:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-3xl">😵</div>
          <p className="font-semibold">出了点问题,但你的数据都安全地存在本地。</p>
          <p className="text-xs text-ink-3">{this.state.error.message}</p>
          <button
            onClick={() => location.reload()}
            className="mt-2 rounded-2xl bg-accent px-5 py-2.5 font-semibold text-accent-ink"
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function RequireAuth() {
  const status = useAuth((s) => s.status)
  const location = useLocation()
  if (status !== 'loggedIn') return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

function GuestOnly() {
  const status = useAuth((s) => s.status)
  return status === 'loggedIn' ? <Navigate to="/" replace /> : <Outlet />
}

function LegacyDataPrompt() {
  const userId = useAuth((s) => s.user?.id)
  const [open, setOpen] = useState(false)
  const [counts, setCounts] = useState<{ sessions: number; sets: number; activities: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    void Promise.all([getAppState<string>('legacyDataDecision', ''), getLegacyDataCounts()]).then(([decision, legacy]) => {
      if (!decision && (legacy.sessions > 0 || legacy.sets > 0 || legacy.activities > 0)) {
        setCounts(legacy)
        setOpen(true)
      }
    })
  }, [userId])

  async function decide(adopt: boolean) {
    setBusy(true)
    try {
      if (adopt) {
        await adoptLegacyData()
        await useSettings.getState().hydrate()
        toast('历史本机数据已绑定到当前账号')
      }
      await setAppState('legacyDataDecision', adopt ? 'adopted' : 'skipped')
      setOpen(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : '迁移失败，旧数据未被删除', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={() => void decide(false)} title="检测到本机历史数据">
      <div className="space-y-4 px-1 pb-2 pt-1">
        <p className="text-sm leading-relaxed text-ink-2">这台设备有未绑定账号的旧资料。是否复制并绑定到当前账号？原始资料会保留，不会被删除。</p>
        {counts && <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm text-ink-3">{counts.sessions} 次力量训练 · {counts.sets} 组 · {counts.activities} 条运动记录</p>}
        <Button block loading={busy} onClick={() => void decide(true)}>绑定历史数据</Button>
        <Button variant="secondary" block disabled={busy} onClick={() => void decide(false)}>暂不绑定，创建空账号</Button>
      </div>
    </Sheet>
  )
}

function AccountLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
      <LegacyDataPrompt />
    </>
  )
}

export default function App() {
  const hydrateSettings = useSettings((s) => s.hydrate)
  const hydrateAuth = useAuth((s) => s.hydrate)
  const authStatus = useAuth((s) => s.status)
  const dbEpoch = useAuth((s) => s.dbEpoch)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void hydrateAuth().catch((e) => console.error('认证初始化失败', e))
  }, [hydrateAuth])

  useEffect(() => {
    if (authStatus === 'unknown') return
    setReady(false)
    Promise.all([hydrateSettings(), bootstrapDB()])
      .catch((e) => console.error('启动失败', e))
      .finally(() => setReady(true))
  }, [authStatus, dbEpoch, hydrateSettings])

  if (!ready || authStatus === 'unknown') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg">
        <div className="text-4xl font-black tracking-tight">
          MyGym<span className="text-accent">OS</span>
        </div>
        <div className="text-xs tracking-[0.3em] text-ink-3">TRAIN · TRACK · GROW</div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <HashRouter key={dbEpoch}>
        <ScrollToTop />
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<AccountLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/train" element={<TrainPage />} />
              <Route path="/workout/:id" element={<ActiveWorkoutPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/me" element={<MePage />} />
              <Route path="/exercises" element={<ExercisesPage />} />
              <Route path="/exercise/:id" element={<ExerciseDetailPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/report/month/:key" element={<MonthlyReportPage />} />
              <Route path="/report/year/:year" element={<YearlyReportPage />} />
              <Route path="/milestones" element={<MilestonesPage />} />
              <Route path="/badminton" element={<BadmintonPage />} />
              <Route path="/badminton/new" element={<BadmintonFormPage />} />
              <Route path="/badminton/:id" element={<BadmintonFormPage />} />
              <Route path="/badminton/:id/edit" element={<BadmintonFormPage />} />
              <Route path="/swimming" element={<SwimmingPage />} />
              <Route path="/swimming/new" element={<SwimmingFormPage />} />
              <Route path="/swimming/:id/edit" element={<SwimmingFormPage />} />
              <Route path="/tennis" element={<TennisPage />} />
              <Route path="/tennis/new" element={<TennisFormPage />} />
              <Route path="/tennis/:id/edit" element={<TennisFormPage />} />
              <Route path="/volleyball" element={<VolleyballPage />} />
              <Route path="/volleyball/new" element={<VolleyballFormPage />} />
              <Route path="/volleyball/:id" element={<VolleyballDetailPage />} />
              <Route path="/volleyball/:id/edit" element={<VolleyballFormPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  )
}
