import type { SessionMessage } from 'claude-code'

import type { Cost, Moment } from '../types'

const MAX_MOMENTS = 16
const CLIP = 1500

export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export const short = (s: string, n = 64) => {
  const t = oneLine(s)

  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// A question with its options, minus any "(Recommended)" tag: the tag is the
// asker's opinion, and the check must form its own.
export const questionText = (questions: readonly unknown[]) =>
  questions
    .map(q => {
      const { question, options } = (q ?? {}) as {
        question?: unknown
        options?: unknown
      }
      const rows = Array.isArray(options)
        ? options.map(o => {
            const { label, description } = (o ?? {}) as {
              label?: unknown
              description?: unknown
            }
            const name = String(label ?? '').replace(/\s*\(Recommended\)\s*$/i, '')

            return `- ${name}${description ? `: ${String(description)}` : ''}`
          })
        : []

      return [String(question ?? ''), ...rows].join('\n')
    })
    .join('\n\n')

// Task notifications are user-role rows the person did not write.
const isPersonWords = (text: string) => text !== '' && !text.startsWith('<')

// What can still be decided: the person's latest message and everything after it. An
// answered question is history, so it leaves the list.
export const momentsFrom = (rows: readonly SessionMessage[], answered: readonly string[] = []): Moment[] => {
  const out: Moment[] = []
  let start = Math.max(0, rows.length - 40)

  for (let i = rows.length - 1; i >= start; i -= 1) {
    const row = rows[i]

    if (row?.role === 'user' && isPersonWords(row.text.trim())) {
      start = i
      break
    }
  }

  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i]
    if (row === undefined) continue

    if (isPersonWords(row.text.trim())) {
      out.push({ id: `m${i}`, kind: row.role === 'user' ? 'You' : 'Claude', text: row.text })
    }

    for (const use of row.toolUses ?? []) {
      const isAnswered = use.result !== undefined || use.text !== undefined || answered.includes(use.tool_use_id)
      if (use.tool === 'AskUserQuestion' && isAnswered) continue

      out.push(
        use.tool === 'AskUserQuestion'
          ? {
              id: use.tool_use_id,
              kind: 'Question',
              text: questionText(Array.isArray(use.input.questions) ? use.input.questions : []),
            }
          : {
              id: use.tool_use_id,
              kind: use.tool,
              text: `${use.tool} ${JSON.stringify(use.input).slice(0, CLIP)}`,
            },
      )
    }
  }

  return out.slice(-MAX_MOMENTS)
}

export const lastUserWords = (rows: readonly SessionMessage[]) => {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]

    if (row?.role === 'user' && isPersonWords(row.text.trim())) return row.text.trim()
  }

  return ''
}

// ---- the answer, as its parts ----

export type RowLabel = 'You get' | "You don't get" | 'You give up' | 'You already have'

export type ParsedAnswer = {
  decision?: string
  why?: string
  rows: { label: RowLabel; value: string }[]
  suggestion?: string
  silent?: string
  other?: string
}

const SINGLE: Record<string, 'decision' | 'why' | 'suggestion' | 'silent'> = {
  Decision: 'decision',
  'Why it came up': 'why',
  Suggestion: 'suggestion',
  Silent: 'silent',
}

