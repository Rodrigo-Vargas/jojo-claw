import type { JsonSettingValue, ToolDefinition } from '@jojo-claw/core'

export const calculatorTool: ToolDefinition = {
  name: 'calculate',
  description:
    'Evaluates a basic arithmetic expression using numbers, parentheses, and +, -, *, /, or %.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'The arithmetic expression to evaluate.' },
    },
    required: ['expression'],
  },
}

/** Evaluates the deliberately small expression grammar exposed to the model. */
export function calculate(argumentsValue: Record<string, JsonSettingValue>): number {
  const expression = argumentsValue.expression
  if (typeof expression !== 'string' || !expression.trim())
    throw new Error('calculate requires expression to be a non-empty string.')
  if (!/^[0-9+\-*/%().\s]+$/.test(expression))
    throw new Error(
      `calculate received ${JSON.stringify(expression)}; expected arithmetic characters only.`,
    )
  const result = Function(`"use strict"; return (${expression})`)() as unknown
  if (typeof result !== 'number' || !Number.isFinite(result))
    throw new Error(`calculate produced ${String(result)}; expected a finite number.`)
  return result
}
