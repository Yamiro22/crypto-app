/**
 * ============================================================
 * positionManager.js  —  BabyDoge BTC Oracle v3
 * Early-Exit Engine: Take-Profit + Stop-Loss
 * ============================================================
 *
 * PURPOSE:
 *   Runs a continuous 3-second polling loop whenever an open
 *   position (pendingBet) is active.  At each tick it fetches
 *   the live bid price from the CLOB and decides:
 *
 *   TAKE-PROFIT ──  bid ≥ TAKE_PROFIT_PRICE  →  sell immediately
 *   STOP-LOSS   ──  bid ≤ STOP_LOSS_PRICE
 *                   AND MACD crossed against us  →  sell to cut losses
 *   TRAILING    ──  optional: dynamic profit-lock (see below)
 *
 * DESIGN PATTERN:
 *   This module exports a class `PositionManager` that is
 *   instantiated once in App.jsx and reused across trades.
 *   App.jsx calls:
 *     • manager.open(position, callbacks)  — start monitoring
 *     • manager.close()                   — stop monitoring (cleanup)
 *
 * ─────────────────────────────────────────────────────────────
 * THRESHOLD RATIONALE
 * ─────────────────────────────────────────────────────────────
 *
 *  TAKE_PROFIT = 0.85  (85 ¢)
 *    We entered near 50–55 ¢.  A 30 ¢+ gain in a 5-min window
 *    is exceptional.  Locking it in beats riding to expiry.
 *
 *  STOP_LOSS   = 0.15  (15 ¢)
 *    Below 15 ¢ the market is pricing us as nearly dead.
 *    Holding costs more (opportunity cost) than the ~15 ¢
 *    we'd salvage.  MACD confirmation prevents selling on a
 *    brief spike down that could recover.
 *
 *  TRAILING_ACTIVATION = 0.70  (70 ¢)
 *    Once the trade is solidly profitable (>70 ¢) we switch
 *    to a trailing stop that locks in at least 60 ¢.
 *
 *  TRAILING_STEP = 0.05  (5 ¢)
 *    The trailing floor rises in 5 ¢ increments as the bid
 *    continues to climb.
 * ============================================================
 */

import { getTokenBidPrice, sellPosition } from './polymarketApi.js';

// ─────────────────────────────────────────────────────────────
//  THRESHOLD CONSTANTS  (tune these per your risk tolerance)
// ─────────────────────────────────────────────────────────────

/** Sell immediately when bid reaches this (30 ¢+ profit on ~55 ¢ entry) */
const TAKE_PROFIT_PRICE = 0.85;

/** Hard floor — sell if bid collapses here AND MACD confirms reversal */
const STOP_LOSS_PRICE = 0.15;

/**
 * Activate trailing stop once we're comfortably in profit.
 * Below this level we use the hard stop-loss instead.
 */
const TRAILING_ACTIVATION_PRICE = 0.70;

/**
 * Trailing floor starts here when trailing activates.
 * i.e. if bid hits 0.70, we set floor = 0.65.
 */
const TRAILING_FLOOR_OFFSET = 0.05;

/** How often (ms) to poll the bid price */
const POLL_INTERVAL_MS = 3000;

/** Max consecutive fetch failures before we abort the monitor */
const MAX_FETCH_FAILURES = 5;

// ─────────────────────────────────────────────────────────────
//  POSITION MANAGER CLASS
// ─────────────────────────────────────────────────────────────

export class PositionManager {
  constructor() {
    this._timerId       = null;
    this._position      = null;  // { asset_id, tokenQty, entryPrice, direction, usdcSpent }
    this._callbacks     = null;  // { onTakeProfit, onStopLoss, onTick, onError }
    this._trailingFloor = null;  // null = not yet activated
    this._highWaterBid  = 0;     // highest bid seen since entry
    this._failCount     = 0;     // consecutive fetch failures
    this._active        = false;
  }

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────────────────────

