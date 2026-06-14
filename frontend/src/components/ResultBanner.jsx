import { colorOf } from '../roulette.js'

export function ResultBanner({ result }) {
  if (!result) return null
  const color = result.color || colorOf(result.number)
  return (
    <div className={`result-banner result-${color.toLowerCase()}`}>
      <div className="result-label">Выпало</div>
      <div className="result-number">{result.number}</div>
      <div className="result-color">{color}</div>
    </div>
  )
}
