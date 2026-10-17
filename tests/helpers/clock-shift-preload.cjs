'use strict';

/**
 * clock-shift-preload.cjs - preload (`--require`) that moves the wall clock of a test process.
 *
 * Used by scripts/clock-shift-gate.js through NODE_OPTIONS, so child processes spawned by a
 * test inherit it. The shift in milliseconds comes from CLOCK_SHIFT_MS; unset, empty, zero
 * or not a number means: do nothing.
 *
 * Shifted: `new Date()` without arguments, `Date()` called as a function, `Date.now()`.
 * Exact (untouched): `new Date(x)`, `Date.UTC`, `Date.parse`, performance.now, hrtime, timers,
 * file mtimes. A test that compares a fresh file mtime with `Date.now()` therefore sees a
 * file that is "shift old"; that is a limit of this approach, not a finding.
 */

const RealDate = Date;
const shiftMs = Number(process.env.CLOCK_SHIFT_MS);

if (process.env.CLOCK_SHIFT_MS && Number.isFinite(shiftMs) && shiftMs !== 0) {
  const shiftedNow = () => RealDate.now() + shiftMs;
  // A plain function, not a class: `Date()` without `new` must keep working. Reflect.construct
  // with new.target keeps subclasses (`class X extends Date`) on the right prototype.
  const ShiftedDate = function Date(...args) {
    if (!new.target) return new RealDate(shiftedNow()).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [shiftedNow()] : args, new.target);
  };
  Object.setPrototypeOf(ShiftedDate, RealDate); // inherits Date.UTC and Date.parse unchanged
  ShiftedDate.prototype = RealDate.prototype;
  Object.defineProperty(RealDate.prototype, 'constructor', { value: ShiftedDate, writable: true, configurable: true });
  Object.defineProperty(ShiftedDate, 'now', { value: shiftedNow, writable: true, configurable: true });
  globalThis.Date = ShiftedDate;
}