  /**
   * Start monitoring an open position.
   *
   * @param {object} position
   *   {
   *     asset_id:   string   — token address returned by buyPosition()
   *     tokenQty:   number   — how many tokens we hold
   *     entryPrice: number   — price we paid (for P&L display)
   *     direction:  'UP'|'DOWN'
   *     usdcSpent:  number   — dollar amount risked
   *   }
   *
   * @param {object} callbacks
   *   {
   *     onTakeProfit(sellReceipt)  — called when TP fires
   *     onStopLoss(sellReceipt)    — called when SL fires
   *     onTick({ bid, pnl, status }) — called every 3s with live data
   *     onError(err)              — called on unrecoverable error
   *     // Optional: inject MACD data for stop-loss confirmation
   *     getMacdSignal()           — returns 'BULLISH'|'BEARISH'|'NEUTRAL'
   *   }
   */
  open(position, callbacks) {
    if (this._active) {
      console.warn('[PositionManager] Already monitoring a position. Call close() first.');
      return;
    }

    if (!position?.asset_id || !position?.tokenQty) {
      throw new Error('[PositionManager] open() requires asset_id and tokenQty');
    }

    this._position      = position;
    this._callbacks     = callbacks;
    this._trailingFloor = null;
    this._highWaterBid  = position.entryPrice ?? 0;
    this._failCount     = 0;
    this._active        = true;

    console.info(
      `[PositionManager] 🟢 Monitoring opened\n` +
      `  Token  : ${position.asset_id.slice(0, 12)}…\n` +
      `  Dir    : ${position.direction}\n` +
      `  Entry  : ${position.entryPrice}\n` +
      `  Qty    : ${position.tokenQty}\n` +
      `  TP     : ${TAKE_PROFIT_PRICE}  SL: ${STOP_LOSS_PRICE}`
    );

    // Run immediately, then on interval
    this._tick();
    this._timerId = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  /**
   * Stop monitoring (call after the position is resolved or on unmount).
   */
  close() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    this._active    = false;
    this._position  = null;
    this._callbacks = null;
    console.info('[PositionManager] 🔴 Monitor closed');
  }

  /** Whether the manager is currently watching a position */
  get isActive() {
    return this._active;
  }

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL — POLL TICK
  // ─────────────────────────────────────────────────────────────

