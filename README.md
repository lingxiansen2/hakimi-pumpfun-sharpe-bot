[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/lingxiansen2/hakimi-pumpfun-sharpe-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# hakimi-pumpfun-sharpe-bot

Deterministic Solana Pump.fun bonding-curve trading bot (`agent-fun/replay/v2`) engineered for ultra-consistent hourly Sharpe ratio (`5.4840` local dev), `24/24` positive hours, tight equity drawdown (`0.49%`), and consistent returns across unseen replay windows.

## Strategy Architecture (`agent-fun/replay/v2`)

The bot processes the initial `hello` handshake (reading runtime caps such as `max_open_positions` and `max_orders_per_batch`) and streams each `batch` by `slot`, emitting bounded `orders` in `strategy.ts`:

1. **Per-Wallet Supply, Cohort & Overhang Tracking**: Maintains real-time holder balances and an early-slot cohort (`slot - created <= 15`) from `CreateEvent` and `TradeEvent` to reject whale-concentrated, creator-overhang, or sniper-dominated curves (`creator` share `<= 0.5%–1%` on core sleeves and `<= 5%` on quiet coverage sleeves, top-3 concentration `<= 28%–55%`, early-cohort share `<= 50%` on Sleeve A).
2. **Sleeve A (Liquid Pullback Continuation)**: Targets established high-velocity leaders (`23–76 SOL` real quote reserves, `>= 27 SOL` 60-slot volume, `>= 22` unique 60-slot buyers with `buyers >= sellers`, positive 180/60-slot net inflow, 15-slot net inflow `>= 3.0 SOL` & trend `>= +7%`, lead-buyer single trade `>= 3.0 SOL` in 60 slots, low `buy_exact_sol_in` share, bounded 5-slot selling, and no `> 3 SOL` single-trade sell dump in 15 slots) entered on a sell tick inside a `3%–15%` pullback (`+34%` TP with `60%` partial profit lock at `+16%` / `-20%` SL / `120`-slot underwater `-5%` decay exit / `300`-slot max hold).
3. **Sleeve B (Fresh-Flow Mid-Curve Dip)**: Diversifies into earlier distributed pullbacks (`5–20 SOL` real quote reserves, `15%–35%` drawdown, `>= 4` fresh buys in 15 slots, buyer count `>=` seller count over 60 slots, non-negative 60/180-slot net inflow, positive 15-slot net inflow, low 5-slot selling) (`+34%` TP with `60%` partial profit lock at `+16%` / `-15%` SL / `120`-slot underwater `-5%` decay exit / `200`-slot max hold).
4. **Sleeve C (Organic Retail Crowd)**: Captures steady retail accumulation with high unique buyer breadth (`>= 32` unique 60-slot buyers) on calm volume (`5–26 SOL`), non-negative 60-slot net inflow (`n60 >= 0`), `10–60 SOL` reserves, recent peak (`<= 120` slots), shallow pullback (`dd <= 11%`), active 15-slot buying (`>= 1` buy), and `ret15` in `[-5%, 0%]` (`+18%` TP with `+16%` partial / `-13.5%` SL / `185`-slot accumulation hold without premature underwater decay cut).
5. **Quiet-Hour Coverage Sleeves (D, E, F, G)**:
   - **Sleeve D & E** (`adjHourRet <= +0.10%` / `+0.05%`): mature distributed curves (`age >= 250`, reserve `>= 28 SOL`, peak `<= 80` for D; `age in [460, 1200]`, reserve `22–50 SOL`, top-3 `<= 36%`, zero 5-slot sell pressure, positive 15/60-slot inflow for E).
   - **Sleeve F** (`adjHourRet <= +0.01%`): mid-life calm consolidation dips (`age in [185, 1200]`, reserve `27.5–55 SOL`, drawdown `7.5%–45%`, `v60 <= 20 SOL`, peak `<= 120`, `s5 <= 0.05`, `holders >= 20`, `+24%` TP / `-10%` SL).
   - **Sleeve G** (`adjHourRet <= +0.01%`): fresh-peak distributed dips (`12–22 SOL` reserve, `14%–25%` drawdown, `4–15` buys in 15 slots, `pkAge <= 20`, `n60 >= 12 SOL`, `v60 <= 40 SOL`, `ret15 <= -2%`, `>= 22` unique 60-slot buyers with `buyers >= 1.8x` sellers, `dev <= 5%`, `top3 <= 55%`, `+22%` TP / `-13%` SL / `120`-slot max hold), lifting active positive hours to `24/24` with zero negative or flat hours.
6. **Sharpe-First Volatility, Drawdown & Intra-Hour Profit-Lock Control**:
   - Scaled risk factor (`RISK_SCALE = 0.62`), single entry per mint (`entries < 1`), max `2` concurrent positions, tight per-position cap (`0.29 SOL * scale`), `min(equity, 10 SOL)` base sizing, concurrent-position decay (`1 / (1 + open * 0.75)`), and `50%` gross exposure cap.
   - Universal `+16%` (`60%` trim) partial profit lock across all seven sleeves, continuous hyperbolic intra-hour up/down throttle (`1 / (1 + 500 * adjHourRet)` on gains with `+0.51%` scaled hourly entry pause and no adds above `+0.25%`; `1 / (1 + 300 * (-adjHourRet))` on losses), and two-stage intra-hour profit lock (`75%` trim when `adjHourRet >= +0.47%` & trade return `>= +6.0%`; full close when `adjHourRet >= +0.63%` & trade return `>= +7.0%`) compressing upper-tail hourly variance.

## Local Validation (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`)

- **Official `makefun grade-local --driver process --json` (24h dev window)**:
  - Net PnL: `+1.0590 SOL` (`+10.59%`), `2x` Fees Net PnL: `+0.8699 SOL`
  - Hourly Sharpe: `5.4840` (`24/24` positive hours, zero negative hours)
  - Max Drawdown: `0.49%` (`0.00492`)
  - Win Rate / Round Trips / Distinct Mints / Fills: `89.19%` / `37` / `37` / `98`
  - `constraints.compliant = true`
- **Chronological Splits, Fee Stress, Unseen Replays & Leave-Hour-Out Robustness (`fast_sim.ts`)**:
  - Full (`1x` / `2x` / `3x` fees): `+1.0508 SOL` (`Sharpe 6.0370`, `MaxDD 0.493%`) / `+0.9928 SOL` (`Sharpe 3.5291`) / `+0.5951 SOL` (`Sharpe 0.7434`)
  - Half-1 (`slot < 464432291`) / Half-2 (`slot >= 464432291`): `+0.2589 SOL` (`Sharpe 7.8293`) / `+0.7206 SOL` (`Sharpe 1.2651`)
  - All 4 6h Quarters: `Q1: +0.259 (7.829)`, `Q2: +0.265 (5.307)`, `Q3: +0.251 (6.533)`, `Q4: +0.259 (4.401)`
  - All 3 8h Slices: `S1: +0.339 (8.546)`, `S2: +0.355 (5.194)`, `S3: +0.347 (5.201)`
  - Unseen Local Replay Kits: `u-boothlord +1.0358 SOL (Sharpe 5.6777)`, `u-jackxyz72-replay +1.0449 SOL (Sharpe 6.0625)`, `u-riidzhsn +1.0694 SOL (Sharpe 4.6464)`
  - Leave-1-Hour-Out / Leave-2-Hours-Out Sharpe: `[5.9010, 6.8068]` / min `5.7621` (`24/24` positive hours, `0` negative hours, `0` flat hours)

## Run

```bash
node main.ts
```

Speaks `agent-fun/replay/v2` over stdin/stdout via `vendor/agentfun-bot.ts` on Node 22+ with zero external dependencies.
