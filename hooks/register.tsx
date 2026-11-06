import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cost, GainCheck, Moment } from '../types'
import {
  autoDisplay,
  costOf,
  costText,
  estimateOf,
  FIELDS,
  lastUserWords,
  meterOf,
  momentsFrom,
  parseAnswer,
  percentPerUsd,
  questionText,
  short,
  timeOf,
} from './lib'
import type { Display, DisplayField, RowLabel } from './lib'
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
const autoStop = atom({ plugin: 'gain-check', key: 'autoStop' } as const, true)
// The latest usage figures. The engine pushes them, so what is drawn stays current.
const reading = atom({ plugin: 'gain-check', key: 'reading' } as const, null)
// This project's own tick boxes; null means the standard setup for the account.
const display = atom({ plugin: 'gain-check', key: 'display' } as const, null)
const showSettings = atom({ plugin: 'gain-check', key: 'showSettings' } as const, false)
// Questions already answered, for the moment before the transcript shows their answer.
const closed = atom({ plugin: 'gain-check', key: 'closed' } as const, [])
const showPast = atom({ plugin: 'gain-check', key: 'showPast' } as const, false)
// The newest answer the person has opened; anything newer shows as ready.
const seen = atom({ plugin: 'gain-check', key: 'seen' } as const, null)

const isLive = (c: GainCheck, now: number) => c.status === 'running' && now - c.startedAt < STALE_MS

// Stores the latest usage figures; every drawing that reads them redraws by itself.
// A lower limit reading means the 5-hour window reset, so measuring starts again.
const applyUsage = async (
  $: EngineInterface,
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
  cost: { usd: number } | undefined,
) => {
  const five = rateLimits.find(r => r.kind === 'five_hour')
  await update($, reading, () => ({
    ...(cost === undefined ? {} : { usd: cost.usd }),
    ...(five === undefined ? {} : { percent: five.percentUsed }),
    ...(five?.resetsAt === undefined ? {} : { resetsAt: five.resetsAt }),
  }))

  if (five === undefined || cost === undefined) return
  const now = { usd: cost.usd, percent: five.percentUsed }
  const base = await read($, baseline)
  if (base === null || now.percent < base.percent) await update($, baseline, () => now)
}

const syncUsage = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  await applyUsage($, usage.rateLimits, usage.cost)
}

// What one more check is likely to cost, from real runs and the stored usage figures.
const estimateNow = async ($: EngineInterface) => {
  const estimate: Cost = estimateOf(await read($, measured))
  const now = await read($, reading)
  const base = await read($, baseline)

  return {
    estimate,
    perUsd:
      now?.usd === undefined || now.percent === undefined || base === null
        ? undefined
        : percentPerUsd(base, { usd: now.usd, percent: now.percent }),
    percentUsed: now?.percent,
    resetsAt: timeOf(now?.resetsAt),
  }
}

// Limit figures only exist on a subscription, so they tell the two kinds of account apart.
const displayNow = async ($: EngineInterface): Promise<Display & { isCustom: boolean; isSubscription: boolean }> => {
  const isSubscription = (await read($, reading))?.percent !== undefined
  const custom = await read($, display)

  return { ...autoDisplay(isSubscription), ...custom, isCustom: custom !== null, isSubscription }
}

const displayKey = async ($: EngineInterface) => `display:${await $.session.root()}`

const toggleField = async ($: EngineInterface, field: DisplayField) => {
  const { dollars, share, tokens, limit, hint } = await displayNow($)
  const current: Display = { dollars, share, tokens, limit, hint }
  const next = { ...current, [field]: !current[field] }
  await update($, display, () => next)
  await $.store.set(await displayKey($), next)
}

const resetDisplay = async ($: EngineInterface) => {
  await update($, display, () => null)
  await $.store.delete(await displayKey($))
}

const openSettings = async ($: EngineInterface) => {
  await update($, showSettings, () => true)
  await $.ui.open({ id: PANE, title: TITLE })
}

const refresh = async ($: EngineInterface) => {
  const rows = await $.session.messages()
  const extra = await read($, asks)
  const answered = await read($, closed)
  await update($, moments, () => [...momentsFrom(rows, answered), ...extra].slice(-16))
  await syncUsage($)
}

const settle = ($: EngineInterface, id: string, patch: Partial<GainCheck>) =>
  update($, checks, list => list.map(c => (c.id === id ? { ...c, ...patch } : c)))

