import { expect, test } from 'claude-code/testing'

import { autoDisplay, costOf, costText, estimateOf, meterOf, parseAnswer, percentPerUsd, questionText, short, timeOf } from './lib'

const QUESTION = {
  plugin: 'gain-check',
  component: 'AskUserQuestion',
  requestId: 'tu1',
  props: {
    tool: 'AskUserQuestion',
    questions: [
      {
        question: 'Which database?',
        header: 'Database',
        multiSelect: false,
        options: [
          { label: 'Postgres (Recommended)', description: 'mature' },
          { label: 'SQLite', description: 'simple' },
        ],
      },
    ],
  },
} as const

const TWO = {
  ...QUESTION,
  props: {
    tool: 'AskUserQuestion',
    questions: [
      QUESTION.props.questions[0],
      {
        question: 'Ship this week?',
        header: 'Timing',
        multiSelect: false,
        options: [
          { label: 'Yes', description: 'sooner' },
          { label: 'No', description: 'later' },
        ],
      },
    ],
  },
} as const

const PANE = {
  plugin: 'gain-check',
  component: 'Pane',
  requestId: 'gain-check',
  props: {
    title: 'Gain check',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'gain-check',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 } },
} as const

const ROWS = [
  { role: 'user', text: 'should we switch databases', toolUses: [] },
  {
    role: 'assistant',
    text: 'Here is my long reasoning about it',
    toolUses: [
      { tool_use_id: 'b1', tool: 'Bash', input: { command: 'ls' } },
      { tool_use_id: 'q1', tool: 'AskUserQuestion', input: { questions: QUESTION.props.questions } },
    ],
  },
  { role: 'user', text: '<task-notification>done</task-notification>', toolUses: [] },
]

const ANSWER = [
  'Decision: Switch to Postgres',
  'Why it came up: The app is outgrowing its single-file database.',
  'You get: Safe writes from many users at once.',
  "You don't get: Any speed-up for the slow report.",
  'You give up: About a day of migration work.',
  'You already have: Nightly backups that would carry over.',
  'Suggestion: Switch after this release. Your call.',
].join('\n')

const done = (id: string, subject: string, answer = ANSWER) => ({
  id,
  source: 'test',
  subject,
  body: subject,
  status: 'done',
  startedAt: 1,
  answer,
  cost: { tokens: 300_000, usd: 0.31 },
})

const running = (id: string, subject: string) => ({
  id,
  source: 'test',
  subject,
  body: subject,
  status: 'running',
  startedAt: 1000,
  agentId: `agent-${id}`,
})

// Stands for the engine beneath the mod and records what the check is handed.
const engine = (
  on: any,
  opts: {
    selection?: string
    override?: string
    seed?: unknown[]
    refuseStop?: boolean
    account?: 'subscription' | 'api'
    root?: string
    savedDisplay?: Record<string, unknown>
    rows?: unknown[]
  } = {},
) => {
  const stops: string[] = []
  const saved: Record<string, unknown> = {}
  const deleted: string[] = []
  const spawned: any[] = []
  const specs: any[] = []
  const toasts: string[] = []
  const placed: string[] = []
  const opened: string[] = []
  let clock = 1000
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'gain' } }))
  on('session.root', () => ({ value: opts.root ?? '/project' }))
  on('store.get', (_: any, e: any) => ({ value: opts.savedDisplay?.[e.key] }))
  on('store.delete', (_: any, e: any) => {
    deleted.push(e.key)

    return { value: undefined }
  })
  on('store.set', (_: any, e: any) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('tool.call', { tool: 'TaskStop' }, (_: any, e: any) => {
    if (opts.refuseStop === true) return { deny: 'not allowed' }
    stops.push(e.task_id)

    return { result: {}, text: 'stopped' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: {}, text: 'answered' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {}, text: 'read' }))
  on('classic.PermissionRequest', () => ({}))
  on('fs.read', () => {
    if (opts.override === undefined) throw new Error('missing')

    return { value: opts.override }
  })
  on('agent.register', (_: any, e: any) => {
    specs.push(e)

    return { value: { agent: 'gain-check:check' } }
  })
  on('clock.now', () => {
    clock += 1000

    return { value: clock }
  })
  on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
  on('session.messages', () => ({ value: opts.rows ?? ROWS }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {},
      rateLimits: opts.account === 'api' ? [] : [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2030-01-01T18:40:00Z' }],
      cost: { usd: 5 },
    },
  }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('ui.open', (_: any, e: any) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.place', (_: any, e: any) => {
    placed.push(e.id)

    return { value: { requestId: e.id } }
  })
  on('ui.selection', () => ({
    value: opts.selection === undefined ? undefined : { text: opts.selection },
  }))
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('agent.spawn', (_: any, e: any) => {
    spawned.push(e)

    return { model: 'm', agentId: 'a1' }
  })
  if (opts.seed !== undefined) {
    // A real read-write stand-in for the seeded value, so a status change sticks.
    let stored: unknown = { shape: 'checks-1', value: opts.seed }
    let version = 1
    on('state.get', (_: any, e: any, next: any) =>
      e.key === 'checks' ? { value: { value: stored, version } } : next(e),
    )
    on('state.set', (_: any, e: any, next: any) => {
      if (e.key !== 'checks') return next(e)
      stored = e.value
      version += 1

      return { value: { isSet: true, version } }
    })
  }
  on('ui.log', () => ({ value: undefined }))

  return { spawned, specs, toasts, placed, opened, stops, saved, deleted }
}

