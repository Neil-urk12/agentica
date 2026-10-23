/**
 * One shared coarse clock for "N min ago" labels, so the waiting queue and
 * tiles show the same waited time. It ticks only while something holds it.
 */
class Clock {
  now = $state(Date.now());
  #holders = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  /** Start ticking (if idle); returns the release function for an $effect. */
  hold() {
    if (this.#holders++ === 0) {
      this.now = Date.now();
      this.#timer = setInterval(() => (this.now = Date.now()), 30_000);
    }
    return () => {
      if (--this.#holders === 0) clearInterval(this.#timer);
    };
  }
}

export const clock = new Clock();
