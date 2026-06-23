import { useEffect, useMemo, useRef, useState } from 'react'
import { WHEEL_ORDER, colorOf } from '../roulette.js'

const SIZE = 300
const CENTER = SIZE / 2
const OUTER_R = 141
const INNER_R = 92
const NUM_R = 117
const HUB_R = 44
const STEP = 360 / WHEEL_ORDER.length

function colorHex(c) {
  return { RED: '#b81818', BLACK: '#0d0d0d', GREEN: '#0a8a3a' }[c]
}
function numHex(c) {
  return c === 'GREEN' ? '#bfffd0' : '#ffe9b0'
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
        rot: i * STEP,
        color: colorOf(n),
      })),
    []
  )

  useEffect(() => {
    if (phase !== 'SPINNING' || !result) return
    if (lastResultRef.current === result.number) return
    lastResultRef.current = result.number
    const base = targetAngleFor(result.number)
    setAngle((prev) => {
      const fullTurns = 6 * 360
      const current = prev % 360
      const delta = (((base - current) % 360) + 360) % 360
      return prev + fullTurns + delta
    })
  }, [phase, result])

  useEffect(() => {
    if (phase === 'BETTING') lastResultRef.current = null
  }, [phase])

  const isSpinning = phase === 'SPINNING'
  const showResult = phase === 'RESULT' && result

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" />
      <svg
        className="wheel-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx={CENTER} cy={CENTER} r={OUTER_R + 7} fill="#caa44a" />
        <circle cx={CENTER} cy={CENTER} r={OUTER_R + 3} fill="#3a2e10" />

        <g
          className="wheel-rotor"
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transition: isSpinning ? 'transform 4s cubic-bezier(.18,.72,.22,1)' : 'none',
          }}
        >
          {sectors.map((s, i) => (
            <g key={i}>
              <path d={s.path} fill={colorHex(s.color)} stroke="#000" strokeWidth="1" />
              <text
                x={s.labelPos[0]}
                y={s.labelPos[1]}
                fill={numHex(s.color)}
                fontSize="8"
                fontFamily="'Press Start 2P', monospace"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${s.rot} ${s.labelPos[0]} ${s.labelPos[1]})`}
              >
                {s.n}
              </text>
            </g>
          ))}
          <circle cx={CENTER} cy={CENTER} r={INNER_R} fill="#060606" stroke="#2a2a2a" strokeWidth="3" />
        </g>

        <circle cx={CENTER} cy={CENTER} r={HUB_R} fill="#0a0c10" stroke="#caa44a" strokeWidth="2" />
        {showResult ? (
          <text
            x={CENTER}
            y={CENTER + 2}
            fill={numHex(result.color)}
            fontSize="44"
            fontFamily="'VT323', monospace"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ filter: 'drop-shadow(0 0 8px rgba(255,176,0,.7))' }}
          >
            {result.number}
          </text>
        ) : (
          <text
            x={CENTER}
            y={CENTER + 1}
            fill="#39ff14"
            fontSize="11"
            fontFamily="'Press Start 2P', monospace"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ filter: 'drop-shadow(0 0 6px #39ff14)' }}
          >
            SPIN
          </text>
        )}
      </svg>
    </div>
  )
}