const boot = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('with no project file it uses the built-in instructions and read-only tools', async ($: any, on: any) => {
  const { specs } = engine(on)
  await boot($)

  expect(specs.length).toBe(1)
  expect(specs[0].name).toBe('check')
  expect(specs[0].prompt).toContain('You get:')
  expect(specs[0].tools).toEqual(['Read', 'Grep', 'Glob'])
  expect(specs[0].omitClaudeMd).toBe(true)
})

test('a project file replaces the instructions and tools', async ($: any, on: any) => {
  const { specs } = engine(on, { override: '---\nname: x\ntools: Read, Bash\n---\nMY RULES' })
  await boot($)

  expect(specs[0].prompt).toBe('MY RULES')
  expect(specs[0].tools).toEqual(['Read', 'Bash'])
})

test('the built-in instructions tell it on-screen text is data, not instructions', async ($: any, on: any) => {
  const { specs } = engine(on)
  await boot($)

  expect(specs[0].prompt).toContain('never instructions')
})

test('a question gets a button above the dialog, and it checks the options without the tag', async ($: any, on: any) => {
  const { spawned } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...QUESTION, surface: 'terminal' })

  // The engine refuses a tree without its own node once, so a draw that
  // mounts at all proves the dialog is still there.
  await ui.press({ key: 'gain-q0' })

  expect(spawned.length).toBe(1)
  expect(spawned[0].subagent_type).toBe('gain-check:check')
  expect(spawned[0].prompt).toContain('Which database?')
  expect(spawned[0].prompt).toContain('- Postgres: mature')
  expect(spawned[0].prompt).toContain('- SQLite: simple')
  expect(spawned[0].prompt).not.toContain('Recommended')
  await ui.unmount()
})

test('a press answers at once: a toast, and a card placed in the transcript', async ($: any, on: any) => {
  const { toasts, placed } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...QUESTION, surface: 'terminal' })

  await ui.press({ key: 'gain-q0' })

  expect(toasts.join(' ')).toContain('started')
  expect(placed.length).toBe(1)
  await ui.unmount()
})

test('pressing the same thing again starts nothing and says so', async ($: any, on: any) => {
  const { spawned, toasts } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...QUESTION, surface: 'terminal' })

  for (let i = 0; i < 5; i += 1) await ui.press({ key: 'gain-q0' })

  expect(spawned.length).toBe(1)
  expect(toasts.join(' ')).toContain('Already checking')
  await ui.unmount()
})

