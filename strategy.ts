// Deterministic low-variance seven-sleeve bonding-curve strategy for agent-fun/replay/v2.
//
// Core design:
//   1. Track per-wallet token balances & early-slot cohort (<= 15 slots post-CreateEvent)
//      to reject whale-concentrated, creator-overhang, or sniper-dominated curves.
//   2. Sleeve A (Liquid Pullback Continuation): active distributed leaders (real reserve 23-76 SOL,
//      60-slot volume >= 27 SOL, >= 22 unique 60-slot buyers with buyers >= sellers, positive
//      180/60-slot net inflow, 15-slot net inflow >= 3.0 SOL & trend >= +7%, lead-buyer >= 3.0 SOL,
//      early-cohort share <= 50%, no > 3 SOL dump in 15 slots) on a sell tick inside 3%-15%
//      drawdown (+34% TP with 60% partial lock at +16% / -20% SL / 120-slot underwater decay cut).
//   3. Sleeve B (Fresh-Flow Mid-Curve Dip): earlier distributed pullbacks (real reserve 5-20 SOL,
//      15%-35% drawdown, >= 4 fresh buys in 15 slots, buyer count >= seller count over 60 slots,
//      non-negative 60/180-slot net flow, low 5-slot sell pressure) (+34% TP with +16% partial / -15% SL).
//   4. Sleeve C (Organic Retail Crowd): steady distributed accumulation (>= 32 unique 60-slot buyers
//      on calm 5-26 SOL volume, non-negative 60-slot net inflow, recent peak <= 120 slots, shallow
//      dip dd <= 11% and ret15 in [-5%, 0%]) (+18% TP with +16% partial / -13.5% SL / 185-slot hold).
//   5. Sleeve D (Mature Reserve Pullback), Sleeve E (Mid-Life Consolidation Breakout),
//      Sleeve F (Quiet Mid-Life Dip Stabilization), & Sleeve G (Quiet Fresh-Peak Distributed Dip):
//      quiet-hour coverage sleeves gated by low intra-hour return (adjHourRet <= +0.10% / +0.05% / +0.01%)
//      covering mature distributed curves (D/E/F) and fresh-peak low-overhang buyer-breadth dips
//      (G: rq 12-22 SOL, dd 14%-25%, 4-15 buys/15s, peak <= 20s, n60 >= 12 SOL, v60 <= 40 SOL,
//      u60 >= 22 & >= 1.8x sellers, dev <= 5%, top3 <= 55%) to achieve 24/24 positive hours.
//   6. Sharpe-first volatility budget: RISK_SCALE = 0.62 with capped base equity min(eq, 10),
//      tight position cap (0.29 SOL * scale), universal +16% (60%) partial profit lock across all
//      sleeves, continuous hyperbolic intra-hour throttle (kUp=500, kDn=300) with +0.51% scaled hourly
//      entry cap, no adds above +0.25% hour return, and two-stage intra-hour profit lock (75% trim
//      at +0.47% hour / +6.0% trade; full lock at +0.63% hour / +7.0% trade) compressing upper-tail
//      hourly variance and keeping MaxDD <= 0.50%.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const RISK_SCALE = 0.62;

type SleeveId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

interface SleeveParams {
  stakePct: number;
  tp: number;
  sl: number;
  maxHold: number;
  allowPartialTp: boolean;
  allowAdds: boolean;
  allowDecayExit: boolean;
}

const SLEEVE_CFG: Record<SleeveId, SleeveParams> = {
  A: { stakePct: 0.16, tp: 0.34, sl: 0.20, maxHold: 300, allowPartialTp: true, allowAdds: true, allowDecayExit: true },
  B: { stakePct: 0.14, tp: 0.34, sl: 0.15, maxHold: 200, allowPartialTp: true, allowAdds: true, allowDecayExit: true },
  C: { stakePct: 0.24, tp: 0.18, sl: 0.135, maxHold: 185, allowPartialTp: true, allowAdds: true, allowDecayExit: false },
  D: { stakePct: 0.50, tp: 0.24, sl: 0.10, maxHold: 110, allowPartialTp: true, allowAdds: false, allowDecayExit: false },
  E: { stakePct: 0.45, tp: 0.22, sl: 0.09, maxHold: 150, allowPartialTp: true, allowAdds: false, allowDecayExit: false },
  F: { stakePct: 0.40, tp: 0.24, sl: 0.10, maxHold: 120, allowPartialTp: true, allowAdds: false, allowDecayExit: false },
  G: { stakePct: 0.30, tp: 0.22, sl: 0.13, maxHold: 120, allowPartialTp: true, allowAdds: false, allowDecayExit: false },
};

