/**
 * Tool card entry point for the `AskUserQuestion` tool.
 *
 * The backend owns template content and emits the resolved request on
 * `questionRequest`. A template that renders through a dedicated product card
 * ships its own question shape and is routed by `templateId` here; everything
 * else — plain model-authored questions and any future template that only needs
 * the shared contract — is rendered by the generic card below, which knows only
 * `resolvedQuestions`.
 *
 * AskUser owns the rendered anatomy, interaction semantics, and styling; the
 * shared interaction shell owns drafts, interaction, submission and sizing.
 *
 * MERGE NOTE (this split is going to remote main): main still has the pre-split
 * single component, where the pre-selection of a question's first option was
 * shared policy and the card's own payload concerns were not separated. When
 * this split meets main, keep the three-layer shape (dispatcher -> generic card
 * or owning card -> {@link AskUserQuestionShell}) and keep the pre-selection
 * opt-in per card; do not fold the Qt-specific payload back into the generic
 * card, and do not restore a shared default.
 */

import React, { useMemo } from 'react';
import type { FlowToolItem, ToolCardProps } from '../types/flow-chat';
import {
  AskUserQuestionShell,
  type AskUserCardQuestion,
} from './AskUserQuestionShell';
import {
  QT_MIGRATION_PATHS_TEMPLATE_ID,
  QtMigrationIntakeCard,
} from './QtMigrationIntakeCard';

/**
 * Template id used by the wire shape; the routing key is the template the
 * backend resolved the request from, never the tool name (Qt intake is served by
 * the AskUserQuestion tool, not by a `QtMigrationIntake` card).
 */
export const QT_MIGRATION_TEMPLATE_IDS: readonly string[] = [
  QT_MIGRATION_PATHS_TEMPLATE_ID,
];

/**
 * Resolve the card for this request. A template-backed request that carries its
 * own card keeps that card even when its payload is incomplete, so a broken
 * payload fails loudly instead of silently falling back to the generic card.
 */
export const AskUserQuestionCard: React.FC<ToolCardProps> = (props) => {
  const templateId = askUserQuestionTemplateId(props.toolItem);
  return templateId && QT_MIGRATION_TEMPLATE_IDS.includes(templateId)
    ? <QtMigrationIntakeCard {...props} />
    : <GenericAskUserQuestionCard {...props} />;
};

/**
 * Template the request was resolved from. The resolved envelope is
 * authoritative; the raw model params are the fallback while the envelope is
 * still in flight.
 */
export function askUserQuestionTemplateId(toolItem: FlowToolItem): string | undefined {
  return readTemplateId(toolItem.questionRequest)
    ?? readTemplateId(toolItem.toolCall?.input);
}

function readTemplateId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const templateId = (input as Record<string, unknown>).templateId;
  return typeof templateId === 'string' && templateId.trim()
    ? templateId.trim()
    : undefined;
}

interface QuestionOption {
  description: string;
  label: string;
  value?: string;
}

interface QuestionData {
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
  question: string;
  /** When present, the question shows a text input below the options. */
  inputPlaceholder?: string;
  /** Field id the backend template binds the answer to (template questions). */
  field?: string;
  /** Backend-declared requiredness (template policy; only backend may set it). */
  required?: boolean;
}

function normalizeQuestionsFromParams(input: unknown): QuestionData[] {
  if (!input || typeof input !== 'object') return [];
  const raw = input as Record<string, unknown>;
  // Template-backed requests arrive as `resolvedQuestions` on the
  // toolawaitinguserinput envelope; plain questions use `questions`.
  const rawQuestions = raw.questions ?? raw.resolvedQuestions;
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions.flatMap((candidate): QuestionData[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const rawQuestion = candidate as Record<string, unknown>;
    const rawOptions = Array.isArray(rawQuestion.options)
      ? rawQuestion.options
      : [];
    const options = rawOptions.flatMap((option): QuestionOption[] => {
      if (!option || typeof option !== 'object') return [];
      const rawOption = option as Record<string, unknown>;
      if (typeof rawOption.label !== 'string') return [];
      return [{
        description: typeof rawOption.description === 'string'
          ? rawOption.description
          : '',
        label: rawOption.label,
        value: typeof rawOption.value === 'string' && rawOption.value.trim()
          ? rawOption.value
          : undefined,
      }];
    });

    const rawField = typeof rawQuestion.field === 'string' ? rawQuestion.field.trim() : '';
    const rawPlaceholder = typeof rawQuestion.inputPlaceholder === 'string'
      ? rawQuestion.inputPlaceholder.trim()
      : '';

    return [{
      field: rawField || undefined,
      header: typeof rawQuestion.header === 'string' ? rawQuestion.header : '',
      inputPlaceholder: rawPlaceholder || undefined,
      multiSelect: Boolean(rawQuestion.multiSelect),
      options,
      question: typeof rawQuestion.question === 'string'
        ? rawQuestion.question
        : '',
      required: Boolean(rawQuestion.required),
    }];
  });
}

/** Same source as FileOperationToolCard: partial JSON while streaming, then final toolCall.input. */
function genericParamsSource(toolItem: FlowToolItem): unknown {
  return toolItem.isParamsStreaming
    ? toolItem.partialParams || toolItem.toolCall?.input
    : toolItem.toolCall?.input;
}

/**
 * Plain (non-template) questions, plus the shared projection of any
 * template-backed request that does not own a dedicated card. Template-backed
 * questions are the same as plain ones here except for a field id and
 * placeholder text that are already literal copy, so nothing is localized: a
 * card that ships i18n keys resolves them itself before handing questions over.
 */
function resolveGenericQuestions(toolItem: FlowToolItem): AskUserCardQuestion[] {
  const fromEnvelope = normalizeQuestionsFromParams(toolItem.questionRequest);
  const questions = fromEnvelope.length > 0
    ? fromEnvelope
    : normalizeQuestionsFromParams(genericParamsSource(toolItem));

  return questions.map((question) => ({
    field: question.field,
    header: question.header || undefined,
    inputPlaceholder: question.inputPlaceholder,
    multiSelect: question.multiSelect,
    prompt: question.question,
    options: question.options.map((option) => ({
      // A template option carries its own value when the display label is not
      // what the backend expects; otherwise the label is the answer.
      value: option.value?.trim() || option.label,
      label: option.label,
      description: option.description,
    })),
  }));
}

const GenericAskUserQuestionCard: React.FC<ToolCardProps> = ({
  toolItem,
  isLastItem,
  sessionId,
}) => {
  const questions = useMemo(() => resolveGenericQuestions(toolItem), [toolItem]);

  return (
    <AskUserQuestionShell
      isLastItem={isLastItem}
      questions={questions}
      sessionId={sessionId}
      toolItem={toolItem}
    />
  );
};
