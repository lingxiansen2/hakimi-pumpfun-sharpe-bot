// Deterministic low-variance dual-sleeve bonding-curve strategy for agent-fun/replay/v2.
//
// Core design:
//   1. Track per-wallet token balances from CreateEvent/TradeEvent to reject whale-concentrated
//      or creator-overhang curves (creator share <= 0.5%, top-3 concentration <= 28%, >= 40 holders).
//   2. Sleeve A (Liquid Pullback Continuation): enters active distributed leaders (real reserve
//      15-76 SOL, 60-slot volume >= 27 SOL, >= 22 unique 60-slot buyers, positive 60/180/15-slot net
//      inflow, low exact-SOL bot share) on a sell tick inside a 3%-15% drawdown (+45% TP / -20% SL).
//   3. Sleeve B (Fresh-Flow Mid-Curve Dip): diversifies into earlier distributed pullbacks (real
//      reserve 5-22 SOL, 15%-35% drawdown, >= 4 fresh buys in 15 slots, low 5-slot sell pressure)
//      with tighter +30% TP / -15% SL / 150-slot timeout so quiet hours stay productive.
//   4. Smooth Sharpe-first risk budget: single entry per mint, equity-capped base sizing (min(eq,10)),
//      concurrent-open-position sizing decay, and clean pacing probes for >= 20 mint guardrails.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface TradeRec {
  slot: number;
  isBuy: boolean;
  sol: number;
  user: Pubkey;
  ix: string;
}

interface CoinBook {
  creator: string;
  holdings: Map<Pubkey, bigint>;
  totalHeld: bigint;
  peakPrice: number;
  trades: TradeRec[];
  entries: number;
}

interface PosState {
  sleeve: 'A' | 'B';
  openedSlot: number;
  lastAddSlot: number;
  lastValue: number;
  invested: number;
  adds: number;
  exiting: boolean;
  filled: boolean;
  tp: number;
  sl: number;
  maxHold: number;
}

