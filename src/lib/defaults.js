// Paleta categórica validada (orden fijo) + variantes para categorías extra.
export const PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948',
  '#184f95', '#a8461b', '#0f7a55', '#9a6a00', '#b8476f', '#4c8a1f', '#8a7fe0', '#a83232',
]
export const colorFor = (i) => PALETTE[i % PALETTE.length]
export const NEUTRAL = '#a9a79f'
export const UNCAT = '#d9a21b'

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Supermercado', emoji: '🛒' },
  { name: 'Vivienda (fijos)', emoji: '🏠' },
  { name: 'Desarrollo y trabajo', emoji: '💼' },
  { name: 'Ocio y salidas', emoji: '🍻' },
  { name: 'Salud y bienestar', emoji: '💪' },
  { name: 'Comida comprada', emoji: '🍕' },
  { name: 'Equipamiento Dpto', emoji: '🛋️' },
  { name: 'Auto y transporte', emoji: '🚗' },
  { name: 'Gastos hormiga', emoji: '☕' },
  { name: 'Regalos', emoji: '🎁' },
  { name: 'Estética e indumentaria', emoji: '👕' },
  { name: 'Subscripciones', emoji: '🔁' },
  { name: 'Impuestos', emoji: '🧾' },
  { name: 'Vacaciones', emoji: '✈️' },
  { name: 'Ahorro', emoji: '🐷' },
  { name: 'Otros', emoji: '📦' },
]

export const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Sueldo', emoji: '💵' },
  { name: 'Trabajos extra', emoji: '🧰' },
  { name: 'Reintegros', emoji: '↩️' },
  { name: 'Regalos recibidos', emoji: '🎀' },
  { name: 'Otros ingresos', emoji: '➕' },
]

export const DEFAULT_TAGS = ['Fijo', 'Tarjeta', 'Familia']

export const EMOJI_CHOICES = ['🛒', '🏠', '💼', '🍻', '💪', '🍕', '🛋️', '🚗', '☕', '🎁', '👕', '🔁', '🧾', '✈️', '🐷', '📦', '💵', '🧰', '↩️', '🎀', '➕', '📚', '🐶', '💊', '⚡', '📱', '🎮', '🎓', '⛽', '🚌', '🍷', '🏦']
