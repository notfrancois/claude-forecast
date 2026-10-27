export type Sample = { t: number; p: number }

export type Meter = {
  busy: boolean
  context?: number
  ctxTokens?: number
  compactAt?: number
  ctxHistory: number[]
  fiveHour?: number
  fiveReset?: string
  fiveSamples: Sample[]
  weekly?: number
  weeklyReset?: string
  lastResponseAt?: number
  ttl?: '5m' | '1h'
  hitRatio?: number
  turnTokens?: number
  turnUsd?: number
  agents?: number
  agentUsd?: number
  inputUsd?: number
  sessionUsd?: number
  startedAt?: number
  usdHistory: number[]
  repo?: string
  branch?: string
}

declare module 'claude-code' {
  interface PluginState {
    'forecast-meter': { meter: Meter; tick: number }
  }
}
