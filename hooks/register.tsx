import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cost, GainCheck, Moment } from '../types'
import {
  costLine,
  costOf,
  estimateOf,
  lastUserWords,
  momentsFrom,
  parseAnswer,
  percentPerUsd,
  questionText,
  short,
} from './lib'
import type { RowLabel } from './lib'
import { DEFAULT_PROMPT, DEFAULT_TOOLS } from './prompt'

const PANE = 'gain-check'
const TITLE = 'Gain check'
const AGENT_NAME = 'check'
const AGENT_TYPE = 'gain-check:check'
// A project may give the checker its own instructions and tools in this file.
const PROJECT_AGENT_FILE = '.claude/agents/gain-check.md'
const QUESTION_SOURCE = 'a question Claude asked, with its options'
const CLIP = 1500

// A check costs real usage and takes minutes. Repeats of the same text are refused
// below; this cap only stops a runaway, since the cost shows before every press.
const MAX_RUNNING = 6
const STALE_MS = 15 * 60_000

const moments = atom({ plugin: 'gain-check', key: 'moments' } as const, [], { shape: 'moments-1' })
const asks = atom({ plugin: 'gain-check', key: 'asks' } as const, [], { shape: 'asks-1' })
const checks = atom({ plugin: 'gain-check', key: 'checks' } as const, [], { shape: 'checks-1' })
const viewing = atom({ plugin: 'gain-check', key: 'viewing' } as const, null)
const showTools = atom({ plugin: 'gain-check', key: 'showTools' } as const, false)
const measured = atom({ plugin: 'gain-check', key: 'measured' } as const, [], { shape: 'measured-1' })
const baseline = atom({ plugin: 'gain-check', key: 'baseline' } as const, null)

const isLive = (c: GainCheck, now: number) => c.status === 'running' && now - c.startedAt < STALE_MS

// The live usage reading, as the two numbers the share of the limit is worked from.
const readingOf = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  const five = usage.rateLimits.find(r => r.kind === 'five_hour')
  const usd = usage.cost?.usd

  return five === undefined || usd === undefined ? undefined : { usd, percent: five.percentUsed }
}

// Called from events, never while drawing. A lower reading means the 5-hour window
// reset, so measuring starts again.
const rememberBaseline = async ($: EngineInterface) => {
  const now = await readingOf($)
  if (now === undefined) return
  const base = await read($, baseline)
  if (base === null || now.percent < base.percent) await update($, baseline, () => now)
}

// What one more check is likely to cost, from real runs and the live usage reading.
const estimateNow = async ($: EngineInterface) => {
  const estimate: Cost = estimateOf(await read($, measured))
  const now = await readingOf($)
  const base = await read($, baseline)

  return {
    estimate,
    perUsd: now === undefined || base === null ? undefined : percentPerUsd(base, now),
    percentUsed: now?.percent,
  }
}

const refresh = async ($: EngineInterface) => {
  const rows = await $.session.messages()
  const extra = await read($, asks)
  await update($, moments, () => [...momentsFrom(rows), ...extra].slice(-16))
  await rememberBaseline($)
}

const settle = ($: EngineInterface, id: string, patch: Partial<GainCheck>) =>
  update($, checks, list => list.map(c => (c.id === id ? { ...c, ...patch } : c)))

const openCheck = async ($: EngineInterface, id: string) => {
  await update($, viewing, () => id)
  await $.ui.open({ id: PANE, title: TITLE })
}

type RunOptions = { force?: boolean; quiet?: boolean }

const runCheck = async ($: EngineInterface, subject: string, source: string, opts: RunOptions = {}) => {
  const { force = false, quiet = false } = opts
  const body = subject.trim()
  if (body === '') return false

  const now = await $.clock.now()
  const key = short(body, 100)
  const list = await read($, checks)
  const same = list.filter(c => c.subject === key).at(-1)

  if (same !== undefined && isLive(same, now)) {
    await update($, viewing, () => same.id)
    if (!quiet) $.ui.toast('Already checking this one. The answer will appear in its card.')

    return false
  }

  if (same?.status === 'done' && !force) {
    await openCheck($, same.id)
    if (!quiet) $.ui.toast('Already checked. Showing that answer.')

    return false
  }

  if (list.filter(c => isLive(c, now)).length >= MAX_RUNNING) {
    if (!quiet) $.ui.toast(`${MAX_RUNNING} checks are already running. Try again when one finishes.`)

    return false
  }

  const said = lastUserWords(await $.session.messages())
  const prompt = [
    `The on-screen text to check (${source}):`,
    '',
    body,
    ...(said !== '' && said !== body
      ? ['', `The person's latest message, in their words, only to identify what this refers to: ${said}`]
      : []),
  ].join('\n')
  const id = `c${now}`

  await update($, checks, all =>
    [...all, { id, source, subject: key, body, status: 'running' as const, startedAt: now }].slice(-12),
  )
  await update($, viewing, () => id)
  if (!quiet) $.ui.toast('Gain check started. Usually 1 to 4 minutes.')
  void $.ui.place({ id: `card-${id}` })
  void $.ui.open({ id: PANE, title: TITLE })

  const spawned = await $.agent.spawn({ subagentType: AGENT_TYPE, description: TITLE, prompt })

  if ('deny' in spawned && spawned.deny !== undefined) {
    await settle($, id, { status: 'failed', answer: String(spawned.deny) })
    $.ui.toast('Gain check could not start.')

    return false
  }

  await settle($, id, { agentId: 'agentId' in spawned ? spawned.agentId : undefined })

  return true
}

