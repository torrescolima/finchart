import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Minus,
  Plus,
  RotateCcw,
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
import { fetchLiveChart } from '../services/marketApi';
import {
  ChartType,
  OhlcBar,
  PortfolioHolding,
  PriceLine,
  StockProfile,
  SubIndicator,
  Timeframe,
  TrendLine,
} from '../types/market';
import { formatCurrency, formatVolume } from '../utils/financeMath';

interface ChartTerminalProps {
  stock: StockProfile;
  isDark: boolean;
  holdings: PortfolioHolding[];
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

type DrawMode = 'cursor' | 'hline' | 'trendline';

export function ChartTerminal({
  stock,
  isDark,
  holdings,
  onAddOrUpdateHolding,
}: ChartTerminalProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('6M');
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [subIndicator, setSubIndicator] = useState<SubIndicator>('volume');
  const [showSma20, setShowSma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVwap, setShowVwap] = useState(false);

  // Live OHLCV chart cache per symbol + timeframe
  const [liveBarsCache, setLiveBarsCache] = useState<Record<string, OhlcBar[]>>({});
  const [loadingChart, setLoadingChart] = useState(false);

  const [drawMode, setDrawMode] = useState<DrawMode>('cursor');
  const [priceLinesBySymbol, setPriceLinesBySymbol] = useState<Record<string, PriceLine[]>>({});
  const [trendLinesBySymbol, setTrendLinesBySymbol] = useState<Record<string, TrendLine[]>>({});
  const [pendingTrendStart, setPendingTrendStart] = useState<{ index: number; price: number } | null>(
    null
  );

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

  const bars: OhlcBar[] = useMemo(() => {
    const live = liveBarsCache[cacheKey];
    if (live && live.length > 0) return live;
    return getBarsForTimeframe(stock.bars, timeframe);
  }, [liveBarsCache, cacheKey, stock.bars, timeframe]);

  // Reset zoom/pan when timeframe or ticker changes
  useEffect(() => {
    setVisibleCount(
      Math.min(
        bars.length,
        timeframe === '1D' ? 80 : timeframe === '1W' ? 70 : timeframe === '1M' ? 30 : 120
      )
    );
    setRightOffset(0);
    setPendingTrendStart(null);
  }, [stock.symbol, timeframe, bars.length]);

  // Measure canvas container cleanly via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 100 && h > 180) {
          setCanvasSize({ width: w, height: h });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Precompute technical indicators on active bars
  const indicators = useMemo(() => {
    const closes = bars.map((b) => b.close);
    return {
      sma20: computeSMA(closes, 20),
      ema50: computeEMA(closes, 50),
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

  // Geometry constants
  const PAD_LEFT = 12;
  const PAD_RIGHT = 68;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 26;
  const SUB_GAP = 14;
  const plotW = Math.max(100, canvasSize.width - PAD_LEFT - PAD_RIGHT);
  const totalPlotH = Math.max(160, canvasSize.height - PAD_TOP - PAD_BOTTOM);
  const subH = Math.round(totalPlotH * 0.24);
  const mainH = totalPlotH - subH - SUB_GAP;
  const subTop = PAD_TOP + mainH + SUB_GAP;

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
    }
    const pad = Math.max((hi - lo) * 0.08, hi * 0.005);
    return { minPrice: lo - pad, maxPrice: hi + pad };
  }, [visibleBars, startIdx, showBollinger, indicators.bb]);

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

  const currentPriceLines = priceLinesBySymbol[stock.symbol] ?? [];
  const currentTrendLines = trendLinesBySymbol[stock.symbol] ?? [];

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

    // Merrill Lynch Crisp White & Blue Light Palette + Institutional Dark Palette
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

    if (showSma20) drawOverlaySeries(indicators.sma20, '#0052C2', 1.45);
    if (showEma50) drawOverlaySeries(indicators.ema50, '#012169', 1.45);
    if (showVwap) drawOverlaySeries(indicators.vwap, '#0284C7', 1.4, [4, 2]);

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

    if (pendingTrendStart && hoverPos) {
      const x1 = indexToX(pendingTrendStart.index - startIdx);
      const y1 = priceToY(pendingTrendStart.price);
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
      const isUpSession = stock.price >= stock.prevClose;
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

    // Crosshair
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
      ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(1, 33, 105, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(snappedX, PAD_TOP);
      ctx.lineTo(snappedX, PAD_TOP + totalPlotH);
      ctx.moveTo(PAD_LEFT, cy);
      ctx.lineTo(PAD_LEFT + plotW, cy);
      ctx.stroke();
      ctx.restore();

      if (hoverPos.y <= PAD_TOP + mainH) {
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
    showBollinger,
    showVwap,
    indicators,
    minPrice,
    maxPrice,
    hoverPos,
    inspectedIndex,
    inspectedBar,
    currentPriceLines,
    currentTrendLines,
    pendingTrendStart,
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

    if (drawMode === 'trendline' && y >= PAD_TOP && y <= PAD_TOP + mainH) {
      const globalIdx = startIdx + xToLocalIndex(x);
      const price = Number(yToPrice(y).toFixed(2));
      if (!pendingTrendStart) {
        setPendingTrendStart({ index: globalIdx, price });
      } else {
        setTrendLinesBySymbol((prev) => ({
          ...prev,
          [stock.symbol]: [
            ...(prev[stock.symbol] ?? []),
            {
              id: `tl-${Date.now()}`,
              startIndex: pendingTrendStart.index,
              startPrice: pendingTrendStart.price,
              endIndex: globalIdx,
              endPrice: price,
            },
          ],
        }));
        setPendingTrendStart(null);
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

  const orderBook = useMemo(() => {
    const tick = stock.price >= 200 ? 0.05 : 0.02;
    const asks = Array.from({ length: 6 }, (_, i) => {
      const level = 6 - i;
      const price = Number((stock.price + tick * level).toFixed(2));
      const size = Math.round(((Math.sin(stock.price * 7 + level * 1.9) + 1.5) * 420 + 180) / 10) * 10;
      return { price, size };
    });
    const bids = Array.from({ length: 6 }, (_, i) => {
      const level = i + 1;
      const price = Number(Math.max(0.01, stock.price - tick * level).toFixed(2));
      const size = Math.round(((Math.cos(stock.price * 5 + level * 2.3) + 1.5) * 440 + 160) / 10) * 10;
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
    Math.min(100, ((stock.price - stock.week52Low) / Math.max(0.01, stock.week52High - stock.week52Low)) * 100)
  );

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
                {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                <span>
                  {isUp ? '+' : ''}
                  {sessionChange.toFixed(2)} ({isUp ? '+' : ''}
                  {sessionChangePct.toFixed(2)}%)
                </span>
              </div>
            </div>

            <div className="hidden sm:grid grid-cols-3 gap-5 pl-5 border-l border-[#D6E2F0] dark:border-slate-800 text-xs">
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">Day High</div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">{stock.dayHigh.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">Day Low</div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">{stock.dayLow.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">Volume</div>
                <div className="font-medium text-[#0A1F44] dark:text-slate-100">{formatVolume(stock.volume)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Chart Controls Toolbar */}
        <div className="px-4 py-2 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
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

            <div className="flex items-center gap-1">
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
                onClick={() => setShowBollinger((v) => !v)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showBollinger
                    ? 'bg-[#EAF2FD] text-[#0052C2] dark:bg-blue-500/20 dark:text-blue-300'
                    : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                BB (20,2)
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
          </div>

          <div className="flex items-center gap-2">
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

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setDrawMode('cursor');
                  setPendingTrendStart(null);
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
                  setPendingTrendStart(null);
                }}
                title="Place horizontal price level"
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  drawMode === 'hline'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                Price Line
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawMode(drawMode === 'trendline' ? 'cursor' : 'trendline');
                  setPendingTrendStart(null);
                }}
                title="Draw 2-point trendline"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  drawMode === 'trendline'
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                <span>Trendline</span>
              </button>

              {(currentPriceLines.length > 0 || currentTrendLines.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setPriceLinesBySymbol((p) => ({ ...p, [stock.symbol]: [] }));
                    setTrendLinesBySymbol((p) => ({ ...p, [stock.symbol]: [] }));
                  }}
                  title="Clear chart drawings"
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
                onClick={() => setVisibleCount((v) => Math.min(bars.length, Math.round(v * 1.25)))}
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

        {/* Interactive Canvas Area */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-[440px] bg-white dark:bg-[#0B0F17] select-none overflow-hidden"
        >
          {inspectedBar && (
            <div className="pointer-events-none absolute top-2.5 left-3 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] font-mono tabular-nums bg-white/90 dark:bg-[#0B0F17]/85 px-2 py-1 rounded">
              <span className="text-[#5A7190] dark:text-slate-400">{inspectedBar.time}</span>
              <span>
                <span className="text-slate-400 mr-1">O</span>
                <span className="text-[#0A1F44] dark:text-slate-100">{inspectedBar.open.toFixed(2)}</span>
              </span>
              <span>
                <span className="text-slate-400 mr-1">H</span>
                <span className="text-[#0A1F44] dark:text-slate-100">{inspectedBar.high.toFixed(2)}</span>
              </span>
              <span>
                <span className="text-slate-400 mr-1">L</span>
                <span className="text-[#0A1F44] dark:text-slate-100">{inspectedBar.low.toFixed(2)}</span>
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
                <span className="text-[#334E73] dark:text-slate-300">{formatVolume(inspectedBar.volume)}</span>
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
              {drawMode !== 'cursor' && (
                <span className="text-[#0052C2] dark:text-blue-400 font-sans font-medium">
                  {drawMode === 'hline'
                    ? 'Click chart to place horizontal level'
                    : pendingTrendStart
                    ? 'Click second point to finish trendline'
                    : 'Click first point to start trendline'}
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
      </div>

      {/* Contextual Depth, Session Stats & Quick Portfolio Ticket */}
      <div className="w-full xl:w-[292px] shrink-0 bg-white dark:bg-[#0E131D] flex flex-col divide-y divide-[#D6E2F0] dark:divide-slate-800 xl:overflow-y-auto">
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
                <div key={`ask-${ask.price}`} className="relative flex justify-between py-0.5 px-1.5">
                  <div
                    className="absolute inset-y-0 right-0 bg-rose-500/10 dark:bg-rose-500/15"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative text-rose-600 dark:text-rose-400">
                    {ask.price.toFixed(2)}
                  </span>
                  <span className="relative text-[#2A4166] dark:text-slate-300">{ask.size}</span>
                </div>
              );
            })}

            <div className="py-1.5 my-1 border-y border-[#D6E2F0] dark:border-slate-800 flex items-center justify-between px-1.5 bg-[#F8FAFD] dark:bg-transparent">
              <span className="font-semibold text-[#012169] dark:text-white">
                {stock.price.toFixed(2)}
              </span>
              <span className="text-[11px] text-[#5A7190] dark:text-slate-400 font-sans">Last Trade</span>
            </div>

            {orderBook.bids.map((bid) => {
              const pct = (bid.size / orderBook.maxSize) * 100;
              return (
                <div key={`bid-${bid.price}`} className="relative flex justify-between py-0.5 px-1.5">
                  <div
                    className="absolute inset-y-0 right-0 bg-[#0052C2]/10 dark:bg-emerald-500/15"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative text-emerald-700 dark:text-emerald-400">
                    {bid.price.toFixed(2)}
                  </span>
                  <span className="relative text-[#2A4166] dark:text-slate-300">{bid.size}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Key Statistics */}
        <div className="p-4 space-y-3">
          <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
            Session & Valuation Metrics
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
                ${stock.marketCapB >= 1000 ? `${(stock.marketCapB / 1000).toFixed(2)}T` : `${stock.marketCapB.toFixed(1)}B`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">P/E (TTM / Fwd)</dt>
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
              <dt className="text-[11px] text-[#5A7190] dark:text-slate-400">Dividend Yield</dt>
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
      </div>
    </div>
  );
}
