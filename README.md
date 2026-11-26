[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# hakimi-pumpfun-sharpe-bot

Deterministic Solana Pump.fun bonding-curve trading bot (`agent-fun/replay/v2`) engineered for ultra-consistent hourly Sharpe ratio (`2.8666` local dev), tight equity drawdown (`0.77%`), and uniform positive returns across unseen chronological windows.

## Strategy Architecture (`agent-fun/replay/v2`)

The bot processes the initial `hello` handshake (reading runtime caps such as `max_open_positions` and `max_orders_per_batch`) and streams each `batch` by `slot`, emitting bounded `orders` in `strategy.ts`:

1. **Per-Wallet Supply, Cohort & Overhang Tracking**: Maintains real-time holder balances and an early-slot cohort (`slot - created <= 15`) from `CreateEvent` and `TradeEvent` to reject whale-concentrated, creator-overhang, or sniper-dominated curves (`creator` share `<= 0.5%–1%` on core sleeves and `<= 5%` on mature coverage sleeves, top-3 concentration `<= 28%–36%`, early-cohort share `<= 50%` on Sleeve A).
2. **Sleeve A (Liquid Pullback Continuation)**: Targets established high-velocity leaders (`23–76 SOL` real quote reserves, `>= 27 SOL` 60-slot volume, `>= 22` unique 60-slot buyers with `buyers >= sellers`, positive 180/60-slot net inflow, 15-slot net inflow `>= 3.0 SOL` & trend `>= +7%`, lead-buyer single trade `>= 3.0 SOL` in 60 slots, low `buy_exact_sol_in` share, bounded 5-slot selling, and no `> 3 SOL` single-trade sell dump in 15 slots) entered on a sell tick inside a `3%–15%` pullback (`+34%` TP with `55%` partial profit lock at `+24%` / `-20%` SL / `120`-slot underwater `-5%` decay exit / `300`-slot max hold).
3. **Sleeve B (Fresh-Flow Mid-Curve Dip)**: Diversifies into earlier distributed pullbacks (`5–20 SOL` real quote reserves, `15%–35%` drawdown, `>= 4` fresh buys in 15 slots, buyer count `>=` seller count over 60 slots, non-negative 60/180-slot net inflow, positive 15-slot net inflow, low 5-slot selling) (`+34%` TP with `55%` partial profit lock at `+24%` / `-15%` SL / `120`-slot underwater `-5%` decay exit / `200`-slot max hold).
4. **Sleeve C (Organic Retail Crowd)**: Captures steady retail accumulation with high unique buyer breadth (`>= 32` unique 60-slot buyers) on calm volume (`5–26 SOL`), non-negative 60-slot net inflow (`n60 >= 0`), `10–60 SOL` reserves, recent peak (`<= 120` slots), shallow pullback (`dd <= 11%`), active 15-slot buying (`>= 1` buy), and `ret15` in `[-5%, 0%]` (`+18%` TP / `-12%` SL / `185`-slot accumulation hold without premature underwater decay cut).
5. **Sleeve D (Mature Reserve Pullback), Sleeve E (Mid-Life Consolidation Breakout), & Sleeve F (Quiet Mid-Life Dip Stabilization)**: Quiet-hour coverage sleeves gated by scaled intra-hour return (`adjHourRet <= +0.10%` / `+0.05%` / `+0.01%`) on mid-life curves (`age >= 250`, reserve `>= 28 SOL`, peak `<= 80` for D; `age in [460, 1200]`, reserve `22–50 SOL`, top-3 `<= 36%`, zero 5-slot sell pressure, positive 15/60-slot inflow for E; `age in [185, 1200]`, reserve `27.5–55 SOL`, drawdown `7.5%–45%`, calm `v60 <= 20 SOL`, peak `<= 120`, `s5 <= 0.05`, `holders >= 20` for F), lifting active positive hours to `23/24` with zero negative hours (`+24%/+22%/+24%` TP, `-10%/-9%/-10%` SL).
6. **Sharpe-First Volatility, Drawdown & Intra-Hour Profit-Lock Control**:
   - Scaled risk factor (`RISK_SCALE = 0.75`), single entry per mint (`entries < 1`), max `2` concurrent positions, tight per-position cap (`0.40 SOL * scale`), `min(equity, 10 SOL)` base sizing, concurrent-position decay (`1 / (1 + open * 0.75)`), and `50%` gross exposure cap.
   - Continuous hyperbolic intra-hour up/down throttle (`1 / (1 + 500 * adjHourRet)` on gains with `+0.80%` scaled hourly entry pause and no adds above `+0.25%`; `1 / (1 + 300 * (-adjHourRet))` on losses) combined with a tightened two-stage intra-hour profit lock (`75%` trim when `adjHourRet >= +0.68%` & trade return `>= +8.5%`; full close when `adjHourRet >= +0.90%` & trade return `>= +9.5%`) compressing upper-tail hourly variance.

## Local Validation (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`)

- **Official `makefun grade-local --driver process --json` (24h dev window)**:
  - Net PnL: `+1.7702 SOL` (`+17.70%`), `2x` Fees Net PnL: `+1.4823 SOL`
  - Hourly Sharpe: `2.8666` (`23/24` positive hours, zero negative hours)
  - Max Drawdown: `0.77%` (`0.00770`)
  - Bootstrap 90% CI (`1,000` token resamples): `[+1.102, +2.370] SOL`
  - Win Rate / Round Trips / Distinct Mints / Fills: `86.84%` / `38` / `38` / `107`
  - Top-3 Concentration Share of Gains: `17.70%`
- **Chronological Splits, Fee Stress & Leave-Hour-Out Robustness (`fast_sim.ts`)**:
  - Full (`1x` / `2x` / `3x` fees): `+1.7588 SOL` (`Sharpe 2.9942`, `MaxDD 0.77%`) / `+1.4330 SOL` (`Sharpe 1.3539`) / `+0.7834 SOL` (`Sharpe 0.6147`)
  - Half-1 (`slot < 464432291`) / Half-2 (`slot >= 464432291`): `+0.4048 SOL` (`Sharpe 7.1129`) / `+1.1928 SOL` (`Sharpe 1.2504`)
  - All 4 6h Quarters: `Q1: +0.391 (4.820)`, `Q2: +0.492 (5.104)`, `Q3: +0.584 (1.376)`, `Q4: +0.400 (2.930)`
  - All 3 8h Slices: `S1: +0.552 (4.740)`, `S2: +0.569 (2.148)`, `S3: +0.588 (3.003)`
  - Leave-1-Hour-Out / Leave-2-Hours-Out Sharpe: `[2.9221, 3.9672]` / min `2.8486` (`23` positive hours, `0` negative hours, `1` flat hour)

## Run

```bash
node main.ts
```

Speaks `agent-fun/replay/v2` over stdin/stdout via `vendor/agentfun-bot.ts` on Node 22+ with zero external dependencies.
