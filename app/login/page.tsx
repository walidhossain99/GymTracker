'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.replace('/dashboard')
        router.refresh()
      } else {
        const origin = window.location.origin
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name || email.split('@')[0] },
            emailRedirectTo: `${origin}/auth/callback`,
          },
        })
        if (error) throw error
        if (data.session) {
          router.replace('/dashboard')
          router.refresh()
        } else {
          setMessage('Account created. Check your email to confirm your address, then sign in.')
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card card stack">
        <div>
          <div className="eyebrow">Progress Forge</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Train. Record. Progress.</h1>
          <p className="muted">Your bodyweight, exercises, sessions and progressive overload history synced across your devices.</p>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>
        <form className="stack" onSubmit={submit}>
          {mode === 'signup' && (
            <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          )}
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        {message && <div className={message.startsWith('Account created') ? 'success' : 'error'}>{message}</div>}
        <div className="muted" style={{ fontSize: 12 }}>Your workout data is protected by per-user database access rules.</div>
      </div>
    </main>
  )
}
