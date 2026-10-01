/**
 * Per-provider watchlist persistence (localStorage).
 *
 * The engine/UI keep the live list in memory; this module makes each
 * provider's watchlist survive reloads. Falls back to the provider's
 * built-in default when nothing was saved yet.
 */

const PREFIX = 'openchart.watchlist.';

export function loadSavedWatchlist(providerId: string): string[] | null {
  try {
    const raw = localStorage.getItem(PREFIX + providerId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const symbols = parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
    return symbols.length > 0 ? symbols : null;
  } catch {
    return null;
  }
}

export function saveWatchlist(providerId: string, symbols: string[]): void {
  try {
    localStorage.setItem(PREFIX + providerId, JSON.stringify(symbols));
  } catch {
    /* storage full/unavailable — persistence is best-effort */
  }
}