// Each question gets its own check, all at once, skipping any already running or done.
const runMany = async ($: EngineInterface, questions: readonly unknown[]) => {
  let started = 0

  for (const q of questions) {
    if (await runCheck($, questionText([q]), QUESTION_SOURCE, { quiet: true })) started += 1
  }

  $.ui.toast(started === 0 ? 'Those are already checked or running.' : `Started ${started} gain checks. Usually 1 to 4 minutes.`)
}

const checkSelection = async ($: EngineInterface) => {
  const selected = await $.ui.selection()
  const text = selected?.text.trim() ?? ''

  if (text === '') return false
  await runCheck($, text, 'text the person selected')

  return true
}

// ---- drawing ----

// The surface's element table; each surface's Box, Text and Button take these props.
type Table = { Box: any; Text: any; Button: any }

const LABEL_COLOR: Record<RowLabel, string> = {
  'You get': 'success',
  "You don't get": 'warning',
  'You give up': 'error',
  'You already have': 'suggestion',
}

const statusMark = (c: GainCheck) =>
  c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : '×'

const statusColor = (c: GainCheck) =>
  c.status === 'running' ? 'warning' : c.status === 'done' ? 'claude' : 'error'

// One card: a rounded frame with the same padding everywhere.
const frame = ({ Box }: Table, color: string, children: unknown, dim = false) => (
  <Box flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={dim} paddingX={1}>
    {children}
  </Box>
)