// A line with no label continues the one above it; text before any label is kept
// as `other`, so nothing the checker wrote is ever lost.
export const parseAnswer = (answer: string): ParsedAnswer => {
  const out: ParsedAnswer = { rows: [] }
  const other: string[] = []
  let append: ((line: string) => void) | undefined

  for (const raw of answer.split('\n')) {
    const line = raw.trim().replace(/^```\w*$/, '')
    if (line === '') continue
    const hit = /^(Decision|Why it came up|You get|You don't get|You give up|You already have|Suggestion|Silent):\s*(.*)$/.exec(line)

    if (hit === null) {
      if (append !== undefined) append(line)
      else other.push(line)
      continue
    }

    const label = hit[1] as string
    const value = hit[2] ?? ''
    const key = SINGLE[label]

    if (key !== undefined) {
      out[key] = value
      append = l => {
        out[key] = `${out[key] ?? ''} ${l}`.trim()
      }
    } else {
      const row = { label: label as RowLabel, value }
      out.rows.push(row)
      append = l => {
        row.value = `${row.value} ${l}`.trim()
      }
    }
  }

  if (other.length > 0) out.other = other.join(' ')

  return out
}

// ---- what a check costs ----

type UsageLike = {
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// Dollars per million tokens: input, output, cache read, cache write (about 1.25x
// input). Anthropic's API list prices as of October 2026; a model missing here
// shows tokens only.
const PRICE: readonly (readonly [RegExp, readonly [number, number, number, number]])[] = [
  [/fable-5/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus-5/, [5, 25, 0.5, 6.25]],
  [/sonnet-5/, [2, 10, 0.2, 2.5]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.125]],
]

export const costOf = (u: UsageLike | undefined): Cost | undefined => {
  if (u === undefined) return undefined
  const counts = [u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens]
  const tokens = counts.reduce((a, b) => a + b, 0)
  const price = PRICE.find(([re]) => re.test(u.model ?? ''))?.[1]
  if (price === undefined) return { tokens }
  const usd = counts.reduce((sum, n, i) => sum + n * (price[i] ?? 0), 0) / 1_000_000

  return { tokens, usd: Math.round(usd * 1000) / 1000 }
}

// A rough starting point until your own runs exist; they replace it from the first
// finished check.
const ROUGH: Cost = { tokens: 700_000, usd: 1.2 }

export const estimateOf = (recent: readonly Cost[]): Cost => {
  const last = recent.slice(-5)
  if (last.length === 0) return ROUGH
  const priced = last.flatMap(c => (c.usd === undefined ? [] : [c.usd]))
  const tokens = last.reduce((sum, c) => sum + c.tokens, 0) / last.length

  return priced.length === 0
    ? { tokens: Math.round(tokens) }
    : { tokens: Math.round(tokens), usd: Math.round((priced.reduce((a, b) => a + b, 0) / priced.length) * 1000) / 1000 }
}

// How much of the 5-hour limit a dollar has used so far in this session. Only
// claimed once enough has moved to mean something; other sessions on the account
// count too, so this reads high rather than low.
export const percentPerUsd = (
  base: { usd: number; percent: number },
  now: { usd: number; percent: number },
) => {
  const usd = now.usd - base.usd
  const percent = now.percent - base.percent

  return usd >= 1 && percent >= 1 ? percent / usd : undefined
}

const tokensLabel = (n: number) =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`

// ---- what shows on screen ----

export type DisplayField = 'dollars' | 'share' | 'tokens' | 'limit' | 'hint'
export type Display = Record<DisplayField, boolean>

export const FIELDS: readonly { key: DisplayField; label: string }[] = [
  { key: 'share', label: 'Share of my limit per check' },
  { key: 'dollars', label: 'Dollar price' },
  { key: 'tokens', label: 'Token count' },
  { key: 'limit', label: 'How much of my limit is used' },
  { key: 'hint', label: 'The hint on the bar' },
]

// The standard setup. On a subscription dollars aren't charged, so the limit is what
// matters; pay-as-you-go has no limit to show, so dollars are what matters.
export const autoDisplay = (isSubscription: boolean): Display => ({
  dollars: !isSubscription,
  share: isSubscription,
  tokens: false,
  limit: isSubscription,
  hint: true,
})

// The cost, showing only what is ticked; empty when nothing ticked can be worked out.
export const costText = (c: Cost, perUsd: number | undefined, show: Display, isEstimate = true) => {
  const parts = [
    ...(show.dollars && c.usd !== undefined ? [`$${c.usd.toFixed(2)}`] : []),
    ...(show.share && c.usd !== undefined && perUsd !== undefined ? [`${(c.usd * perUsd).toFixed(1)}% of limit`] : []),
    ...(show.tokens ? [`${tokensLabel(c.tokens)} tokens`] : []),
  ]
  if (parts.length === 0) return ''

  return `${isEstimate ? '≈ ' : ''}${parts.join(' · ')}`
}

export const meterOf = (percent: number, cells = 10) => {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

export const timeOf = (iso: string | undefined) => {
  if (iso === undefined) return undefined
  const d = new Date(iso)

  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
