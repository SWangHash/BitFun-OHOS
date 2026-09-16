import React, { useEffect, useRef, useState } from 'react';
import { MobileBanner, MobileButton, MobileTextarea } from '@openbitfun/ui/mobile';
import type { RemoteSessionManager } from '../services/RemoteSessionManager';
import ChatAskQuestionCard, {QuestionInteractionContext} from './ChatAskQuestionCard';
import { useI18n } from '../i18n';

interface PermissionRequest {
  requestId: string; sessionId: string; toolCallId?: string; action: string;
  resources: string[]; source?: {identity?:string}; displayMetadata?: Record<string,unknown>;
}
interface PendingQuestion {toolId:string;sessionId:string;questions:Record<string,unknown>}
interface InteractionMailbox {sessionId:string;permissions:{revision:number;requests:PermissionRequest[]};userQuestions:{revision:number;questions:PendingQuestion[]}}
/** Runtime mailbox identity is requestId. A tool call is only an optional display association. */
export function PermissionMailbox({manager,sessionId,invalidation}:{manager:RemoteSessionManager;sessionId:string;invalidation:number}) {
  const {t}=useI18n();
  const [questions,setQuestions]=useState<PendingQuestion[]>([]);
  const [requests,setRequests]=useState<PermissionRequest[]>([]);
  const [failed,setFailed]=useState<{operation: 'load' | 'reply'; message: string} | null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [editId,setEditId]=useState<string|null>(null);
  const [input,setInput]=useState('{}');
  const epoch=useRef(0);
  const running=useRef(false);
  const dirty=useRef(false);
  async function refresh() {
    dirty.current=true;
    if(running.current)return;
    running.current=true;
    const ticket=epoch.current;
    try {
      while(dirty.current&&ticket===epoch.current){
        dirty.current=false;
        const next=await manager.invokeHost<InteractionMailbox>('get_session_interaction_mailbox',{sessionId});
        if(next.sessionId!==sessionId)throw new Error('Interaction mailbox session mismatch');
        if(ticket===epoch.current){setRequests(next.permissions.requests.filter(request=>request.sessionId===sessionId));setQuestions(next.userQuestions.questions.filter(question=>question.sessionId===sessionId));setFailed(null);}
      }
    }catch(error){if(ticket===epoch.current)setFailed({operation:'load',message:error instanceof Error?error.message:String(error)});}
    finally{running.current=false;}
  }
  useEffect(()=>{void refresh();},[invalidation]);
  useEffect(()=>()=>{epoch.current++;},[]);
  async function reply(requestId:string,answer:'once'|'reject') {
    if(busy)return;
    const ticket=epoch.current;
    setBusy(requestId);setFailed(null);
    try {
      const updatedInput=editId===requestId&&answer==='once'?JSON.parse(input):undefined;
      if(updatedInput!==undefined&&(!updatedInput||typeof updatedInput!=='object'||Array.isArray(updatedInput)))throw new Error('Input must be a JSON object');
      await manager.invokeHost('respond_permission',{requestId,reply:answer,updatedInput});
      if(ticket===epoch.current){setEditId(null);await refresh();}
    }catch(error){if(ticket===epoch.current)setFailed({operation:'reply',message:error instanceof Error?error.message:String(error)});}
    finally{if(ticket===epoch.current)setBusy(null);}
  }
  if(!requests.length&&!questions.length&&!failed)return null;
  return <section aria-label={t('chat.approvalRequired')}>
    {failed&&<MobileBanner tone="danger">{t(failed.operation==='load'?'chat.interactionLoadFailed':'chat.approvalFailed')} {failed.message}<MobileButton onClick={()=>void refresh()}>{t('devices.retry')}</MobileButton></MobileBanner>}
    <QuestionInteractionContext.Provider value={toolId=>manager.startQuestionInteraction(sessionId,toolId)}>
      {questions.map(question=><ChatAskQuestionCard key={question.toolId} tool={{id:question.toolId,name:'AskUserQuestion',status:'running',tool_input:question.questions}}
        onAnswer={async(toolId,answers)=>{await manager.answerQuestion(toolId,answers);await refresh();}}/>)}
    </QuestionInteractionContext.Provider>
    {requests.map(request=><div key={request.requestId}>
      <h3>{request.source?.identity||request.action}</h3>
      <p>{request.action}</p><pre>{request.resources.join('\n')}</pre>
      {editId===request.requestId&&<MobileTextarea aria-label={t('chat.toolRequest')} value={input} onChange={event=>setInput(event.target.value)} disabled={!!busy}/>}
      <MobileButton disabled={!!busy} onClick={()=>{setEditId(request.requestId);setInput('{}');}}>{t('chat.editApproval')}</MobileButton>
      <MobileButton disabled={!!busy} onClick={()=>void reply(request.requestId,'once')}>{t('chat.approve')}</MobileButton>
      <MobileButton disabled={!!busy} onClick={()=>void reply(request.requestId,'reject')}>{t('chat.reject')}</MobileButton>
    </div>)}
  </section>;
}
