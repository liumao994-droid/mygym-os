import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BrandWatermark } from '@/components/BrandWatermark'
import { Button, Card } from '@/components/ui/basic'
import { useAuth } from '@/store/auth'

type AuthMode = 'login' | 'register'

export default function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const register = useAuth((s) => s.register)
  const login = useAuth((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isRegister = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanUsername = username.trim()
    if (!cleanUsername) return setError('请输入用户名')
    if (!password) return setError('请输入密码')
    if (isRegister) {
      if (password !== confirmPassword) return setError('两次输入的密码不一致')
      if (!nickname.trim()) return setError('请输入昵称')
    }
    setError('')
    setSubmitting(true)
    try {
      if (isRegister) await register(cleanUsername, password, nickname)
      else await login(cleanUsername, password)
      const state = location.state as { from?: { pathname?: string } } | null
      navigate(state?.from?.pathname || '/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '暂时无法完成登录，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh items-center overflow-hidden bg-bg px-4 py-8">
      <BrandWatermark size="page" pos="tr" />
      <main className="relative mx-auto w-full max-w-sm">
        <div className="mb-8 px-2">
          <div className="text-3xl font-black tracking-tight text-ink">MyGym<span className="text-accent">OS</span></div>
          <p className="mt-2 text-sm text-ink-3">{isRegister ? '创建账号，开始沉淀属于你的训练数据。' : '欢迎回来，继续记录你的成长。'}</p>
        </div>

        <Card className="!p-5 sm:!p-6">
          <h1 className="text-xl font-bold text-ink">{isRegister ? '创建账号' : '登录账号'}</h1>
          <p className="mt-1 text-xs text-ink-3">数据按账号独立保存，切换账号不会互相看到记录。</p>

          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            <AuthInput label="用户名" value={username} onChange={setUsername} autoComplete="username" placeholder="2-32 个字符，不含空格" />
            {isRegister && <AuthInput label="昵称" value={nickname} onChange={setNickname} autoComplete="nickname" placeholder="怎么称呼你" />}
            <AuthInput label="密码" value={password} onChange={setPassword} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="至少 6 个字符" />
            {isRegister && <AuthInput label="确认密码" value={confirmPassword} onChange={setConfirmPassword} type="password" autoComplete="new-password" placeholder="再次输入密码" />}
            {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">{error}</p>}
            <Button type="submit" block size="lg" loading={submitting}>
              {isRegister ? '创建并登录' : '登录'}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-ink-3">
            {isRegister ? '已有账号？' : '还没有账号？'}{' '}
            <Link className="font-semibold text-accent hover:opacity-80" to={isRegister ? '/login' : '/register'}>
              {isRegister ? '去登录' : '创建账号'}
            </Link>
          </div>
        </Card>

        <p className="mx-auto mt-5 max-w-xs text-center text-[11px] leading-relaxed text-ink-3">
          密码仅在安全连接中提交，并由服务端加密散列保存，不会写入本机训练备份。
        </p>
      </main>
    </div>
  )
}

function AuthInput({ label, value, onChange, type = 'text', autoComplete, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  autoComplete: string
  placeholder: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] text-ink outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-2 focus:ring-accent/45"
      />
    </label>
  )
}