export function createStrategy(): Bot {
  const books = new Map<Pubkey, CoinBook>();
  const posMap = new Map<Pubkey, PosState>();
  const probes = new Map<Pubkey, boolean>();
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let curHourIdx = -1;
  let hourStartEq = 10;

  const bookOf = (mint: Pubkey, creator = ''): CoinBook => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { creator, holdings: new Map(), totalHeld: 0n, peakPrice: 0, trades: [], entries: 0 };
      books.set(mint, b);
    } else if (!b.creator && creator) {
      b.creator = creator;
    }
    return b;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const touched = new Set<Pubkey>();

      for (const f of batch.fills) {
        if (f.status === 'filled' && f.side === 'buy' && !f.client_id.startsWith('_')) {
          myCoins.add(f.mint);
        }
      }

      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          bookOf(e.mint, e.creator);
        } else if (e.event === 'TradeEvent') {
          const b = bookOf(e.mint, e.creator);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const tok = BigInt(e.token_amount);
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          if (price > b.peakPrice) b.peakPrice = price;
          const prev = b.holdings.get(e.user) ?? 0n;
          if (e.is_buy) {
            b.holdings.set(e.user, prev + tok);
            b.totalHeld += tok;
          } else {
            const dec = tok > prev ? prev : tok;
            b.holdings.set(e.user, prev - dec);
            b.totalHeld -= dec;
          }
          b.trades.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user, ix: e.ix_name });
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

      // 1. Manage exits on open core positions.
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
        const ret = cost > 0 ? val / cost - 1 : 0;

        if (!ps.exiting && (ret >= ps.tp || ret <= -ps.sl || now - ps.openedSlot >= ps.maxHold)) {
          ps.exiting = true;
        }
        if (!ps.exiting || pend?.sell) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // 2. Close any landed guardrail probe immediately.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // 3. Portfolio budget, hourly variance throttle & sizing.
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
      const hourMult = hourRet >= 0.05 ? 0.5 : 1.0;

      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const [mint, ps] of posMap) {
        exposure += Math.max(ps.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      }
      const baseEq = Math.min(equity, 10);
      const maxExp = baseEq * 0.50;

      // 4. Evaluate touched curves for Sleeve A, Sleeve B, or size completion.
      for (const mint of touched) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
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
        for (const bal of b.holdings.values()) {
          if (bal > 1000n) holders++;
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
        const u60 = new Set<Pubkey>();
        for (let j = b.trades.length - 1; j >= 0; j--) {
          const tr = b.trades[j]!;
          const d = now - tr.slot;
          if (d >= 180) break;
          const sgn = tr.isBuy ? tr.sol : -tr.sol;
          n180 += sgn;
          if (d < 60) {
            v60 += tr.sol;
            n60 += sgn;
            if (tr.isBuy) u60.add(tr.user);
          }
          if (d < 30 && tr.isBuy) {
            b30 += tr.sol;
            if (tr.ix === 'buy_exact_sol_in') ex30 += tr.sol;
          }
          if (d < 15) {
            n15 += sgn;
            if (tr.isBuy) b15++;
          }
          if (d < 5 && !tr.isBuy) s5 += tr.sol;
        }
        const exactShare = b30 > 0 ? ex30 / b30 : 0;
        const lastTr = b.trades[b.trades.length - 1];

        if (ps === undefined) {
          if (slotsLeft <= 0 || b.entries >= 1) continue;
          const okA =
            lastTr !== undefined &&
            !lastTr.isBuy &&
            rq >= 15 &&
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
            n15 >= 0.3 &&
            exactShare <= 0.25 &&
            s5 / v60 <= 0.12;

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
            v60 >= 3;

          if (!okA && !okB) continue;
          const conc = 1 / (1 + posMap.size * 0.75);
          const targetStake = baseEq * (okA ? 0.18 : 0.14) * conc * hourMult;
          const capSol = (Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS) * 0.98;
          const amt = Math.min(capSol, targetStake, maxExp - exposure, free - tx);
          if (amt < 0.02) continue;

          orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amt * LAMPORTS)), max_slippage_bps: 1000 });
          posMap.set(mint, {
            sleeve: okA ? 'A' : 'B',
            openedSlot: now,
            lastAddSlot: now,
            lastValue: 0,
            invested: amt,
            adds: 0,
            exiting: false,
            filled: false,
            tp: okA ? 0.44 : 0.36,
            sl: okA ? 0.20 : 0.15,
            maxHold: okA ? 300 : 200,
          });
          b.entries++;
          free -= amt + tx;
          exposure += amt;
          slotsLeft--;
        } else if (ps.filled && !ps.exiting && ps.adds < 2) {
          const targetStake = baseEq * (ps.sleeve === 'A' ? 0.18 : 0.14) * hourMult;
          if (ps.invested < targetStake - 0.02) {
            const pos = state.positions.get(mint);
            const cost = pos ? Number(pos.cost_lamports) / LAMPORTS : ps.invested;
            const curRet = cost > 0 ? ps.lastValue / cost - 1 : -1;
            if (now - ps.lastAddSlot >= 2 && curRet >= -0.04 && top3 <= 0.28 && dev <= 0.01) {
              const capSol = (Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS) * 0.98;
              const amt = Math.min(capSol, targetStake - ps.invested, maxExp - exposure, free - tx);
              if (amt >= 0.02) {
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

      // 5. Filtered pacing probe only when behind the 24-mint pace for short 6h windows.
      if (probes.size < 1 && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / 18_000);
        if (myCoins.size < Math.ceil(25 * pace)) {
          for (const mint of touched) {
            if (orders.length >= cap || probes.size >= 1) break;
            if (posMap.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint) || myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < 5) continue;
            const b = books.get(mint)!;
            if (b.trades.length < 3 || b.trades[b.trades.length - 1]!.isBuy) continue;
            const dev = b.totalHeld > 0n ? Number(((b.holdings.get(b.creator) ?? 0n) * 1000n) / b.totalHeld) / 1000 : 1;
            if (dev > 0.02) continue;
            const probeSol = 0.011;
            if (free < probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(probeSol * LAMPORTS)), max_slippage_bps: 1000 });
            probes.set(mint, false);
            free -= probeSol + tx;
          }
        }
      }

      return orders;
    },
  };
}
