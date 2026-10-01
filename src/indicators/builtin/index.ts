/**
 * indicator-engine — built-in registry.
 * NOTE: this module must stay framework-free — it is imported by the
 * Web Worker as well as the main thread.
 */

import type { IndicatorDefinition } from '../plugin-api';
import {
  bollingerDefinition,
  emaDefinition,
  smaDefinition,
  vwapDefinition,
} from './overlays';
import { atrDefinition, macdDefinition, rsiDefinition } from './panes';
import { volumeProfileDefinition } from './volume-profile';

export const BUILTIN_DEFINITIONS: IndicatorDefinition[] = [
  smaDefinition,
  emaDefinition,
  vwapDefinition,
  bollingerDefinition,
  volumeProfileDefinition,
  rsiDefinition,
  macdDefinition,
  atrDefinition,
];

const BY_ID = new Map(BUILTIN_DEFINITIONS.map((d) => [d.id, d]));

export function getDefinition(id: string): IndicatorDefinition | undefined {
  return BY_ID.get(id);
}

export function registerDefinition(def: IndicatorDefinition): void {
  if (!BY_ID.has(def.id)) {
    BY_ID.set(def.id, def);
    BUILTIN_DEFINITIONS.push(def);
  }
}

export function defaultParams(def: IndicatorDefinition): Record<string, number> {
  const params: Record<string, number> = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
}