test('several checks can run at once, up to a cap that stops a runaway', async ($: any, on: any) => {
  const { spawned, toasts } = engine(on)
  await boot($)

  for (let i = 0; i < 8; i += 1) await $.command.run({ command: 'gain', args: `check ${i}` })

  expect(spawned.length).toBe(6)
  expect(toasts.join(' ')).toContain('already running')
})

test('/gain with text checks that text, and passes only the person\'s words as context', async ($: any, on: any) => {
  const { spawned } = engine(on)
  await boot($)

  const ran = await $.command.run({ command: 'gain', args: 'drop the old API' })

  expect(ran.text).toBeDefined()
  expect(spawned[0].prompt).toContain('drop the old API')
  expect(spawned[0].prompt).toContain('should we switch databases')
  expect(spawned[0].prompt).not.toContain('my long reasoning')
})

test('/gain with a mouse selection checks the selection', async ($: any, on: any) => {
  const { spawned } = engine(on, { selection: 'Ship on Friday' })
  await boot($)

  await $.command.run({ command: 'gain', args: '' })

  expect(spawned[0].prompt).toContain('Ship on Friday')
})

test('/gain with nothing selected opens the picker and starts nothing', async ($: any, on: any) => {
  const { spawned } = engine(on)
  await boot($)

  const ran = await $.command.run({ command: 'gain', args: '' })

  expect(ran.text).toContain('pick')
  expect(spawned.length).toBe(0)
})

test('the pane lists moments as cards: no tool noise until asked, a click checks that one', async ($: any, on: any) => {
  const { spawned } = engine(on)
  await boot($)
  await $.command.run({ command: 'gain', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'q1' })).toBeDefined()
  expect(await ui.find({ key: 'm0' })).toBeDefined()
  expect(await ui.find({ key: 'm2' })).toBeUndefined()
  expect(await ui.find({ key: 'b1' })).toBeUndefined()

  await ui.press({ key: 'show-tools' })
  expect(await ui.find({ key: 'b1' })).toBeDefined()

  await ui.press({ key: 'q1' })
  expect(spawned[0].prompt).toContain('Which database?')
  await ui.unmount()
})

test('an answer is drawn as one card per part, with the plain labels', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'Switch to Postgres')] })
  await boot($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  for (const label of ['You get', "You don't get", 'You give up', 'You already have', 'Suggestion']) {
    expect((await ui.find({ type: 'Text', text: label }))?.text).toBe(label)
  }
  expect(await ui.find({ type: 'Text', text: /Safe writes from many users/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /About a day of migration work/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /single-file database/ })).toBeDefined()
  await ui.unmount()
})

test('clicking a check card shows that check\'s answer', async ($: any, on: any) => {
  engine(on, {
    seed: [
      done('c1', 'First', 'You get: The first answer.'),
      done('c2', 'Second', 'You get: The second answer.'),
    ],
  })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /The second answer/ })).toBeDefined()
  await ui.press({ key: 'check-c1' })
  expect(await ui.find({ type: 'Text', text: /The first answer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /The second answer/ })).toBeUndefined()
  await ui.unmount()
})

test('the card in the chat is short, and a click opens the full answer', async ($: any, on: any) => {
  const { opened } = engine(on, { seed: [done('c1', 'Switch to Postgres')] })
  await boot($)
  const ui = await $.ui.mount({
    plugin: 'gain-check',
    component: 'Placed',
    requestId: 'card-c1',
    props: { id: 'card-c1', plugin: 'gain-check' },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /Switch after this release/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You get' })).toBeUndefined()
  await ui.press({ key: 'open-c1' })
  expect(opened).toContain('gain-check')
  await ui.unmount()
})

test('a silent answer is one calm card that says why', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'Rename a heading', 'Silent: docs only, nothing at stake.')] })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /docs only, nothing at stake/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You get' })).toBeUndefined()
  await ui.unmount()
})

test('the pane draws on the other surfaces too', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'Switch to Postgres')] })
  await boot($)
  await $.command.run({ command: 'gain', args: '' })

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'q1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a turn that is not this mod\'s check reports nothing', async ($: any, on: any) => {
  const { toasts } = engine(on)
  await boot($)
  await $.command.run({ command: 'gain', args: 'drop the old API' })
  toasts.length = 0

  const end = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
  await $.turn.complete({ ...end, answer: 'main answer' })
  await $.turn.complete({ ...end, agentId: 'someone-else', answer: 'other agent' })

  expect(toasts.length).toBe(0)
})

