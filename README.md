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

The `Gain check` button tells you where things stand at a glance:

- **Green:** a check is working.
- **Yellow:** an answer is ready and waiting for you. Opening it, or sending your next message, clears this.
- **White:** nothing is going on.

## It follows where you are

Once a decision is made, it stops taking up your screen. An answered question leaves the list, along with any finished check on it. Your next message does the same for other finished checks, and the list only offers your latest message and what follows. Nothing is deleted: `Past checks` in the side pane brings them back, because you paid for those answers, and a past check's card in the chat shrinks to one line you can still click.

## Stopping a check

A check you started keeps running until it finishes, unless you stop it:

- **Stop:** every running check has a `Stop` button on its card, and `Stop all` sits next to the `Gain check` button.
- **Stop checks when I answer:** when you answer or close a question, any check still running on that question stops by itself. Click the box in the question dialog or the side pane to turn this off. It stays as you left it.

Stopping saves what hasn't been spent yet, and you lose that answer, but you can always run it again.

## What it costs

Every check is a real agent run, and the cost shows before you press:

```
[ ✦ Gain check ]  Select text, then click  ·  ≈ 0.2% of limit  ·  31% used  [ ⚙ Settings ]
```

The numbers stay current by themselves as your usage moves.

## Choose what shows

Click `⚙ Settings` for tick boxes: share of your limit per check, dollar price, token count, how much of your limit is used, and the hint on the bar.

- **Standard setup:** it follows your account. On a subscription you see your limit and no dollars, because you aren't charged per check. On pay-as-you-go you see dollars, because there is no limit to show.
- **Your choice:** one click flips a box, and it's saved for that project, so each project can have its own setup. `Back to automatic` returns to the standard one.

- The first number is a rough starting point. From your first finished check on, it is the average of your last 5 real runs.
- The dollar price is what the tokens would cost at API list prices. On a subscription you pay no dollars, but the usage counts against your limit.
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
