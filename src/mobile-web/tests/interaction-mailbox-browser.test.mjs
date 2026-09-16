import assert from 'node:assert/strict';
import {test} from 'node:test';
import {launchBrowser,startSourceServer} from './helpers/browser-account-harness.mjs';
test('mailbox restores questions and permissions without tool attachment and replies with the owning identities', {timeout:40000},async()=>{
 const source=await startSourceServer();const browser=await launchBrowser();
 try{
  const page=await browser.newPage();await page.goto(source.origin);
  await page.evaluate(async()=>{
   const R=await import('/node_modules/.vite/deps/react.js');const React=R.default??R;
   const D=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=D.default??D;
   const {PermissionMailbox}=await import('/src/components/PermissionMailbox.tsx');
   const calls=[];window.mailboxCalls=calls;let pending=true;
   const manager={invokeHost:async(command,request)=>{
    calls.push({command,request});
    if(command==='respond_permission')return null;
    return {sessionId:'session',permissions:{revision:1,requests:[{requestId:'request-without-tool',sessionId:'session',action:'write',resources:['/target']}]},userQuestions:{revision:1,questions:pending?[{toolId:'question-tool',sessionId:'session',questions:{questions:[{question:'Choose a value',options:[{label:'Alpha'},{label:'Beta'}]}]}}]:[]}};
   },startQuestionInteraction:async(sessionId,toolId)=>calls.push({command:'start',sessionId,toolId}),answerQuestion:async(toolId,answers)=>{calls.push({command:'answer',toolId,answers});pending=false;}};
   document.body.innerHTML='<div id="mailbox-test"></div>';
   createRoot(document.querySelector('#mailbox-test')).render(React.createElement(PermissionMailbox,{manager,sessionId:'session',invalidation:0}));
  });
  await page.waitForFunction(()=>document.body.innerText.includes('Choose a value'));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Alpha')).click());
  await page.click('.chat-ask-card__submit');
  await page.waitForFunction(()=>window.mailboxCalls.some(c=>c.command==='answer'));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='chat.approve').click());
  await page.waitForFunction(()=>window.mailboxCalls.some(c=>c.command==='respond_permission'));
  const calls=await page.evaluate(()=>window.mailboxCalls);
  assert.equal(calls.find(c=>c.command==='start').toolId,'question-tool');
  assert.equal(calls.find(c=>c.command==='answer').toolId,'question-tool');
  assert.equal(calls.find(c=>c.command==='respond_permission').request.requestId,'request-without-tool');
  assert.ok(calls.filter(c=>c.command==='get_session_interaction_mailbox').length>=2);
 }finally{await browser.close();await source.close()}
});