test('the band is always there: with a selection a click checks it', async ($: any, on: any) => {
  const { spawned } = engine(on, { selection: 'Ship on Friday' })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'gain-band' })

  expect(spawned.length).toBe(1)
  expect(spawned[0].prompt).toContain('Ship on Friday')
  await ui.unmount()
})

test('the band with nothing selected opens the pick-list and starts nothing', async ($: any, on: any) => {
  const { spawned, opened } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'gain-band' })

  expect(spawned.length).toBe(0)
  expect(opened).toContain('gain-check')
  await ui.unmount()
})

test('the band yields to a survey', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })

  expect(await ui.find({ key: 'gain-band' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('a dialog with several questions gets a button for each, and one press checks only that one', async ($: any, on: any) => {
  const { spawned } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...TWO, surface: 'terminal' })

  await ui.press({ key: 'gain-q1' })

  expect(spawned.length).toBe(1)
  expect(spawned[0].prompt).toContain('Ship this week?')
  expect(spawned[0].prompt).not.toContain('Which database?')
  await ui.unmount()
})

test('"all" checks each question separately, at once, and never repeats one already running', async ($: any, on: any) => {
  const { spawned, toasts } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...TWO, surface: 'terminal' })

  await ui.press({ key: 'gain-q0' })
  toasts.length = 0
  await ui.press({ key: 'gain-all' })

  expect(spawned.length).toBe(2)
  expect(toasts.length).toBe(1)
  await ui.unmount()
})

test('a single question has no "all" button', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...QUESTION, surface: 'terminal' })

  expect(await ui.find({ key: 'gain-q0' })).toBeDefined()
  expect(await ui.find({ key: 'gain-all' })).toBeUndefined()
  await ui.unmount()
})

test('the cost shows before you press, in the dialog, the band and the pane', async ($: any, on: any) => {
  engine(on, { account: 'api' })
  await boot($)
  await $.command.run({ command: 'gain', args: '' })

  for (const target of [QUESTION, BAND, PANE]) {
    const ui = await $.ui.mount({ ...target, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /\$1\.20/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a run is priced from its real token split', () => {
  const opus = {
    model: 'claude-opus-5-5',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  }

  expect(costOf(opus)).toEqual({ tokens: 4_000_000, usd: 29.2 })
  expect(costOf({ ...opus, model: 'claude-sonnet-5-5' })?.usd).toBe(14.7)
  expect(costOf({ ...opus, model: 'some-new-model' })).toEqual({ tokens: 4_000_000 })
  expect(costOf(undefined)).toBeUndefined()
})

test('the estimate starts rough and then follows real runs', () => {
  expect(estimateOf([])).toEqual({ tokens: 700_000, usd: 1.2 })
  expect(estimateOf([{ tokens: 100_000, usd: 0.2 }, { tokens: 300_000, usd: 0.4 }])).toEqual({ tokens: 200_000, usd: 0.3 })
})

test('the 5-hour share is only claimed once enough has moved to measure it', () => {
  const base = { usd: 10, percent: 10 }

  expect(percentPerUsd(base, { usd: 14, percent: 12 })).toBe(0.5)
  expect(percentPerUsd(base, { usd: 10.5, percent: 10 })).toBeUndefined()
  expect(percentPerUsd(base, { usd: 14, percent: 2 })).toBeUndefined()
})

test('an answer is split into its parts, and a line with no label continues the one above', () => {
  const p = parseAnswer(
    ['Decision: Switch', 'Why it came up: It is slow.', 'You get: Speed', 'and fewer errors', 'Suggestion: Do it. Your call.'].join('\n'),
  )

  expect(p.decision).toBe('Switch')
  expect(p.why).toBe('It is slow.')
  expect(p.rows).toEqual([{ label: 'You get', value: 'Speed and fewer errors' }])
  expect(p.suggestion).toBe('Do it. Your call.')
})

test('a silent answer and a shapeless one are both kept readable', () => {
  expect(parseAnswer('Silent: docs only.').silent).toBe('docs only.')
  expect(parseAnswer('Something else entirely').other).toBe('Something else entirely')
})

test('a running check\'s chat card has a Stop button that stops that check', async ($: any, on: any) => {
  const { stops } = engine(on, { seed: [running('c1', 'First'), running('c2', 'Second')] })
  await boot($)
  const ui = await $.ui.mount({
    plugin: 'gain-check',
    component: 'Placed',
    requestId: 'card-c1',
    props: { id: 'card-c1', plugin: 'gain-check' },
    surface: 'terminal',
  })

  await ui.press({ key: 'stop-c1' })

  expect(stops).toEqual(['agent-c1'])
  await ui.unmount()
})

test('a finished check has no Stop button', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'stop-c1' })).toBeUndefined()
  await ui.unmount()
})

