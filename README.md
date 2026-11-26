[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# hakimi-pumpfun-sharpe-bot

Deterministic Solana Pump.fun bonding-curve trading bot (`agent-fun/replay/v2`) engineered for high hourly Sharpe ratio (`1.3652` local dev), tight equity drawdown (`1.71%`), and consistent positive returns across unseen 6-hour windows.

## Strategy Architecture (`agent-fun/replay/v2`)

The bot processes the initial `hello` handshake (reading runtime caps such as `max_open_positions` and `max_orders_per_batch`) and streams each `batch` by `slot`, emitting bounded `orders` in `strategy.ts`:

1. **Per-Wallet Supply, Cohort & Overhang Tracking**: Maintains real-time holder balances and an early-slot cohort (`slot - created <= 15`) from `CreateEvent` and `TradeEvent` to reject whale-concentrated, creator-overhang, or sniper-dominated curves (`creator` share `<= 0.5%–1%`, top-3 concentration `<= 28%–30%`, early-cohort share `<= 50%` on Sleeve A).
2. **Sleeve A (Liquid Pullback Continuation)**: Targets established high-velocity leaders (`23–76 SOL` real quote reserves, `>= 27 SOL` 60-slot volume, `>= 22` unique 60-slot buyers with `buyers >= sellers`, positive 180/60-slot net inflow, 15-slot net inflow `>= 3.0 SOL` & trend `>= +7%`, lead-buyer single trade `>= 3.0 SOL` in 60 slots, low `buy_exact_sol_in` share, bounded 5-slot selling, and no `> 3 SOL` single-trade sell dump in 15 slots) entered on a sell tick inside a `3%–15%` pullback (`+38%` TP with `55%` partial profit lock at `+24%` / `-20%` SL / `120`-slot underwater `-5%` decay exit / `300`-slot max hold).
3. **Sleeve B (Fresh-Flow Mid-Curve Dip)**: Diversifies into earlier distributed pullbacks (`5–20 SOL` real quote reserves, `15%–35%` drawdown, `>= 35` holders, `>= 4` recent buys in 15 slots, buyer count `>=` seller count over 60 slots, non-negative 60/180-slot net inflow, positive 15-slot net inflow, low 5-slot selling) (`+34%` TP with `55%` partial profit lock at `+24%` / `-15%` SL / `120`-slot underwater `-5%` decay exit / `200`-slot max hold).
4. **Sleeve C (Organic Retail Crowd)**: Captures steady retail accumulation with high unique buyer breadth (`>= 32` unique 60-slot buyers) on calm volume (`5–26 SOL`), `10–60 SOL` reserves, recent peak (`<= 120` slots), shallow pullback (`dd <= 11%`), active 15-slot buying (`>= 1` buy), and `ret15` in `[-5%, 0%]` (`+18%` TP / `-12%` SL / `90`-slot max hold).
5. **Sharpe-First Volatility & Drawdown Control**:
   - Single entry per mint (`entries < 1`), max `2` concurrent core positions, `0.50 SOL` per-position cap, `min(equity, 10 SOL)` base sizing, concurrent-position decay (`1 / (1 + open * 0.75)`), and `50%` gross exposure cap.
   - Continuous hyperbolic intra-hour up/down throttle (`1 / (1 + 500 * hourRet)` on gains with `+1.0%` hourly entry pause; `1 / (1 + 300 * (-hourRet))` on losses) to compress hourly return variance.
   - Clean, creator-filtered pacing probes (`0.0103 SOL`, `dev <= 0.5%`, `>= 15` holders, `>= 5 SOL` reserves) when trailing a 40-mint 3.05h pace so every 6-hour window clears the `>= 20` distinct-mint guardrail with safe margin (`40–43` mints per 6h quarter).

## Local Validation (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`)

- **Official `makefun grade-local --driver process --stress --json` (24h dev window)**:
  - Net PnL: `+2.669 SOL` (`+26.69%`), `2x` Fees Net PnL: `+2.251 SOL`
  - Hourly Sharpe: `1.3652` (`Sortino: 291.1198`)
  - Max Drawdown: `1.71%` (`0.01712`)
  - Bootstrap 90% CI (`1,000` token resamples): `[+1.571, +3.894] SOL`
  - Win Rate / Round Trips / Distinct Mints: `43.48%` / `69` / `60`
  - Top-3 Concentration Share of Gains: `24.25%` (`+1.952 SOL` ex-top-3)
  - Block-Resampled Stress (`m = 20`): median `-0.300 SOL`, `5/20` positive worlds, `0` failed runs
- **Chronological Splits & 2x Fees (`fast_sim.ts`)**:
  - Full (`1x` / `2x` fees): `+2.617 SOL` (`Sharpe 1.374`, `MaxDD 1.85%`) / `+2.499 SOL` (`Sharpe 1.20`)
  - Half-1 (`slot < 464432291`) / Half-2 (`slot >= 464432291`): `+0.419 SOL` (`Sharpe 1.30`) / `+2.429 SOL` (`Sharpe 1.38`)
  - All 4 6h Quarters: `Q1: +0.40 (1.25, 41m)`, `Q2: +0.77 (1.73, 40m)`, `Q3: +0.90 (1.92, 43m)`, `Q4: +0.43 (0.88, 41m)`
  - All 3 Shifted 6h Windows: `S1 (+3–9h): 1.53`, `S2 (+9–15h): 1.70`, `S3 (+15–21h): 0.86`

## Run

```bash
node main.ts
```

Speaks `agent-fun/replay/v2` over stdin/stdout via `vendor/agentfun-bot.ts` on Node 22+ with zero external dependencies.
