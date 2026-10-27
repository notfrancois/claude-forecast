import { expect, test } from 'claude-code/testing'

import type { Meter } from '../types'
import { addContext, burnRate, coldCost, inputPrice, addSample, bar, cells, compact, duration, fit, fiveRate, hitRatio, isExpensive, learnTtl, limitOutlook, outlook, segments, spark, tint, turnsLeft, until, weekRate, width } from './register'

const MIN = 60_000

test('duration', () => {
  expect(duration(42_000)).toBe('42s')
  expect(duration(5 * MIN)).toBe('5m')
  expect(duration(80 * MIN)).toBe('1h20m')
  expect(duration(76 * 60 * MIN)).toBe('3d4h')
})

test('compact', () => {
  expect(compact(950)).toBe('950')
  expect(compact(12_340)).toBe('12.3k')
  expect(compact(2_500_000)).toBe('2.5M')
})

test('addSample restarts after a reset and skips repeats', () => {
  const s = addSample([{ t: 0, p: 40 }], { t: MIN, p: 40 })
  expect(s.length).toBe(1)
  expect(addSample([{ t: 0, p: 80 }], { t: MIN, p: 3 })).toEqual([{ t: MIN, p: 3 }])
})

test('addSample drops samples older than 30 minutes', () => {
  const s = addSample([{ t: 0, p: 10 }, { t: 20 * MIN, p: 20 }], { t: 40 * MIN, p: 30 })
  expect(s).toEqual([{ t: 20 * MIN, p: 20 }, { t: 40 * MIN, p: 30 }])
})

test('outlook forecasts from the pace', () => {
  // 10 points in 10 minutes from 50 %: 50 points left takes 50 minutes.
  const rate = fiveRate([{ t: 0, p: 40 }, { t: 10 * MIN, p: 50 }])
  expect(outlook(50, rate, 20 * MIN)).toEqual({ eta: 50 * MIN, landing: 70 })
  expect(fiveRate([{ t: 0, p: 40 }, { t: MIN, p: 50 }])).toBe(undefined)
  expect(fiveRate([{ t: 0, p: 40 }])).toBe(undefined)
  expect(outlook(50, undefined, MIN)).toEqual({})
})

test('fiveRate fits every sample, so a burst at the end barely moves it', () => {
  const steady = [0, 5, 10, 15, 20].map(m => ({ t: m * MIN, p: 10 + m }))
  const burst = [...steady.slice(0, -1), { t: 20 * MIN, p: 40 }]
  const endpoints = (40 - 10) / (20 * MIN)
  expect(fiveRate(steady)).toBe(1 / MIN)
  expect(fiveRate(burst)! < endpoints).toBe(true)
})

test('weekRate uses the average since the window opened', () => {
  const WEEK = 7 * 24 * 60 * MIN
  // 2 days into the week at 40 %: 20 points a day, out in 3 more days.
  const rate = weekRate(40, WEEK, 2 * 24 * 60 * MIN)
  expect(outlook(40, rate, 5 * 24 * 60 * MIN).eta).toBe(3 * 24 * 60 * MIN)
  expect(weekRate(1, WEEK, 30 * MIN)).toBe(undefined)
})

test('weekly segment warns before the reset', () => {
  const now = 2 * 24 * 60 * MIN
  const hot = { ...FULL, weekly: 40, weeklyReset: new Date(7 * 24 * 60 * MIN).toISOString() }
  expect(limitOutlook(hot, 'wk', now).landing).toBe(140)
  const wk = segments(hot, now).find(s => s.id === 'wk')!
  expect(wk.full.map(p => p.text).join('').includes('out in 3d0h')).toBe(true)
})

test('addContext restarts after a compact', () => {
  expect(addContext([40, 50, 60], 70)).toEqual([40, 50, 60, 70])
  expect(addContext([40, 50, 60], 12)).toEqual([12])
})

