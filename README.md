[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# hakimi-pumpfun-sharpe-bot

Deterministic Solana Pump.fun bonding-curve trading bot (`agent-fun/replay/v2`) engineered for high hourly Sharpe ratio, low equity drawdown, and consistent positive returns across unseen 6-hour windows.

## Strategy Architecture (`agent-fun/replay/v2`)

The bot processes the initial `hello` handshake (extracting caps such as `max_open_positions` and `max_orders_per_batch`) and streams each `batch` by `slot`, emitting bounded `orders` in `strategy.ts`:

1. **Per-Wallet Supply & Overhang Tracking**: Maintains real-time holder balances from `CreateEvent` and `TradeEvent` to enforce strict decentralization (`creator` share <= `0.5%`, top-3 concentration <= `28%`, minimum holder breadth, and bounded average SOL reserve per holder).
2. **Sleeve A (Liquid Pullback Continuation)**: Targets established high-velocity curves (`15–76 SOL` real quote reserves, `>= 27 SOL` 60-slot volume, `>= 22` unique 60-slot buyers, positive 180/60/15-slot net inflow, low `buy_exact_sol_in` ratio, and bounded 5-slot sell pressure) entered strictly on a sell tick inside a `3%–15%` pullback (`+44%` TP / `-20%` SL / `300`-slot max hold).
3. **Sleeve B (Fresh-Flow Mid-Curve Dip)**: Diversifies into earlier distributed dips (`5–20 SOL` real quote reserves, `15%–35%` drawdown, `>= 35` holders, `>= 4` recent buys in 15 slots, positive 15-slot net inflow, low 5-slot selling) with tighter exits (`+36%` TP / `-15%` SL / `200`-slot max hold).
4. **Sharpe-First Portfolio Risk Control**:
   - Single entry per mint (`entries < 1`) to avoid concentrated tail dependence.
   - Base sizing anchored to `min(equity, 10 SOL)` with concurrent-position decay (`1 / (1 + open * 0.75)`), a `50%` gross exposure cap, and an intra-hour variance throttle (`0.5x` sizing once current-hour return reaches `+5%`).
   - Clean, creator-filtered pacing probes (`0.011 SOL`) when trailing the 24-mint pace so unseen 6-hour windows comfortably clear the `>= 20` distinct-mint constraint.

## Local Validation (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`)

- **Official `makefun grade-local --driver process --json` (24h dev window)**:
  - Net PnL: `+5.479 SOL` (`+54.79%`)
  - Hourly Sharpe: `0.520` (`Sortino: 1.793`)
  - Max Drawdown: `9.43%` (`0.0943`)
  - Cost Sensitivity (`2x` fees): `+4.398 SOL`
  - Round Trips / Distinct Mints: `70` / `67` (`compliant: true`)
  - 90% Token-Bootstrap Interval: `[+1.589 SOL, +9.500 SOL]`
- **Chronological Splits (Half-1 `slot < 464432291` vs Half-2 `slot >= 464432291`)**:
  - Half-1: `+1.360 SOL`, Hourly Sharpe `0.639`, MaxDD `2.00%`, `26` mints
  - Half-2: `+4.375 SOL`, Hourly Sharpe `0.564`, MaxDD `10.37%`, `58` mints

## Run

```bash
node main.ts
```

Speaks `agent-fun/replay/v2` over stdin/stdout via `vendor/agentfun-bot.ts` on Node 22+ with zero external dependencies.