// Asks the engine to stop the check's agent. Stopping saves what isn't spent yet;
// the check can always be run again.
const stopCheck = async ($: EngineInterface, c: GainCheck) => {
  if (c.agentId === undefined) {
    $.ui.toast('That check is still starting. Try again in a moment.')

    return false
  }

  const stopped = await $.tool.call({ tool: 'TaskStop', task_id: c.agentId })

  if ('deny' in stopped && stopped.deny !== undefined) {
    $.ui.toast(`Could not stop that check: ${stopped.deny}`)

    return false
  }

  await settle($, c.id, { status: 'stopped' })

  return true
}

const stopMany = async ($: EngineInterface, list: readonly GainCheck[]) => {
  let stopped = 0
  for (const c of list) if (await stopCheck($, c)) stopped += 1

  return stopped
}

const plural = (n: number) => `${n} gain check${n === 1 ? '' : 's'}`

// The question closed, so a check still running on it no longer helps the decision.
const subjectsOf = (questions: readonly unknown[]) =>
  new Set([short(questionText(questions), 100), ...questions.map(q => short(questionText([q]), 100))])

const stopForQuestions = async ($: EngineInterface, questions: readonly unknown[]) => {
  const subjects = subjectsOf(questions)
  const now = await $.clock.now()
  const live = (await read($, checks)).filter(c => isLive(c, now) && subjects.has(c.subject))
  const stopped = await stopMany($, live)

  if (stopped > 0) $.ui.toast(`Stopped ${plural(stopped)}, since you answered the question.`)
}

// The decision is made, so its question and finished checks are history: out of view,
// not deleted, because those answers were paid for.
const closeQuestion = async ($: EngineInterface, id: string, questions: readonly unknown[]) => {
  if (await read($, autoStop)) await stopForQuestions($, questions)
  const subjects = subjectsOf(questions)
  await update($, checks, list =>
    list.map(c => (subjects.has(c.subject) && c.status !== 'running' ? { ...c, past: true } : c)),
  )
  await update($, closed, list => [...list, id].slice(-50))
  await refresh($)
}

// The person moved on, so whatever had finished is history. A running check stays.
const retireFinished = async ($: EngineInterface) => {
  await update($, checks, list => list.map(c => (c.status === 'running' ? c : { ...c, past: true })))
}

const toggleAutoStop = async ($: EngineInterface) => {
  const next = !(await read($, autoStop))
  await update($, autoStop, () => next)
  await $.store.set('autoStop', next)
  $.ui.toast(next ? 'Auto-stop is on.' : 'Auto-stop is off. Checks keep running after you answer.')
}

