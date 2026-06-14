import { useEffect, useMemo, useRef, useState } from 'react'
import { WHEEL_ORDER, colorOf } from '../roulette.js'

const SIZE = 360
const CENTER = SIZE / 2
const OUTER_R = 170
const INNER_R = 110
const NUM_R = 140
const STEP = 360 / WHEEL_ORDER.length // ~9.73°

function colorHex(c) {
  return { RED: '#c92a2a', BLACK: '#1a1a1a', GREEN: '#2b8a3e' }[c]
}

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function sectorPath(i) {
  const start = i * STEP - STEP / 2
  const end = start + STEP
  const [x1, y1] = polar(CENTER, CENTER, OUTER_R, start)
  const [x2, y2] = polar(CENTER, CENTER, OUTER_R, end)
  const [x3, y3] = polar(CENTER, CENTER, INNER_R, end)
  const [x4, y4] = polar(CENTER, CENTER, INNER_R, start)
  return [
    `M ${x1} ${y1}`,
    `A ${OUTER_R} ${OUTER_R} 0 0 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${INNER_R} ${INNER_R} 0 0 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

function targetAngleFor(number) {
  const idx = WHEEL_ORDER.indexOf(number)
  if (idx < 0) return 0
  // указатель сверху (0°). Нужно довернуть колесо так, чтобы сектор idx оказался под ним.
  return -(idx * STEP)
}

export function RouletteWheel({ phase, result }) {
  const [angle, setAngle] = useState(0)
  const lastResultRef = useRef(null)

  const sectors = useMemo(
    () =>
      WHEEL_ORDER.map((n, i) => ({
        n,
        path: sectorPath(i),
        labelPos: polar(CENTER, CENTER, NUM_R, i * STEP),
        color: colorOf(n),
      })),
    []
  )

  useEffect(() => {
    if (phase !== 'SPINNING' || !result) return
    if (lastResultRef.current === result.number) return
    lastResultRef.current = result.number
    // несколько полных оборотов + точная позиция
    const base = targetAngleFor(result.number)
    setAngle((prev) => {
      // увеличиваем угол так, чтобы он всегда рос (избегаем обратного отката)
      const fullTurns = 6 * 360
      const current = prev % 360
      const delta = ((base - current) % 360 + 360) % 360
      return prev + fullTurns + delta
    })
  }, [phase, result])

  // в BETTING сбрасываем lastResult чтобы новая SPINNING фаза снова прокрутила
  useEffect(() => {
    if (phase === 'BETTING') lastResultRef.current = null
  }, [phase])

  const isSpinning = phase === 'SPINNING'

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" />
      <svg className="wheel" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={CENTER} cy={CENTER} r={OUTER_R + 8} fill="#5a3a1a" />
        <g
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transition: isSpinning
              ? 'transform 4s cubic-bezier(.18,.72,.22,1)'
              : 'none',
          }}
        >
          {sectors.map((s, i) => (
            <g key={i}>
              <path d={s.path} fill={colorHex(s.color)} stroke="#000" strokeWidth="1" />
              <text
                x={s.labelPos[0]}
                y={s.labelPos[1]}
                fill="#fff"
                fontSize="13"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${i * STEP} ${s.labelPos[0]} ${s.labelPos[1]})`}
              >
                {s.n}
              </text>
            </g>
          ))}
          <circle cx={CENTER} cy={CENTER} r={INNER_R} fill="#3a2410" />
          <circle cx={CENTER} cy={CENTER} r={40} fill="#7a5230" stroke="#3a2410" strokeWidth="3" />
        </g>
      </svg>
      {phase === 'RESULT' && result && (
        <div className="wheel-result-badge">{result.number}</div>
      )}
    </div>
  )
}
