import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Meter, Sample } from '../types'

const EMPTY: Meter = { busy: false, ctxHistory: [], fiveSamples: [], usdHistory: [] }
const meter = atom({ plugin: 'forecast-meter', key: 'meter' } as const, EMPTY)
const tick = atom({ plugin: 'forecast-meter', key: 'tick' } as const, 0)

const MIN = 60_000
// Older samples describe a pace the person already left behind.
const RATE_WINDOW = 30 * MIN
const MIN_SPAN = 2 * MIN
const KEEP = 6
const WEEK = 7 * 24 * 60 * MIN
const TTL = { '5m': 5 * MIN, '1h': 60 * MIN } as const
export type Ttl = keyof typeof TTL

export function duration(ms: number): string {
  if (ms < MIN) return `${Math.max(0, Math.round(ms / 1000))}s`
  const m = Math.round(ms / MIN)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${h % 24}h`
}

// A clock time reads faster than a duration the person has to add to now.
export function until(ts: number, now: number): string {
  const d = new Date(ts)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`
}

export function compact(n: number): string {
  return n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`
}

// A drop in percent means the window reset, so the old pace no longer applies.
export function addSample(samples: Sample[], s: Sample): Sample[] {
  const last = samples[samples.length - 1]
  if (last && s.p < last.p) return [s]
  if (last && s.p === last.p) return samples
  return [...samples, s].filter(x => s.t - x.t <= RATE_WINDOW)
}

// Least squares over every sample, so one burst cannot swing the forecast.
export function fiveRate(samples: Sample[]): number | undefined {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last || last.t - first.t < MIN_SPAN) return undefined
  const mean = (f: (s: Sample) => number) => samples.reduce((a, s) => a + f(s), 0) / samples.length
  const mt = mean(s => s.t)
  const mp = mean(s => s.p)
  return mean(s => (s.t - mt) * (s.p - mp)) / mean(s => (s.t - mt) ** 2)
}

// A week of usage has nights and days off; its own average is the steady pace.
export function weekRate(p: number, resetAt: number, now: number): number | undefined {
  const elapsed = now - (resetAt - WEEK)
  return elapsed < 60 * MIN ? undefined : p / elapsed
}

export type Outlook = { eta?: number; landing?: number }

export function outlook(p: number, rate: number | undefined, resetIn: number | undefined): Outlook {
  if (rate === undefined || rate <= 0) return {}
  return { eta: (100 - p) / rate, landing: resetIn === undefined ? undefined : p + rate * resetIn }
}

// A drop means a compact or /clear; growth before it describes another context.
export function addContext(history: number[], p: number): number[] {
  const last = history[history.length - 1]
  return last !== undefined && p < last ? [p] : push(history, p)
}

// After a gap between both lifetimes, a warm cache proves 1h and a cold one 5m.
export function learnTtl(gapMs: number, hit: number | undefined): Ttl | undefined {
  if (hit === undefined || gapMs <= 6 * MIN || gapMs >= 55 * MIN) return undefined
  return hit >= 50 ? '1h' : hit < 20 ? '5m' : undefined
}

export function turnsLeft(history: number[], current?: number): number | undefined {
  if (current === undefined) return undefined
  const deltas = history.slice(1).map((p, i) => p - history[i]!).filter(d => d > 0)
  if (deltas.length === 0) return undefined
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
  return Math.floor((100 - current) / avg)
}

export function hitRatio(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number | undefined {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total === 0 ? undefined : Math.round((u.cache_read_input_tokens / total) * 100)
}

export function isExpensive(usd: number | undefined, history: number[]): boolean {
  if (usd === undefined || history.length < 3) return false
  return usd > (2 * history.reduce((a, b) => a + b, 0)) / history.length
}

const clamp = (p: number) => Math.min(100, Math.max(0, p))
const STOPS: [number, number[]][] = [[0, [217, 119, 87]], [60, [217, 119, 87]], [80, [229, 165, 10]], [100, [229, 72, 77]]]
const TRACK = [68, 70, 79]

const hex = (rgb: number[]) => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const mix = (a: number[], b: number[], k: number) => a.map((c, j) => c + (b[j]! - c) * k)

// Each cell takes the color of the percent it stands for: accent, amber, red.
export function tint(p: number): number[] {
  const x = clamp(p)
  const hi = Math.max(1, STOPS.findIndex(([at]) => at >= x))
  const [a, ca] = STOPS[hi - 1]!
  const [b, cb] = STOPS[hi]!
  return mix(ca, cb, (x - a) / (b - a))
}

// Any use shows one cell; the tail reaches where the pace lands at reset.
export function cells(p: number, landing: number | undefined, width: number): { fill: number; tail: number } {
  const fill = p > 0 ? Math.max(1, Math.round((clamp(p) / 100) * width)) : 0
  const end = landing === undefined ? fill : Math.max(fill, Math.round((clamp(landing) / 100) * width))
  return { fill, tail: end - fill }
}

// Painted spaces fill the cell exactly in any font; block glyphs do not.
export function bar(p: number, landing?: number, width = 10): Part[] {
  const { fill, tail } = cells(p, landing, width)
  return Array.from({ length: width }, (_, i) => {
    const heat = tint(((i + 0.5) / width) * 100)
    return { text: ' ', bg: hex(i < fill ? heat : i < fill + tail ? mix(heat, TRACK, 0.55) : TRACK) }
  })
}

export function spark(xs: number[]): string {
  const max = Math.max(...xs)
  return xs.map(x => '▁▂▃▄▅▆▇█'[max > 0 ? Math.round((x / max) * 7) : 0]).join('')
}

function pick(limits: SessionRateLimit[], kind: string) {
  return limits.find(l => l.kind === kind)
}

function pct(p: number) {
  return `${Math.round(p)}%`
}

const ACCENT = '#D97757'
const SEP = ' │ '
const REPO_GAP = 2

// Color only flags what needs attention; a calm value stays neutral.
function heat(p: number) {
  return p >= 90 ? 'red' : p >= 70 ? 'yellow' : undefined
}

export type Part = { text: string; color?: string; bg?: string; dim?: boolean; bold?: boolean }
// Higher priority drops first; full gives way to lean before anything is hidden.
export type Segment = { id: string; priority: number; full: Part[]; lean: Part[] }

function gauge(label: string, p: number, landing?: number): { full: Part[]; lean: Part[] } {
  const value: Part = { text: pct(p), color: heat(p), bold: heat(p) === 'red' }
  const head: Part = { text: `${label} `, dim: true }
  return {
    full: [head, ...bar(p, landing), { text: ' ' }, value],
    lean: [head, value],
  }
}

export function limitOutlook(m: Meter, id: '5h' | 'wk', now: number): Outlook & { p?: number; resetIn?: number } {
  const p = id === '5h' ? m.fiveHour : m.weekly
  const reset = id === '5h' ? m.fiveReset : m.weeklyReset
  if (p === undefined) return {}
  const resetAt = reset ? Date.parse(reset) : undefined
  const resetIn = resetAt === undefined ? undefined : resetAt - now
  const rate = id === '5h' ? fiveRate(m.fiveSamples) : resetAt === undefined ? undefined : weekRate(p, resetAt, now)
  return { p, resetIn, ...outlook(p, rate, resetIn) }
}

export function runsOut(o: Outlook & { resetIn?: number }): boolean {
  return o.eta !== undefined && o.resetIn !== undefined && o.eta < o.resetIn
}

function limit(id: '5h' | 'wk', priority: number, m: Meter, now: number): Segment | undefined {
  const o = limitOutlook(m, id, now)
  if (o.p === undefined) return undefined
  const g = gauge(id, o.p, o.landing)
  const out = runsOut(o)
  const risk: Part[] = out ? [{ text: ` out in ${duration(o.eta!)}`, color: 'red', bold: true }] : []
  const reset: Part[] = o.resetIn !== undefined && (out || o.p >= 70) ? [{ text: ` →${until(now + o.resetIn, now)}`, dim: true }] : []
  return { id, priority, full: [...g.full, ...risk, ...reset], lean: [...g.lean, ...risk] }
}

export function segments(m: Meter, now: number): Segment[] {
  const out: Segment[] = []
  if (m.context !== undefined) {
    const g = gauge('ctx', m.context)
    const turns = turnsLeft(m.ctxHistory, m.context)
    const more: Part[] = m.context >= 50 && turns !== undefined ? [{ text: ` ~${turns} turns`, dim: true }] : []
    out.push({ id: 'ctx', priority: 0, full: [...g.full, ...more], lean: [...g.lean, ...more] })
  }
  for (const s of [limit('5h', 2, m, now), limit('wk', 4, m, now)]) if (s) out.push(s)
  if (m.lastResponseAt !== undefined) {
    const left = TTL[m.ttl ?? '1h'] - (now - m.lastResponseAt)
    // Under 80 % the turn re-paid most of its context: worth a glance.
    const head: Part[] = [{ text: 'cache hit ', dim: true }, ...(m.hitRatio !== undefined ? [{ text: `${m.hitRatio}%`, color: m.hitRatio < 80 ? 'yellow' : undefined }] : [])]
    const state: Part[] = m.busy ? [] : left <= 0 ? [{ text: ' · ', dim: true }, { text: 'cold', color: 'yellow' }] : left <= 5 * MIN ? [{ text: ' · ', dim: true }, { text: `${duration(left)} left`, color: left <= MIN ? 'red' : 'yellow' }] : []
    out.push({ id: 'cache', priority: 3, full: [...head, ...state], lean: [...head, ...state] })
  }
  if (m.turnTokens !== undefined) {
    const pricey = isExpensive(m.turnUsd, m.usdHistory.slice(0, -1))
    const color = pricey ? 'yellow' : undefined
    const usd: Part[] = m.turnUsd !== undefined ? [{ text: `$${m.turnUsd.toFixed(2)}`, color }] : [{ text: compact(m.turnTokens), color }]
    const flag: Part[] = pricey ? [{ text: ' ▲', color }] : []
    const trend: Part[] = m.usdHistory.length >= 3 ? [{ text: `${spark(m.usdHistory)} `, color: ACCENT, dim: true }] : []
    out.push({
      id: 'turn',
      priority: 5,
      full: [{ text: 'turn ', dim: true }, ...trend, { text: compact(m.turnTokens), color }, ...(m.turnUsd !== undefined ? [{ text: ' · ', dim: true }, usd[0]!] : []), ...flag],
      lean: [{ text: 'turn ', dim: true }, ...usd, ...flag],
    })
  }
  if (m.repo) {
    const head: Part[] = [{ text: '⎇ ', color: ACCENT }, { text: m.repo }]
    out.push({ id: 'repo', priority: 6, full: [...head, ...(m.branch ? [{ text: `:${m.branch}`, dim: true }] : [])], lean: head })
  }
  return out
}

export function width(parts: Part[]): number {
  return parts.reduce((n, p) => n + [...p.text].length, 0)
}

export function fit(segs: Segment[], columns: number): { left: Part[][]; repo?: Part[] } {
  const mode = new Map(segs.map(s => [s.id, s.full]))
  const kept = new Set(segs.map(s => s.id))
  const total = () => {
    const live = segs.filter(s => kept.has(s.id))
    const left = live.filter(s => s.id !== 'repo')
    const repo = live.find(s => s.id === 'repo')
    return left.reduce((n, s) => n + width(mode.get(s.id)!), 0) + SEP.length * Math.max(0, left.length - 1) + (repo ? REPO_GAP + width(mode.get('repo')!) : 0)
  }
  const order = [...segs].sort((a, b) => b.priority - a.priority)
  for (const s of order) if (total() > columns) mode.set(s.id, s.lean)
  for (const s of order) if (total() > columns && s.priority > 0) kept.delete(s.id)
  const live = segs.filter(s => kept.has(s.id))
  const repo = live.find(s => s.id === 'repo')
  return { left: live.filter(s => s.id !== 'repo').map(s => mode.get(s.id)!), repo: repo && mode.get('repo') }
}

function push<T>(list: T[], x: T): T[] {
  return [...list, x].slice(-KEEP)
}

async function refreshRepo($: Pick<CoreEngineInterface, 'process' | 'state'>, cwd?: string) {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return
  const [top = '', branch] = r.stdout.trim().split('\n')
  await update($, meter, m => ({ ...m, repo: top.split('/').pop(), branch }))
}

const LIMIT_NAME = { '5h': '5h', wk: 'weekly' } as const

export const register: Register = on => {
  let costAtStart: number | undefined
  let warnedCacheFor: number | undefined
  const warnedFor: Partial<Record<'5h' | 'wk', string>> = {}
  let gapAtStart: number | undefined

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    // A reload re-runs session.start; keep the repo the last edit pointed to.
    if (!(await read($, meter)).repo) await refreshRepo($)
    const stored = await $.store.get('ttl')
    const ttl: Ttl | undefined = stored === '5m' || stored === '1h' ? stored : undefined
    if (ttl) await update($, meter, m => ({ ...m, ttl }))
    $.clock.every(1000, async () => {
      await update($, tick, t => t + 1)
      const m = await read($, meter)
      if (m.busy || m.lastResponseAt === undefined || warnedCacheFor === m.lastResponseAt) return
      const left = TTL[m.ttl ?? '1h'] - ((await $.clock.now()) - m.lastResponseAt)
      if (left > 0 && left <= MIN) {
        warnedCacheFor = m.lastResponseAt
        $.ui.toast(`Prompt cache expires in ${duration(left)}: reply now or the next turn re-writes it`)
      }
    })
    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      costAtStart = (await $.session.usage()).cost?.usd
      const m = await update($, meter, m => ({ ...m, busy: true }))
      gapAtStart = m.lastResponseAt === undefined ? undefined : (await $.clock.now()) - m.lastResponseAt
    }
    return next(e)
  })

  // Every main-loop response refreshes the cache entry the TTL counts from.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined && r.usage) {
      const lastResponseAt = await $.clock.now()
      const learned = gapAtStart === undefined ? undefined : learnTtl(gapAtStart, hitRatio(r.usage))
      gapAtStart = undefined
      const before = (await read($, meter)).ttl ?? '1h'
      await update($, meter, m => ({ ...m, lastResponseAt, ttl: learned ?? m.ttl }))
      if (learned && learned !== before) {
        await $.store.set('ttl', learned)
        $.ui.toast(`Prompt cache lives ${learned} on this account: countdown adjusted`)
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ((e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') && !ran.isError) {
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      await refreshRepo($, path.slice(0, path.lastIndexOf('/')) || '/')
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const u = e.usage
      const usd = (await $.session.usage()).cost?.usd
      const turnUsd = usd !== undefined && costAtStart !== undefined ? usd - costAtStart : undefined
      await update($, meter, m => ({
        ...m,
        busy: false,
        turnTokens: u ? u.input_tokens + u.output_tokens + u.cache_creation_input_tokens : undefined,
        hitRatio: u ? hitRatio(u) : m.hitRatio,
        turnUsd,
        usdHistory: turnUsd === undefined ? m.usdHistory : push(m.usdHistory, turnUsd),
      }))
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const five = pick(e.rateLimits, 'five_hour')
    const week = pick(e.rateLimits, 'seven_day')
    const m = await update($, meter, m => ({
      ...m,
      context: e.context.percent,
      ctxHistory: e.context.percent === undefined ? m.ctxHistory : addContext(m.ctxHistory, e.context.percent),
      fiveHour: five?.percentUsed,
      fiveReset: five?.resetsAt,
      fiveSamples: five ? addSample(m.fiveSamples, { t: now, p: five.percentUsed }) : m.fiveSamples,
      weekly: week?.percentUsed,
      weeklyReset: week?.resetsAt,
    }))
    for (const id of ['5h', 'wk'] as const) {
      const o = limitOutlook(m, id, now)
      const reset = id === '5h' ? m.fiveReset : m.weeklyReset
      if (!runsOut(o) || warnedFor[id] === reset) continue
      warnedFor[id] = reset
      $.ui.toast(`At this pace the ${LIMIT_NAME[id]} limit runs out in ~${duration(o.eta!)}, ${duration(o.resetIn! - o.eta!)} before it resets`)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const m = await read($, meter)
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 120
    const { left, repo } = fit(segments(m, await $.clock.now()), columns)
    const draw = (parts: Part[]) => parts.map(p => <Text color={p.color} backgroundColor={p.bg} dimColor={p.dim} bold={p.bold}>{p.text}</Text>)

    return (
      <Box justifyContent="space-between" width={columns}>
        <Text wrap="truncate-end">
          {left.map((parts, i) => (
            <Text>
              {i > 0 && <Text dimColor>{SEP}</Text>}
              {draw(parts)}
            </Text>
          ))}
        </Text>
        {repo && <Text wrap="truncate-end">{draw(repo)}</Text>}
      </Box>
    )
  })
}
