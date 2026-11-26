import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  Crosshair,
  LayoutGrid,
  Lock,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeBollinger,
  computeEMA,
  computeMACD,
  computeRSI,
  computeSMA,
  computeVWAP,
  getBarsForTimeframe,
} from '../data/marketData';
import { getTierLimits } from '../lib/entitlements';
import { fetchLiveChart } from '../services/marketApi';
import {
  ChartType,
  FibRetracement,
  OhlcBar,
  PlanTier,
  PortfolioHolding,
  PriceAlert,
  PriceLine,
  SavedChartLayout,
  SplitLayoutMode,
  StockProfile,
  SubIndicator,
  Timeframe,
  TrendLine,
} from '../types/market';
import { formatCurrency, formatVolume } from '../utils/financeMath';
import { MiniChartTile } from './MiniChartTile';

interface ChartTerminalProps {
  stock: StockProfile;
  allStocks: Record<string, StockProfile>;
  isDark: boolean;
  planTier: PlanTier;
  onRequireUpgrade: (requiredTier: Exclude<PlanTier, 'free'>, feature: string) => void;
  holdings: PortfolioHolding[];
  alerts: PriceAlert[];
  onAddAlert: (symbol: string, condition: 'above' | 'below', targetPrice: number, note: string) => void;
  onDeleteAlert: (id: string) => void;
  onResetAlert: (id: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onAddOrUpdateHolding: (symbol: string, sharesDelta: number, executionPrice: number) => void;
}

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y'];
const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'hollow', label: 'Hollow' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];
const SUB_INDICATORS: { id: SubIndicator; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'rsi', label: 'RSI (14)' },
  { id: 'macd', label: 'MACD' },
];
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

type DrawMode = 'cursor' | 'hline' | 'trendline' | 'fib' | 'replay_cut';
type RailTab = 'depth' | 'alerts' | 'layouts';

interface StoredDrawings {
  priceLines: Record<string, PriceLine[]>;
  trendLines: Record<string, TrendLine[]>;
  fibs: Record<string, FibRetracement[]>;
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function ChartTerminal({
  stock,
  allStocks,
  isDark,
  planTier,
  onRequireUpgrade,
  holdings,
  alerts,
  onAddAlert,
  onDeleteAlert,
  onResetAlert,
  onSelectSymbol,
  onAddOrUpdateHolding,
}: ChartTerminalProps) {
  const tierLimits = useMemo(() => getTierLimits(planTier), [planTier]);
  const [timeframe, setTimeframe] = useState<Timeframe>('6M');
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [subIndicator, setSubIndicator] = useState<SubIndicator>('volume');
  const [showSma20, setShowSma20] = useState(false);
  const [showEma50, setShowEma50] = useState(false);
  const [showEma200, setShowEma200] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVwap, setShowVwap] = useState(false);

  // Multi-chart split-screen (unrestricted 1x / 2x / 4x)
  const [splitMode, setSplitMode] = useState<SplitLayoutMode>('1');
  const [tileConfigs, setTileConfigs] = useState<{ symbol: string; timeframe: Timeframe }[]>([
    { symbol: 'SPY', timeframe: '6M' },
    { symbol: 'NVDA', timeframe: '3M' },
    { symbol: 'MSFT', timeframe: '1D' },
  ]);

  // Symbol Compare Overlay (% aligned)
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [compareBarsCache, setCompareBarsCache] = useState<Record<string, OhlcBar[]>>({});

  // Unrestricted Bar Replay (all timeframes including 1D intraday)
  const [replayActive, setReplayActive] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState<number>(650);
  const [replayEndIdx, setReplayEndIdx] = useState<number | null>(null);

  // Right contextual rail tab
  const [railTab, setRailTab] = useState<RailTab>('depth');

  // Unlimited Saved Chart Layouts
  const [savedLayouts, setSavedLayouts] = useState<SavedChartLayout[]>(() =>
    readLocalJson<SavedChartLayout[]>('meridian_chart_layouts_v1', [
      {
        id: 'layout-swing',
        name: 'Swing Confluence (All 5)',
        timeframe: '6M',
        chartType: 'candles',
        subIndicator: 'rsi',
        showSma20: true,
        showEma50: true,
        showEma200: true,
        showBollinger: true,
        showVwap: false,
        splitMode: '1',
        compareSymbol: 'SPY',
      },
      {
        id: 'layout-intraday',
        name: 'Intraday Dual + VWAP',
        timeframe: '1D',
        chartType: 'candles',
        subIndicator: 'macd',
        showSma20: true,
        showEma50: false,
        showEma200: false,
        showBollinger: false,
        showVwap: true,
        splitMode: '2',
        compareSymbol: null,
      },
    ])
  );
  const [newLayoutName, setNewLayoutName] = useState('');

  // Never-expiring Price Alert form
  const [alertCondition, setAlertCondition] = useState<'above' | 'below'>('above');
  const [alertPriceInput, setAlertPriceInput] = useState(() => (stock.price * 1.03).toFixed(2));
  const [alertNoteInput, setAlertNoteInput] = useState('');

  // Keep default alert price synced when switching symbol
  useEffect(() => {
    setAlertPriceInput(
      (stock.price * (alertCondition === 'above' ? 1.03 : 0.97)).toFixed(2)
    );
  }, [stock.symbol]);

  // Live OHLCV chart cache per symbol + timeframe
  const [liveBarsCache, setLiveBarsCache] = useState<Record<string, OhlcBar[]>>({});
  const [loadingChart, setLoadingChart] = useState(false);

  // Persistent per-symbol drawings (Price Lines, Trendlines, Fibonacci Retracements)
  const [drawMode, setDrawMode] = useState<DrawMode>('cursor');
  const initialDrawings = useMemo(
    () =>
      readLocalJson<StoredDrawings>('meridian_drawings_v1', {
        priceLines: {},
        trendLines: {},
        fibs: {},
      }),
    []
  );
  const [priceLinesBySymbol, setPriceLinesBySymbol] = useState<Record<string, PriceLine[]>>(
    initialDrawings.priceLines
  );
  const [trendLinesBySymbol, setTrendLinesBySymbol] = useState<Record<string, TrendLine[]>>(
    initialDrawings.trendLines
  );
  const [fibsBySymbol, setFibsBySymbol] = useState<Record<string, FibRetracement[]>>(
    initialDrawings.fibs
  );
  const [pendingPoint, setPendingPoint] = useState<{ index: number; price: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        'meridian_drawings_v1',
        JSON.stringify({
          priceLines: priceLinesBySymbol,
          trendLines: trendLinesBySymbol,
          fibs: fibsBySymbol,
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [priceLinesBySymbol, trendLinesBySymbol, fibsBySymbol]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_chart_layouts_v1', JSON.stringify(savedLayouts));
    } catch {
      // Ignore quota errors
    }
  }, [savedLayouts]);

  // Viewport zoom & pan
  const [visibleCount, setVisibleCount] = useState(110);
  const [rightOffset, setRightOffset] = useState(0);

