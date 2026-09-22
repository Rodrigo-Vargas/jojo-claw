import type {
  GenerateWithToolsResult,
  JsonSettingValue,
  PluginContext,
  ToolCall,
  ToolDefinition,
  ToolMessage,
} from '@jojo-claw/core'

export interface ToolCallingRunResult {
  text: string
  model: string
  calls: Array<ToolCallRecord>
}

interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, JsonSettingValue>
  result: string
}

export type ToolExecutor = (
  argumentsValue: Record<string, JsonSettingValue>,
) => unknown | Promise<unknown>

/** Runs bounded model/tool rounds, returning calculator results to the next model message. */
export async function runToolCallingAgent(
  context: Pick<PluginContext, 'generateWithTools'>,
  prompt: string,
  tools: ToolDefinition[],
  executors: ReadonlyMap<string, ToolExecutor>,
): Promise<ToolCallingRunResult> {
  const messages: ToolMessage[] = [{ role: 'user', content: prompt }]
  const calls: ToolCallingRunResult['calls'] = []
  for (let round = 0; round < 5; round += 1) {
    const response = await context.generateWithTools({ messages, tools })
    if (response.toolCalls.length === 0) return completedRun(response, calls)
    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls })
    await appendToolResults(messages, calls, response.toolCalls, executors)
  }
  throw new Error(
    'Tool calling exceeded 5 rounds; expected the model to provide a final answer.',
  )
}

function completedRun(
  response: GenerateWithToolsResult,
  calls: ToolCallingRunResult['calls'],
): ToolCallingRunResult {
  if (!response.text.trim()) throw new Error('The model returned neither text nor a tool call.')
  return { text: response.text, model: response.model, calls }
}

async function appendToolResults(
  messages: ToolMessage[],
  calls: ToolCallingRunResult['calls'],
  requestedCalls: ToolCall[],
  executors: ReadonlyMap<string, ToolExecutor>,
): Promise<void> {
  for (const call of requestedCalls) {
    const executor = executors.get(call.name)
    const result = executor
      ? await invokeTool(executor, call.arguments)
      : `Error: unknown tool ${call.name}.`
    calls.push({ id: call.id, name: call.name, arguments: call.arguments, result })
    messages.push({ role: 'tool', content: result, toolCallId: call.id })
  }
}

async function invokeTool(
  executor: ToolExecutor,
  argumentsValue: Record<string, JsonSettingValue>,
): Promise<string> {
  try {
    return JSON.stringify(await executor(argumentsValue))
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Tool execution failed.'}`
  }
}
