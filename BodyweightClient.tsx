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

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [editBodyFat, setEditBodyFat] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editBusy, setEditBusy] = useState(false)

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

  function validateValues(weightValue: string, bodyFatValue: string) {
    const kg = Number(weightValue)
    const fat = bodyFatValue ? Number(bodyFatValue) : null

    if (!Number.isFinite(kg) || kg <= 20 || kg >= 400) {
      return { ok: false as const, message: 'Enter a valid bodyweight between 20 and 400 kg.' }
    }
    if (fat !== null && (!Number.isFinite(fat) || fat <= 1 || fat >= 70)) {
      return { ok: false as const, message: 'Enter a valid body-fat percentage between 1 and 70, or leave it blank.' }
    }
    return { ok: true as const, kg, fat }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!userId) return

    const validation = validateValues(weight, bodyFat)
    if (!validation.ok) {
      setMessage(validation.message)
      return
    }

    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('bodyweight_entries').upsert({
      user_id: userId,
      entry_date: date,
      weight_kg: validation.kg,
      body_fat_pct: validation.fat,
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

  function startEdit(entry: BodyweightEntry) {
    setEditingId(entry.id)
    setEditDate(entry.entry_date)
    setEditWeight(String(entry.weight_kg))
    setEditBodyFat(entry.body_fat_pct === null ? '' : String(entry.body_fat_pct))
    setEditNote(entry.note ?? '')
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDate('')
    setEditWeight('')
    setEditBodyFat('')
    setEditNote('')
  }

  async function updateEntry(entry: BodyweightEntry) {
    if (!userId) return
    const validation = validateValues(editWeight, editBodyFat)
    if (!validation.ok) {
      setMessage(validation.message)
      return
    }
    if (!editDate) {
      setMessage('Choose a date for this weigh-in.')
      return
    }

    setEditBusy(true)
    setMessage('')
    const { error } = await supabase
      .from('bodyweight_entries')
      .update({
        entry_date: editDate,
        weight_kg: validation.kg,
        body_fat_pct: validation.fat,
        note: editNote.trim() || null,
      })
      .eq('id', entry.id)
      .eq('user_id', userId)

    setEditBusy(false)
    if (error) {
      if (error.code === '23505') {
        setMessage('A weigh-in already exists for that date. Edit that row instead, or choose another date.')
      } else {
        setMessage(error.message)
      }
      return
    }

    cancelEdit()
    setMessage('Weigh-in updated.')
    load()
  }

  async function remove(id: string) {
    await supabase.from('bodyweight_entries').delete().eq('id', id)
    if (editingId === id) cancelEdit()
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
        <p>Track scale weight over time. New entries and past weigh-ins can both be corrected whenever needed.</p>
      </header>

      <section className="grid grid-4">
        <StatCard label="Current" value={latest ? formatKg(Number(latest.weight_kg)) : '—'} />
        <StatCard label="7-entry average" value={avg7 === null ? '—' : formatKg(avg7)} />
        <StatCard label="Total change" value={change === null ? '—' : `${change >= 0 ? '+' : ''}${formatKg(change)}`} />
        <StatCard label="Average rate" value={weeklyRate === null ? '—' : `${weeklyRate >= 0 ? '+' : ''}${weeklyRate.toFixed(2)} kg/wk`} />
      </section>

      <section className="two-column-main">
        <form className="card stack" onSubmit={save}>
          <div><h2 className="h2">Log weigh-in</h2><div className="muted">For cleaner trends, weigh under similar conditions.</div></div>
          <label>Date<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Weight (kg)<input required type="number" min="20.01" max="399.99" step="0.01" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="78.4" /></label>
          <label>Body fat % · optional<input type="number" min="1.01" max="69.99" step="0.01" inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="18.5" /></label>
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
        <div className="row-between">
          <h2 className="h2">History</h2>
          <div className="muted" style={{ fontSize: 13 }}>Use Edit to correct date, weight, body fat or notes.</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Weight</th><th>Δ previous</th><th>Body fat</th><th>Note</th><th /></tr></thead>
            <tbody>
              {entries.slice().reverse().map((entry) => {
                const idx = entries.findIndex((e) => e.id === entry.id)
                const prev = idx > 0 ? entries[idx - 1] : null
                const delta = prev ? Number(entry.weight_kg) - Number(prev.weight_kg) : null
                const isEditing = editingId === entry.id

                if (isEditing) {
                  return (
                    <tr key={entry.id} className="bodyweight-edit-row">
                      <td><input aria-label="Edit weigh-in date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></td>
                      <td><input aria-label="Edit weight in kilograms" type="number" min="20.01" max="399.99" step="0.01" inputMode="decimal" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} /></td>
                      <td className="muted">Recalculates after save</td>
                      <td><input aria-label="Edit body fat percentage" type="number" min="1.01" max="69.99" step="0.01" inputMode="decimal" placeholder="Optional" value={editBodyFat} onChange={(e) => setEditBodyFat(e.target.value)} /></td>
                      <td><input aria-label="Edit weigh-in note" maxLength={200} placeholder="Optional" value={editNote} onChange={(e) => setEditNote(e.target.value)} /></td>
                      <td>
                        <div className="row bodyweight-row-actions">
                          <button className="btn btn-primary" type="button" disabled={editBusy} onClick={() => updateEntry(entry)}>{editBusy ? 'Saving…' : 'Save'}</button>
                          <button className="btn" type="button" disabled={editBusy} onClick={cancelEdit}>Cancel</button>
                          <button className="btn btn-danger" type="button" disabled={editBusy} onClick={() => remove(entry.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.entry_date)}</td>
                    <td><strong>{formatKg(Number(entry.weight_kg))}</strong></td>
                    <td>{delta === null ? '—' : `${delta >= 0 ? '+' : ''}${formatKg(delta)}`}</td>
                    <td>{entry.body_fat_pct ? `${Number(entry.body_fat_pct).toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : '—'}</td>
                    <td className="muted">{entry.note || '—'}</td>
                    <td>
                      <div className="row bodyweight-row-actions">
                        <button className="btn" type="button" onClick={() => startEdit(entry)}>Edit</button>
                        <button className="btn btn-danger" type="button" onClick={() => remove(entry.id)}>Delete</button>
                      </div>
                    </td>
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
