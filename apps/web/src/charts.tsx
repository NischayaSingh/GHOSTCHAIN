import { CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface Series { key: string, name: string, color: string, dash?: string }

export function Chart({ data, series, x, yUnit = '%', domain = [0, 100], height = 212, live = false }: {
  data: object[], series: Series[], x: string, yUnit?: string, domain?: [number, number | 'auto'], height?: number, live?: boolean,
}) {
  if (!data.length) return <p className="chart-empty" role="status">Waiting for data.</p>
  return <div className="chart" style={{ height }}>
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <LineChart data={data} margin={{ top: 16, right: live ? 92 : 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey={x} axisLine={false} tickLine={false} tickMargin={8} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
        <YAxis unit={yUnit} width={50} domain={domain} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
        <Tooltip cursor={{ stroke: 'var(--line)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6 }}
          itemStyle={{ color: 'var(--text)' }} labelStyle={{ color: 'var(--muted)' }} />
        {live && <ReferenceLine y={75} stroke="var(--muted)" strokeDasharray="4 4"
          label={{ value: '75% reference', position: 'insideBottomLeft', fill: 'var(--muted)', fontSize: 11 }} />}
        {series.map((item, index) => <Line key={item.key} type="linear" dataKey={item.key} name={item.name} stroke={item.color}
          strokeWidth={1.5} strokeDasharray={item.dash} dot={data.length === 1} activeDot={{ r: 3 }} isAnimationActive={false}>
          {live && <LabelList dataKey={item.key} content={props => props.index === data.length - 1 && typeof props.x === 'number' && typeof props.y === 'number'
            ? <text x={props.x + 8} y={props.y + (index ? 12 : -4)} fill={item.color} fontSize={11}>{item.name}</text>
            : null} />}
        </Line>)}
      </LineChart>
    </ResponsiveContainer>
  </div>
}

export function ChartLegend({ series }: { series: Series[] }) {
  return <div className="chart-legend">{series.map(item => <span key={item.key}><i style={{ borderTop: `2px ${item.dash ? 'dashed' : 'solid'} ${item.color}` }} />{item.name}</span>)}</div>
}

export const strategySeries = [
  { key: 'adaptive', name: 'Adaptive', color: 'var(--link)' },
  { key: 'static', name: 'Static 2×', color: 'var(--secondary-series)', dash: '4 3' },
]
export const benchmarkSeries = [...strategySeries, { key: 'static4', name: 'Static 4×', color: 'var(--third-series)', dash: '1 3' }]
