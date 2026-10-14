import type { ControlSpec } from "../core/app";
import { PARAM_MAX } from "../core/constants";
import type { PanelAction } from "./board";

const WAIT = 12; // blocks: lets the ADC scan, averaging and the UI loop see each gesture
// FancyPot ignores a layer's pots until it has been active for a while (FancyPot.hpp: 0.2 s for SHIFT, ~64 blocks otherwise)
const SHIFT_SETTLE = 200;
const LAYER_SETTLE = 70;
// The ADC readings are averaged: let pots finish settling before a layer change freezes them
const PRE_LAYER = 60;

/**
 * Turns "knob positions per control" into the panel gestures a person would make on the module: for every layer
 * hold its button, wiggle each pot past the freeze threshold and settle on the value, then restore the NORMAL layer
 * positions. Because it goes through the real firmware UI loop this works for every app without knowing its internals.
 */
export function knobScript(
  controls: ControlSpec[],
  values: Record<string, number>,
  currentPots: number[],
): PanelAction[] {
  const actions: PanelAction[] = [];
  const pots = [...currentPots];

  const moveTo = (pot: number, target: number) => {
    if (Math.abs(target - pots[pot]) < 0.06) {
      actions.push({ type: "pot", pot, norm: target > 0.5 ? target - 0.12 : target + 0.12 }, { type: "wait", blocks: WAIT });
    }
    actions.push({ type: "pot", pot, norm: target }, { type: "wait", blocks: WAIT });
    pots[pot] = target;
  };

  for (const layer of ["NORMAL", "SHIFT", "MODE"] as const) {
    // Base-platform knobs at their factory value are left alone (the firmware already starts there, from its EEPROM)
    const items = controls.filter(
      (c) => c.layer === layer && !c.unused && values[c.key] !== undefined && !(c.owner === "platform" && values[c.key] === c.default),
    );
    if (!items.length) continue;
    const button = layer === "SHIFT" ? "SHIFT" : layer === "MODE" ? "MODE" : null;
    if (button) {
      actions.push({ type: "wait", blocks: PRE_LAYER }, { type: "button", button, down: true }, { type: "wait", blocks: button === "SHIFT" ? SHIFT_SETTLE : LAYER_SETTLE });
    }
    for (const c of items) moveTo(c.pot, Math.max(0, Math.min(1, values[c.key] / PARAM_MAX)));
    if (button) actions.push({ type: "wait", blocks: PRE_LAYER }, { type: "button", button, down: false }, { type: "wait", blocks: LAYER_SETTLE });
  }

  // Leave the pots where the NORMAL layer has them, like a person who let go of SHIFT
  for (const c of controls.filter((x) => x.layer === "NORMAL" && !x.unused && values[x.key] !== undefined && !(x.owner === "platform" && values[x.key] === x.default))) {
    moveTo(c.pot, Math.max(0, Math.min(1, values[c.key] / PARAM_MAX)));
  }
  actions.push({ type: "wait", blocks: 40 });
  return actions;
}

export const SETTLE_BLOCKS = 4;