// The whole answer, one card per part.
const drawAnswer = (t: Table, c: GainCheck) => {
  const { Box, Text } = t

  if (c.status === 'running') {
    return frame(
      t,
      'warning',
      <Box flexDirection="column">
        <Text bold color="warning">◐ Checking…</Text>
        <Text>{c.subject}</Text>
        <Text dimColor>Usually 1 to 4 minutes. You can keep working.</Text>
      </Box>,
    )
  }

  if (c.status !== 'done') {
    return frame(
      t,
      'error',
      <Box flexDirection="column">
        <Text bold color="error">× Check {c.status === 'stopped' ? 'stopped' : 'failed'}</Text>
        <Text>{c.subject}</Text>
        {c.status === 'failed' && c.answer !== undefined && <Text dimColor>{c.answer}</Text>}
      </Box>,
    )
  }

  const p = parseAnswer(c.answer ?? '')
  const spent = c.cost === undefined ? null : <Text dimColor>This check used {costLine(c.cost)}</Text>

  if (p.silent !== undefined) {
    return (
      <Box flexDirection="column">
        {frame(
          t,
          'subtle',
          <Box flexDirection="column">
            <Text bold>Nothing to add</Text>
            <Text dimColor>{c.subject}</Text>
            <Text>{p.silent}</Text>
          </Box>,
        )}
        {spent}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {frame(
        t,
        'claude',
        <Box flexDirection="column">
          <Text bold color="claude">{p.decision ?? c.subject}</Text>
          {p.why !== undefined && <Text dimColor>{p.why}</Text>}
          {p.other !== undefined && <Text>{p.other}</Text>}
        </Box>,
      )}
      {p.rows.map(row =>
        frame(
          t,
          LABEL_COLOR[row.label],
          <Box flexDirection="column">
            <Text bold color={LABEL_COLOR[row.label]}>{row.label}</Text>
            <Text>{row.value}</Text>
          </Box>,
        ),
      )}
      {p.suggestion !== undefined &&
        frame(
          t,
          'permission',
          <Box flexDirection="column">
            <Text bold color="permission">Suggestion</Text>
            <Text>{p.suggestion}</Text>
          </Box>,
        )}
      {spent}
    </Box>
  )
}

// One glyph and one colour per kind, so a card reads at a glance.
const glyphOf = (kind: string) => {
  if (kind === 'Question') return { glyph: '?', color: 'warning' }
  if (kind === 'Permission') return { glyph: '!', color: 'error' }
  if (kind === 'You') return { glyph: '›', color: 'suggestion' }
  if (kind === 'Claude') return { glyph: '‹', color: 'claude' }

  return { glyph: '·', color: 'subtle' }
}

const isToolRow = (m: Moment) => !['Question', 'Permission', 'You', 'Claude'].includes(m.kind)

// A project's own instructions and tools, if it has a file for them.
const loadAgent = async ($: EngineInterface) => {
  try {
    const raw = await $.fs.read(`${await $.session.root()}/${PROJECT_AGENT_FILE}`)
    const named = /^tools:\s*(.+)$/m.exec(raw)?.[1]

    return {
      prompt: raw.replace(/^---[\s\S]*?\n---\n/, ''),
      tools: named === undefined ? DEFAULT_TOOLS : named.split(',').map(t => t.trim()).filter(Boolean),
    }
  } catch {
    return { prompt: DEFAULT_PROMPT, tools: DEFAULT_TOOLS }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'gain',
      description: 'Gain check your selection or the text you type; with neither, pick from a list',
    })

    const { prompt, tools } = await loadAgent($)
    await $.agent.register({
      name: AGENT_NAME,
      description: 'A second read on one decision: what you get, what you do not, what you give up, what you already have.',
      prompt,
      tools,
      // It looks up what it needs itself; loading project memory files is most of the cost.
      omitClaudeMd: true,
    })

    // Real costs carry over between sessions, so the estimate stays honest.
    const saved = await $.store.get('measured')
    if (Array.isArray(saved)) await update($, measured, () => saved as Cost[])

    return started
  })

  // Only this mod runs it; it never appears as a choice for Claude.
  on('agent.offer', { agent: AGENT_TYPE }, () => ({ isOffered: false }))

  on('command.run', { command: 'gain' }, async ($, e) => {
    const typed = e.args.trim()

    if (typed !== '') {
      await runCheck($, typed, 'text the person typed')

      return { text: 'Gain check: see the card below.' }
    }

    if (await checkSelection($)) {
      return { text: 'Gain check on your selection: see the card below.' }
    }

    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Nothing selected, so pick something in the Gain check pane.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refresh($)

      return next(e)
    }

    const mine = (await read($, checks)).find(c => c.agentId === e.agentId)

    if (mine !== undefined) {
      if (e.isAborted) {
        await settle($, mine.id, { status: 'stopped' })
      } else {
        const answer = e.answer.trim() !== '' ? e.answer.trim() : `No answer (${e.reason}).`
        const cost = costOf(e.usage)
        await settle($, mine.id, { status: e.reason === 'answer' ? 'done' : 'failed', answer, cost })

        if (cost !== undefined) {
          const list = [...(await read($, measured)), cost].slice(-20)
          await update($, measured, () => list)
          await $.store.set('measured', list)
        }

        $.ui.toast('Gain check ready.')
      }
    }

    return next(e)
  })

  // Permission prompts are drawn by the engine alone and take no button, so they
  // are listed in the pane instead.
  on('classic.PermissionRequest', async ($, e, next) => {
    const now = await $.clock.now()
    const moment: Moment = {
      id: `p${now}`,
      kind: 'Permission',
      text: `Permission prompt for ${e.tool_name}: ${JSON.stringify(e.tool_input ?? {}).slice(0, CLIP)}`,
    }
    await update($, asks, list => [...list, moment].slice(-4))
    await refresh($)

    return next(e)
  })

  // Always on screen, so there is something to click without knowing a command:
  // select any text and press, or press with nothing selected to pick from a list.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const running = (await read($, checks)).filter(c => isLive(c, now)).length
    const { estimate, perUsd } = await estimateNow($)

    return (
      <Box>
        <Button
          key="gain-band"
          label="Gain check"
          onPress={async () => {
            if (!(await checkSelection($))) {
              await refresh($)
              await $.ui.open({ id: PANE, title: TITLE })
            }
          }}
        />
        {running > 0 ? (
          <Text color="warning"> ◐ {running} checking… </Text>
        ) : (
          <Text dimColor> select text first, or click to pick · </Text>
        )}
        <Text dimColor>each {costLine(estimate, perUsd)}</Text>
      </Box>
    )
  })

  // The card in the chat stays short; a click opens the full answer in the pane.
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'gain-check') return next(e)
    const c = (await read($, checks)).find(one => `card-${one.id}` === e.props.id)
    if (c === undefined) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const p = parseAnswer(c.answer ?? '')
    const title = c.status === 'done' && p.decision !== undefined ? p.decision : c.subject
    const note =
      c.status === 'running'
        ? 'Checking… usually 1 to 4 minutes.'
        : p.silent ?? p.suggestion ?? (c.status === 'done' ? 'Answer ready.' : 'This check did not finish.')

    return frame(
      table,
      statusColor(c),
      <Box flexDirection="column">
        <Button key={`open-${c.id}`} plain onPress={() => openCheck($, c.id)}>
          <Text bold color={statusColor(c)}>{statusMark(c)} </Text>
          {title}
        </Button>
        <Text dimColor>{note}</Text>
      </Box>,
    )
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const node = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const questions = e.props.questions
    const all = await read($, checks)
    const { estimate, perUsd } = await estimateNow($)
    const totalUsd = (estimate.usd ?? 0) * questions.length

    return (
      <Box flexDirection="column">
        <Text dimColor>Gain check · each {costLine(estimate, perUsd)}</Text>
        <Box flexWrap="wrap">
          {questions.map((q, i) => {
            const subject = questionText([q])
            const mine = all.filter(c => c.subject === short(subject, 100)).at(-1)
            const header = String((q as { header?: unknown }).header ?? `Question ${i + 1}`)
            const mark = mine?.status === 'running' ? ' ◐' : mine?.status === 'done' ? ' ✓' : ''

            return (
              <Box marginRight={1}>
                <Button
                  key={`gain-q${i}`}
                  label={`${questions.length === 1 ? 'Gain check this question' : header}${mark}`}
                  hotkey={questions.length === 1 ? 'g' : undefined}
                  onPress={() => runCheck($, subject, QUESTION_SOURCE)}
                />
              </Box>
            )
          })}
          {questions.length > 1 && (
            <Button
              key="gain-all"
              label={`All ${questions.length} · $${totalUsd.toFixed(2)}`}
              hotkey="a"
              onPress={() => runMany($, questions)}
            />
          )}
        </Box>
        {node}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const all = await read($, checks)
    const seen = await read($, viewing)
    const current = all.find(c => c.id === seen) ?? all.at(-1)
    const withTools = await read($, showTools)
    const list = (await read($, moments)).filter(m => withTools || !isToolRow(m))
    // Padded to the card's width so a click anywhere on its line lands on the button.
    const inner = Math.max(20, (e.props.bodyColumns ?? 60) - 6)
    const canSelect = e.viewport?.isFullscreen !== false
    const { estimate, perUsd, percentUsed } = await estimateNow($)

    return (
      <Box flexDirection="column">
        <Text dimColor>Each check: {costLine(estimate, perUsd)}</Text>
        {percentUsed !== undefined && <Text dimColor>5-hour limit: {percentUsed}% used so far</Text>}

        {all.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Your checks</Text>
            {[...all].reverse().slice(0, 6).map(c =>
              frame(
                table,
                statusColor(c),
                <Button key={`check-${c.id}`} plain onPress={() => update($, viewing, () => c.id)}>
                  <Text bold={c.id === current?.id} color={statusColor(c)}>{statusMark(c)} </Text>
                  {short(c.subject, inner - 2).padEnd(inner - 2)}
                </Button>,
                c.id !== current?.id,
              ),
            )}
          </Box>
        )}

        {current !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            {drawAnswer(table, current)}
            {current.status !== 'running' && (
              <Button
                key="again"
                label="Check again"
                plain
                dimColor
                onPress={() => runCheck($, current.body, current.source, { force: true })}
              />
            )}
          </Box>
        )}

        <Box marginTop={1} justifyContent="space-between">
          <Text bold>Pick something to check</Text>
          <Button
            key="show-tools"
            label={withTools ? 'Hide tool calls' : 'Show tool calls'}
            plain
            dimColor
            onPress={() => update($, showTools, shown => !shown)}
          />
        </Box>

        {canSelect && (
          <Button
            key="selection"
            label="Check my selection"
            onPress={async () => {
              if (!(await checkSelection($))) {
                $.ui.toast('Nothing selected. Select text with the mouse, then press this.')
              }
            }}
          />
        )}

        {list.length === 0 && <Text dimColor>Nothing yet.</Text>}
        {list
          .slice(-8)
          .reverse()
          .map(moment => {
            const { glyph, color } = glyphOf(moment.kind)

            return frame(
              table,
              color,
              <Button
                key={moment.id}
                plain
                onPress={() => runCheck($, moment.text, `${moment.kind} moment from the session`)}
              >
                <Text color={color}>{glyph} </Text>
                {short(moment.text, inner - 2).padEnd(inner - 2)}
              </Button>,
              true,
            )
          })}
      </Box>
    )
  })
}
