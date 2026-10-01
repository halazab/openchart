/**
 * drawing-engine — manager.
 *
 * Owns the object list, selection, tool state, command history and
 * per-symbol persistence (localStorage, versioned schema). Exposes an
 * OverlayLayer-compatible surface for the renderer and delegates pointer
 * routing to DrawingInteractions.
 */

import type { DrawingToolId } from '../core/types';
import type { CoordinateSpace, StoreView } from '../render/coordinate-space';
import type { OverlayDrawContext } from '../render/overlay/overlay-canvas';
import { CommandStack, type Command } from './history';
import { hitTestDrawing, project } from './geometry';
import { drawDrawings, magnetSnap } from './render';
import { DrawingInteractions } from './interactions';
import {
  DEFAULT_DRAWING_STYLE,
  deserializeDrawings,
  serializeDrawings,
  TOOL_POINT_COUNT,
  type DrawingAnchor,
  type DrawingKind,
  type DrawingObject,
  type DrawingStoreSchema,
  type DrawingStyle,
} from './types';

export interface DrawingManagerOptions {
  coords: CoordinateSpace;
  view: StoreView;
  container: HTMLElement;
  markDirty: () => void;
  onSelectionChanged?: (id: string | null) => void;
  onToolChanged?: (tool: DrawingToolId) => void;
  onHistoryChanged?: () => void;
  onDrawingsChanged?: () => void;
}

