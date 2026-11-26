import { Maximize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeSMA, getBarsForTimeframe } from '../data/marketData';
import { fetchLiveChart } from '../services/marketApi';
import { OhlcBar, StockProfile, Timeframe } from '../types/market';

interface MiniChartTileProps {
  symbol: string;
  timeframe: Timeframe;
  allStocks: Record<string, StockProfile>;
  isDark: boolean;
  showSma20?: boolean;
  onChangeSymbol: (sym: string) => void;
  onChangeTimeframe: (tf: Timeframe) => void;
  onFocusSymbol: (sym: string) => void;
}

const MINI_TFS: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', '1Y'];

export function MiniChartTile({
  symbol,
  timeframe,
  allStocks,
  isDark,
  showSma20 = false,
  onChangeSymbol,
  onChangeTimeframe,
  onFocusSymbol,
}: MiniChartTileProps) {
  const stock = allStocks[symbol] ?? Object.values(allStocks)[0];
  const symbols = useMemo(() => Object.keys(allStocks), [allStocks]);
  const [liveBars, setLiveBars] = useState<OhlcBar[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 380, height: 220 });

  useEffect(() => {
    let cancelled = false;
    setLiveBars(null);
    fetchLiveChart(stock.symbol, timeframe).then((res) => {
      if (!cancelled && res && res.bars.length > 0) {
        setLiveBars(res.bars);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stock.symbol, timeframe]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.floor(e.contentRect.height);
        if (w > 80 && h > 80) setSize({ width: w, height: h });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const bars = useMemo(() => {
    const src = liveBars && liveBars.length > 0 ? liveBars : getBarsForTimeframe(stock.bars, timeframe);
    return src.slice(-90);
  }, [liveBars, stock.bars, timeframe]);

  const sma20 = useMemo(() => computeSMA(bars.map((b) => b.close), 20), [bars]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 8;
    const padR = 54;
    const padT = 10;
    const padB = 20;
    const plotW = Math.max(40, size.width - padL - padR);
    const plotH = Math.max(40, size.height - padT - padB);

    const bg = isDark ? '#0B0F17' : '#FFFFFF';
    const grid = isDark ? 'rgba(148,163,184,0.08)' : 'rgba(1,33,105,0.065)';
    const textMuted = isDark ? '#94A3B8' : '#5A7190';
    const upColor = isDark ? '#10B981' : '#0F8A4B';
    const downColor = '#DC2626';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    const pad = Math.max((hi - lo) * 0.08, hi * 0.004);
    const minP = lo - pad;
    const maxP = hi + pad;

    const toY = (p: number) => padT + plotH - ((p - minP) / Math.max(0.0001, maxP - minP)) * plotH;
    const step = plotW / Math.max(1, bars.length);
    const toX = (i: number) => padL + step * i + step / 2;

    // Horizontal grid
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
      const p = minP + ((maxP - minP) * i) / 3;
      const y = Math.round(toY(p)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillStyle = textMuted;
      ctx.fillText(p.toFixed(2), padL + plotW + 5, y);
    }

    // Candlesticks
    const bodyW = Math.max(1.5, Math.min(9, step * 0.65));
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const x = toX(i);
      const isUp = b.close >= b.open;
      const col = isUp ? upColor : downColor;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, toY(b.high));
      ctx.lineTo(x, toY(b.low));
      ctx.stroke();

      const yO = toY(b.open);
      const yC = toY(b.close);
      ctx.fillStyle = col;
      ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1.2, Math.abs(yC - yO)));
    }

    // SMA 20 (only when explicitly enabled)
    if (showSma20) {
      ctx.strokeStyle = '#0052C2';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < bars.length; i++) {
        const v = sma20[i];
        if (v === null) continue;
        if (!started) {
          ctx.moveTo(toX(i), toY(v));
          started = true;
        } else {
          ctx.lineTo(toX(i), toY(v));
        }
      }
      ctx.stroke();
    }

    // Last price tag
    const last = bars[bars.length - 1];
    if (last) {
      const y = Math.round(toY(last.close)) + 0.5;
      const isPos = stock.price >= stock.prevClose;
      const tagCol = isPos ? '#0F8A4B' : '#DC2626';
      ctx.fillStyle = tagCol;
      ctx.fillRect(padL + plotW + 1, y - 8, padR - 2, 16);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(last.close.toFixed(2), padL + plotW + 4, y);
    }

    // X-axis start/end labels
    ctx.fillStyle = textMuted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText((bars[0]?.time ?? '').slice(-5), padL, padT + plotH + 4);
    ctx.textAlign = 'right';
    ctx.fillText((bars[bars.length - 1]?.time ?? '').slice(-5), padL + plotW, padT + plotH + 4);
  }, [bars, sma20, showSma20, size, isDark, stock.price, stock.prevClose]);

  const diff = stock.price - stock.prevClose;
  const diffPct = (diff / Math.max(0.01, stock.prevClose)) * 100;
  const isUp = diff >= 0;

  return (
    <div className="flex flex-col min-h-[240px] h-full bg-white dark:bg-[#0B0F17] border border-[#D6E2F0] dark:border-slate-800 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <select
            value={stock.symbol}
            onChange={(e) => onChangeSymbol(e.target.value)}
            aria-label="Comparison tile ticker"
            className="px-1.5 py-0.5 text-xs font-mono font-semibold rounded bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#012169] dark:text-white"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
          <span className="font-mono tabular-nums font-semibold text-[#012169] dark:text-white">
            ${stock.price.toFixed(2)}
          </span>
          <span
            className={`font-mono tabular-nums text-[11px] font-medium ${
              isUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {isUp ? '+' : ''}
            {diffPct.toFixed(2)}%
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {MINI_TFS.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onChangeTimeframe(tf)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                timeframe === tf
                  ? 'bg-[#0052C2] text-white'
                  : 'text-[#5A7190] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
              }`}
            >
              {tf}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFocusSymbol(stock.symbol)}
            title={`Focus ${stock.symbol} in primary chart`}
            className="ml-1 p-1 rounded text-[#5A7190] hover:text-[#0052C2] hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="flex-1 min-h-0 relative">
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          className="block"
        />
      </div>
    </div>
  );
}
