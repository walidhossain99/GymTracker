'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/user'
import type { BodyweightEntry } from '@/lib/types'
import { formatDate, formatKg, todayLocalISO } from '@/lib/metrics'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { ProgressLineChart } from './ProgressLineChart'
import { StatCard } from './StatCard'

export function BodyweightClient() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [entries, setEntries] = useState<BodyweightEntry[]>([])
  const [date, setDate] = useState(todayLocalISO())
  const [weight, setWeight] = useState('')
  const [bodyFat, setBodyFat] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const user = await getCurrentUser(supabase)
    setUserId(user.id)
    const { data, error } = await supabase
      .from('bodyweight_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_date', { ascending: true })
    if (error) setMessage(error.message)
    else setEntries((data ?? []) as BodyweightEntry[])
  }, [supabase])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(userId, ['bodyweight_entries'], load)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    const kg = Number(weight)
    const fat = bodyFat ? Number(bodyFat) : null
    if (!Number.isFinite(kg) || kg <= 20 || kg >= 400) {
      setMessage('Enter a valid bodyweight between 20 and 400 kg.')
      return
    }
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('bodyweight_entries').upsert({
      user_id: userId,
      entry_date: date,
      weight_kg: kg,
      body_fat_pct: fat,
      note: note.trim() || null,
    }, { onConflict: 'user_id,entry_date' })
    setBusy(false)
    if (error) setMessage(error.message)
    else {
      setWeight('')
      setBodyFat('')
      setNote('')
      setMessage('Saved. If this date already existed, it was updated.')
      load()
    }
  }

  async function remove(id: string) {
    await supabase.from('bodyweight_entries').delete().eq('id', id)
    load()
  }

  const latest = entries.at(-1)
  const first = entries[0]
  const change = latest && first ? Number(latest.weight_kg) - Number(first.weight_kg) : null
  const avg7 = entries.length ? entries.slice(-7).reduce((s, e) => s + Number(e.weight_kg), 0) / Math.min(7, entries.length) : null
  let weeklyRate: number | null = null
  if (latest && first && latest.entry_date !== first.entry_date) {
    const days = (Date.parse(`${latest.entry_date}T00:00:00Z`) - Date.parse(`${first.entry_date}T00:00:00Z`)) / 86400000
    if (days > 0) weeklyRate = change! / (days / 7)
  }

  const chart = entries.map((e) => ({ label: formatDate(e.entry_date).replace(/\s\d{4}$/, ''), weight: Number(e.weight_kg) }))

  return (
    <div className="container stack">
      <header className="page-head">
        <div className="eyebrow">Body metrics</div>
        <h1 className="h1">Bodyweight</h1>
        <p>Track scale weight over time. Re-entering the same date updates that day instead of creating a duplicate.</p>
      </header>

      <section className="grid grid-4">
        <StatCard label="Current" value={latest ? formatKg(Number(latest.weight_kg)) : '—'} />
        <StatCard label="7-entry average" value={avg7 === null ? '—' : formatKg(avg7)} />
        <StatCard label="Total change" value={change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)} kg`} />
        <StatCard label="Average rate" value={weeklyRate === null ? '—' : `${weeklyRate >= 0 ? '+' : ''}${weeklyRate.toFixed(2)} kg/wk`} />
      </section>

      <section className="two-column-main">
        <form className="card stack" onSubmit={save}>
          <div><h2 className="h2">Log weigh-in</h2><div className="muted">For cleaner trends, weigh under similar conditions.</div></div>
          <label>Date<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Weight (kg)<input required type="number" min="20.01" max="399.99" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="78.4" /></label>
          <label>Body fat % · optional<input type="number" min="1.01" max="69.99" step="0.1" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="18.5" /></label>
          <label>Note · optional<input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Morning, fasted…" /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save weigh-in'}</button>
          {message && <div className="muted" style={{ fontSize: 13 }}>{message}</div>}
        </form>

        <div className="card stack">
          <div><h2 className="h2">Weight progression</h2><div className="muted">Every saved weigh-in is plotted chronologically.</div></div>
          <ProgressLineChart data={chart} dataKey="weight" unit=" kg" empty="Your chart will appear after the first weigh-in." />
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">History</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Weight</th><th>Δ previous</th><th>Body fat</th><th>Note</th><th /></tr></thead>
            <tbody>
              {entries.slice().reverse().map((entry) => {
                const idx = entries.findIndex((e) => e.id === entry.id)
                const prev = idx > 0 ? entries[idx - 1] : null
                const delta = prev ? Number(entry.weight_kg) - Number(prev.weight_kg) : null
                return (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.entry_date)}</td>
                    <td><strong>{formatKg(Number(entry.weight_kg))}</strong></td>
                    <td>{delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kg`}</td>
                    <td>{entry.body_fat_pct ? `${Number(entry.body_fat_pct).toFixed(1)}%` : '—'}</td>
                    <td className="muted">{entry.note || '—'}</td>
                    <td><button className="btn btn-danger" onClick={() => remove(entry.id)}>Delete</button></td>
                  </tr>
                )
              })}
              {!entries.length && <tr><td colSpan={6}><div className="empty">No weigh-ins yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