test('the pane can stop the check you are looking at', async ($: any, on: any) => {
  const { stops } = engine(on, { seed: [running('c1', 'First')] })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'stop-c1' })

  expect(stops).toEqual(['agent-c1'])
  await ui.unmount()

  // Drawn again, as the engine does when a value changes: the stop stuck.
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Stopped/ })).toBeDefined()
  expect(await after.find({ key: 'stop-c1' })).toBeUndefined()
  await after.unmount()
})

test('the band offers Stop all only while something is running, and it stops them all', async ($: any, on: any) => {
  const { stops } = engine(on, { seed: [running('c1', 'First'), running('c2', 'Second'), done('c3', 'Third')] })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'gain-stop-all' })

  expect(stops).toEqual(['agent-c1', 'agent-c2'])
  await ui.unmount()
})

test('the band has no Stop all when nothing is running', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ key: 'gain-stop-all' })).toBeUndefined()
  await ui.unmount()
})

test('answering a question stops the check on that question, and leaves others running', async ($: any, on: any) => {
  const asked = short(questionText([QUESTION.props.questions[0]]), 100)
  const { stops, toasts } = engine(on, { seed: [running('c1', asked), running('c2', 'Something else')] })
  await boot($)

  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTION.props.questions })

  expect(stops).toEqual(['agent-c1'])
  expect(toasts.join(' ')).toContain('Stopped 1 gain check,')
})

test('a check on the whole set of questions is stopped too', async ($: any, on: any) => {
  const both = short(questionText(TWO.props.questions), 100)
  const { stops } = engine(on, { seed: [running('c1', both)] })
  await boot($)

  await $.tool.call({ tool: 'AskUserQuestion', questions: TWO.props.questions })

  expect(stops).toEqual(['agent-c1'])
})

test('the switch turns auto-stop off, says so, and is saved for next time', async ($: any, on: any) => {
  const asked = short(questionText([QUESTION.props.questions[0]]), 100)
  const { stops, saved } = engine(on, { seed: [running('c1', asked)] })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'auto-stop' }))?.text).toContain('[✓]')
  await ui.press({ key: 'auto-stop' })
  expect((await ui.find({ key: 'auto-stop' }))?.text).toContain('[ ]')
  expect(saved.autoStop).toBe(false)
  await ui.unmount()

  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTION.props.questions })

  expect(stops).toEqual([])
})

test('the question dialog has the switch too', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...QUESTION, surface: 'terminal' })

  expect((await ui.find({ key: 'auto-stop' }))?.text).toContain('[✓]')
  await ui.unmount()
})

test('a stop the engine refuses says so and leaves the check as it was', async ($: any, on: any) => {
  const { toasts } = engine(on, { seed: [running('c1', 'First')], refuseStop: true })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'stop-c1' })

  expect(toasts.join(' ')).toContain('Could not stop')
  await ui.unmount()
})

test('a dialog with the most questions still fits and keeps its buttons', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const q = (header: string) => ({ ...QUESTION.props.questions[0], question: `${header}?`, header })
  const ui = await $.ui.mount({
    ...QUESTION,
    props: { tool: 'AskUserQuestion', questions: [q('Database'), q('Timing'), q('Hosting'), q('Budget')] },
    surface: 'terminal',
  })

  for (const key of ['gain-q0', 'gain-q3', 'gain-all', 'auto-stop']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  await ui.unmount()
})

