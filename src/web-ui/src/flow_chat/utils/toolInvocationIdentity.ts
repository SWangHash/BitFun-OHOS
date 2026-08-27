import type { FlowToolItem } from '../types/flow-chat';

export const DEFERRED_TOOL_GATEWAY_NAME = 'CallDeferredTool';

export interface EffectiveToolInvocation {
  toolName: string;
  input: unknown;
  isDeferred: boolean;
}

export function effectiveToolInvocation(
  wireToolName: string,
  wireInput: unknown,
): EffectiveToolInvocation {
  if (
    wireToolName !== DEFERRED_TOOL_GATEWAY_NAME
    || wireInput === null
    || typeof wireInput !== 'object'
    || Array.isArray(wireInput)
  ) {
    return { toolName: wireToolName, input: wireInput, isDeferred: false };
  }

  const input = wireInput as Record<string, unknown>;
  if (
    typeof input.tool_name !== 'string'
    || input.tool_name.trim().length === 0
  ) {
    return { toolName: wireToolName, input: wireInput, isDeferred: false };
  }

  // Allow args to be missing, null, or undefined; use empty object in those
  // cases. The tool name is the critical piece for component routing.
  const effectiveArgs = (!Object.prototype.hasOwnProperty.call(input, 'args')
    || input.args === null
    || input.args === undefined)
    ? {}
    : input.args;

  if (typeof effectiveArgs !== 'object' || Array.isArray(effectiveArgs)) {
    return { toolName: wireToolName, input: wireInput, isDeferred: false };
  }

  const overflowEntries = Object.entries(input)
    .filter(([key]) => key !== 'tool_name' && key !== 'args');
  const effectiveInput = overflowEntries.length === 0
    ? effectiveArgs as Record<string, unknown>
    : Object.fromEntries([
        ...overflowEntries,
        ...Object.entries(effectiveArgs as Record<string, unknown>),
      ]);

  return {
    toolName: input.tool_name,
    input: effectiveInput,
    isDeferred: true,
  };
}

export function getEffectiveToolName(toolItem: Pick<FlowToolItem, 'toolName' | 'toolCall'>): string {
  return effectiveToolInvocation(toolItem.toolName, toolItem.toolCall?.input).toolName;
}

export function projectEffectiveToolItem(toolItem: FlowToolItem): FlowToolItem {
  const effective = effectiveToolInvocation(toolItem.toolName, toolItem.toolCall?.input);
  if (!effective.isDeferred) {
    return toolItem;
  }

  return {
    ...toolItem,
    toolName: effective.toolName,
    toolCall: {
      ...toolItem.toolCall,
      input: effective.input,
    },
  };
}
