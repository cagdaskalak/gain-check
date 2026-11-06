export type Moment = { id: string; kind: string; text: string }

export type Cost = { tokens: number; usd?: number }

export type GainCheck = {
  id: string
  source: string
  subject: string
  body: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  answer?: string
  agentId?: string
  cost?: Cost
}

declare module 'claude-code' {
  interface PluginState {
    'gain-check': {
      moments: Shaped<Moment[]>
      asks: Shaped<Moment[]>
      checks: Shaped<GainCheck[]>
      viewing: string | null
      showTools: boolean
      measured: Shaped<Cost[]>
      baseline: { usd: number; percent: number } | null
      autoStop: boolean
    }
  }
}