  async _tick() {
    if (!this._active || !this._position) return;

    const { asset_id, tokenQty, entryPrice } = this._position;
    const cb = this._callbacks;

    let bid;
    try {
      bid = await getTokenBidPrice(asset_id);
      this._failCount = 0;
    } catch (err) {
      this._failCount++;
      console.warn(`[PositionManager] Fetch failed (${this._failCount}/${MAX_FETCH_FAILURES}):`, err.message);

      if (this._failCount >= MAX_FETCH_FAILURES) {
        console.error('[PositionManager] Too many failures — closing monitor');
        cb?.onError?.(new Error('Max fetch failures reached'));
        this.close();
      }
      return;
    }

    // ── Update high-water mark ──────────────────────────────
    if (bid > this._highWaterBid) {
      this._highWaterBid = bid;
    }

    // ── Compute live P&L ────────────────────────────────────
    const pnlDollars = (bid - entryPrice) * tokenQty;
    const pnlPct     = entryPrice > 0
      ? (((bid - entryPrice) / entryPrice) * 100).toFixed(1)
      : '0.0';

    // ── Notify UI on every tick ─────────────────────────────
    cb?.onTick?.({
      bid,
      pnl:          pnlDollars,
      pnlPct:       parseFloat(pnlPct),
      highWater:    this._highWaterBid,
      trailingFloor: this._trailingFloor,
      status:       this._statusLabel(bid),
    });

    // ─────────────────────────────────────────────────────────
    //  EXIT DECISION TREE
    // ─────────────────────────────────────────────────────────

    // 1. ── TAKE-PROFIT (hard ceiling) ───────────────────────
    if (bid >= TAKE_PROFIT_PRICE) {
      console.info(`[PositionManager] 🎯 TAKE-PROFIT triggered @ ${bid}`);
      await this._executeSell('TAKE_PROFIT', bid, tokenQty, asset_id, cb);
      return;
    }

    // 2. ── TRAILING STOP ────────────────────────────────────
    if (bid >= TRAILING_ACTIVATION_PRICE) {
      // Activate or raise the trailing floor
      const newFloor = parseFloat((bid - TRAILING_FLOOR_OFFSET).toFixed(4));

      if (this._trailingFloor === null || newFloor > this._trailingFloor) {
        this._trailingFloor = newFloor;
        console.info(`[PositionManager] 📈 Trailing floor raised to ${this._trailingFloor}`);
      }
    }

    if (this._trailingFloor !== null && bid <= this._trailingFloor) {
      console.info(
        `[PositionManager] 🔒 TRAILING STOP triggered @ ${bid} (floor: ${this._trailingFloor})`
      );
      await this._executeSell('TRAILING_STOP', bid, tokenQty, asset_id, cb);
      return;
    }

    // 3. ── STOP-LOSS (with MACD confirmation) ───────────────
    if (bid <= STOP_LOSS_PRICE) {
      const macdSignal = cb?.getMacdSignal?.() ?? 'NEUTRAL';
      const macdConfirmsExit = this._macdConfirmsStopLoss(macdSignal);

      if (macdConfirmsExit) {
        console.info(
          `[PositionManager] 🛑 STOP-LOSS triggered @ ${bid}  MACD: ${macdSignal}`
        );
        await this._executeSell('STOP_LOSS', bid, tokenQty, asset_id, cb);
      } else {
        console.info(
          `[PositionManager] ⚠️  Bid at ${bid} but MACD=${macdSignal} — holding (waiting for confirmation)`
        );
      }
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL — EXECUTE SELL
  // ─────────────────────────────────────────────────────────────

  async _executeSell(reason, bid, tokenQty, asset_id, cb) {
    // Stop the monitor immediately to prevent double-sells
    this.close();

    try {
      const receipt = await sellPosition(asset_id, tokenQty, bid);

      if (!receipt?.success) {
        throw new Error('sellPosition returned failure');
      }

      const enrichedReceipt = {
        ...receipt,
        reason,         // 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP'
        bidAtExit: bid,
        highWater: this._highWaterBid,
      };

      if (reason === 'TAKE_PROFIT' || reason === 'TRAILING_STOP') {
        cb?.onTakeProfit?.(enrichedReceipt);
      } else {
        cb?.onStopLoss?.(enrichedReceipt);
      }
    } catch (err) {
      console.error('[PositionManager] _executeSell failed:', err.message);
      cb?.onError?.(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL — MACD CROSS CONFIRMATION
  // ─────────────────────────────────────────────────────────────

  /**
   * We only sell on stop-loss if the MACD confirms the trend is against us.
   * This prevents selling on a brief dip that may reverse.
   *
   * direction UP   → need BEARISH MACD cross to confirm stop-loss
   * direction DOWN → need BULLISH MACD cross to confirm stop-loss
   *
   * @param {string} macdSignal 'BULLISH'|'BEARISH'|'NEUTRAL'
   * @returns {boolean}
   */
  _macdConfirmsStopLoss(macdSignal) {
    const dir = this._position?.direction;
    if (dir === 'UP'   && macdSignal === 'BEARISH') return true;
    if (dir === 'DOWN' && macdSignal === 'BULLISH') return true;
    // NEUTRAL: do NOT sell — wait for clearer confirmation
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL — STATUS LABEL FOR UI
  // ─────────────────────────────────────────────────────────────

  _statusLabel(bid) {
    if (bid >= TAKE_PROFIT_PRICE)          return 'PROFIT_TARGET';
    if (this._trailingFloor !== null)      return 'TRAILING';
    if (bid >= TRAILING_ACTIVATION_PRICE)  return 'TRAILING_ARMING';
    if (bid <= STOP_LOSS_PRICE)            return 'STOP_WATCH';
    if (bid < this._position?.entryPrice)  return 'UNDERWATER';
    return 'PROFITABLE';
  }
}

// ─────────────────────────────────────────────────────────────
//  SINGLETON EXPORT (optional — use in App.jsx)
// ─────────────────────────────────────────────────────────────

/**
 * Single shared instance — prevents multiple monitors running in parallel.
 * Import and use this in App.jsx:
 *
 *   import { positionManager } from './positionManager.js';
 *   positionManager.open(position, callbacks);
 */
export const positionManager = new PositionManager();
