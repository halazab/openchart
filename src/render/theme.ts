/**
 * chart-renderer — theme constants.
 * Dark neutral terminal appearance; classic trading colors for series.
 */

export const CHART_THEME = {
  background: '#0e1116',
  panel: '#11141a',
  text: '#d1d5db',
  mutedText: '#8b93a3',
  grid: '#1a1e26',
  crosshair: '#6b7280',
  border: '#1e232c',

  up: '#26a69a',
  down: '#ef5350',
  upVolume: 'rgba(38, 166, 154, 0.45)',
  downVolume: 'rgba(239, 83, 80, 0.45)',

  areaTop: 'rgba(77, 143, 201, 0.28)',
  areaBottom: 'rgba(77, 143, 201, 0.02)',
  line: '#4d8fc9',

  sessionBreak: 'rgba(120, 130, 148, 0.22)',
  extendedShade: 'rgba(139, 147, 163, 0.05)',

  vpUp: 'rgba(38, 166, 154, 0.5)',
  vpDown: 'rgba(239, 83, 80, 0.42)',
  vpPoc: '#e3b341',
  vpVa: 'rgba(139, 147, 163, 0.55)',

  drawing: '#e3b341',
  drawingSelected: '#f5c96b',
  drawingHandle: '#f5c96b',
  drawingHandleFill: '#0e1116',
  priceRangeFill: 'rgba(38, 166, 154, 0.10)',
  dateRangeFill: 'rgba(77, 143, 201, 0.10)',
  fib: ['#e3b341', '#ef5350', '#e06c75', '#4fb3a9', '#26a69a', '#8b93a3'],
} as const;