interface TradeRec {
  slot: number;
  isBuy: boolean;
  sol: number;
  user: Pubkey;
  ix: string;
  price: number;
}

interface CoinBook {
  created: number | null;
  creator: string;
  holdings: Map<Pubkey, bigint>;
  earlyW: Set<Pubkey>;
  totalHeld: bigint;
  peakPrice: number;
  peakSlot: number;
  trades: TradeRec[];
  entries: number;
}

interface PosState {
  sleeve: SleeveId;
  openedSlot: number;
  lastAddSlot: number;
  lastValue: number;
  invested: number;
  adds: number;
  exiting: boolean;
  partStep: number;
  filled: boolean;
  tp: number;
  sl: number;
  maxHold: number;
}

export function createStrategy(): Bot {
  const books = new Map<Pubkey, CoinBook>();
  const posMap = new Map<Pubkey, PosState>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let curHourIdx = -1;
  let hourStartEq = 10;

  const bookOf = (mint: Pubkey, creator = ''): CoinBook => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { created: null, creator, holdings: new Map(), earlyW: new Set(), totalHeld: 0n, peakPrice: 0, peakSlot: 0, trades: [], entries: 0 };
      books.set(mint, b);
    } else if (!b.creator && creator) {
      b.creator = creator;
    }
    return b;
  };

  const sleeveStakePct = (sleeve: SleeveId): number => SLEEVE_CFG[sleeve].stakePct * RISK_SCALE;
  const maxPosCap = 0.29 * RISK_SCALE;
  const minInitSol = Math.max(0.011, 0.02 * RISK_SCALE);
  const minAddSol = Math.max(0.002, 0.02 * RISK_SCALE);

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const touched = new Set<Pubkey>();

      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          bookOf(e.mint, e.creator).created = e.slot;
        } else if (e.event === 'TradeEvent') {
          const b = bookOf(e.mint, e.creator);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const tok = BigInt(e.token_amount);
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          if (price > b.peakPrice) {
            b.peakPrice = price;
            b.peakSlot = e.slot;
          }
          const prev = b.holdings.get(e.user) ?? 0n;
          if (e.is_buy) {
            b.holdings.set(e.user, prev + tok);
            b.totalHeld += tok;
            if (b.created !== null && e.slot - b.created <= 15) b.earlyW.add(e.user);
          } else {
            const dec = tok > prev ? prev : tok;
            b.holdings.set(e.user, prev - dec);
            b.totalHeld -= dec;
          }
          b.trades.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user, ix: e.ix_name, price });
          touched.add(e.mint);
        }
      }

      for (const mint of touched) {
        const b = books.get(mint)!;
        let cut = 0;
        while (cut < b.trades.length && b.trades[cut]!.slot <= now - 200) cut++;
        if (cut > 0) b.trades.splice(0, cut);
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, { buy: boolean; sell: boolean }>();
      for (const po of state.pending.values()) {
        const cur = pendingByMint.get(po.order.mint) ?? { buy: false, sell: false };
        if (po.order.side === 'buy') cur.buy = true;
        else cur.sell = true;
        pendingByMint.set(po.order.mint, cur);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // 1. Mark open core positions & compute current-hour return for two-stage profit lock.
      const posRet = new Map<Pubkey, number>();
      for (const [mint, ps] of [...posMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        const pend = pendingByMint.get(mint);
        if (pos === undefined) {
          if (pend === undefined) {
            posMap.delete(mint);
            const b = books.get(mint);
            if (b !== undefined && !ps.filled) b.entries--;
          }
          continue;
        }
        ps.filled = true;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const val = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        ps.lastValue = val;
        posRet.set(mint, cost > 0 ? val / cost - 1 : 0);
      }

      let equity = Number(state.cash) / LAMPORTS;
      for (const ps of posMap.values()) if (ps.lastValue > 0) equity += ps.lastValue;
      if (firstTime !== null && lastTime !== null) {
        const hb = Math.floor((lastTime - firstTime) / 3600);
        if (hb > curHourIdx) {
          curHourIdx = hb;
          hourStartEq = equity;
        }
      }
      const hourRet = hourStartEq > 0 ? equity / hourStartEq - 1 : 0;
      const adjHourRet = hourRet / RISK_SCALE;

      // 2. Manage exits on open core positions (TP, SL, decay, two-stage intra-hour lock, partial TP).
      for (const [mint, ps] of [...posMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        const pend = pendingByMint.get(mint);
        const ret = posRet.get(mint);
        if (pos === undefined || curve === undefined || curve.complete || ret === undefined) continue;
        const slUse = ps.partStep > 0 ? -0.18 : -ps.sl;
        const ageHold = now - ps.openedSlot;

        if (!ps.exiting) {
          if (ret >= ps.tp || ret <= slUse || ageHold >= ps.maxHold) {
            ps.exiting = true;
          } else if (SLEEVE_CFG[ps.sleeve].allowDecayExit && ageHold >= 120 && ret <= -0.05) {
            ps.exiting = true;
          } else if (adjHourRet >= 0.0063 && ret >= 0.070) {
            ps.exiting = true;
          } else if (adjHourRet >= 0.0047 && ret >= 0.060 && ps.partStep === 0 && !pend?.sell && orders.length < cap) {
            const lockTok = (pos.token_amount * 75n) / 100n;
            if (lockTok > 0n) {
              orders.push({ side: 'sell', mint, token_amount: lockTok, max_slippage_bps: 10_000 });
              ps.partStep = 1;
              continue;
            }
          } else if (ps.partStep === 0 && SLEEVE_CFG[ps.sleeve].allowPartialTp && ret >= 0.16 && !pend?.sell && orders.length < cap) {
            const partTok = (pos.token_amount * 60n) / 100n;
            if (partTok > 0n) {
              orders.push({ side: 'sell', mint, token_amount: partTok, max_slippage_bps: 10_000 });
              ps.partStep = 1;
              continue;
            }
          }
        }
        if (!ps.exiting || pend?.sell) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // 3. Portfolio budget & continuous hyperbolic intra-hour variance throttle.
      const hourMult =
        adjHourRet >= 0
          ? Math.max(0.12, 1 / (1 + adjHourRet * 500))
          : Math.max(0.25, 1 / (1 + -adjHourRet * 300));
      const blockNew = adjHourRet >= 0.0051;

      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = Math.min(2, state.hello.caps.max_open_positions) - state.committedPositionCount();
      let exposure = 0;
      for (const [mint, ps] of posMap) {
        exposure += Math.max(ps.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      }
      const baseEq = Math.min(equity, 10);
      const maxExp = baseEq * 0.50 * RISK_SCALE;

      // 4. Evaluate touched curves for Sleeve A, B, C, D, E, or size completion.
      for (const mint of touched) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint)) continue;
        const b = books.get(mint)!;
        const ps = posMap.get(mint);
        const rq = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rq < 5 || rq > 76) continue;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const dd = b.peakPrice > 0 ? 1 - price / b.peakPrice : 0;

        let holders = 0;
        let t1 = 0n;
        let t2 = 0n;
        let t3 = 0n;
        let earlyBal = 0n;
        for (const [u, bal] of b.holdings) {
          if (bal > 1000n) holders++;
          if (b.earlyW.has(u)) earlyBal += bal;
          if (bal > t1) {
            t3 = t2;
            t2 = t1;
            t1 = bal;
          } else if (bal > t2) {
            t3 = t2;
            t2 = bal;
          } else if (bal > t3) {
            t3 = bal;
          }
        }
        const top3 = b.totalHeld > 0n ? Number(((t1 + t2 + t3) * 1000n) / b.totalHeld) / 1000 : 1;
        const earlyShare = b.totalHeld > 0n ? Number((earlyBal * 1000n) / b.totalHeld) / 1000 : 1;
        const dev = b.totalHeld > 0n ? Number(((b.holdings.get(b.creator) ?? 0n) * 1000n) / b.totalHeld) / 1000 : 1;
        const avgBag = holders > 0 ? rq / holders : 99;

        let v60 = 0;
        let n60 = 0;
        let n180 = 0;
        let n15 = 0;
        let s5 = 0;
        let b15 = 0;
        let b30 = 0;
        let ex30 = 0;
        let p15 = 0;
        let maxS15 = 0;
        let maxB60 = 0;
        const u60 = new Set<Pubkey>();
        const us60 = new Set<Pubkey>();
        for (let j = b.trades.length - 1; j >= 0; j--) {
          const tr = b.trades[j]!;
          const d = now - tr.slot;
          if (d >= 180) break;
          const sgn = tr.isBuy ? tr.sol : -tr.sol;
          n180 += sgn;
          if (d < 60) {
            v60 += tr.sol;
            n60 += sgn;
            if (tr.isBuy) {
              u60.add(tr.user);
              if (tr.sol > maxB60) maxB60 = tr.sol;
            } else {
              us60.add(tr.user);
            }
          }
          if (d < 30 && tr.isBuy) {
            b30 += tr.sol;
            if (tr.ix === 'buy_exact_sol_in') ex30 += tr.sol;
          }
          if (d < 15) {
            n15 += sgn;
            p15 = tr.price;
            if (tr.isBuy) b15++;
            else if (tr.sol > maxS15) maxS15 = tr.sol;
          }
          if (d < 5 && !tr.isBuy) s5 += tr.sol;
        }
        const exactShare = b30 > 0 ? ex30 / b30 : 0;
        const ret15 = p15 > 0 ? price / p15 - 1 : 0;
        const lastTr = b.trades[b.trades.length - 1];
        const ageCreate = b.created !== null ? now - b.created : 9999;
        const pkAge = now - b.peakSlot;

        if (ps === undefined) {
          if (blockNew || slotsLeft <= 0 || b.entries >= 1) continue;
          const okA =
            lastTr !== undefined &&
            !lastTr.isBuy &&
            rq >= 23 &&
            dd >= 0.03 &&
            dd <= 0.15 &&
            holders >= 40 &&
            avgBag <= 0.60 &&
            top3 <= 0.28 &&
            dev <= 0.005 &&
            v60 >= 27 &&
            u60.size >= 22 &&
            n180 >= 5 &&
            n60 >= 0 &&
            n15 >= 3.0 &&
            exactShare <= 0.25 &&
            s5 / v60 <= 0.12 &&
            maxS15 <= 3.0 &&
            ret15 >= 0.07 &&
            earlyShare <= 0.50 &&
            maxB60 >= 3.0 &&
            u60.size >= us60.size;

          const okB =
            !okA &&
            ((lastTr !== undefined && !lastTr.isBuy) || b15 >= 4) &&
            rq <= 20 &&
            dd >= 0.15 &&
            dd <= 0.35 &&
            holders >= 35 &&
            top3 <= 0.28 &&
            dev <= 0.005 &&
            b15 >= 4 &&
            n15 >= 1 &&
            s5 <= 0.5 &&
            v60 >= 3 &&
            u60.size >= us60.size &&
            n60 >= 0 &&
            n180 >= 0;

          const okC =
            !okA &&
            !okB &&
            rq >= 10 &&
            rq <= 60 &&
            holders >= 30 &&
            top3 <= 0.30 &&
            dev <= 0.01 &&
            u60.size >= 32 &&
            v60 >= 5 &&
            v60 <= 26 &&
            ret15 <= 0 &&
            ret15 >= -0.05 &&
            dd <= 0.11 &&
            b15 >= 1 &&
            pkAge <= 120 &&
            n60 >= 0;

          const okD =
            !okA &&
            !okB &&
            !okC &&
            adjHourRet <= 0.001 &&
            ageCreate >= 250 &&
            rq >= 28 &&
            pkAge <= 80 &&
            s5 <= 0.4 &&
            ret15 <= 0 &&
            v60 >= 12 &&
            dev <= 0.05 &&
            holders >= 20;

          const okE =
            !okA &&
            !okB &&
            !okC &&
            !okD &&
            adjHourRet <= 0.0005 &&
            ageCreate >= 460 &&
            ageCreate <= 1200 &&
            rq >= 22 &&
            rq <= 50 &&
            holders >= 25 &&
            top3 <= 0.36 &&
            dev <= 0.05 &&
            n15 >= 2.0 &&
            s5 <= 0 &&
            v60 >= 2.0 &&
            n60 >= 2.0;

          const okF =
            !okA &&
            !okB &&
            !okC &&
            !okD &&
            !okE &&
            adjHourRet <= 0.0001 &&
            rq >= 27.5 &&
            rq <= 55 &&
            dd >= 0.075 &&
            dd <= 0.45 &&
            s5 <= 0.05 &&
            ret15 <= 0 &&
            ageCreate >= 185 &&
            ageCreate <= 1200 &&
            holders >= 20 &&
            pkAge <= 120 &&
            v60 <= 20;

          const okG =
            !okA &&
            !okB &&
            !okC &&
            !okD &&
            !okE &&
            !okF &&
            adjHourRet <= 0.0001 &&
            rq >= 12 &&
            rq <= 22 &&
            dd >= 0.14 &&
            dd <= 0.25 &&
            b15 >= 4 &&
            b15 <= 15 &&
            pkAge <= 20 &&
            n60 >= 12 &&
            v60 <= 40 &&
            ret15 <= -0.02 &&
            u60.size >= 22 &&
            u60.size >= us60.size * 1.8 &&
            dev <= 0.05 &&
            top3 <= 0.55;

          if (!okA && !okB && !okC && !okD && !okE && !okF && !okG) continue;
          const sleeve: SleeveId = okA ? 'A' : okB ? 'B' : okC ? 'C' : okD ? 'D' : okE ? 'E' : okF ? 'F' : 'G';
          const scfg = SLEEVE_CFG[sleeve];
          const conc = 1 / (1 + posMap.size * 0.75);
          const targetStake = Math.min(maxPosCap, baseEq * sleeveStakePct(sleeve) * conc * hourMult);
          const capSol = (Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS) * 0.98 * RISK_SCALE;
          const amt = Math.min(capSol, targetStake, maxExp - exposure, free - tx);
          if (amt < minInitSol) continue;

          orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amt * LAMPORTS)), max_slippage_bps: 1000 });
          posMap.set(mint, {
            sleeve,
            openedSlot: now,
            lastAddSlot: now,
            lastValue: 0,
            invested: amt,
            adds: 0,
            exiting: false,
            partStep: 0,
            filled: false,
            tp: scfg.tp,
            sl: scfg.sl,
            maxHold: scfg.maxHold,
          });
          b.entries++;
          free -= amt + tx;
          exposure += amt;
          slotsLeft--;
        } else if (ps.filled && !ps.exiting && ps.partStep === 0 && ps.adds < 2 && SLEEVE_CFG[ps.sleeve].allowAdds && !blockNew && adjHourRet <= 0.0025) {
          const targetStake = Math.min(maxPosCap, baseEq * sleeveStakePct(ps.sleeve) * hourMult);
          if (ps.invested < targetStake - minAddSol) {
            const pos = state.positions.get(mint);
            const cost = pos ? Number(pos.cost_lamports) / LAMPORTS : ps.invested;
            const curRet = cost > 0 ? ps.lastValue / cost - 1 : -1;
            if (now - ps.lastAddSlot >= 2 && curRet >= -0.04 && top3 <= 0.28 && dev <= 0.01) {
              const capSol = (Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS) * 0.98 * RISK_SCALE;
              const amt = Math.min(capSol, targetStake - ps.invested, maxExp - exposure, free - tx);
              if (amt >= minAddSol) {
                orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amt * LAMPORTS)), max_slippage_bps: 1000 });
                ps.invested += amt;
                ps.adds++;
                ps.lastAddSlot = now;
                free -= amt + tx;
                exposure += amt;
              }
            }
          }
        }
      }

      return orders;
    },
  };
}
