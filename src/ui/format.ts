const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  return money.format(amount);
}

/** Two decimals for valid amounts, but never hides extra digits the engine would reject. */
export function formatAmountInput(amount: number): string {
  const fixed = amount.toFixed(2);
  return Number(fixed) === amount ? fixed : String(amount);
}
