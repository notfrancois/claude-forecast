# claude-forecast

A Claude Code mod that draws one line above the prompt. It tells you **when** you will run out, not just how much you used.

```
ctx ██████░░░░ 62% compact in ~3 turns │ 5h ███████▒▒▒ 71% out in 38m →14:30 │ wk █████▒▒▒▒▒ 52% out in 2d18h →Sat 13:48 │ cache hit 94% │ turn ▃▄▂▄▃█ 48.2k · $0.92 ▲ · 3 agents $0.60 │ session $4.20 · $1.10/h    ⎇ my-repo:feature-x
```

## What it shows

The bars below are drawn with background colors; the sample uses `█` for fill, `▒` for the tail and `░` for the empty track.

| Part | Meaning |
|---|---|
| `ctx ██████░░░░ 62% ~5 turns` | Context used. From 50 %, about how many more turns fit before auto-compact runs (or the full window when it is off), at the pace of your last turns; yellow from 2. A compact or `/clear` restarts the estimate. |
| `5h ███████▒▒▒ 71% out in 38m` | 5-hour limit used. Bars are ten painted cells, so they line up in any font. The dimmer tail shows where the current pace lands at reset. Each cell takes the color of the percent it stands for, from accent through amber to red, so a tail that reaches the end turns red. Red `out in 38m` when it runs out before it resets, and `resumes in 42m` once it has. The pace is a least-squares fit over the last 30 minutes, so one burst does not swing it. |
| `→14:30` | When a limit resets, as a clock time (weekday added when it is not today). Shown from 70 % or when the forecast warns. |
| `wk █████▒▒▒▒▒ 52% out in 2d18h` | Weekly limit used, with the same tail and warning. Its pace is the average since the week opened, which already counts nights and days off. |
| `cache hit 94%` | Share of the last turn's input read from the prompt cache, which costs about a tenth of fresh input. Yellow under 80 %. Adds `· 3m left` when the cache is about to expire and `· cold` once it has: the next turn then pays to write the whole context again, and `next turn +$0.57` says how much more than a warm turn. |
| `turn ▃▄▂▄▃█ 48.2k · $0.92` | New tokens (input, output and cache writes; cache reads left out) and dollars of the last turn, after a sparkline of the last six turns' cost. Yellow with `▲` when it cost more than twice the average of recent turns. `· 3 agents $0.60` is the part of the dollars that subagents spent. |
| `session $4.20 · $1.10/h` | What the session has cost so far (as `/cost`) and, after ten minutes, its hourly rate. |
| `⎇ my-repo:feature-x` | Repository and branch of the last file Claude edited, right-aligned, so it follows you across repos in a multi-repo workspace. |

Color only marks what needs attention: values stay neutral below 70 %, turn yellow from 70 % and red from 90 %. Details appear only when they matter.

## Alerts

- **Cache:** a toast one minute before the prompt cache expires while Claude waits for you.
- **5-hour and weekly limits:** a toast when the forecast says the limit runs out before it resets, and another when a spent limit resets. Once per window.
- **Cache TTL:** a toast the first time the meter learns a different TTL than it assumed.

## Narrow terminals

The line never wraps. It measures each part against the terminal width: first parts drop their bars and details, then whole parts hide in this order: repository, session, turn, weekly, cache, 5-hour. Context always stays.

## Install

In a Claude Code session:

```
/plugin install forecast-meter --marketplace danidan1214/claude-forecast
```

Answer `y` to add the marketplace, then pick a scope.

### From a local folder

```
git clone https://github.com/danidan1214/claude-forecast.git ~/.claude/mods/claude-forecast
claude --plugin-dir ~/.claude/mods/claude-forecast
```

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

## Cache TTL

Claude Code does not report the prompt cache TTL, so the meter learns it. It starts at 1 hour, what Claude Code requests on a subscription (the `extended-cache-ttl` beta), and checks each turn that starts 6 to 55 minutes after the last response: a hit rate of 50 % or more proves 1 hour, under 20 % proves 5 minutes. What it learns is kept across sessions.

## Limits

- Until a turn starts 6 to 55 minutes after the last one, the cache countdown assumes 1 hour.
- Forecasts need a few minutes of data: the 5-hour forecast needs readings spanning at least 2 minutes, the weekly one an hour into the week, and the turn estimate needs two turns that grew the context.
- The cold-turn price is learned from the dollars of each response, assuming Anthropic's fixed price ratios to input: cache writes 1.25× (5m) or 2× (1h), cache reads 0.1×, output 5×.
- Subagents running in the background past the end of a turn count toward the next one.
- Rate limits only appear on a subscription.
- Dollar figures are the session estimate (as `/cost`), not what a subscription bills.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
