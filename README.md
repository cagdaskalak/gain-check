# Gain check

A second read on any decision on your screen, for Claude Code.

Select some text, or press a button on a question Claude is asking, and a separate agent tells you in plain words:

- **You get**: what the decision actually gives you
- **You don't get**: what it won't do, even if it works
- **You give up**: what it costs in money, risk, work or time
- **You already have**: what covers this today
- **Suggestion**: one action, and the call stays yours

Or it stays silent and says why in one line. It only reads and searches your project, and it never changes anything.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install gain-check --marketplace cagdaskalak/gain-check
```

From a shell:

```
claude plugin install gain-check --marketplace cagdaskalak/gain-check
```

Then answer `y` to add the marketplace and pick a scope.

## How to use it

- **Select any text and click `Gain check`**, the button above the prompt. With nothing selected, the same button opens a list of recent moments to pick from.
- **On a question Claude asks**, each question gets its own button, and `All` checks them together. The check runs while the question stays open, so you can read the answer before you reply.
- **Or type** `/gain <your decision>`.

Each check gets a card in the chat. Click it to open the full answer in the side pane, where every part is its own card and you can click between your checks.

Pressing the same thing twice never runs it twice, and a finished answer opens again without paying for it. Up to 6 checks run at once.

## Stopping a check

A check you started keeps running until it finishes, unless you stop it:

- **Stop:** every running check has a `Stop` button on its card, and `Stop all` sits next to the `Gain check` button.
- **Stop checks when you answer:** when you answer or close a question, any check still running on that question stops by itself. Click the switch in the question dialog or the side pane to turn this off. It stays as you left it.

Stopping saves what hasn't been spent yet, and you lose that answer, but you can always run it again.

## What it costs

Every check is a real agent run, and the cost shows before you press:

```
each about 700k tokens · $1.20 at API prices · 0.6% of your 5-hour limit
```

- The first number is a rough starting point. From your first finished check on, it is the average of your last 5 real runs.
- "API prices" is what the tokens would cost on the API. On a subscription you pay no dollars, but the usage counts against your limit.
- The share of your 5-hour limit appears once enough usage has moved to measure it. Other sessions on your account count too, so it can read a little high.

## Limits

- Selecting text with the mouse needs Claude Code's fullscreen mode. Without it, use the list or `/gain <text>`.
- Permission prompts can't carry a button, because Claude Code draws them itself. They appear in the list instead.
- Mouse clicks depend on your terminal. Where they don't work, `ctrl+x tab` moves focus to the buttons, and letter keys press them.

## Give it your project's rules

By default the agent can only read and search, and it knows nothing about your project beyond what it finds there. To give it your own rules, put an agent file at `.claude/agents/gain-check.md` in your project. Its body replaces the built-in instructions, and its `tools:` line replaces the tool list. Keep the same labels (`You get:`, `You don't get:`, `You give up:`, `You already have:`, `Suggestion:`, `Silent:`) so the cards still draw.

Text you pick is handed to the agent as data, but it does come from your screen. Keep an extended tool list only if you trust what you're checking.

## License

MIT
