export const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
export const BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35])

export function colorOf(n) {
  if (n === 0) return 'GREEN'
  if (RED.has(n)) return 'RED'
  return 'BLACK'
}

// Порядок чисел на европейском колесе (по часовой)
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36,
  11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
  22, 18, 29, 7, 28, 12, 35, 3, 26,
]

export const BET_TYPES = ['RED', 'BLACK', 'GREEN', 'EVEN', 'ODD']

export function betLabel(type) {
  return { RED: 'Red', BLACK: 'Black', GREEN: '0', EVEN: 'Even', ODD: 'Odd' }[type] || type
}

export function isWinningBet(betType, number) {
  if (number === 0) return betType === 'GREEN'
  const c = colorOf(number)
  if (betType === 'RED') return c === 'RED'
  if (betType === 'BLACK') return c === 'BLACK'
  if (betType === 'EVEN') return number % 2 === 0
  if (betType === 'ODD') return number % 2 === 1
  return false
}