test('the bar reads like a product: a short hint and a plain cost, no token talk', async ($: any, on: any) => {
  engine(on, { account: 'api' })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ key: 'gain-band' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Select text, then click/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.20/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tokens/ })).toBeUndefined()
  await ui.unmount()
})

test('the bar stays current: a usage update reaches it with no new read', async ($: any, on: any) => {
  engine(on)
  await boot($)
  await $.session.measure({
    context: {},
    rateLimits: [{ kind: 'five_hour', percentUsed: 77, resetsAt: '2030-01-01T18:40:00Z' }],
    cost: { usd: 9 },
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /77%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeUndefined()
  await ui.unmount()
})

test('a finished check you have not opened shows as ready, and Open opens it', async ($: any, on: any) => {
  const { opened } = engine(on, { seed: [done('c1', 'First')] })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Answer ready/ })).toBeDefined()
  await ui.press({ key: 'gain-open' })
  expect(opened).toContain('gain-check')
  await ui.unmount()

  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Answer ready/ })).toBeUndefined()
  await after.unmount()
})

test('the pane shows your limit as a meter with its reset time, and each kind by name', async ($: any, on: any) => {
  engine(on)
  await boot($)
  await $.command.run({ command: 'gain', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /▰▰▰▰▱▱▱▱▱▱ 42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Resets/ })).toBeDefined()
  expect((await ui.find({ key: 'q1' }))?.text).toContain('Question')
  expect((await ui.find({ key: 'm0' }))?.text).toContain('You')
  await ui.unmount()
})

test('the meter and the reset time read plainly', () => {
  expect(meterOf(0)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(meterOf(31)).toBe('▰▰▰▱▱▱▱▱▱▱')
  expect(meterOf(100)).toBe('▰▰▰▰▰▰▰▰▰▰')
  expect(meterOf(140)).toBe('▰▰▰▰▰▰▰▰▰▰')
  expect(timeOf('not a time')).toBeUndefined()
  expect(timeOf(undefined)).toBeUndefined()
  expect(typeof timeOf('2030-01-01T18:40:00Z')).toBe('string')
})

test('the cost shows only what is ticked', () => {
  const all = { dollars: true, share: true, tokens: true, limit: true, hint: true }
  const c = { tokens: 114_000, usd: 0.37 }

  expect(costText(c, 0.5, all)).toBe('≈ $0.37 · 0.2% of limit · 114k tokens')
  expect(costText(c, 0.5, { ...all, dollars: false, tokens: false })).toBe('≈ 0.2% of limit')
  expect(costText(c, 0.5, { ...all, share: false, tokens: false })).toBe('≈ $0.37')
  expect(costText(c, undefined, { ...all, dollars: false, tokens: false })).toBe('')
  expect(costText({ tokens: 6_000 }, undefined, { ...all, tokens: false })).toBe('')
  expect(costText(c, 0.5, { ...all, share: false }, false)).toBe('$0.37 · 114k tokens')
})

test('the standard setup follows the account: limits on a subscription, dollars on the API', () => {
  expect(autoDisplay(true)).toEqual({ dollars: false, share: true, tokens: false, limit: true, hint: true })
  expect(autoDisplay(false)).toEqual({ dollars: true, share: false, tokens: false, limit: false, hint: true })
})

const movedUsage = {
  context: {},
  rateLimits: [{ kind: 'five_hour', percentUsed: 44, resetsAt: '2030-01-01T18:40:00Z' }],
  cost: { usd: 9 },
  changed: ['rateLimits'],
}

test('on a subscription the bar shows your limit and no dollars, with no setup', async ($: any, on: any) => {
  engine(on)
  await boot($)
  await $.session.measure(movedUsage)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /0\.6% of limit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /44% used/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})

test('on the API the bar shows dollars and no limit, with no setup', async ($: any, on: any) => {
  engine(on, { account: 'api' })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /\$1\.20/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /of limit/ })).toBeUndefined()
  await ui.unmount()
})

