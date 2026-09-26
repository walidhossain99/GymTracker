'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

export function ProgressLineChart({
  data,
  dataKey,
  unit = '',
  empty = 'No data yet.',
}: {
  data: Record<string, string | number>[]
  dataKey: string
  unit?: string
  empty?: string
}) {
  if (!data.length) return <div className="empty">{empty}</div>

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="4 5" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis stroke="var(--muted)" tickLine={false} axisLine={false} domain={['dataMin - 2', 'dataMax + 2']} />
          <Tooltip
            contentStyle={{ background: '#11161e', border: '1px solid #283140', borderRadius: 12 }}
            formatter={(value) => [`${Number(value).toFixed(1)}${unit}`, '']}
          />
          <Line type="monotone" dataKey={dataKey} stroke="#7cf7a5" strokeWidth={3} dot={{ r: 3, fill: '#7cf7a5' }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