const openCheck = async ($: EngineInterface, id: string) => {
  await update($, viewing, () => id)
  await update($, seen, () => id)
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

  if (same?.status === 'done' && same.past !== true && !force) {
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

const LABEL_ICON: Record<RowLabel, string> = {
  'You get': '+',
  "You don't get": '○',
  'You give up': '−',
  'You already have': '✓',
}

const LABEL_COLOR: Record<RowLabel, string> = {
  'You get': 'success',
  "You don't get": 'warning',
  'You give up': 'error',
  'You already have': 'suggestion',
}

const statusMark = (c: GainCheck) =>
  c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'stopped' ? '■' : '×'

const statusColor = (c: GainCheck) =>
  c.status === 'running' ? 'success' : c.status === 'done' ? 'claude' : c.status === 'stopped' ? 'subtle' : 'error'

// A tick box, wide enough to see and hit. A terminal can't draw one character larger.
const box = (isOn: boolean) => (isOn ? '[✓]' : '[ ]')

// The on/off switch: one click flips it, and it stays as you left it.
const drawSwitch = ({ Button, Text }: Table, $: EngineInterface, isOn: boolean) => (
  <Button key="auto-stop" plain onPress={() => toggleAutoStop($)}>
    <Text bold color={isOn ? 'success' : 'subtle'}>{box(isOn)}  </Text>
    Stop checks when I answer
  </Button>
)

// One card: a rounded frame with the same padding everywhere.
const frame = ({ Box }: Table, color: string, children: unknown, dim = false) => (
  <Box flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={dim} paddingX={1}>
    {children}
  </Box>
)

// The tick boxes: wide framed rows, one click flips one, saved for this project.
const drawSettings = (
  t: Table,
  $: EngineInterface,
  shown: Awaited<ReturnType<typeof displayNow>>,
  inner: number,
) => {
  const { Box, Button, Text } = t

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Show on screen</Text>
      {FIELDS.map(f =>
        frame(
          t,
          shown[f.key] ? 'success' : 'subtle',
          <Button key={`tick-${f.key}`} plain onPress={() => toggleField($, f.key)}>
            <Text bold color={shown[f.key] ? 'success' : 'subtle'}>{box(shown[f.key])}  </Text>
            {f.label.padEnd(Math.max(10, inner - 5))}
          </Button>,
          !shown[f.key],
        ),
      )}
      <Text dimColor>
        {shown.isCustom
          ? 'Your choice, saved for this project.'
          : `Set automatically for ${shown.isSubscription ? 'a subscription' : 'pay-as-you-go'}.`}
      </Text>
      {shown.isCustom && (
        <Button key="tick-reset" label="Back to automatic" plain dimColor onPress={() => resetDisplay($)} />
      )}
    </Box>
  )
}

// The whole answer, one card per part.
const drawAnswer = (t: Table, c: GainCheck, spentText: string) => {
  const { Box, Text } = t

  if (c.status === 'running') {
    return frame(
      t,
      'success',
      <Box flexDirection="column">
        <Text bold color="success">◐ Checking…</Text>
        <Text>{c.subject}</Text>
        <Text dimColor>This usually takes 1 to 4 minutes. You can keep working.</Text>
      </Box>,
    )
  }

  if (c.status === 'stopped') {
    return frame(
      t,
      'subtle',
      <Box flexDirection="column">
        <Text bold>■ Stopped</Text>
        <Text dimColor>{c.subject}</Text>
      </Box>,
    )
  }

  if (c.status !== 'done') {
    return frame(
      t,
      'error',
      <Box flexDirection="column">
        <Text bold color="error">× Check failed</Text>
        <Text>{c.subject}</Text>
        {c.answer !== undefined && <Text dimColor>{c.answer}</Text>}
      </Box>,
    )
  }

  const p = parseAnswer(c.answer ?? '')
  const spent = spentText === '' ? null : <Text dimColor>This check used {spentText}</Text>

  if (p.silent !== undefined) {
    return (
      <Box flexDirection="column">
        {frame(
          t,
          'subtle',
          <Box flexDirection="column">
            <Text bold>– Nothing to add</Text>
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
            <Box>
              <Text color={LABEL_COLOR[row.label]}>{LABEL_ICON[row.label]} </Text>
              <Text bold color={LABEL_COLOR[row.label]}>{row.label}</Text>
            </Box>
            <Text>{row.value}</Text>
          </Box>,
        ),
      )}
      {p.suggestion !== undefined &&
        frame(
          t,
          'permission',
          <Box flexDirection="column">
            <Box>
              <Text color="permission">→ </Text>
              <Text bold color="permission">Suggestion</Text>
            </Box>
            <Text>{p.suggestion}</Text>
          </Box>,
        )}
      {spent}
    </Box>
  )
}

// One colour per kind, so a card reads at a glance.
const colorOf = (kind: string) => {
  if (kind === 'Question') return 'warning'
  if (kind === 'Permission') return 'error'
  if (kind === 'You') return 'suggestion'
  if (kind === 'Claude') return 'claude'

  return 'subtle'
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
    const savedSwitch = await $.store.get('autoStop')
    if (typeof savedSwitch === 'boolean') await update($, autoStop, () => savedSwitch)
    await syncUsage($)
    const savedDisplay = await $.store.get(await displayKey($))
    if (savedDisplay !== undefined && savedDisplay !== null) await update($, display, () => savedDisplay as Display)

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

  // The engine pushes usage after each turn and whenever a limit moves a whole point.
  on('session.measure', async ($, e, next) => {
    await applyUsage($, e.rateLimits, e.cost)

    return next(e)
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

        await syncUsage($)
        $.ui.toast('Gain check ready.')
      }
    }

    return next(e)
  })

  // When a question closes, however it closed, checks still running on it stop if the
  // switch is on. A check that fails to stop must never get in the way of the answer.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId === undefined) await refresh($)
    const result = await next(e)

    if (e.agentId === undefined) {
      try {
        await closeQuestion($, e.tool_use_id, e.questions)
      } catch (error) {
        $.ui.log(`gain-check: could not close the question: ${String(error)}`, { to: 'debug' })
      }
    }

    return result
  })

  // A permission prompt is over once its tool call is over.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined && (await read($, asks)).length > 0) {
      await update($, asks, () => [])
      await refresh($)
    }

    return result
  })

  // A message from the person means they moved on, typed here or sent from their phone.
  // A slash command doesn't, and neither does a background notification waking the session.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isPerson && e.command === undefined) await retireFinished($)

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
    const all = await read($, checks)
    const live = all.filter(c => isLive(c, now))
    const latestDone = all.filter(c => c.status === 'done' && c.past !== true).at(-1)
    const isReady = latestDone !== undefined && latestDone.id !== (await read($, seen))
    const { estimate, perUsd, percentUsed } = await estimateNow($)
    const shown = await displayNow($)
    const costed = costText(estimate, perUsd, shown)
    // The button says where things stand: green, a check is working; yellow, an answer
    // is waiting for you; no colour, nothing is going on.
    const tone = live.length > 0 ? 'success' : isReady ? 'warning' : undefined
    // A terminal's own button would keep its brackets white, so it draws them itself.
    const face = e.surface === 'terminal' ? '[ ✦ Gain check ]' : '✦ Gain check'

    return (
      <Box>
        <Button
          key="gain-band"
          plain
          onPress={async () => {
            if (!(await checkSelection($))) {
              await refresh($)
              await $.ui.open({ id: PANE, title: TITLE })
            }
          }}
        >
          <Text bold color={tone}>{face}</Text>
        </Button>
        {live.length > 0 && <Text color={tone}> ◐ Checking{live.length > 1 ? ` ${live.length}` : ''}… </Text>}
        {live.length > 0 && (
          <Button
            key="gain-stop-all"
            label={live.length > 1 ? 'Stop all' : 'Stop'}
            dimColor
            onPress={async () => {
              const stopped = await stopMany($, live)
              if (stopped > 0) $.ui.toast(`Stopped ${plural(stopped)}.`)
            }}
          />
        )}
        {live.length === 0 && isReady && <Text color={tone}> ✓ Answer ready </Text>}
        {live.length === 0 && isReady && (
          <Button key="gain-open" label="Open" onPress={() => openCheck($, latestDone.id)} />
        )}
        {live.length === 0 && !isReady && shown.hint && <Text dimColor> Select text, then click</Text>}
        {costed !== '' && <Text dimColor>  ·  {costed}</Text>}
        {shown.limit && percentUsed !== undefined && <Text dimColor>  ·  {percentUsed}% used</Text>}
        <Text>  </Text>
        <Button key="gain-settings" label="⚙ Settings" dimColor onPress={() => openSettings($)} />
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

    // History: one quiet line, still a click away from its full answer.
    if (c.past === true) {
      return (
        <Button
          key={`open-${c.id}`}
          plain
          dimColor
          onPress={async () => {
            await update($, showPast, () => true)
            await openCheck($, c.id)
          }}
        >
          {statusMark(c)} {title}
        </Button>
      )
    }

    const note =
      c.status === 'running'
        ? 'Checking… usually 1 to 4 minutes.'
        : c.status === 'stopped'
          ? 'Stopped.'
          : p.silent ?? p.suggestion ?? (c.status === 'done' ? 'Your answer is ready.' : 'This check did not finish.')

    return frame(
      table,
      statusColor(c),
      <Box flexDirection="column">
        <Button key={`open-${c.id}`} plain onPress={() => openCheck($, c.id)}>
          <Text bold color={statusColor(c)}>{statusMark(c)} </Text>
          {title}
        </Button>
        <Text dimColor>{note}</Text>
        {c.status === 'done' && <Text dimColor>Click the title to see the full answer.</Text>}
        {c.status === 'running' && (
          <Button
            key={`stop-${c.id}`}
            label="Stop"
            onPress={async () => {
              if (await stopCheck($, c)) $.ui.toast('Stopped.')
            }}
          />
        )}
      </Box>,
    )
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const node = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const questions = e.props.questions
    const all = await read($, checks)
    const { estimate, perUsd } = await estimateNow($)
    const shown = await displayNow($)
    const costed = costText(estimate, perUsd, shown)
    const totalCost = costText(
      { tokens: estimate.tokens * questions.length, ...(estimate.usd === undefined ? {} : { usd: estimate.usd * questions.length }) },
      perUsd,
      shown,
    )
    const isAutoStop = await read($, autoStop)

    return (
      <Box flexDirection="column">
        <Text dimColor>✦ Gain check{costed === '' ? '' : ` · ${costed} each`}</Text>
        <Box flexWrap="wrap">
          {questions.map((q, i) => {
            const subject = questionText([q])
            const mine = all.filter(c => c.subject === short(subject, 100) && c.past !== true).at(-1)
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
              label={`All ${questions.length}${totalCost === '' ? '' : ` · ${totalCost}`}`}
              hotkey="a"
              onPress={() => runMany($, questions)}
            />
          )}
        </Box>
        {drawSwitch($.ui.resolve(e), $, isAutoStop)}
        {node}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const all = await read($, checks)
    const viewedId = await read($, viewing)
    const isPastOpen = await read($, showPast)
    const active = all.filter(c => c.past !== true)
    const pastCount = all.length - active.length
    const visible = isPastOpen ? all : active
    const current = visible.find(c => c.id === viewedId) ?? active.at(-1) ?? (isPastOpen ? all.at(-1) : undefined)
    const withTools = await read($, showTools)
    const list = (await read($, moments)).filter(m => withTools || !isToolRow(m))
    // Padded to the card's width so a click anywhere on its line lands on the button.
    const inner = Math.max(20, (e.props.bodyColumns ?? 60) - 6)
    const canSelect = e.viewport?.isFullscreen !== false
    const { estimate, perUsd, percentUsed, resetsAt } = await estimateNow($)
    const isAutoStop = await read($, autoStop)
    const shown = await displayNow($)
    const costed = costText(estimate, perUsd, shown)
    const isSettingsOpen = await read($, showSettings)
    const hasLimit = shown.limit && percentUsed !== undefined

    return (
      <Box flexDirection="column">
        <Text dimColor>A second opinion on any decision on your screen.</Text>
        {(hasLimit || costed !== '') && (
          <Box marginTop={1} flexDirection="column">
            {frame(
              table,
              'subtle',
              <Box flexDirection="column">
                {hasLimit && <Text>5-hour limit  {meterOf(percentUsed ?? 0)} {percentUsed}%</Text>}
                {hasLimit && resetsAt !== undefined && <Text dimColor>Resets {resetsAt}</Text>}
                {costed !== '' && <Text>Each check  {costed}</Text>}
              </Box>,
              true,
            )}
          </Box>
        )}
        {drawSwitch(table, $, isAutoStop)}
        <Box marginTop={1}>
          <Button
            key="show-settings"
            label={isSettingsOpen ? '⚙ Hide settings' : '⚙ Settings'}
            onPress={() => update($, showSettings, open => !open)}
          />
        </Box>
        {isSettingsOpen && drawSettings(table, $, shown, inner)}

        {visible.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Your checks</Text>
            {[...visible].reverse().slice(0, 6).map(c =>
              frame(
                table,
                statusColor(c),
                <Button
                  key={`check-${c.id}`}
                  plain
                  onPress={async () => {
                    await update($, viewing, () => c.id)
                    await update($, seen, () => c.id)
                  }}
                >
                  <Text bold={c.id === current?.id} color={statusColor(c)}>{statusMark(c)} </Text>
                  {short(c.subject, inner - 2).padEnd(inner - 2)}
                </Button>,
                c.id !== current?.id,
              ),
            )}
          </Box>
        )}

        {pastCount > 0 && (
          <Button
            key="show-past"
            label={isPastOpen ? 'Hide past checks' : `Past checks (${pastCount})`}
            plain
            dimColor
            onPress={() => update($, showPast, open => !open)}
          />
        )}

        {current !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            {drawAnswer(table, current, current.cost === undefined ? '' : costText(current.cost, perUsd, shown, false))}
            {current.status === 'running' && (
              <Button
                key={`stop-${current.id}`}
                label="Stop this check"
                onPress={async () => {
                  if (await stopCheck($, current)) $.ui.toast('Stopped.')
                }}
              />
            )}
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
            const color = colorOf(moment.kind)
            const room = Math.max(10, inner - moment.kind.length - 2)

            return frame(
              table,
              color,
              <Button
                key={moment.id}
                plain
                onPress={() => runCheck($, moment.text, `${moment.kind} moment from the session`)}
              >
                <Text bold color={color}>{moment.kind}  </Text>
                {short(moment.text, room).padEnd(room)}
              </Button>,
              true,
            )
          })}
      </Box>
    )
  })
}