test('the tick boxes stay out of the way until asked for', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'tick-dollars' })).toBeUndefined()
  await ui.press({ key: 'show-settings' })
  expect((await ui.find({ key: 'tick-dollars' }))?.text).toContain('[ ]')
  expect((await ui.find({ key: 'tick-share' }))?.text).toContain('[✓]')
  await ui.unmount()
})

test('the gear on the bar opens the tick boxes', async ($: any, on: any) => {
  const { opened } = engine(on)
  await boot($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'gain-settings' })
  await band.unmount()
  expect(opened).toContain('gain-check')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'tick-dollars' })).toBeDefined()
  await ui.unmount()
})

test('a tick changes what shows, and is saved for this project only', async ($: any, on: any) => {
  const { saved } = engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'show-settings' })
  await ui.press({ key: 'tick-dollars' })
  expect((await ui.find({ key: 'tick-dollars' }))?.text).toContain('[✓]')
  await ui.unmount()

  expect((saved['display:/project'] as any).dollars).toBe(true)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /\$1\.20/ })).toBeDefined()
  await band.unmount()
})

test('each project keeps its own choice', async ($: any, on: any) => {
  const mine = { dollars: true, share: false, tokens: true, limit: false, hint: false }
  engine(on, { root: '/project-a', savedDisplay: { 'display:/project-a': mine, 'display:/project-b': { dollars: false } } })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /\$1\.20 · 700k tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Select text/ })).toBeUndefined()
  await ui.unmount()
})

test('a project with no saved choice gets the standard setup', async ($: any, on: any) => {
  engine(on, { root: '/project-c', savedDisplay: { 'display:/project-a': { dollars: true } } })
  await boot($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})

test('"back to automatic" forgets the choice', async ($: any, on: any) => {
  const { deleted } = engine(on, { savedDisplay: { 'display:/project': { dollars: true, share: false, tokens: false, limit: false, hint: true } } })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'show-settings' })
  await ui.press({ key: 'tick-reset' })

  expect(deleted).toContain('display:/project')
  expect((await ui.find({ key: 'tick-dollars' }))?.text).toContain('[ ]')
  expect(await ui.find({ key: 'tick-reset' })).toBeUndefined()
  await ui.unmount()
})

test('the all button follows the ticks too', async ($: any, on: any) => {
  engine(on, { account: 'api' })
  await boot($)
  const ui = await $.ui.mount({ ...TWO, surface: 'terminal' })

  expect((await ui.find({ key: 'gain-all' }))?.text).toContain('$2.40')
  await ui.unmount()
})

test('with dollars off the all button shows no price', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const ui = await $.ui.mount({ ...TWO, surface: 'terminal' })

  expect((await ui.find({ key: 'gain-all' }))?.text).not.toContain('$')
  await ui.unmount()
})

const person = { text: 'next thing', origin: { kind: 'composer' } }

test('an answered question leaves the pick-list; one still open stays', async ($: any, on: any) => {
  const open = { tool_use_id: 'q-open', tool: 'AskUserQuestion', input: { questions: QUESTION.props.questions } }
  const answered = { ...open, tool_use_id: 'q-done', result: {}, text: 'Postgres' }
  engine(on, { rows: [{ role: 'user', text: 'go on', toolUses: [] }, { role: 'assistant', text: '', toolUses: [answered, open] }] })
  await boot($)
  await $.command.run({ command: 'gain', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'q-done' })).toBeUndefined()
  expect(await ui.find({ key: 'q-open' })).toBeDefined()
  await ui.unmount()
})

test('older chat drops off the pick-list: only your latest message and what follows', async ($: any, on: any) => {
  engine(on, {
    rows: [
      { role: 'user', text: 'an old question', toolUses: [] },
      { role: 'assistant', text: 'an old answer', toolUses: [] },
      { role: 'user', text: 'the current question', toolUses: [] },
      { role: 'assistant', text: 'the current answer', toolUses: [] },
    ],
  })
  await boot($)
  await $.command.run({ command: 'gain', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'm0' })).toBeUndefined()
  expect(await ui.find({ key: 'm1' })).toBeUndefined()
  expect(await ui.find({ key: 'm2' })).toBeDefined()
  expect(await ui.find({ key: 'm3' })).toBeDefined()
  await ui.unmount()
})

