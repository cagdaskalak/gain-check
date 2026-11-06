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
  past?: boolean
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
      reading: { usd?: number; percent?: number; resetsAt?: string } | null
      seen: string | null
      display: { dollars: boolean; share: boolean; tokens: boolean; limit: boolean; hint: boolean } | null
      showSettings: boolean
      closed: string[]
      showPast: boolean
    }
  }
}