test('learnTtl reads the hit ratio after a gap between 5m and 1h', () => {
  expect(learnTtl(20 * MIN, 95)).toBe('1h')
  expect(learnTtl(20 * MIN, 3)).toBe('5m')
  expect(learnTtl(20 * MIN, 35)).toBe(undefined)
  expect(learnTtl(2 * MIN, 3)).toBe(undefined)
  expect(learnTtl(70 * MIN, 3)).toBe(undefined)
})

test('spark scales to the largest turn', () => {
  expect(spark([0.1, 0.2, 0.4])).toBe('▃▅█')
  expect(spark([0, 0])).toBe('▁▁')
})

test('turnsLeft averages context growth', () => {
  expect(turnsLeft([20, 30, 40], 40)).toBe(6)
  expect(turnsLeft([40], 40)).toBe(undefined)
  expect(turnsLeft([20, 30], undefined)).toBe(undefined)
})

test('hitRatio', () => {
  expect(hitRatio({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toBe(90)
  expect(hitRatio({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(undefined)
})

test('isExpensive needs history and double the average', () => {
  expect(isExpensive(0.5, [0.1, 0.1, 0.1])).toBe(true)
  expect(isExpensive(0.15, [0.1, 0.1, 0.1])).toBe(false)
  expect(isExpensive(5, [0.1])).toBe(false)
})

test('cells show any use, clamp and reach the landing', () => {
  expect(cells(50, undefined, 10)).toEqual({ fill: 5, tail: 0 })
  expect(cells(0, undefined, 10)).toEqual({ fill: 0, tail: 0 })
  expect(cells(3, undefined, 10)).toEqual({ fill: 1, tail: 0 })
  expect(cells(130, undefined, 10)).toEqual({ fill: 10, tail: 0 })
  expect(cells(20, 75, 10)).toEqual({ fill: 2, tail: 6 })
  expect(cells(50, 140, 10)).toEqual({ fill: 5, tail: 5 })
})

test('bar paints one space per cell', () => {
  const b = bar(50, 80)
  expect(b.map(c => c.text).join('')).toBe(' '.repeat(10))
  expect(new Set(b.map(c => c.bg)).size > 3).toBe(true)
})

test('tint runs from accent through amber to red', () => {
  expect(tint(0)).toEqual([217, 119, 87])
  expect(tint(80)).toEqual([229, 165, 10])
  expect(tint(100)).toEqual([229, 72, 77])
})

const BASE: Meter = { busy: false, ctxHistory: [], fiveSamples: [], usdHistory: [] }
const FULL: Meter = {
  ...BASE,
  context: 14,
  fiveHour: 1,
  weekly: 10,
  lastResponseAt: 0,
  hitRatio: 99,
  turnTokens: 22_900,
  turnUsd: 0.38,
  repo: 'claude-forecast',
  branch: 'feat/forecast-meter',
}

const line = (columns: number) => {
  const { left, repo } = fit(segments(FULL, MIN), columns)
  return { ids: left.map(p => p.map(x => x.text).join('')), repo: repo?.map(x => x.text).join('') }
}

test('calm values hide resets, turns left and the cache countdown', () => {
  const texts = segments(FULL, MIN).flatMap(s => s.full.map(p => p.text)).join('')
  expect(texts.includes('→')).toBe(false)
  expect(texts.includes('turns')).toBe(false)
  expect(texts.includes('left')).toBe(false)
})

test('details appear once they matter', () => {
  const hot = { ...FULL, context: 60, ctxHistory: [40, 50, 60], fiveHour: 75, fiveReset: new Date(90 * MIN).toISOString(), lastResponseAt: -56 * MIN }
  const texts = segments(hot, MIN).flatMap(s => s.full.map(p => p.text)).join('')
  expect(texts.includes('~4 turns')).toBe(true)
  expect(texts.includes(`→${until(90 * MIN, MIN)}`)).toBe(true)
  expect(texts.includes('3m left')).toBe(true)
})

test('fit keeps everything on a wide terminal', () => {
  const { ids, repo } = line(200)
  expect(ids.length).toBe(5)
  expect(repo).toBe('⎇ claude-forecast:feat/forecast-meter')
})

test('fit goes lean, then drops by priority, never past the width', () => {
  for (const columns of [120, 90, 70, 50, 30]) {
    const { left, repo } = fit(segments(FULL, MIN), columns)
    const used = left.reduce((n, p) => n + width(p), 0) + 3 * Math.max(0, left.length - 1) + (repo ? 2 + width(repo) : 0)
    expect(used <= columns || left.length === 1).toBe(true)
  }
  expect(line(30).ids).toEqual(['ctx 14%', '5h 1%'])
  expect(line(12).ids).toEqual(['ctx 14%'])
  expect(line(30).repo).toBe(undefined)
})

test('until shows a clock time, with the weekday when it is not today', () => {
  const now = new Date(2026, 9, 27, 9, 0).getTime()
  expect(until(new Date(2026, 9, 27, 14, 30).getTime(), now)).toBe('14:30')
  expect(until(new Date(2026, 9, 31, 9, 5).getTime(), now)).toBe('Sat 09:05')
})

test('cache hit turns yellow under 80 %', () => {
  const low = segments({ ...FULL, hitRatio: 42 }, MIN).find(s => s.id === 'cache')!
  expect(low.full.map(p => p.text).join('')).toBe('cache hit 42%')
  expect(low.full[1]!.color).toBe('yellow')
  const ok = segments(FULL, MIN).find(s => s.id === 'cache')!
  expect(ok.full[1]!.color).toBe(undefined)
})

test('turnsLeft counts to the auto-compact point', () => {
  expect(turnsLeft([40, 50, 60], 60, 80)).toBe(2)
  expect(turnsLeft([40, 50, 90], 90, 80)).toBe(0)
})

test('inputPrice recovers the input rate from a priced step', () => {
  // $3 per million input: 1000 in, 2000 written at 1h (2x), 10000 read (0.1x), 100 out (5x).
  const u = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000 }
  const usd = (1000 + 4000 + 1000 + 500) * 3e-6
  expect(Math.round(inputPrice(usd, u, '1h')! * 1e9)).toBe(3000)
  expect(inputPrice(0, u, '1h')).toBe(undefined)
  expect(coldCost(100_000, 3e-6, '1h').toFixed(2)).toBe('0.57')
})

test('cache shows what a cold turn costs', () => {
  const cold = { ...FULL, ctxTokens: 100_000, inputUsd: 3e-6, lastResponseAt: -2 * 60 * MIN }
  const seg = segments(cold, MIN).find(s => s.id === 'cache')!
  expect(seg.full.map(p => p.text).join('')).toBe('cache hit 99% · cold, next turn +$0.57')
})

test('a spent limit counts down to its reset', () => {
  const spent = { ...FULL, fiveHour: 100, fiveReset: new Date(43 * MIN).toISOString() }
  const seg = segments(spent, MIN).find(s => s.id === '5h')!
  expect(seg.lean.map(p => p.text).join('')).toBe('5h 100% resumes in 42m')
})

test('turn names the agents and what they cost', () => {
  const seg = segments({ ...FULL, agents: 3, agentUsd: 0.2 }, MIN).find(s => s.id === 'turn')!
  expect(seg.full.map(p => p.text).join('').endsWith(' · 3 agents $0.20')).toBe(true)
})

test('session burn rate waits ten minutes', () => {
  expect(burnRate(2, 0, 30 * MIN)).toBe(4)
  expect(burnRate(2, 0, 5 * MIN)).toBe(undefined)
  const seg = segments({ ...FULL, sessionUsd: 2, startedAt: -29 * MIN }, MIN).find(s => s.id === 'session')!
  expect(seg.full.map(p => p.text).join('')).toBe('session $2.00 · $4.00/h')
})
