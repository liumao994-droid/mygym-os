import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSettings } from '@/store/settings'
import { bootstrapDB } from '@/services/io'
import { BottomNav } from '@/components/BottomNav'
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

export default function App() {
  const hydrate = useSettings((s) => s.hydrate)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([hydrate(), bootstrapDB()])
      .catch((e) => console.error('启动失败', e))
      .finally(() => setReady(true))
  }, [hydrate])

  if (!ready) {
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
      <HashRouter>
        <ScrollToTop />
        <Routes>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BottomNav />
      </HashRouter>
    </ErrorBoundary>
  )
}
