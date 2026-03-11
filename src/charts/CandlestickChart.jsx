// ─── CANDLESTICK CHART ────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from 'react';

const CHART_H = 140;
const CHART_W_MIN = 500;

export default function CandlestickChart({ candles = [], height = CHART_H, threshold = null, vwap = null }) {
  const [zoom, setZoom] = useState(60);
  const [offset, setOffset] = useState(0);
  const svgRef = useRef(null);
  const [svgWidth, setSvgWidth] = useState(700);

  useEffect(() => {
    if (svgRef.current) setSvgWidth(svgRef.current.clientWidth || 700);
  }, []);

  if (!candles || candles.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#303060', fontSize: 11 }}>
        📊 No chart data — fetch data first
      </div>
    );
  }

  const visibleCount = Math.min(zoom, candles.length);
  const startIdx = Math.max(0, candles.length - visibleCount - offset);
  const visible = candles.slice(startIdx, startIdx + visibleCount);

  const allHighs  = visible.map(c => c.high);
  const allLows   = visible.map(c => c.low);
  const minPrice  = Math.min(...allLows)  * 0.9995;
  const maxPrice  = Math.max(...allHighs) * 1.0005;
  const priceRange = maxPrice - minPrice;

  const W = svgWidth;
  const H = height;
  const PAD_L = 8, PAD_R = 50, PAD_T = 8, PAD_B = 16;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const toX = (i) => PAD_L + (i / visible.length) * chartW;
  const toY = (price) => PAD_T + chartH - ((price - minPrice) / priceRange) * chartH;

  const candleW = Math.max(2, (chartW / visible.length) * 0.7);

  // Price levels for y-axis
  const priceSteps = 4;
  const priceStep  = priceRange / priceSteps;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 5, alignItems: 'center' }}>
        {[20, 40, 60].map(z => (
          <button key={z} onClick={() => setZoom(z)}
            style={{ background: zoom===z?'#ff6d00':'#0d0d22', color: zoom===z?'white':'#3a3a6a', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 9, cursor: 'pointer', fontFamily:"'Fredoka One'" }}>
            {z}
          </button>
        ))}
        <button onClick={() => setOffset(o => Math.min(o + 10, candles.length - zoom))}
          style={{ background: '#0d0d22', color: '#3a3a6a', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 9, cursor: 'pointer' }}>←</button>
        <button onClick={() => setOffset(o => Math.max(o - 10, 0))}
          style={{ background: '#0d0d22', color: '#3a3a6a', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 9, cursor: 'pointer' }}>→</button>
        {offset > 0 && <button onClick={() => setOffset(0)}
          style={{ background: '#0d0d22', color: '#ff6d00', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 9, cursor: 'pointer' }}>Live</button>}
      </div>

      <svg ref={svgRef} width="100%" height={H} style={{ display: 'block' }}>
        {/* Background grid */}
        {[...Array(priceSteps + 1)].map((_, i) => {
          const price = minPrice + i * priceStep;
          const y = toY(price);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#0e0e28" strokeWidth={1} />
              <text x={W - PAD_R + 3} y={y + 3} fill="#303060" fontSize={8} fontFamily="Nunito">{price.toFixed(0)}</text>
            </g>
          );
        })}

        {/* Threshold line */}
        {threshold && threshold > minPrice && threshold < maxPrice && (
          <g>
            <line x1={PAD_L} y1={toY(threshold)} x2={W - PAD_R} y2={toY(threshold)} stroke="#ffd700" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
            <text x={PAD_L + 2} y={toY(threshold) - 3} fill="#ffd700" fontSize={8} fontFamily="Nunito">threshold</text>
          </g>
        )}

        {/* VWAP line */}
        {vwap && vwap > minPrice && vwap < maxPrice && (
          <g>
            <line x1={PAD_L} y1={toY(vwap)} x2={W - PAD_R} y2={toY(vwap)} stroke="#c44dff" strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />
            <text x={PAD_L + 2} y={toY(vwap) - 3} fill="#c44dff" fontSize={8} fontFamily="Nunito">VWAP</text>
          </g>
        )}

        {/* Candles */}
        {visible.map((c, i) => {
          const bull = c.close >= c.open;
          const color = bull ? '#00e5aa' : '#ff3366';
          const x = toX(i + 0.5);
          const openY  = toY(c.open);
          const closeY = toY(c.close);
          const highY  = toY(c.high);
          const lowY   = toY(c.low);
          const bodyTop = Math.min(openY, closeY);
          const bodyH   = Math.max(1, Math.abs(openY - closeY));

          return (
            <g key={i}>
              {/* Wick */}
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={1} opacity={0.7} />
              {/* Body */}
              <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} opacity={0.85} />
            </g>
          );
        })}

        {/* Current price line */}
        {visible.length > 0 && (() => {
          const lastClose = visible[visible.length - 1].close;
          const y = toY(lastClose);
          return (
            <g>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#ff9d00" strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />
              <rect x={W - PAD_R + 1} y={y - 6} width={48} height={12} rx={2} fill="#ff9d00" opacity={0.9} />
              <text x={W - PAD_R + 4} y={y + 3} fill="white" fontSize={7} fontFamily="Nunito" fontWeight="bold">{lastClose.toFixed(0)}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
