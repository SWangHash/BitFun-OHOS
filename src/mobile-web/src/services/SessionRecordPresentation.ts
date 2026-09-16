import type { ChatMessage, ChatMessageItem, RemoteToolStatus } from './RemoteSessionManager';

/** Rendering accepts rich records without narrowing their stored protocol data. */
export interface MobileStoredTurn {
  turnId: string; turnIndex: number; status: string; timestamp: number;
  userMessage: { id: string; content: string; timestamp: number; metadata?: unknown };
  modelRounds: Array<{ roundIndex: number; textItems: RichText[]; thinkingItems?: RichText[]; toolItems: RichTool[] }>;
  error?: string;
}
interface RichText { id: string; content: string; orderIndex?: number; timestamp?: number; status?: string; subagentSessionId?: string }
interface RichTool { id: string; toolName: string; orderIndex?: number; status?: string; startTime?: number; durationMs?: number; subagentSessionId?: string; toolCall: {id:string;input:unknown}; toolResult?:{result:unknown;success:boolean;error?:string} }
export function presentSessionTurn(turn: MobileStoredTurn): ChatMessage[] {
  const items: ChatMessageItem[] = [...turn.modelRounds].sort((a,b)=>a.roundIndex-b.roundIndex).flatMap(round => {
    const ordered = [
      ...round.textItems.map(data=>({type:'text' as const,data})),
      ...(round.thinkingItems??[]).map(data=>({type:'thinking' as const,data})),
      ...round.toolItems.map(data=>({type:'tool' as const,data})),
    ].filter(({data})=>data.status!=='superseded' && data.status!=='retry_superseded');
    ordered.sort((a,b)=>(a.data.orderIndex??0)-(b.data.orderIndex??0));
    return ordered.map(entry=> {
      if(entry.type!=='tool') return {type:entry.type,content:entry.data.content,is_subagent:!!entry.data.subagentSessionId};
      const data=entry.data;
      const tool:RemoteToolStatus={id:data.toolCall.id,name:data.toolName,status:data.status??(data.toolResult?(data.toolResult.success?'completed':'error'):'running'),duration_ms:data.durationMs,start_ms:data.startTime,tool_input:data.toolCall.input,tool_output:data.toolResult?.result,error_preview:data.toolResult?.error};
      return {type:'tool',tool,is_subagent:!!data.subagentSessionId};
    });
  });
  return [
    {id:turn.userMessage.id,turn_id:turn.turnId,role:'user',content:turn.userMessage.content,timestamp:String(turn.userMessage.timestamp),metadata:turn.userMessage.metadata},
    {id:`${turn.turnId}_assistant`,turn_id:turn.turnId,role:'assistant',content:items.filter(i=>i.type==='text').map(i=>i.content??'').join(''),thinking:items.filter(i=>i.type==='thinking').map(i=>i.content??'').join(''),items,tools:items.flatMap(i=>i.tool?[i.tool]:[]),status:turn.status==='inprogress'?'streaming':turn.status,error:turn.error,timestamp:String(turn.timestamp)},
  ];
}
