import { ChatMessage, RemoteToolStatusResponse, ChatMessageItemResponse } from '../model/RemoteModels';
import { DurableSessionEvent } from './DurableSessionStream';

interface ToolControlEvent { turnId?: string; toolEvent?: ToolControlPayload; }
interface ToolControlPayload { event_type?: string; tool_id?: string; tool_name?: string; params?: Object; }
export interface PendingPermission { requestId: string; sessionId: string; roundId?: string; toolCallId?: string; source: PermissionSource; }
export interface SessionInteractionMailbox { sessionId: string; userQuestions: QuestionMailbox; permissions: PermissionMailbox; }
interface QuestionMailbox { revision: number; questions: PendingQuestion[]; }
interface PermissionMailbox { revision: number; requests: PendingPermission[]; }
interface PendingQuestion { toolId: string; sessionId: string; dialogTurnId?: string; modelRoundId?: string; questions: Object; registeredAtMs: number; interactionStarted?: boolean; }
interface PermissionSource { identity: string; }
interface PendingControl { turnId: string; tool: RemoteToolStatusResponse; }

/** Permission mailbox is control state, never a transcript or text delta. */
export class PermissionControlOverlay {
  private pending: Map<string, PendingControl> = new Map();
  revision: number = 0;
  apply(event: DurableSessionEvent): boolean {
    if (event.event !== 'agentic://tool-event') return false;
    const payload = event.payload as ToolControlEvent;
    const tool = payload.toolEvent;
    if (!tool?.tool_id) return false;
    if (tool.event_type === 'ConfirmationNeeded') {
      this.pending.set(tool.tool_id, { turnId: payload.turnId || '', tool: { id: tool.tool_id, name: tool.tool_name, status: 'pending_confirmation', tool_input: tool.params } });
    } else if (['Confirmed', 'Completed', 'Failed', 'Cancelled', 'Rejected'].includes(tool.event_type || '')) {
      const keys: string[] = [];
      this.pending.forEach((control: PendingControl, key: string) => { if (control.tool.id === tool.tool_id) keys.push(key); });
      keys.forEach((key: string) => this.pending.delete(key));
    } else return false;
    this.revision++; return true;
  }
  hydrate(sessionId: string, requests: PendingPermission[]): void {
    const next: Map<string, PendingControl> = new Map();
    for (const request of requests) {
      if (request.sessionId !== sessionId) continue;
      const id = request.toolCallId || request.requestId;
      const old = this.pending.get(request.requestId) || this.pending.get(id);
      const control: PendingControl = old ? JSON.parse(JSON.stringify(old)) as PendingControl : { turnId: '', tool: { id: id, name: request.source.identity, status: 'pending_confirmation' } };
      control.tool.permission_request_id = request.requestId;
      next.set(request.requestId, control);
    }
    this.pending = next; this.revision++;
  }
  hydrateMailbox(snapshot: SessionInteractionMailbox): void {
    this.hydrate(snapshot.sessionId, snapshot.permissions.requests);
    for (const question of snapshot.userQuestions.questions) {
      this.pending.set(`question:${question.toolId}`, { turnId: question.dialogTurnId || '', tool: {
        id: question.toolId, name: 'AskUserQuestion', status: 'running', tool_input: question.questions
      } });
    }
  }
  decorate(messages: ChatMessage[]): ChatMessage[] {
    const finished: string[] = [];
    for (const message of messages) {
      for (const tool of message.tools || []) {
        if (['completed', 'failed', 'cancelled', 'rejected', 'success', 'error'].includes(tool.status || '')) {
          this.pending.forEach((control: PendingControl, key: string) => { if (control.tool.id === tool.id) finished.push(key); });
        }
      }
    }
    finished.forEach((key: string) => this.pending.delete(key));
    const active = messages.find((message: ChatMessage) => message.role === 'assistant' && ['active', 'running'].includes(message.status));
    const source = messages.slice();
    if (!active && this.pending.size > 0) source.push({ id: 'permission-mailbox', role: 'assistant', text: '', status: 'active', tools: [], items: [] });
    return source.map((message: ChatMessage): ChatMessage => {
      if (message.role !== 'assistant') return message;
      const controls: PendingControl[] = Array.from(this.pending.values()).filter((control: PendingControl) => message.id === 'permission-mailbox' || (control.turnId && source.some((row: ChatMessage) => row.turnId === control.turnId) ? control.turnId === message.turnId : message === active));
      if (!['active', 'running'].includes(message.status)) {
        controls.forEach((control: PendingControl) => { if (!control.tool.permission_request_id) this.pending.delete(control.tool.id || ''); });
        return message;
      }
      const tools = (message.tools || []).slice();
      const items = (message.items || []).slice();
      for (const control of controls) {
        const index = tools.findIndex((tool: RemoteToolStatusResponse) => tool.id === control.tool.id);
        const original = index >= 0 ? tools[index] : undefined;
        const replacement = JSON.parse(JSON.stringify(original || control.tool)) as RemoteToolStatusResponse;
        replacement.id = control.tool.id; replacement.name = control.tool.name || original?.name;
        replacement.permission_request_id = control.tool.permission_request_id;
        replacement.status = control.tool.status; replacement.tool_input = control.tool.tool_input || original?.tool_input;
        if (index >= 0) tools[index] = replacement; else tools.push(replacement);
        const itemIndex = items.findIndex((item: ChatMessageItemResponse) => item.tool?.id === replacement.id);
        if (itemIndex >= 0) {
          const item = JSON.parse(JSON.stringify(items[itemIndex])) as ChatMessageItemResponse;
          item.tool = replacement; items[itemIndex] = item;
        }
        else items.push({ type: 'tool', tool: replacement });
      }
      const decorated = JSON.parse(JSON.stringify(message)) as ChatMessage;
      decorated.tools = tools; decorated.items = items; return decorated;
    });
  }
}