  // Crosshair state
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; startOffset: number } | null>(null);

  // Quick position ticket state
  const [tradeShares, setTradeShares] = useState('25');
  const [tradeFeedback, setTradeFeedback] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });

  const cacheKey = `${stock.symbol}:${timeframe}`;
  const availableSymbols = useMemo(() => Object.keys(allStocks), [allStocks]);

  // Fetch genuine real-world OHLCV candlesticks from our Yahoo Finance proxy
  useEffect(() => {
    let cancelled = false;
    setLoadingChart(true);
    fetchLiveChart(stock.symbol, timeframe).then((res) => {
      if (cancelled) return;
      setLoadingChart(false);
      if (res && res.bars.length > 0) {
        setLiveBarsCache((prev) => ({
          ...prev,
          [cacheKey]: res.bars,
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stock.symbol, timeframe, cacheKey]);

  // Fetch comparison symbol bars when active
  useEffect(() => {
    if (!compareSymbol || compareSymbol === stock.symbol) return;
    const key = `${compareSymbol}:${timeframe}`;
    if (compareBarsCache[key]) return;
    let cancelled = false;
    fetchLiveChart(compareSymbol, timeframe).then((res) => {
      if (!cancelled && res && res.bars.length > 0) {
        setCompareBarsCache((prev) => ({ ...prev, [key]: res.bars }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [compareSymbol, stock.symbol, timeframe, compareBarsCache]);

  const fullBars: OhlcBar[] = useMemo(() => {
    const live = liveBarsCache[cacheKey];
    if (live && live.length > 0) return live;
    return getBarsForTimeframe(stock.bars, timeframe);
  }, [liveBarsCache, cacheKey, stock.bars, timeframe]);

  // Exit replay cleanly if symbol or timeframe changes
  useEffect(() => {
    setReplayPlaying(false);
    if (replayActive) {
      setReplayEndIdx(Math.max(15, Math.floor(fullBars.length * 0.55)));
    } else {
      setReplayEndIdx(null);
    }
  }, [stock.symbol, timeframe]);

  // Replay playback timer
  useEffect(() => {
    if (!replayActive || !replayPlaying) return;
    const id = window.setInterval(() => {
      setReplayEndIdx((prev) => {
        const cur = prev ?? Math.max(15, Math.floor(fullBars.length * 0.55));
        if (cur >= fullBars.length - 1) {
          setReplayPlaying(false);
          return fullBars.length - 1;
        }
        return cur + 1;
      });
    }, replaySpeedMs);
    return () => window.clearInterval(id);
  }, [replayActive, replayPlaying, replaySpeedMs, fullBars.length]);

  const bars: OhlcBar[] = useMemo(() => {
    if (!replayActive || replayEndIdx === null) return fullBars;
    return fullBars.slice(0, Math.max(12, Math.min(fullBars.length, replayEndIdx + 1)));
  }, [fullBars, replayActive, replayEndIdx]);

  // Reset zoom/pan when timeframe or ticker changes
  useEffect(() => {
    setVisibleCount(
      Math.min(
        fullBars.length,
        timeframe === '1D' ? 80 : timeframe === '1W' ? 70 : timeframe === '1M' ? 30 : 120
      )
    );
    setRightOffset(0);
    setPendingPoint(null);
  }, [stock.symbol, timeframe, fullBars.length]);

  // Measure canvas container cleanly via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 100 && h > 160) {
          setCanvasSize({ width: w, height: h });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [splitMode]);

  // Precompute ALL technical indicators simultaneously (zero cap)
  const indicators = useMemo(() => {
    const closes = bars.map((b) => b.close);
    return {
      sma20: computeSMA(closes, 20),
      ema50: computeEMA(closes, 50),
      ema200: computeEMA(closes, 200),
      bb: computeBollinger(closes, 20, 2),
      vwap: computeVWAP(bars),
      rsi: computeRSI(closes, 14),
      macd: computeMACD(closes),
    };
  }, [bars]);

  // Slice visible window
  const { startIdx, visibleBars } = useMemo(() => {
    const total = bars.length;
    const clampedCount = Math.max(12, Math.min(total, visibleCount));
    const maxOffset = Math.max(0, total - clampedCount);
    const offset = Math.max(0, Math.min(maxOffset, rightOffset));
    const end = total - offset;
    const start = Math.max(0, end - clampedCount);
    return {
      startIdx: start,
      visibleBars: bars.slice(start, end),
    };
  }, [bars, visibleCount, rightOffset]);

  // Build aligned comparison overlay series scaled to first visible bar's price
  const compareOverlay = useMemo(() => {
    if (!compareSymbol || compareSymbol === stock.symbol || visibleBars.length === 0) return null;
    const key = `${compareSymbol}:${timeframe}`;
    const rawComp =
      compareBarsCache[key] ??
      (allStocks[compareSymbol]
        ? getBarsForTimeframe(allStocks[compareSymbol].bars, timeframe)
        : []);
    if (rawComp.length === 0) return null;

    const byTime = new Map<string, number>();
    for (const b of rawComp) byTime.set(b.time, b.close);

    const anchorPrimary = visibleBars[0].close;
    let anchorComp: number | null = null;
    const rawMatched: (number | null)[] = visibleBars.map((vb, idx) => {
      const exact = byTime.get(vb.time);
      if (exact !== undefined) return exact;
      // Fallback index alignment from end
      const fallbackIdx = rawComp.length - (bars.length - (startIdx + idx));
      if (fallbackIdx >= 0 && fallbackIdx < rawComp.length) return rawComp[fallbackIdx].close;
      return null;
    });

    for (const v of rawMatched) {
      if (v !== null && v > 0) {
        anchorComp = v;
        break;
      }
    }
    if (!anchorComp) return null;

    const scaled = rawMatched.map((v) =>
      v !== null ? anchorPrimary * (v / anchorComp!) : null
    );
    const lastComp = [...rawMatched].reverse().find((v) => v !== null) ?? anchorComp;
    const compReturnPct = ((lastComp - anchorComp) / anchorComp) * 100;
    const primaryReturnPct =
      ((visibleBars[visibleBars.length - 1].close - anchorPrimary) / anchorPrimary) * 100;

    return {
      symbol: compareSymbol,
      scaled,
      compReturnPct,
      primaryReturnPct,
    };
  }, [compareSymbol, stock.symbol, timeframe, compareBarsCache, allStocks, visibleBars, bars.length, startIdx]);

  // Geometry constants
  const PAD_LEFT = 12;
  const PAD_RIGHT = 68;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 26;
  const SUB_GAP = 14;
  const plotW = Math.max(100, canvasSize.width - PAD_LEFT - PAD_RIGHT);
  const totalPlotH = Math.max(140, canvasSize.height - PAD_TOP - PAD_BOTTOM);
  const subH = Math.round(totalPlotH * 0.24);
  const mainH = totalPlotH - subH - SUB_GAP;
  const subTop = PAD_TOP + mainH + SUB_GAP;

  const currentPriceLines = priceLinesBySymbol[stock.symbol] ?? [];
  const currentTrendLines = trendLinesBySymbol[stock.symbol] ?? [];
  const currentFibs = fibsBySymbol[stock.symbol] ?? [];
  const symbolAlerts = useMemo(
    () => alerts.filter((a) => a.symbol === stock.symbol),
    [alerts, stock.symbol]
  );

  const { minPrice, maxPrice } = useMemo(() => {
    if (visibleBars.length === 0) return { minPrice: 0, maxPrice: 100 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < visibleBars.length; i++) {
      const b = visibleBars[i];
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
      const gIdx = startIdx + i;
      if (showBollinger && indicators.bb.upper[gIdx] !== null) {
        hi = Math.max(hi, indicators.bb.upper[gIdx]!);
        lo = Math.min(lo, indicators.bb.lower[gIdx]!);
      }
      if (compareOverlay && compareOverlay.scaled[i] !== null) {
        hi = Math.max(hi, compareOverlay.scaled[i]!);
        lo = Math.min(lo, compareOverlay.scaled[i]!);
      }
    }
    const pad = Math.max((hi - lo) * 0.08, hi * 0.005);
    return { minPrice: lo - pad, maxPrice: hi + pad };
  }, [visibleBars, startIdx, showBollinger, indicators.bb, compareOverlay]);

  const priceToY = (p: number) => {
    const ratio = (p - minPrice) / Math.max(0.0001, maxPrice - minPrice);
    return PAD_TOP + mainH - ratio * mainH;
  };

  const yToPrice = (y: number) => {
    const ratio = (PAD_TOP + mainH - y) / Math.max(1, mainH);
    return minPrice + ratio * (maxPrice - minPrice);
  };

  const indexToX = (localIdx: number) => {
    const step = plotW / Math.max(1, visibleBars.length);
    return PAD_LEFT + step * localIdx + step / 2;
  };

  const xToLocalIndex = (x: number) => {
    const step = plotW / Math.max(1, visibleBars.length);
    return Math.max(0, Math.min(visibleBars.length - 1, Math.floor((x - PAD_LEFT) / step)));
  };

  const inspectedIndex = useMemo(() => {
    if (!hoverPos || visibleBars.length === 0) return visibleBars.length - 1;
    if (hoverPos.x < PAD_LEFT || hoverPos.x > PAD_LEFT + plotW) return visibleBars.length - 1;
    return xToLocalIndex(hoverPos.x);
  }, [hoverPos, visibleBars.length, plotW]);

  const inspectedBar = visibleBars[inspectedIndex] ?? visibleBars[visibleBars.length - 1];
  const inspectedGlobalIdx = startIdx + inspectedIndex;

  // High-DPI Canvas Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleBars.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = isDark ? '#0B0F17' : '#FFFFFF';
    const grid = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(1, 33, 105, 0.065)';
    const divider = isDark ? '#1E293B' : '#D6E2F0';
    const textMuted = isDark ? '#94A3B8' : '#5A7190';
    const textBright = isDark ? '#F1F5F9' : '#0A1F44';
    const upColor = isDark ? '#10B981' : '#0F8A4B';
    const downColor = '#DC2626';
    const merrillBlue = isDark ? '#3B82F6' : '#0052C2';
    const merrillNavy = isDark ? '#334155' : '#012169';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Horizontal gridlines & Y-axis labels
    const yTicks = 6;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= yTicks; i++) {
      const price = minPrice + ((maxPrice - minPrice) * i) / yTicks;
      const y = Math.round(priceToY(price)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + plotW, y);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      ctx.fillText(price.toFixed(2), PAD_LEFT + plotW + 8, y);
    }

    // Vertical time gridlines & X-axis labels
    const xTickCount = Math.min(7, Math.max(3, Math.floor(plotW / 115)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < xTickCount; i++) {
      const lIdx = Math.round((i / Math.max(1, xTickCount - 1)) * (visibleBars.length - 1));
      const x = Math.round(indexToX(lIdx)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + totalPlotH);
      ctx.stroke();

      const label = visibleBars[lIdx]?.time ?? '';
      const shortLabel = label.length === 10 ? label.slice(2) : label;
      ctx.fillStyle = textMuted;
      ctx.fillText(shortLabel, x, PAD_TOP + totalPlotH + 7);
    }

    // Sub-pane & Y-axis dividers
    ctx.strokeStyle = divider;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(subTop - SUB_GAP / 2) + 0.5);
    ctx.lineTo(canvasSize.width, Math.round(subTop - SUB_GAP / 2) + 0.5);
    ctx.moveTo(Math.round(PAD_LEFT + plotW) + 0.5, 0);
    ctx.lineTo(Math.round(PAD_LEFT + plotW) + 0.5, PAD_TOP + totalPlotH);
    ctx.stroke();

    const drawOverlaySeries = (
      series: (number | null)[],
      color: string,
      width = 1.4,
      dash: number[] = []
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleBars.length; i++) {
        const val = series[startIdx + i];
        if (val === null || val === undefined) {
          started = false;
          continue;
        }
        const x = indexToX(i);
        const y = priceToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    if (showBollinger) {
      ctx.save();
      ctx.beginPath();
      let firstX = -1;
      const lowerPoints: [number, number][] = [];
      for (let i = 0; i < visibleBars.length; i++) {
        const u = indicators.bb.upper[startIdx + i];
        const l = indicators.bb.lower[startIdx + i];
        if (u !== null && l !== null) {
          const x = indexToX(i);
          if (firstX === -1) {
            ctx.moveTo(x, priceToY(u));
            firstX = x;
          } else {
            ctx.lineTo(x, priceToY(u));
          }
          lowerPoints.push([x, priceToY(l)]);
        }
      }
      for (let i = lowerPoints.length - 1; i >= 0; i--) {
        ctx.lineTo(lowerPoints[i][0], lowerPoints[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = isDark ? 'rgba(59, 130, 246, 0.08)' : 'rgba(0, 82, 194, 0.08)';
      ctx.fill();
      ctx.restore();

      drawOverlaySeries(indicators.bb.upper, 'rgba(0, 82, 194, 0.6)', 1);
      drawOverlaySeries(indicators.bb.mid, 'rgba(0, 82, 194, 0.4)', 1, [3, 3]);
      drawOverlaySeries(indicators.bb.lower, 'rgba(0, 82, 194, 0.6)', 1);
    }

    // Draw Fibonacci Retracements behind candles
    for (const fib of currentFibs) {
      const x1 = Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotW, indexToX(fib.startIndex - startIdx)));
      const x2 = Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotW, indexToX(fib.endIndex - startIdx)));
      const leftX = Math.min(x1, x2);
      const rightX = Math.max(x1, x2, leftX + 90);
      const span = fib.endPrice - fib.startPrice;

      ctx.save();
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';

      for (const ratio of FIB_RATIOS) {
        const lvlPrice = fib.endPrice - span * ratio;
        if (lvlPrice < minPrice || lvlPrice > maxPrice) continue;
        const y = Math.round(priceToY(lvlPrice)) + 0.5;
        ctx.strokeStyle =
          ratio === 0.5 || ratio === 0.618
            ? 'rgba(0, 82, 194, 0.85)'
            : 'rgba(1, 33, 105, 0.42)';
        ctx.lineWidth = ratio === 0.618 ? 1.3 : 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(Math.min(PAD_LEFT + plotW, rightX), y);
        ctx.stroke();

        ctx.fillStyle = isDark ? '#93C5FD' : '#012169';
        ctx.fillText(`${(ratio * 100).toFixed(1)}% (${lvlPrice.toFixed(2)})`, leftX + 4, y - 2);
      }
      ctx.restore();
    }

    const step = plotW / Math.max(1, visibleBars.length);
    const bodyW = Math.max(2, Math.min(14, step * 0.68));

    if (chartType === 'candles' || chartType === 'hollow') {
      for (let i = 0; i < visibleBars.length; i++) {
        const b = visibleBars[i];
        const x = indexToX(i);
        const yOpen = priceToY(b.open);
        const yClose = priceToY(b.close);
        const yHigh = priceToY(b.high);
        const yLow = priceToY(b.low);
        const isUp = b.close >= b.open;
        const color = isUp ? upColor : downColor;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();

        const top = Math.min(yOpen, yClose);
        const height = Math.max(1.5, Math.abs(yClose - yOpen));
        if (chartType === 'hollow' && isUp) {
          ctx.fillStyle = bg;
          ctx.fillRect(x - bodyW / 2, top, bodyW, height);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(x - bodyW / 2, top, bodyW, height);
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(x - bodyW / 2, top, bodyW, height);
        }
      }
    } else {
      ctx.save();
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        const x = indexToX(i);
        const y = priceToY(b.close);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = merrillBlue;
      ctx.lineWidth = 2.1;
      ctx.stroke();

      if (chartType === 'area') {
        const lastX = indexToX(visibleBars.length - 1);
        const firstX = indexToX(0);
        ctx.lineTo(lastX, PAD_TOP + mainH);
        ctx.lineTo(firstX, PAD_TOP + mainH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + mainH);
        grad.addColorStop(0, isDark ? 'rgba(59, 130, 246, 0.28)' : 'rgba(0, 82, 194, 0.20)');
        grad.addColorStop(1, 'rgba(0, 82, 194, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
    }

    // All 5 Moving Averages & Overlays (unlimited simultaneous)
    if (showSma20) drawOverlaySeries(indicators.sma20, '#0052C2', 1.45);
    if (showEma50) drawOverlaySeries(indicators.ema50, '#012169', 1.45);
    if (showEma200) drawOverlaySeries(indicators.ema200, '#D97706', 1.55);
    if (showVwap) drawOverlaySeries(indicators.vwap, '#0284C7', 1.4, [4, 2]);

    // Comparison Symbol Overlay
    if (compareOverlay) {
      ctx.save();
      ctx.strokeStyle = '#7C3AED';
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < compareOverlay.scaled.length; i++) {
        const val = compareOverlay.scaled[i];
        if (val === null) continue;
        const x = indexToX(i);
        const y = priceToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Active Never-Expiring Price Alerts plotted right on chart
    for (const al of symbolAlerts) {
      if (al.targetPrice < minPrice || al.targetPrice > maxPrice) continue;
      const y = Math.round(priceToY(al.targetPrice)) + 0.5;
      const col = al.triggeredAt ? '#0F8A4B' : '#D97706';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + plotW, y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = col;
      ctx.fillRect(PAD_LEFT + plotW + 1, y - 9, PAD_RIGHT - 2, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 9.5px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(al.targetPrice.toFixed(2), PAD_LEFT + plotW + 6, y);
    }

    // Horizontal Price Lines
    for (const line of currentPriceLines) {
      if (line.price < minPrice || line.price > maxPrice) continue;
      const y = Math.round(priceToY(line.price)) + 0.5;
      ctx.save();
      ctx.strokeStyle = '#0052C2';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + plotW, y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#0052C2';
      ctx.fillRect(PAD_LEFT + plotW + 1, y - 9, PAD_RIGHT - 2, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(line.price.toFixed(2), PAD_LEFT + plotW + 6, y);
    }

    // Trendlines
    for (const tl of currentTrendLines) {
      const x1 = indexToX(tl.startIndex - startIdx);
      const y1 = priceToY(tl.startPrice);
      const x2 = indexToX(tl.endIndex - startIdx);
      const y2 = priceToY(tl.endPrice);
      ctx.save();
      ctx.strokeStyle = '#0052C2';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.fillStyle = '#0052C2';
      ctx.beginPath();
      ctx.arc(x1, y1, 3, 0, Math.PI * 2);
      ctx.arc(x2, y2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (pendingPoint && hoverPos) {
      const x1 = indexToX(pendingPoint.index - startIdx);
      const y1 = priceToY(pendingPoint.price);
      ctx.save();
      ctx.strokeStyle = '#0052C2';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(hoverPos.x, hoverPos.y);
      ctx.stroke();
      ctx.restore();
    }

    const lastBar = visibleBars[visibleBars.length - 1];
    if (lastBar) {
      const lastY = Math.round(priceToY(lastBar.close)) + 0.5;
      const isUpSession = replayActive
        ? lastBar.close >= lastBar.open
        : stock.price >= stock.prevClose;
      const tagBg = isUpSession ? '#0F8A4B' : '#DC2626';

      ctx.save();
      ctx.strokeStyle = tagBg;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, lastY);
      ctx.lineTo(PAD_LEFT + plotW, lastY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = tagBg;
      ctx.fillRect(PAD_LEFT + plotW + 1, lastY - 9, PAD_RIGHT - 2, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 10.5px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lastBar.close.toFixed(2), PAD_LEFT + plotW + 6, lastY);
    }

    // Lower sub-pane
    ctx.save();
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = textMuted;

    if (subIndicator === 'volume') {
      ctx.fillText('Volume', PAD_LEFT + 4, subTop + 2);
      const maxVol = Math.max(1, ...visibleBars.map((b) => b.volume));
      for (let i = 0; i < visibleBars.length; i++) {
        const b = visibleBars[i];
        const x = indexToX(i);
        const h = (b.volume / maxVol) * (subH - 14);
        ctx.fillStyle =
          b.close >= b.open
            ? isDark
              ? 'rgba(16, 185, 129, 0.45)'
              : 'rgba(0, 82, 194, 0.35)'
            : 'rgba(220, 38, 38, 0.40)';
        ctx.fillRect(x - bodyW / 2, subTop + subH - h, bodyW, h);
      }
      ctx.fillStyle = textMuted;
      ctx.fillText(formatVolume(maxVol), PAD_LEFT + plotW + 8, subTop + 4);
    } else if (subIndicator === 'rsi') {
      ctx.fillText('RSI (14)', PAD_LEFT + 4, subTop + 2);
      const y70 = subTop + subH - (70 / 100) * subH;
      const y30 = subTop + subH - (30 / 100) * subH;
      ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(1, 33, 105, 0.16)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y70);
      ctx.lineTo(PAD_LEFT + plotW, y70);
      ctx.moveTo(PAD_LEFT, y30);
      ctx.lineTo(PAD_LEFT + plotW, y30);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = textMuted;
      ctx.textBaseline = 'middle';
      ctx.fillText('70', PAD_LEFT + plotW + 8, y70);
      ctx.fillText('30', PAD_LEFT + plotW + 8, y30);

      ctx.strokeStyle = merrillBlue;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleBars.length; i++) {
        const val = indicators.rsi[startIdx + i];
        if (val === null) continue;
        const x = indexToX(i);
        const y = subTop + subH - (val / 100) * subH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    } else {
      ctx.fillText('MACD (12, 26, 9)', PAD_LEFT + 4, subTop + 2);
      let maxAbs = 0.1;
      for (let i = 0; i < visibleBars.length; i++) {
        const m = indicators.macd.macd[startIdx + i];
        const s = indicators.macd.signal[startIdx + i];
        const h = indicators.macd.hist[startIdx + i];
        if (m !== null) maxAbs = Math.max(maxAbs, Math.abs(m));
        if (s !== null) maxAbs = Math.max(maxAbs, Math.abs(s));
        if (h !== null) maxAbs = Math.max(maxAbs, Math.abs(h));
      }
      const zeroY = subTop + subH / 2;
      ctx.strokeStyle = divider;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, zeroY);
      ctx.lineTo(PAD_LEFT + plotW, zeroY);
      ctx.stroke();

      for (let i = 0; i < visibleBars.length; i++) {
        const h = indicators.macd.hist[startIdx + i];
        if (h === null) continue;
        const x = indexToX(i);
        const barH = (h / maxAbs) * (subH * 0.44);
        ctx.fillStyle = h >= 0 ? 'rgba(15, 138, 75, 0.48)' : 'rgba(220, 38, 38, 0.48)';
        ctx.fillRect(x - bodyW / 2, h >= 0 ? zeroY - barH : zeroY, bodyW, Math.abs(barH));
      }

      const drawSubLine = (arr: (number | null)[], col: string) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < visibleBars.length; i++) {
          const v = arr[startIdx + i];
          if (v === null) continue;
          const x = indexToX(i);
          const y = zeroY - (v / maxAbs) * (subH * 0.44);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };
      drawSubLine(indicators.macd.macd, merrillBlue);
      drawSubLine(indicators.macd.signal, '#D97706');
    }
    ctx.restore();

    // Crosshair (or Replay Cut preview vertical guide)
    if (
      hoverPos &&
      hoverPos.x >= PAD_LEFT &&
      hoverPos.x <= PAD_LEFT + plotW &&
      hoverPos.y >= PAD_TOP &&
      hoverPos.y <= PAD_TOP + totalPlotH
    ) {
      const snappedX = Math.round(indexToX(inspectedIndex)) + 0.5;
      const cy = Math.round(hoverPos.y) + 0.5;
      ctx.save();
      ctx.strokeStyle =
        drawMode === 'replay_cut'
          ? '#0052C2'
          : isDark
          ? 'rgba(148, 163, 184, 0.5)'
          : 'rgba(1, 33, 105, 0.35)';
      ctx.lineWidth = drawMode === 'replay_cut' ? 1.8 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(snappedX, PAD_TOP);
      ctx.lineTo(snappedX, PAD_TOP + totalPlotH);
      if (drawMode !== 'replay_cut') {
        ctx.moveTo(PAD_LEFT, cy);
        ctx.lineTo(PAD_LEFT + plotW, cy);
      }
      ctx.stroke();
      ctx.restore();

      if (hoverPos.y <= PAD_TOP + mainH && drawMode !== 'replay_cut') {
        const hoverPrice = yToPrice(hoverPos.y);
        ctx.fillStyle = merrillNavy;
        ctx.fillRect(PAD_LEFT + plotW + 1, cy - 9, PAD_RIGHT - 2, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10.5px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(hoverPrice.toFixed(2), PAD_LEFT + plotW + 6, cy);
      }

      const dateTxt = inspectedBar?.time ?? '';
      if (dateTxt) {
        const tw = 74;
        const bx = Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotW - tw, snappedX - tw / 2));
        ctx.fillStyle = merrillNavy;
        ctx.fillRect(bx, PAD_TOP + totalPlotH + 3, tw, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dateTxt, bx + tw / 2, PAD_TOP + totalPlotH + 12);
      }
    }

    ctx.fillStyle = textBright;
  }, [
    canvasSize,
    visibleBars,
    startIdx,
    isDark,
    chartType,
    subIndicator,
    showSma20,
    showEma50,
    showEma200,
    showBollinger,
    showVwap,
    compareOverlay,
    indicators,
    minPrice,
    maxPrice,
    hoverPos,
    inspectedIndex,
    inspectedBar,
    currentPriceLines,
    currentTrendLines,
    currentFibs,
    symbolAlerts,
    pendingPoint,
    drawMode,
    replayActive,
    stock.price,
    stock.prevClose,
    plotW,
    mainH,
    subH,
    subTop,
    totalPlotH,
  ]);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.14 : 0.88;
    setVisibleCount((prev) => Math.max(16, Math.min(bars.length, Math.round(prev * factor))));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drawMode === 'replay_cut' && x >= PAD_LEFT && x <= PAD_LEFT + plotW) {
      const cutGlobalIdx = Math.max(12, Math.min(fullBars.length - 1, startIdx + xToLocalIndex(x)));
      setReplayActive(true);
      setReplayPlaying(false);
      setReplayEndIdx(cutGlobalIdx);
      setRightOffset(0);
      setDrawMode('cursor');
      return;
    }

    if (drawMode === 'hline' && y >= PAD_TOP && y <= PAD_TOP + mainH) {
      const price = Number(yToPrice(y).toFixed(2));
      setPriceLinesBySymbol((prev) => ({
        ...prev,
        [stock.symbol]: [
          ...(prev[stock.symbol] ?? []),
          { id: `hl-${Date.now()}`, price, label: `Level ${price.toFixed(2)}` },
        ],
      }));
      setDrawMode('cursor');
      return;
    }

    if ((drawMode === 'trendline' || drawMode === 'fib') && y >= PAD_TOP && y <= PAD_TOP + mainH) {
      const globalIdx = startIdx + xToLocalIndex(x);
      const price = Number(yToPrice(y).toFixed(2));
      if (!pendingPoint) {
        setPendingPoint({ index: globalIdx, price });
      } else {
        if (drawMode === 'trendline') {
          setTrendLinesBySymbol((prev) => ({
            ...prev,
            [stock.symbol]: [
              ...(prev[stock.symbol] ?? []),
              {
                id: `tl-${Date.now()}`,
                startIndex: pendingPoint.index,
                startPrice: pendingPoint.price,
                endIndex: globalIdx,
                endPrice: price,
              },
            ],
          }));
        } else {
          setFibsBySymbol((prev) => ({
            ...prev,
            [stock.symbol]: [
              ...(prev[stock.symbol] ?? []),
              {
                id: `fib-${Date.now()}`,
                startIndex: pendingPoint.index,
                startPrice: pendingPoint.price,
                endIndex: globalIdx,
                endPrice: price,
              },
            ],
          }));
        }
        setPendingPoint(null);
        setDrawMode('cursor');
      }
      return;
    }

    setIsDragging(true);
    dragStartRef.current = { x, startOffset: rightOffset };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHoverPos({ x, y });

    if (isDragging && dragStartRef.current) {
      const dx = x - dragStartRef.current.x;
      const pxPerBar = plotW / Math.max(1, visibleBars.length);
      const barShift = Math.round(dx / Math.max(2, pxPerBar));
      const maxOffset = Math.max(0, bars.length - visibleBars.length);
      setRightOffset(Math.max(0, Math.min(maxOffset, dragStartRef.current.startOffset + barShift)));
    }
  };

  const handleMouseUpOrLeave = (clearHover: boolean) => {
    setIsDragging(false);
    dragStartRef.current = null;
    if (clearHover) setHoverPos(null);
  };

  const toggleReplayMode = () => {
    if (replayActive) {
      setReplayActive(false);
      setReplayPlaying(false);
      setReplayEndIdx(null);
      if (drawMode === 'replay_cut') setDrawMode('cursor');
    } else {
      setReplayActive(true);
      setReplayPlaying(false);
      setReplayEndIdx(Math.max(15, Math.floor(fullBars.length * 0.55)));
      setRightOffset(0);
    }
  };

  const handleSaveCurrentLayout = () => {
    if (savedLayouts.length >= tierLimits.maxSavedLayouts) {
      onRequireUpgrade(
        'pro',
        `Saving more than ${tierLimits.maxSavedLayouts} chart templates`
      );
      return;
    }
    const label = newLayoutName.trim() || `${timeframe} ${chartType} Setup`;
    const next: SavedChartLayout = {
      id: `layout-${Date.now()}`,
      name: label,
      timeframe,
      chartType,
      subIndicator,
      showSma20,
      showEma50,
      showEma200,
      showBollinger,
      showVwap,
      splitMode,
      compareSymbol,
    };
    setSavedLayouts((prev) => [next, ...prev]);
    setNewLayoutName('');
  };

  const handleSelectSplitMode = (mode: SplitLayoutMode) => {
    if (mode !== '1' && !tierLimits.multiChartSplit) {
      onRequireUpgrade('pro', 'Multi-Chart Split Layouts (2x & 4x)');
      return;
    }
    setSplitMode(mode);
  };

  const handleLoadLayout = (layout: SavedChartLayout) => {
    if (layout.splitMode !== '1' && !tierLimits.multiChartSplit) {
      onRequireUpgrade('pro', 'Multi-Chart Split Layouts (2x & 4x)');
      return;
    }
    setTimeframe(layout.timeframe);
    setChartType(layout.chartType);
    setSubIndicator(layout.subIndicator);
    setShowSma20(layout.showSma20);
    setShowEma50(layout.showEma50);
    setShowEma200(layout.showEma200);
    setShowBollinger(layout.showBollinger);
    setShowVwap(layout.showVwap);
    setSplitMode(layout.splitMode);
    setCompareSymbol(layout.compareSymbol);
  };

  const handleCreateAlert = () => {
    const target = Number(alertPriceInput);
    if (!Number.isFinite(target) || target <= 0) return;
    onAddAlert(stock.symbol, alertCondition, Number(target.toFixed(2)), alertNoteInput.trim());
    setAlertNoteInput('');
  };

  const orderBook = useMemo(() => {
    const tick = stock.price >= 200 ? 0.05 : 0.02;
    const asks = Array.from({ length: 6 }, (_, i) => {
      const level = 6 - i;
      const price = Number((stock.price + tick * level).toFixed(2));
      const size =
        Math.round(((Math.sin(stock.price * 7 + level * 1.9) + 1.5) * 420 + 180) / 10) * 10;
      return { price, size };
    });
    const bids = Array.from({ length: 6 }, (_, i) => {
      const level = i + 1;
      const price = Number(Math.max(0.01, stock.price - tick * level).toFixed(2));
      const size =
        Math.round(((Math.cos(stock.price * 5 + level * 2.3) + 1.5) * 440 + 160) / 10) * 10;
      return { price, size };
    });
    const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size), 1);
    const spread = Number((asks[asks.length - 1].price - bids[0].price).toFixed(2));
    return { asks, bids, maxSize, spread };
  }, [stock.price]);

  const existingHolding = holdings.find((h) => h.symbol === stock.symbol);
  const sessionChange = stock.price - stock.prevClose;
  const sessionChangePct = (sessionChange / Math.max(0.01, stock.prevClose)) * 100;
  const isUp = sessionChange >= 0;

  const handlePositionSubmit = (side: 'buy' | 'sell') => {
    const qty = Number(tradeShares);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const delta = side === 'buy' ? qty : -qty;
    onAddOrUpdateHolding(stock.symbol, delta, stock.price);
    setTradeFeedback(
      `${side === 'buy' ? 'Added' : 'Reduced'} ${qty} sh ${stock.symbol} @ ${formatCurrency(stock.price, 2)}`
    );
    window.setTimeout(() => setTradeFeedback(null), 3000);
  };

  const w52PositionPct = Math.max(
    0,
    Math.min(
      100,
      ((stock.price - stock.week52Low) / Math.max(0.01, stock.week52High - stock.week52Low)) * 100
    )
  );

  const hasDrawings =
    currentPriceLines.length > 0 || currentTrendLines.length > 0 || currentFibs.length > 0;
  const activeAlertCount = alerts.filter((a) => !a.triggeredAt).length;

  return (
    <div className="h-full flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
      {/* Main Chart Column */}
      <div className="flex-1 min-w-0 flex flex-col border-b xl:border-b-0 xl:border-r border-[#D6E2F0] dark:border-slate-800">
        {/* Ticker Identity & Quote Header */}
        <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#0E131D]">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight text-[#012169] dark:text-white font-mono">
                {stock.symbol}
              </h1>
              <span className="text-sm font-medium text-[#2A4166] dark:text-slate-200 truncate">
                {stock.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#5A7190] dark:text-slate-400 mt-0.5 flex-wrap">
              <span>{stock.exchange}</span>
              <span aria-hidden="true">·</span>
              <span>{stock.sector}</span>
              <span aria-hidden="true">·</span>
              <span>{stock.isLive ? 'Yahoo Finance Live' : 'Baseline Feed'}</span>
              {loadingChart && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#0052C2] dark:text-blue-400">Updating bars...</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6 font-mono tabular-nums">
            <div className="text-right">
              <div className="text-xl font-semibold text-[#012169] dark:text-white leading-tight">
                ${stock.price.toFixed(2)}
              </div>
              <div
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  isUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {isUp ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                )}
                <span>
                  {isUp ? '+' : ''}
                  {sessionChange.toFixed(2)} ({isUp ? '+' : ''}
                  {sessionChangePct.toFixed(2)}%)
                </span>
              </div>
            </div>

            <div className="hidden sm:grid grid-cols-3 gap-5 pl-5 border-l border-[#D6E2F0] dark:border-slate-800 text-xs">
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">
                  Day High
                </div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">
                  {stock.dayHigh.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">
                  Day Low
                </div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">
                  {stock.dayLow.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">
                  Volume
                </div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">
                  {formatVolume(stock.volume)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chart Controls Toolbar (Row 1: Timeframes, Chart Types, Unrestricted Indicators, Compare) */}
        <div className="px-4 py-2 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-0.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 rounded text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                    timeframe === tf
                      ? 'bg-[#0052C2] text-white'
                      : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[#D6E2F0] dark:bg-slate-700" />

            <div className="flex items-center gap-0.5">
              {CHART_TYPES.map((ct) => (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => setChartType(ct.id)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    chartType === ct.id
                      ? 'bg-[#012169] text-white dark:bg-slate-700'
                      : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                  }`}
                >
                  {ct.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[#D6E2F0] dark:bg-slate-700" />

            {/* Unlimited Simultaneous Indicators */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setShowSma20((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showSma20
                    ? 'bg-[#EAF2FD] text-[#0052C2] dark:bg-blue-500/20 dark:text-blue-300'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                SMA 20
              </button>
              <button
                type="button"
                onClick={() => setShowEma50((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showEma50
                    ? 'bg-[#E2EAF7] text-[#012169] dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                EMA 50
              </button>
              <button
                type="button"
                onClick={() => setShowEma200((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showEma200
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                EMA 200
              </button>
              <button
                type="button"
                onClick={() => setShowBollinger((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showBollinger
                    ? 'bg-[#EAF2FD] text-[#0052C2] dark:bg-blue-500/20 dark:text-blue-300'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                BB
              </button>
              <button
                type="button"
                onClick={() => setShowVwap((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showVwap
                    ? 'bg-sky-50 text-sky-700 dark:bg-cyan-500/15 dark:text-cyan-400'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                VWAP
              </button>
            </div>

            <div className="h-4 w-px bg-[#D6E2F0] dark:bg-slate-700" />

            {/* Compare Overlay Selector */}
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[#5A7190] dark:text-slate-400">
              <span>Compare</span>
              <select
                value={compareSymbol ?? ''}
                onChange={(e) => setCompareSymbol(e.target.value || null)}
                aria-label="Compare overlay symbol"
                className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#012169] dark:text-white"
              >
                <option value="">None</option>
                {availableSymbols
                  .filter((sym) => sym !== stock.symbol)
                  .map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sub-Indicators */}
            <div className="flex items-center gap-0.5">
              {SUB_INDICATORS.map((ind) => (
                <button
                  key={ind.id}
                  type="button"
                  onClick={() => setSubIndicator(ind.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    subIndicator === ind.id
                      ? 'bg-[#012169] text-white dark:bg-slate-700'
                      : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                  }`}
                >
                  {ind.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[#D6E2F0] dark:bg-slate-700" />

            {/* Multi-Chart Split Layout (1x / 2x / 4x) */}
            <div
              className="inline-flex items-center gap-0.5 bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 rounded p-0.5"
              title="Multi-chart split-screen layout"
            >
              <LayoutGrid className="w-3 h-3 text-[#5A7190] mx-1" />
              {(['1', '2', '4'] as SplitLayoutMode[]).map((mode) => {
                const locked = mode !== '1' && !tierLimits.multiChartSplit;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleSelectSplitMode(mode)}
                    title={locked ? 'Pro Trader feature' : `${mode}x Chart Layout`}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium transition-colors ${
                      splitMode === mode
                        ? 'bg-[#0052C2] text-white'
                        : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{mode}x</span>
                    {locked && <Lock className="w-2.5 h-2.5 opacity-70" />}
                  </button>
                );
              })}
            </div>

            {/* Unrestricted Bar Replay Toggle (Works on Intraday 1D & All Timeframes) */}
            <button
              type="button"
              onClick={toggleReplayMode}
              title="Bar Replay on any timeframe including 1D intraday"
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                replayActive
                  ? 'bg-[#012169] text-white'
                  : 'bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#012169] dark:text-slate-200 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
              }`}
            >
              <Rewind className="w-3 h-3" />
              <span>Replay</span>
            </button>

            <div className="h-4 w-px bg-[#D6E2F0] dark:bg-slate-700" />

            {/* Drawing Tools (Persistent per Symbol) */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setDrawMode('cursor');
                  setPendingPoint(null);
                }}
                title="Crosshair / Pan"
                className={`p-1.5 rounded transition-colors ${
                  drawMode === 'cursor'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawMode(drawMode === 'hline' ? 'cursor' : 'hline');
                  setPendingPoint(null);
                }}
                title="Place horizontal price level"
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  drawMode === 'hline'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                Level
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawMode(drawMode === 'trendline' ? 'cursor' : 'trendline');
                  setPendingPoint(null);
                }}
                title="Draw 2-point trendline"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  drawMode === 'trendline'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                <span>Trend</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawMode(drawMode === 'fib' ? 'cursor' : 'fib');
                  setPendingPoint(null);
                }}
                title="Draw 2-point Fibonacci Retracement"
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  drawMode === 'fib'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                Fib
              </button>

              {hasDrawings && (
                <button
                  type="button"
                  onClick={() => {
                    setPriceLinesBySymbol((p) => ({ ...p, [stock.symbol]: [] }));
                    setTrendLinesBySymbol((p) => ({ ...p, [stock.symbol]: [] }));
                    setFibsBySymbol((p) => ({ ...p, [stock.symbol]: [] }));
                  }}
                  title="Clear drawings for this ticker"
                  className="p-1.5 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setVisibleCount((v) => Math.max(16, Math.round(v * 0.78)))}
                title="Zoom in"
                className="p-1.5 rounded text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((v) => Math.min(bars.length, Math.round(v * 1.25)))
                }
                title="Zoom out"
                className="p-1.5 rounded text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisibleCount(Math.min(bars.length, 120));
                  setRightOffset(0);
                }}
                title="Reset chart view"
                className="p-1.5 rounded text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Unrestricted Bar Replay Control Strip */}
        {replayActive && (
          <div className="px-4 py-2 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#012169] text-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight">Bar Replay ({timeframe})</span>
              <span className="text-blue-200 font-mono tabular-nums text-[11px]">
                Bar {bars.length} / {fullBars.length} · {bars[bars.length - 1]?.time ?? ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setReplayPlaying(false);
                  setDrawMode(drawMode === 'replay_cut' ? 'cursor' : 'replay_cut');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  drawMode === 'replay_cut'
                    ? 'bg-white text-[#012169]'
                    : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
              >
                <Scissors className="w-3 h-3" />
                <span>{drawMode === 'replay_cut' ? 'Click any candle...' : 'Cut to Bar'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReplayPlaying(false);
                  setReplayEndIdx((prev) => Math.max(12, (prev ?? bars.length - 1) - 1));
                }}
                title="Step back 1 bar"
                className="p-1.5 rounded bg-white/15 hover:bg-white/25"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setReplayPlaying((p) => !p)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0052C2] hover:bg-blue-500 font-semibold text-[11px]"
              >
                {replayPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{replayPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReplayPlaying(false);
                  setReplayEndIdx((prev) =>
                    Math.min(fullBars.length - 1, (prev ?? bars.length - 1) + 1)
                  );
                }}
                title="Step forward 1 bar"
                className="p-1.5 rounded bg-white/15 hover:bg-white/25"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <select
                value={replaySpeedMs}
                onChange={(e) => setReplaySpeedMs(Number(e.target.value))}
                aria-label="Replay speed"
                className="px-1.5 py-1 rounded text-[11px] font-mono bg-white/15 text-white border border-white/25"
              >
                <option value={950} className="text-slate-900">
                  1x
                </option>
                <option value={450} className="text-slate-900">
                  2x
                </option>
                <option value={200} className="text-slate-900">
                  4x
                </option>
              </select>

              <button
                type="button"
                onClick={toggleReplayMode}
                className="ml-1 px-2.5 py-1 rounded text-[11px] font-medium bg-white/15 hover:bg-rose-600 transition-colors"
              >
                Exit
              </button>
            </div>
          </div>
        )}

        {/* Chart Canvas Viewport (1x Full, 2x Dual, or 4x Quad Split-Screen) */}
        <div
          className={`flex-1 min-h-[440px] overflow-hidden ${
            splitMode === '1'
              ? 'flex flex-col'
              : splitMode === '2'
              ? 'grid grid-cols-1 lg:grid-cols-2 gap-0'
              : 'grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 gap-0'
          }`}
        >
          {/* Primary Interactive Canvas */}
          <div
            ref={containerRef}
            className="relative flex-1 min-h-[260px] h-full bg-white dark:bg-[#0B0F17] select-none overflow-hidden"
          >
            {inspectedBar && (
              <div className="pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums bg-white/90 dark:bg-[#0B0F17]/85 px-2 py-1 rounded">
                <span className="text-[#5A7190] dark:text-slate-400">{inspectedBar.time}</span>
                <span>
                  <span className="text-slate-400 mr-1">O</span>
                  <span className="text-[#0A1F44] dark:text-slate-100">
                    {inspectedBar.open.toFixed(2)}
                  </span>
                </span>
                <span>
                  <span className="text-slate-400 mr-1">H</span>
                  <span className="text-[#0A1F44] dark:text-slate-100">
                    {inspectedBar.high.toFixed(2)}
                  </span>
                </span>
                <span>
                  <span className="text-slate-400 mr-1">L</span>
                  <span className="text-[#0A1F44] dark:text-slate-100">
                    {inspectedBar.low.toFixed(2)}
                  </span>
                </span>
                <span>
                  <span className="text-slate-400 mr-1">C</span>
                  <span
                    className={
                      inspectedBar.close >= inspectedBar.open
                        ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                        : 'text-rose-600 dark:text-rose-400 font-medium'
                    }
                  >
                    {inspectedBar.close.toFixed(2)}
                  </span>
                </span>
                <span>
                  <span className="text-slate-400 mr-1">Vol</span>
                  <span className="text-[#334E73] dark:text-slate-300">
                    {formatVolume(inspectedBar.volume)}
                  </span>
                </span>
                {showSma20 && indicators.sma20[inspectedGlobalIdx] !== null && (
                  <span className="text-[#0052C2] dark:text-blue-400">
                    SMA20 {indicators.sma20[inspectedGlobalIdx]!.toFixed(2)}
                  </span>
                )}
                {showEma50 && indicators.ema50[inspectedGlobalIdx] !== null && (
                  <span className="text-[#012169] dark:text-indigo-400">
                    EMA50 {indicators.ema50[inspectedGlobalIdx]!.toFixed(2)}
                  </span>
                )}
                {showEma200 && indicators.ema200[inspectedGlobalIdx] !== null && (
                  <span className="text-amber-700 dark:text-amber-400">
                    EMA200 {indicators.ema200[inspectedGlobalIdx]!.toFixed(2)}
                  </span>
                )}
                {compareOverlay && (
                  <span className="text-violet-700 dark:text-violet-400 font-medium">
                    vs {compareOverlay.symbol} ({compareOverlay.compReturnPct >= 0 ? '+' : ''}
                    {compareOverlay.compReturnPct.toFixed(1)}% vs{' '}
                    {compareOverlay.primaryReturnPct >= 0 ? '+' : ''}
                    {compareOverlay.primaryReturnPct.toFixed(1)}%)
                  </span>
                )}
                {drawMode !== 'cursor' && (
                  <span className="text-[#0052C2] dark:text-blue-400 font-sans font-medium">
                    {drawMode === 'hline'
                      ? 'Click chart to place level'
                      : drawMode === 'replay_cut'
                      ? 'Click any candle to start Bar Replay'
                      : pendingPoint
                      ? `Click second point to finish ${drawMode === 'fib' ? 'Fibonacci' : 'trendline'}`
                      : `Click first point to start ${drawMode === 'fib' ? 'Fibonacci' : 'trendline'}`}
                  </span>
                )}
              </div>
            )}

            <canvas
              ref={canvasRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={() => handleMouseUpOrLeave(false)}
              onMouseLeave={() => handleMouseUpOrLeave(true)}
              style={{ width: canvasSize.width, height: canvasSize.height }}
              className={`block ${
                drawMode !== 'cursor'
                  ? 'cursor-crosshair'
                  : isDragging
                  ? 'cursor-grabbing'
                  : 'cursor-crosshair'
              }`}
            />
          </div>

          {/* Companion Multi-Chart Tiles for 2x and 4x Split-Screen */}
          {splitMode !== '1' &&
            tileConfigs.slice(0, splitMode === '2' ? 1 : 3).map((cfg, idx) => (
              <MiniChartTile
                key={`tile-${idx}`}
                symbol={cfg.symbol}
                timeframe={cfg.timeframe}
                allStocks={allStocks}
                isDark={isDark}
                showSma20={showSma20}
                onChangeSymbol={(sym) =>
                  setTileConfigs((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, symbol: sym } : item))
                  )
                }
                onChangeTimeframe={(tf) =>
                  setTileConfigs((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, timeframe: tf } : item))
                  )
                }
                onFocusSymbol={(sym) => {
                  onSelectSymbol(sym);
                  setSplitMode('1');
                }}
              />
            ))}
        </div>
      </div>

      {/* Contextual Right Rail: Depth & Trade | Never-Expiring Alerts | Saved Layouts */}
      <div className="w-full xl:w-[296px] shrink-0 bg-white dark:bg-[#0E131D] flex flex-col xl:overflow-hidden">
        {/* Rail Tab Bar */}
        <div className="px-2.5 py-2 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] grid grid-cols-3 gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setRailTab('depth')}
            className={`py-1.5 px-2 rounded font-medium whitespace-nowrap transition-colors ${
              railTab === 'depth'
                ? 'bg-[#0052C2] text-white'
                : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
            }`}
          >
            Depth &amp; Trade
          </button>
          <button
            type="button"
            onClick={() => setRailTab('alerts')}
            className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded font-medium whitespace-nowrap transition-colors ${
              railTab === 'alerts'
                ? 'bg-[#0052C2] text-white'
                : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
            }`}
          >
            <Bell className="w-3 h-3" />
            <span>Alerts ({activeAlertCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setRailTab('layouts')}
            className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded font-medium whitespace-nowrap transition-colors ${
              railTab === 'layouts'
                ? 'bg-[#0052C2] text-white'
                : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
            }`}
          >
            <Bookmark className="w-3 h-3" />
            <span>Layouts</span>
          </button>
        </div>

        <div className="flex-1 xl:overflow-y-auto divide-y divide-[#D6E2F0] dark:divide-slate-800">
          {railTab === 'depth' && (
            <>
              {/* Level 2 Market Depth */}
              <div className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                    Indicative Order Book
                  </h2>
                  <span className="text-[11px] font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
                    Spread ${orderBook.spread.toFixed(2)}
                  </span>
                </div>

                <div className="grid grid-cols-2 text-[11px] text-[#5A7190] dark:text-slate-400 pb-1">
                  <span>Price (USD)</span>
                  <span className="text-right">Size</span>
                </div>

                <div className="space-y-0.5 font-mono tabular-nums text-xs">
                  {orderBook.asks.map((ask) => {
                    const pct = (ask.size / orderBook.maxSize) * 100;
                    return (
                      <div
                        key={`ask-${ask.price}`}
                        className="relative flex justify-between py-0.5 px-1.5"
                      >
                        <div
                          className="absolute inset-y-0 right-0 bg-rose-500/10 dark:bg-rose-500/15"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative text-rose-600 dark:text-rose-400">
                          {ask.price.toFixed(2)}
                        </span>
                        <span className="relative text-[#2A4166] dark:text-slate-300">
                          {ask.size}
                        </span>
                      </div>
                    );
                  })}

                  <div className="py-1.5 my-1 border-y border-[#D6E2F0] dark:border-slate-800 flex items-center justify-between px-1.5 bg-[#F8FAFD] dark:bg-transparent">
                    <span className="font-semibold text-[#012169] dark:text-white">
                      {stock.price.toFixed(2)}
                    </span>
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">
                      Last Trade
                    </span>
                  </div>

                  {orderBook.bids.map((bid) => {
                    const pct = (bid.size / orderBook.maxSize) * 100;
                    return (
                      <div
                        key={`bid-${bid.price}`}
                        className="relative flex justify-between py-0.5 px-1.5"
                      >
                        <div
                          className="absolute inset-y-0 right-0 bg-[#0052C2]/10 dark:bg-emerald-500/15"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative text-emerald-700 dark:text-emerald-400">
                          {bid.price.toFixed(2)}
                        </span>
                        <span className="relative text-[#2A4166] dark:text-slate-300">
                          {bid.size}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Key Statistics */}
              <div className="p-4 space-y-3">
                <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                  Session &amp; Valuation Metrics
                </h2>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-[#5A7190] dark:text-slate-400">
                    <span>52-Week Range</span>
                    <span className="font-mono tabular-nums">
                      {stock.week52Low.toFixed(2)} – {stock.week52High.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-[#DCE6F5] dark:bg-slate-800">
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#0052C2] dark:bg-blue-400 border-2 border-white dark:border-[#0E131D]"
                      style={{ left: `calc(${w52PositionPct}% - 5px)` }}
                    />
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">Market Cap</dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      $
                      {stock.marketCapB >= 1000
                        ? `${(stock.marketCapB / 1000).toFixed(2)}T`
                        : `${stock.marketCapB.toFixed(1)}B`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      P/E (TTM / Fwd)
                    </dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {stock.peTtm.toFixed(1)}x / {stock.peForward.toFixed(1)}x
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">EV / EBITDA</dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {stock.evEbitda.toFixed(1)}x
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Dividend Yield
                    </dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {stock.dividendYield.toFixed(2)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">Beta (5Y)</dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {stock.beta.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">Avg Volume</dt>
                    <dd className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {formatVolume(stock.avgVolume)}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Portfolio Position Ticket */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                    Portfolio Position
                  </h2>
                  <span className="text-[11px] font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
                    {existingHolding ? `${existingHolding.shares} sh held` : 'No position'}
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Shares</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={tradeShares}
                      onChange={(e) => setTradeShares(e.target.value)}
                      className="mt-1 w-full px-3 py-1.5 text-xs font-mono tabular-nums rounded-md bg-[#F8FAFD] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-slate-100 focus:outline-none focus:border-[#0052C2]"
                    />
                  </label>

                  <div className="flex items-center justify-between text-[11px] text-[#5A7190] dark:text-slate-400">
                    <span>Estimated Value</span>
                    <span className="font-mono tabular-nums font-medium text-[#0A1F44] dark:text-slate-100">
                      {formatCurrency((Number(tradeShares) || 0) * stock.price, 2)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handlePositionSubmit('buy')}
                      className="py-2 px-3 rounded-md text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white transition-colors"
                    >
                      Add Shares
                    </button>
                    <button
                      type="button"
                      disabled={!existingHolding || existingHolding.shares <= 0}
                      onClick={() => handlePositionSubmit('sell')}
                      className="py-2 px-3 rounded-md text-xs font-semibold bg-[#EAF2FD] hover:bg-[#D6E5FA] dark:bg-slate-800 dark:hover:bg-slate-700 text-[#012169] dark:text-slate-100 disabled:opacity-40 transition-colors"
                    >
                      Reduce
                    </button>
                  </div>

                  {tradeFeedback && (
                    <p className="text-[11px] font-medium text-[#0052C2] dark:text-blue-400">
                      {tradeFeedback}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {railTab === 'alerts' && (
            <>
              <div className="p-4 space-y-3">
                <div>
                  <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                    Never-Expiring Price Alerts
                  </h2>
                  <p className="text-[11px] text-[#5A7190] dark:text-slate-400 mt-0.5">
                    Alerts stay active indefinitely, plot directly on the chart, and auto-trigger on
                    live quotes.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                        Condition
                      </span>
                      <select
                        value={alertCondition}
                        onChange={(e) => {
                          const c = e.target.value as 'above' | 'below';
                          setAlertCondition(c);
                          setAlertPriceInput(
                            (stock.price * (c === 'above' ? 1.03 : 0.97)).toFixed(2)
                          );
                        }}
                        className="mt-1 w-full px-2 py-1.5 text-xs rounded bg-[#F8FAFD] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                      >
                        <option value="above">Crosses Above</option>
                        <option value="below">Crosses Below</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                        Target ($)
                      </span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.01}
                        value={alertPriceInput}
                        onChange={(e) => setAlertPriceInput(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 text-xs font-mono tabular-nums rounded bg-[#F8FAFD] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Note (optional)
                    </span>
                    <input
                      type="text"
                      placeholder={`e.g. ${stock.symbol} breakout level`}
                      value={alertNoteInput}
                      onChange={(e) => setAlertNoteInput(e.target.value)}
                      className="mt-1 w-full px-2.5 py-1.5 text-xs rounded bg-[#F8FAFD] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleCreateAlert}
                    className="w-full py-2 px-3 rounded-md text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white transition-colors"
                  >
                    Set {stock.symbol} Alert (No Expiry)
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#012169] dark:text-slate-200">
                    All Saved Alerts ({alerts.length})
                  </span>
                  <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                    Never expire
                  </span>
                </div>

                {alerts.length === 0 ? (
                  <p className="text-xs text-[#5A7190] dark:text-slate-400 py-4 text-center">
                    No alerts configured yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {alerts.map((al) => {
                      const liveP = allStocks[al.symbol]?.price;
                      return (
                        <div
                          key={al.id}
                          className="p-2.5 rounded border border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#141B29] space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(al.symbol)}
                              className="font-mono font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                            >
                              {al.symbol}
                            </button>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-semibold ${
                                  al.triggeredAt
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {al.triggeredAt ? 'Triggered' : 'Armed'}
                              </span>
                              {al.triggeredAt && (
                                <button
                                  type="button"
                                  onClick={() => onResetAlert(al.id)}
                                  className="text-[10px] text-[#0052C2] hover:underline"
                                >
                                  Re-arm
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onDeleteAlert(al.id)}
                                aria-label={`Delete ${al.symbol} alert`}
                                className="p-0.5 text-[#5A7190] hover:text-rose-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <div className="font-mono tabular-nums text-[11px] text-[#0A1F44] dark:text-slate-200">
                            {al.condition === 'above' ? 'Above' : 'Below'} $
                            {al.targetPrice.toFixed(2)}
                            {liveP !== undefined && (
                              <span className="text-[#5A7190] dark:text-slate-400">
                                {' '}
                                · Now ${liveP.toFixed(2)}
                              </span>
                            )}
                          </div>
                          {al.note && (
                            <div className="text-[11px] text-[#5A7190] dark:text-slate-400 truncate">
                              {al.note}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {railTab === 'layouts' && (
            <>
              <div className="p-4 space-y-3">
                <div>
                  <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                    Unlimited Saved Chart Layouts
                  </h2>
                  <p className="text-[11px] text-[#5A7190] dark:text-slate-400 mt-0.5">
                    Save your active timeframe, indicators, compare overlay, and split-screen mode
                    with zero caps.
                  </p>
                </div>

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Layout name..."
                    value={newLayoutName}
                    onChange={(e) => setNewLayoutName(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded bg-[#F8FAFD] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCurrentLayout}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white whitespace-nowrap"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-2">
                {savedLayouts.map((layout) => {
                  const activeInds = [
                    layout.showSma20 && 'SMA20',
                    layout.showEma50 && 'EMA50',
                    layout.showEma200 && 'EMA200',
                    layout.showBollinger && 'BB',
                    layout.showVwap && 'VWAP',
                  ].filter(Boolean);
                  return (
                    <div
                      key={layout.id}
                      className="p-2.5 rounded border border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#141B29] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleLoadLayout(layout)}
                          className="text-xs font-semibold text-[#012169] dark:text-white hover:text-[#0052C2] dark:hover:text-blue-400 text-left truncate"
                        >
                          {layout.name}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSavedLayouts((prev) => prev.filter((l) => l.id !== layout.id))
                          }
                          aria-label={`Delete ${layout.name}`}
                          className="p-0.5 text-[#5A7190] hover:text-rose-600 shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-[11px] font-mono text-[#5A7190] dark:text-slate-400">
                        {layout.timeframe} · {layout.splitMode}x Split ·{' '}
                        {layout.subIndicator.toUpperCase()}
                        {layout.compareSymbol ? ` · vs ${layout.compareSymbol}` : ''}
                      </div>
                      {activeInds.length > 0 && (
                        <div className="text-[10px] text-[#0052C2] dark:text-blue-400">
                          {activeInds.join(' · ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
