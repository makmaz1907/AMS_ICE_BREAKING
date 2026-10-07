import { useEffect, useRef, useState } from "react";

// Final results: places are revealed from last to first, with a longer pause (a drum roll on the host) before the winner.
// Host and phones run the same timeline from when the game-results state arrives, so they stay roughly in step.
// onStep(place) fires as each place is revealed; onStep(0) fires once at the start.
export function useFinalReveal(count: number, active: boolean, onStep?: (place: number) => void) {
  const [shown, setShown] = useState(0);
  const step = useRef(onStep);
  step.current = onStep;
  useEffect(() => {
    setShown(0);
    if (!active || count === 0) return;
    const timers: number[] = [];
    const at = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay));
    step.current?.(0);
    // Places below 5th come out quickly so a big game doesn't drag; the top five get a beat each.
    let delay = 900;
    for (let place = count; place >= 1; place -= 1) {
      if (place === 1) delay += count > 1 ? 2_600 : 1_800;
      const revealed = count - place + 1;
      at(delay, () => { setShown(revealed); step.current?.(place); });
      delay += place - 1 > 5 ? 450 : 1_300;
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [count, active]);
  return { shown, done: active && shown >= count, isRevealed: (place: number) => place > count - shown };
}
