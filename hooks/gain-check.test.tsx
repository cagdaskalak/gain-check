import { expect, test } from 'claude-code/testing'

import { costLine, costOf, estimateOf, parseAnswer, percentPerUsd } from './lib'

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

// Stands for the engine beneath the mod and records what the check is handed.
const engine = (on: any, opts: { selection?: string; override?: string; seed?: unknown[] } = {}) => {
  const spawned: any[] = []
  const specs: any[] = []
  const toasts: string[] = []
  const placed: string[] = []
  const opened: string[] = []
  let clock = 1000
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'gain' } }))
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
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
  on('session.messages', () => ({ value: ROWS }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }], cost: { usd: 5 } },
  }))
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
    on('state.get', (_: any, e: any, next: any) =>
      e.key === 'checks' ? { value: { value: { shape: 'checks-1', value: opts.seed }, version: 1 } } : next(e),
    )
  }

  return { spawned, specs, toasts, placed, opened }
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
  engine(on)
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

test('the cost reads plainly', () => {
  expect(costLine({ tokens: 700_000, usd: 1.2 }, 0.5)).toBe('about 700k tokens · $1.20 at API prices · 0.6% of your 5-hour limit')
  expect(costLine({ tokens: 1_200_000, usd: 1.28 })).toBe('about 1.2M tokens · $1.28 at API prices')
  expect(costLine({ tokens: 6_000 })).toBe('about 6k tokens')
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
