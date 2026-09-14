import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatAskQuestionCard, { QuestionInteractionContext } from '../../src/components/ChatAskQuestionCard';
import { I18nProvider } from '../../src/i18n';

export const events: Array<{ type: string; toolId: string; answers?: unknown }> = [];
const container = document.createElement('div');
container.id = 'question-fixture';
document.body.append(container);
const root = createRoot(container);
let failNextInteraction = false;

export function rejectNextInteraction() { failNextInteraction = true; }

export function showQuestion(toolId: string) {
  root.render(
    <I18nProvider>
      <QuestionInteractionContext.Provider value={async (id) => {
        events.push({ type: 'interaction', toolId: id });
        if (failNextInteraction) {
          failNextInteraction = false;
          throw new Error('Fixture activity acknowledgement failed');
        }
      }}>
        <ChatAskQuestionCard key={toolId} tool={{ id: toolId, name: 'AskUserQuestion', status: 'running',
          tool_input: { questions: [{ question: 'Format?', options: [{ label: 'PNG' }, { label: 'SVG' }] }] },
        }} onAnswer={async (id, answers) => { events.push({ type: 'answer', toolId: id, answers }); }} />
      </QuestionInteractionContext.Provider>
    </I18nProvider>,
  );
}