test('answering a question retires its finished check from view, and leaves others', async ($: any, on: any) => {
  const asked = short(questionText([QUESTION.props.questions[0]]), 100)
  engine(on, { seed: [done('c1', asked, 'You get: The old answer.'), done('c2', 'Something else', 'You get: Still current.')] })
  await boot($)

  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTION.props.questions })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'check-c1' })).toBeUndefined()
  expect(await ui.find({ key: 'check-c2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /The old answer/ })).toBeUndefined()
  await ui.unmount()
})

test('your next message retires finished checks; a running one stays', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First'), running('c2', 'Second')] })
  await boot($)

  await $.prompt.submit(person)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'check-c1' })).toBeUndefined()
  expect(await ui.find({ key: 'check-c2' })).toBeDefined()
  await ui.unmount()
})

test('a message from the phone counts too', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)

  await $.prompt.submit({ ...person, origin: { kind: 'bridge' } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'check-c1' })).toBeUndefined()
  await ui.unmount()
})

test('a background notification is not moving on, so the answer stays while you read it', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)

  await $.prompt.submit({ ...person, origin: { kind: 'task-notification' } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'check-c1' })).toBeDefined()
  await ui.unmount()
})

test('a slash command is not moving on', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)

  await $.prompt.submit({ ...person, text: '/gain', command: { name: 'gain', args: '' } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'check-c1' })).toBeDefined()
  await ui.unmount()
})

test('"Answer ready" clears once you have moved on', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)

  await $.prompt.submit(person)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Answer ready/ })).toBeUndefined()
  await ui.unmount()
})

test('past checks are never lost: a click brings them back and opens the answer', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First', 'You get: The old answer.')] })
  await boot($)
  await $.prompt.submit(person)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'show-past' }))?.text).toContain('Past checks (1)')
  await ui.press({ key: 'show-past' })
  await ui.press({ key: 'check-c1' })
  expect(await ui.find({ type: 'Text', text: /The old answer/ })).toBeDefined()
  await ui.unmount()
})

test('with no past checks there is no past list', async ($: any, on: any) => {
  engine(on, { seed: [done('c1', 'First')] })
  await boot($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'show-past' })).toBeUndefined()
  await ui.unmount()
})

test('a past check\'s chat card shrinks to one quiet line, still clickable', async ($: any, on: any) => {
  const { opened } = engine(on, { seed: [done('c1', 'Switch to Postgres')] })
  await boot($)
  await $.prompt.submit(person)
  const ui = await $.ui.mount({
    plugin: 'gain-check',
    component: 'Placed',
    requestId: 'card-c1',
    props: { id: 'card-c1', plugin: 'gain-check' },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /Switch after this release/ })).toBeUndefined()
  await ui.press({ key: 'open-c1' })
  expect(opened).toContain('gain-check')
  await ui.unmount()
})

test('a permission prompt leaves the list once its tool call is over', async ($: any, on: any) => {
  engine(on)
  await boot($)
  await $.classic.PermissionRequest({ tool_name: 'Read', tool_input: { file_path: 'x' }, permission_suggestions: [] })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: 'Permission  ' })).toBeDefined()
  await before.unmount()

  await $.tool.call({ tool: 'Read', file_path: 'x' })

  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: 'Permission  ' })).toBeUndefined()
  await after.unmount()
})

test('the settings are a proper button with wide tick rows', async ($: any, on: any) => {
  engine(on)
  await boot($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ key: 'gain-settings' }))?.props.label).toBe('⚙ Settings')
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'show-settings' })
  const row = await ui.find({ key: 'tick-dollars' })
  expect(row?.text).toContain('[ ]')
  expect((row?.text.length ?? 0) > 60).toBe(true)
  await ui.unmount()
})
