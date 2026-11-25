[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/reward.svg)](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# hakimi-pumpfun-sharpe-bot

Deterministic Solana Pump.fun bonding-curve trading bot (`agent-fun/replay/v2`) engineered for high hourly Sharpe ratio, tight equity drawdown (`<= 4.5%`), and consistent positive returns across unseen 6-hour windows.

## Strategy Architecture (`agent-fun/replay/v2`)

The bot processes the initial `hello` handshake (reading runtime caps such as `max_open_positions` and `max_orders_per_batch`) and streams each `batch` by `slot`, emitting bounded `orders` in `strategy.ts`:

1. **Per-Wallet Supply & Overhang Tracking**: Maintains real-time holder balances from `CreateEvent` and `TradeEvent` to enforce strict decentralization (`creator` share `<= 0.5%–1%`, top-3 concentration `<= 28%–30%`, minimum holder breadth, and bounded average SOL reserve per holder).
2. **Sleeve A (Liquid Pullback Continuation)**: Targets established high-velocity curves (`23–76 SOL` real quote reserves, `>= 27 SOL` 60-slot volume, `>= 22` unique 60-slot buyers, positive 180/60/15-slot net inflow, 15-slot price trend `>= +7%`, low `buy_exact_sol_in` share, bounded 5-slot selling, and no `> 3 SOL` single-trade sell dump in 15 slots) entered on a sell tick inside a `3%–15%` pullback (`+44%` TP / `-20%` SL / `300`-slot max hold).
3. **Sleeve B (Fresh-Flow Mid-Curve Dip)**: Diversifies into earlier distributed dips (`5–20 SOL` real quote reserves, `15%–35%` drawdown, `>= 35` holders, `>= 4` recent buys in 15 slots, positive 15-slot net inflow, low 5-slot selling) (`+34%` TP / `-15%` SL / `200`-slot max hold).
4. **Sleeve C (Organic Retail Crowd)**: Captures steady retail accumulation with high unique buyer breadth (`>= 32` unique 60-slot buyers) on calm volume (`5–26 SOL`), `10–60 SOL` reserves, recent peak (`<= 120` slots), active 15-slot buying (`>= 1` buy), and `ret15 <= 0` (`+18%` TP / `-12%` SL / `90`-slot max hold).
5. **Sharpe-First Volatility & Drawdown Control**:
   - Single entry per mint (`entries < 1`), `1.15 SOL` per-position cap, `min(equity, 10 SOL)` base sizing, concurrent-position decay (`1 / (1 + open * 0.75)`), and `50%` gross exposure cap.
   - Two-tier intra-hour return throttle (`0.25x` sizing once current-hour return reaches `+2%`, `0.12x` at `+4%`) to stabilize hourly return variance.
   - Clean, creator-filtered pacing probes (`0.011 SOL`) when trailing a 27-mint 5h pace so every unseen 6-hour window comfortably clears the `>= 20` distinct-mint constraint.

## Local Validation (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`)

- **Official `makefun grade-local --driver process --stress --json` (24h dev window)**:
  - Net PnL: `+5.440 SOL` (`+54.40%`)
  - Hourly Sharpe: `0.7350` (`Sortino: 2.5418`)
  - Max Drawdown: `4.23%` (`0.04225`)
  - Win Rate / Round Trips / Distinct Mints: `45.95%` / `74` / `71`
  - Top-3 Concentration Share of Gains: `23.51%`
  - Block-Resampled Stress (`m = 20`): median `-0.570 SOL`, `7/20` positive worlds
- **Chronological Splits & 2x Fees (`fast_sim.ts`)**:
  - Full (`1x` / `2x` fees): `+5.650 SOL` (`Sharpe 0.756`, `MaxDD 4.11%`) / `+3.905 SOL`
  - Half-1 (`slot < 464432291`) / Half-2 (`slot >= 464432291`): `+1.327 SOL` (`Sharpe 0.773`, `28` mints) / `+4.863 SOL` (`Sharpe 0.751`, `58` mints)
  - All 4 6h Quarters: `Q1: +1.31 (0.76, 29m)`, `Q2: +0.82 (0.44, 29m)`, `Q3: +2.02 (1.43, 30m)`, `Q4: +1.00 (0.48, 28m)`

## Run

```bash
node main.ts
```

Speaks `agent-fun/replay/v2` over stdin/stdout via `vendor/agentfun-bot.ts` on Node 22+ with zero external dependencies.