const STORAGE_PREFIX = 'openchart.drawings.';
const SAVE_DEBOUNCE_MS = 250;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export class DrawingManager {
  readonly layerId = 'drawings';
  readonly layerZ = 3;

  private readonly opts: DrawingManagerOptions;
  private drawings: DrawingObject[] = [];
  private selectedId: string | null = null;
  private tool: DrawingToolId = 'cursor';
  private magnet = false;
  private hidden = false;
  private symbol = '';
  private commands = new CommandStack();
  private interactions: DrawingInteractions;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private previewObj: DrawingObject | null = null;

  constructor(options: DrawingManagerOptions) {
    this.opts = options;
    this.commands.onChange = () => this.opts.onHistoryChanged?.();
    this.interactions = new DrawingInteractions(this, options.container, options.coords, options.view);
  }

  // -- Layer ----------------------------------------------------------------

  get id(): string {
    return this.layerId;
  }

  get z(): number {
    return this.layerZ;
  }

  draw(context: OverlayDrawContext): void {
    drawDrawings(context, this.drawings, this.selectedId, this.previewObj, this.hidden);
  }

  dispose(): void {
    this.persistNow();
    this.interactions.dispose();
  }

  // -- Tool & selection -------------------------------------------------------

  getTool(): DrawingToolId {
    return this.tool;
  }

  setTool(tool: DrawingToolId): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.cancelCreation();
    if (tool !== 'cursor') {
      // Drawing tools imply deselect-on-pan behavior; keep selection visible.
    }
    this.opts.onToolChanged?.(tool);
    this.opts.markDirty();
  }

  isSelected(): string | null {
    return this.selectedId;
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.opts.onSelectionChanged?.(id);
    this.opts.markDirty();
  }

  getSelectedDrawing(): DrawingObject | null {
    return this.drawings.find((d) => d.id === this.selectedId) ?? null;
  }

  // -- Settings ----------------------------------------------------------------

  setMagnet(enabled: boolean): void {
    this.magnet = enabled;
  }

  isMagnet(): boolean {
    return this.magnet;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.opts.markDirty();
  }

  isHidden(): boolean {
    return this.hidden;
  }

  // -- CRUD (history-aware) ------------------------------------------------------

  list(): readonly DrawingObject[] {
    return this.drawings;
  }

  add(kind: DrawingKind, points: DrawingAnchor[], style?: Partial<DrawingStyle>): DrawingObject {
    const obj: DrawingObject = {
      id: nextId(),
      symbol: this.symbol,
      kind,
      points: points.map((p) => ({ ...p })),
      style: { ...DEFAULT_DRAWING_STYLE, ...style },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const command: Command = {
      label: `add ${kind}`,
      undo: () => {
        this.drawings = this.drawings.filter((d) => d.id !== obj.id);
        if (this.selectedId === obj.id) this.select(null);
        this.afterMutation();
      },
      redo: () => {
        this.drawings.push(obj);
        this.afterMutation();
      },
    };
    this.drawings.push(obj);
    this.commands.push(command);
    this.select(obj.id);
    this.afterMutation();
    return obj;
  }

  remove(id: string): void {
    const idx = this.drawings.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const obj = this.drawings[idx];
    const before = obj;
    const beforeList = this.drawings.slice();
    const command: Command = {
      label: `remove ${obj.kind}`,
      undo: () => {
        this.drawings = beforeList.slice();
        this.afterMutation();
      },
      redo: () => {
        this.drawings = this.drawings.filter((d) => d.id !== before.id);
        if (this.selectedId === before.id) this.select(null);
        this.afterMutation();
      },
    };
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selectedId === id) this.select(null);
    this.commands.push(command);
    this.afterMutation();
  }

  clearAll(): void {
    if (this.drawings.length === 0) return;
    const beforeList = this.drawings.slice();
    const command: Command = {
      label: 'clear drawings',
      undo: () => {
        this.drawings = beforeList.slice();
        this.afterMutation();
      },
      redo: () => {
        this.drawings = [];
        this.select(null);
        this.afterMutation();
      },
    };
    this.drawings = [];
    this.select(null);
    this.commands.push(command);
    this.afterMutation();
  }

  updateStyle(id: string, style: Partial<DrawingStyle>): void {
    const obj = this.drawings.find((d) => d.id === id);
    if (!obj) return;
    const before = { ...obj.style };
    const after = { ...obj.style, ...style };
    const command: Command = {
      label: `style ${obj.kind}`,
      undo: () => {
        const target = this.drawings.find((d) => d.id === id);
        if (target) {
          target.style = before;
          target.updatedAt = Date.now();
          this.afterMutation();
        }
      },
      redo: () => {
        const target = this.drawings.find((d) => d.id === id);
        if (target) {
          target.style = after;
          target.updatedAt = Date.now();
          this.afterMutation();
        }
      },
    };
    obj.style = after;
    obj.updatedAt = Date.now();
    this.commands.push(command);
    this.afterMutation();
  }

  // -- Geometry editing (used by interactions) ---------------------------------

  /** Deep-copy points for a drag session. */
  capturePoints(id: string): DrawingAnchor[] | null {
    const obj = this.drawings.find((d) => d.id === id);
    return obj ? obj.points.map((p) => ({ ...p })) : null;
  }

  /** Apply a live geometry change during drag (NOT recorded in history). */
  applyLivePoints(id: string, points: DrawingAnchor[]): void {
    const obj = this.drawings.find((d) => d.id === id);
    if (!obj) return;
    obj.points = points;
    obj.updatedAt = Date.now();
    this.opts.markDirty();
  }

  /** Record a completed drag as one history command. */
  commitPoints(id: string, before: DrawingAnchor[]): void {
    const obj = this.drawings.find((d) => d.id === id);
    if (!obj) return;
    const after = obj.points.map((p) => ({ ...p }));
    const command: Command = {
      label: `move ${obj.kind}`,
      undo: () => {
        const target = this.drawings.find((d) => d.id === id);
        if (target) {
          target.points = before.map((p) => ({ ...p }));
          this.afterMutation();
        }
      },
      redo: () => {
        const target = this.drawings.find((d) => d.id === id);
        if (target) {
          target.points = after.map((p) => ({ ...p }));
          this.afterMutation();
        }
      },
    };
    this.commands.push(command);
    this.afterMutation();
  }

  // -- Creation preview -----------------------------------------------------------

  /** Build/refresh the ephemeral preview object shown while creating. */
  setPreview(kind: DrawingKind | null, points: DrawingAnchor[]): void {
    if (!kind) {
      this.previewObj = null;
      this.opts.markDirty();
      return;
    }
    this.previewObj = {
      id: '__preview',
      symbol: this.symbol,
      kind,
      points,
      style: { ...DEFAULT_DRAWING_STYLE },
      createdAt: 0,
      updatedAt: 0,
    };
    this.opts.markDirty();
  }

  /** Called by interactions when a creation flow completes. */
  commitCreation(kind: DrawingKind, points: DrawingAnchor[]): void {
    this.add(kind, points);
    this.previewObj = null;
    // Return to select mode like TradingView.
    this.setTool('cursor');
  }

  cancelCreation(): void {
    this.previewObj = null;
    this.opts.markDirty();
  }

  pointCountFor(kind: DrawingKind): number {
    return TOOL_POINT_COUNT[kind];
  }

  // -- History ---------------------------------------------------------------------

  undo(): void {
    if (this.commands.undo()) this.afterMutation();
  }

  redo(): void {
    if (this.commands.redo()) this.afterMutation();
  }

  canUndo(): boolean {
    return this.commands.canUndo();
  }

  canRedo(): boolean {
    return this.commands.canRedo();
  }

  // -- Hit testing -------------------------------------------------------------------

  hitTest(x: number, y: number): ReturnType<typeof hitTestDrawing> {
    const paneRect = this.opts.coords.mainPaneRect();
    // Newest drawings take precedence.
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const hit = hitTestDrawing(this.drawings[i], this.opts.coords, this.opts.view, x, y, paneRect);
      if (hit) return hit;
    }
    return null;
  }

  // -- Persistence ----------------------------------------------------------------------

  setSymbol(symbol: string): void {
    this.persistNow();
    this.symbol = symbol;
    this.drawings = [];
    this.selectedId = null;
    this.commands.clear();
    this.loadFromStorage();
    this.opts.onDrawingsChanged?.();
    this.opts.onSelectionChanged?.(null);
    this.opts.markDirty();
  }

  private storageKey(): string {
    return `${STORAGE_PREFIX}${this.symbol || 'default'}`;
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const schema = JSON.parse(raw) as DrawingStoreSchema;
      this.drawings = deserializeDrawings(schema);
    } catch {
      // Corrupt storage must never break the chart.
      this.drawings = [];
    }
  }

  private persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.symbol) return;
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(serializeDrawings(this.drawings)));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }

  private afterMutation(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, SAVE_DEBOUNCE_MS);
    this.opts.onDrawingsChanged?.();
    this.opts.markDirty();
  }

  // -- Exported for interactions ------------------------------------------------------------

  markDirty(): void {
    this.opts.markDirty();
  }

  exportJSON(): string {
    return JSON.stringify(serializeDrawings(this.drawings), null, 2);
  }

  importJSON(json: string): boolean {
    try {
      const schema = JSON.parse(json) as DrawingStoreSchema;
      const items = deserializeDrawings(schema).filter((d) => d.kind && d.points.length >= 1);
      if (items.length === 0) return false;
      const beforeList = this.drawings.slice();
      this.drawings = items;
      this.select(null);
      const command: Command = {
        label: 'import drawings',
        undo: () => {
          this.drawings = beforeList.slice();
          this.afterMutation();
        },
        redo: () => {
          this.drawings = items;
          this.afterMutation();
        },
      };
      this.commands.push(command);
      this.afterMutation();
      return true;
    } catch {
      return false;
    }
  }

  magnetSnapAnchor(time: number, price: number): DrawingAnchor {
    if (!this.magnet) return { time, price };
    return magnetSnap(this.opts.coords, time, price, this.opts.view);
  }
}

export function projectForTests(drawing: DrawingObject, coords: CoordinateSpace) {
  return project(drawing, coords);
}
