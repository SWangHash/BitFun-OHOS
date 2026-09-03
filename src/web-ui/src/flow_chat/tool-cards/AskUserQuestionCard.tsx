/**
 * AskUserQuestion tool card component
 * Displays multiple questions, collects user answers and submits them
 */

import React, { useState, useCallback, useMemo, useLayoutEffect, useRef, useEffect } from 'react';
import { Loader2, AlertCircle, ArrowUp, ChevronDown, ChevronRight, FolderSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FlowToolItem, ToolCardProps } from '../types/flow-chat';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { pickWorkspaceDirectory } from '@/infrastructure/peer-device/pickWorkspaceDirectory';
import { createLogger } from '@/shared/utils/logger';
import { Button, Tooltip } from '@/component-library';
import { useToolCardHeightContract } from './useToolCardHeightContract';
import { SmoothHeightCollapse } from '../components/modern/SmoothHeightCollapse';
import './AskUserQuestionCard.scss';

const log = createLogger('AskUserQuestionCard');

/**
 * Backend rejection for a non-existent migration path. Stable machine format
 * emitted by the coordinator: `qt_migration_path_not_found: field=<id>; path=<value>`.
 */
const PATH_NOT_FOUND_PATTERN =
  /qt_migration_path_not_found:\s*field=([^;]+);\s*path=(.+)/;

/** Static i18n keys for the migration field ids rejected by the backend. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  source_project: 'toolCards.askUser.fieldName.source_project',
  output_project: 'toolCards.askUser.fieldName.output_project',
  toolchain: 'toolCards.askUser.fieldName.toolchain',
  template: 'toolCards.askUser.fieldName.template',
};

function parsePathNotFoundRejection(
  message: string,
): { field: string; path: string } | null {
  const match = PATH_NOT_FOUND_PATTERN.exec(message.trim());
  if (!match) return null;
  return { field: match[1].trim(), path: match[2].trim() };
}

interface QuestionOption {
  label: string;
  description: string;
  value?: string;
}

interface QuestionData {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  /** When present, the question shows a text input below the options. */
  inputPlaceholder?: string;
  /** Field id the backend template binds the answer to (template questions). */
  field?: string;
  /** Backend-declared requiredness (template policy; only backend may set it). */
  required?: boolean;
}

/** Renders option description with tooltip for truncated text */
const OptionDescription: React.FC<{ description: string }> = ({ description }) => {
  const descRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [description]);

  const descElement = (
    <div ref={descRef} className="option-description">{description}</div>
  );

  if (isTruncated) {
    return (
      <Tooltip content={description} placement="top" delay={300}>
        {descElement}
      </Tooltip>
    );
  }

  return descElement;
};

function normalizeQuestionsFromParams(input: unknown): QuestionData[] {
  if (!input || typeof input !== 'object') return [];
  const raw = input as Record<string, unknown>;
  const qs = raw.questions ?? raw.resolvedQuestions;
  if (!Array.isArray(qs)) return [];
  return qs.map((q: any) => ({
    question: q.question || '',
    header: q.header || '',
    options: Array.isArray(q.options) ? q.options.map((option: any) => ({
      label: option?.label || '',
      description: option?.description || '',
      value: typeof option?.value === 'string' ? option.value : undefined,
    })) : [],
    multiSelect: Boolean(q.multiSelect),
    inputPlaceholder: typeof q.inputPlaceholder === 'string' && q.inputPlaceholder.trim() ? q.inputPlaceholder : undefined,
    field: typeof q.field === 'string' && q.field.trim() ? q.field : undefined,
    required: Boolean(q.required),
  }));
}

/** Same source as FileOperationToolCard: partial JSON while streaming, then final toolCall.input. */
function isAwaitingQuestionPayload(
  questionsLength: number,
  isParamsStreaming: boolean | undefined,
  status: FlowToolItem['status']
): boolean {
  if (questionsLength > 0) return false;
  if (isParamsStreaming) return true;
  const s = status as string;
  return (
    status === 'preparing' ||
    status === 'streaming' ||
    status === 'pending' ||
    s === 'receiving'
  );
}

export const AskUserQuestionCard: React.FC<ToolCardProps> = ({
  toolItem,
  isLastItem,
}) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolCall, toolResult, isParamsStreaming, partialParams } = toolItem;

  // Template-owned text (question/header/labels/placeholders) may carry a
  // stable i18n key under the `askUser.qtMigration.*` namespace. Render those
  // through the flow-chat catalog; keep concrete values (paths) as-is.
  const localize = useCallback((text: string) => {
    return text.startsWith('askUser.qtMigration.') ? t(`toolCards.${text}`) : text;
  }, [t]);

  const paramsSource = partialParams || toolCall?.input;
  const toolId = toolItem.id ?? toolCall?.id;

  // The backend `toolawaitinguserinput` event carries the authoritative
  // resolved payload. It sits on the tool item separately from `toolCall.input`
  // (immutable model params kept for replay/audit) and takes precedence; plain
  // questions fall back to the inline `questions` shape.
  const questionSource =
    (toolItem as unknown as { questionRequest?: unknown }).questionRequest ?? paramsSource;

  // Template events expose `resolvedQuestions`; normalizeQuestionsFromParams
  // accepts that envelope directly so the backend-resolved payload remains the
  // single source of truth instead of falling back to empty raw questions.
  const resolvedPayload = (questionSource as Record<string, unknown> | undefined);
  const presentation = (resolvedPayload?.presentation ?? undefined) as
    | { layout?: string; allowSkip?: boolean; introKey?: string; hintKey?: string; requiredFields?: string[] }
    | undefined;

  const questions = useMemo(
    () => normalizeQuestionsFromParams(questionSource),
    [questionSource]
  );

  const awaitingPayload = isAwaitingQuestionPayload(
    questions.length,
    isParamsStreaming,
    status
  );
  
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCompletedSummary, setShowCompletedSummary] = useState(status === 'completed');

  // Options carry a display label ("默认路径"/"备选路径") plus the actual
  // path in `description`. The submitted value must be the concrete path:
  // fall back to the label only when no description is present (plain,
  // non-template questions keep their label semantics).
  const optionValue = useCallback((option: { label?: string; description?: string; value?: string }) => {
    if (option?.value?.trim()) return option.value.trim();
    const description = option?.description?.trim();
    return description ? description : (option?.label ?? '');
  }, []);

  // Pre-select the first option for single-select questions with candidate
  // options so the user sees a recommended default (Qt migration paths).
  useEffect(() => {
    if (awaitingPayload || status === 'completed') return;
    setAnswers(prev => {
      let changed = false;
      const next = { ...prev };
      questions.forEach((q, i) => {
        if (next[i] === undefined && q.options.length > 0 && !q.multiSelect) {
          next[i] = optionValue(q.options[0]);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [questions, awaitingPayload, status, optionValue]);

  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
    toolId,
    toolName: toolItem.toolName,
  });

  useLayoutEffect(() => {
    const shouldCompactCompleted =
      status === 'completed' &&
      isLastItem !== true &&
      !showCompletedSummary;

    if (shouldCompactCompleted) {
      applyExpandedState(true, false, (nextExpanded) => {
        setShowCompletedSummary(!nextExpanded);
      });
      return;
    }

    if (status !== 'completed' && showCompletedSummary) {
      setShowCompletedSummary(false);
    }
  }, [applyExpandedState, isLastItem, showCompletedSummary, status]);

  useLayoutEffect(() => {
    setAnswers(prev => {
      let changed = false;
      const next = { ...prev };
      questions.forEach((question, index) => {
        if (next[index] !== undefined || question.options.length === 0) return;
        next[index] = question.multiSelect
          ? [optionValue(question.options[0])]
          : optionValue(question.options[0]);
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [questions]);

  const isAllAnswered = useCallback(() => {
    if (questions.length === 0) return false;
    
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      // Questions with a custom input accept either a typed value or a selected
      // option. The typed value takes precedence when both are present.
      if (q.inputPlaceholder) {
        const typed = (otherInputs[i] || '').trim();
        const answer = answers[i];
        if (!typed && (!answer || (Array.isArray(answer) && answer.length === 0))) return false;
        continue;
      }
      const answer = answers[i];
      if (!answer) return false;
      if (Array.isArray(answer) && answer.length === 0) return false;
      if (typeof answer === 'string' && answer === '') return false;
    }
    return true;
  }, [answers, otherInputs, questions]);

  const handleSingleChange = useCallback((questionIndex: number, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionIndex]: value
    }));
    setOtherInputs(prev => ({
      ...prev,
      [questionIndex]: ''
    }));
  }, []);

  const handleMultiChange = useCallback((questionIndex: number, value: string, checked: boolean) => {
    setAnswers(prev => {
      const current = prev[questionIndex];
      const currentArray = Array.isArray(current) ? current : [];
      
      if (checked) {
        return { ...prev, [questionIndex]: [...currentArray, value] };
      } else {
        return { ...prev, [questionIndex]: currentArray.filter(v => v !== value) };
      }
    });
  }, []);

  const handleOtherInputChange = useCallback((questionIndex: number, value: string) => {
    setOtherInputs(prev => ({
      ...prev,
      [questionIndex]: value
    }));
    if (value.length > 0) {
      setAnswers(prev => ({
        ...prev,
        [questionIndex]: questions[questionIndex]?.multiSelect ? [] : ''
      }));
    }
  }, [questions]);

  // Open a native directory picker (or the in-app peer browser in Peer Device
  // Mode) and fill the path input with the selected folder. Falls back to
  // manual typing when the dialog is unavailable (e.g. web preview).
  const handleBrowsePath = useCallback(async (questionIndex: number, title: string) => {
    const currentValue = otherInputs[questionIndex] || '';
    let selected: string | null = null;
    try {
      selected = await pickWorkspaceDirectory({
        title,
        defaultPath: currentValue || undefined,
      });
    } catch (error) {
      log.error('Path picker unavailable', { questionIndex, error });
      return;
    }
    if (selected) {
      setOtherInputs(prev => ({
        ...prev,
        [questionIndex]: selected
      }));
      setAnswers(prev => ({
        ...prev,
        [questionIndex]: questions[questionIndex]?.multiSelect ? [] : ''
      }));
    }
  }, [otherInputs, questions]);

  const handleSubmit = useCallback(async () => {
    if (!isAllAnswered() || isSubmitting || isSubmitted) return;

    const toolId = toolItem.id;
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const processedAnswers: Record<string, string | string[]> = {};
      
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        // Template-backed questions are submitted by field id so the backend
        // re-validation binds answers to the exact waiting request; plain
        // questions keep the positional key.
        const answerKey = question.field ?? String(i);
        const answer = answers[i];
        const otherInput = otherInputs[i] || '';
        const typed = otherInput.trim();

        if (question.inputPlaceholder) {
          if (typed) {
            processedAnswers[answerKey] = typed;
          } else if (Array.isArray(answer)) {
            processedAnswers[answerKey] = answer.filter(v => v !== 'Other').join(', ');
          } else {
            processedAnswers[answerKey] = answer || '';
          }
          continue;
        }

        if (Array.isArray(answer)) {
          processedAnswers[answerKey] = answer.map(v => 
            v === 'Other' ? (otherInput || 'Other') : v
          );
        } else {
          processedAnswers[answerKey] = answer === 'Other' ? (otherInput || 'Other') : answer;
        }
      }

      const answersPayload = processedAnswers;
      
      await toolAPI.submitUserAnswers(toolId, answersPayload);
      
      setIsSubmitted(true);
    } catch (error) {
      const rawMessage = error instanceof Error && error.message.trim()
        ? error.message
        : '';
      const rejection = parsePathNotFoundRejection(rawMessage);
      let message: string;
      if (rejection) {
        const fieldLabelKey = FIELD_LABEL_KEYS[rejection.field];
        const fieldLabel = fieldLabelKey ? t(fieldLabelKey) : rejection.field;
        message = t('toolCards.askUser.submitPathNotFound', {
          field: fieldLabel,
          path: rejection.path,
        });
      } else {
        message = rawMessage || t('toolCards.askUser.submitFailed');
      }
      setSubmissionError(message);
      log.error('Failed to submit answers', { toolId, error });
    } finally {
      setIsSubmitting(false);
    }
  }, [toolItem.id, answers, otherInputs, questions, isAllAnswered, isSubmitting, isSubmitted, t]);

  const getStatusIcon = () => {
    if (status === 'completed') {
      return null;
    }
    if (isSubmitting) {
      return <Loader2 size={16} className="status-icon-loading animate-spin" />;
    }
    return <AlertCircle size={16} className="status-icon-waiting" />;
  };

  const getStatusText = () => {
    if (status === 'completed') return t('toolCards.askUser.completed');
    if (isSubmitted) return t('toolCards.askUser.submittedWaiting');
    if (isSubmitting) return t('toolCards.askUser.submitting');
    return t('toolCards.askUser.waitingAnswer');
  };

  const getEffectiveAnswer = useCallback((questionIndex: number): string | string[] | undefined => {
    const localAnswer = answers[questionIndex];
    if (localAnswer !== undefined) return localAnswer;

    if (status === 'completed' && toolResult?.result) {
      const result = typeof toolResult.result === 'string'
        ? JSON.parse(toolResult.result)
        : toolResult.result;
      return result?.answers?.[String(questionIndex)];
    }
    return undefined;
  }, [answers, status, toolResult]);

  const renderQuestion = (q: QuestionData, questionIndex: number) => {
    const answer = getEffectiveAnswer(questionIndex);
    const otherInput = otherInputs[questionIndex] || '';
    const hasCustomInput = Boolean(q.inputPlaceholder);
    
    const isOtherSelected = q.multiSelect 
      ? Array.isArray(answer) && answer.includes('Other')
      : answer === 'Other';

    const inputName = `question-${questionIndex}`;

    return (
      <div data-bf-component="ask-user-question-card" data-bf-part="question" key={questionIndex} className="ask-question-item">
        <div className="question-item-header" data-bf-component="ask-user-question-card" data-bf-part="header">
          <span className="question-header-chip">{localize(q.header)}</span>
          <span className="question-text">{localize(q.question)}</span>
        </div>
        
        <div className="question-options" data-bf-component="ask-user-question-card" data-bf-part="options">
          {q.options.map((option, optIdx) => (
            <label key={optIdx} className="option-label" data-bf-component="ask-user-question-card" data-bf-part="option">
              {q.multiSelect ? (
                <>
                  <input
                    type="checkbox"
                    name={inputName}
                    value={optionValue(option)}
                    checked={Array.isArray(answer) && answer.includes(optionValue(option))}
                    onChange={(e) => handleMultiChange(questionIndex, optionValue(option), e.target.checked)}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-checkbox" />
                </>
              ) : (
                <>
                  <input
                    type="radio"
                    name={inputName}
                    value={optionValue(option)}
                    checked={answer === optionValue(option)}
                    onChange={(e) => handleSingleChange(questionIndex, e.target.value)}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-radio" />
                </>
              )}
              <div className="option-content">
                <div className="option-label-text">{localize(option.label)}</div>
                <OptionDescription description={localize(option.description)} />
              </div>
              {optIdx === 0 && (q.options.length > 1 || option.value === '__official__') && (
                <span className="option-recommend-tag">{t('toolCards.askUser.qtMigration.option.recommend')}</span>
              )}
            </label>
          ))}
          
          {hasCustomInput ? (
            <div className="question-custom-input" data-bf-component="ask-user-question-card" data-bf-part="customInput">
              <input
                type="text"
                className="custom-input-inline"
                placeholder={localize(q.inputPlaceholder || '')}
                value={otherInput}
                onChange={(e) => handleOtherInputChange(questionIndex, e.target.value)}
                disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
              />
              <button
                type="button"
                className="path-browse-button"
                data-bf-component="ask-user-question-card"
                data-bf-part="browse"
                onClick={() => void handleBrowsePath(questionIndex, localize(q.question))}
                disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                title={t('toolCards.askUser.browsePath')}
                aria-label={t('toolCards.askUser.browsePath')}
              >
                <FolderSearch size={14} />
              </button>
            </div>
          ) : !isOtherSelected ? (
            <label className="option-label option-other" data-bf-component="ask-user-question-card" data-bf-part="option">
              {q.multiSelect ? (
                <>
                  <input
                    type="checkbox"
                    name={inputName}
                    value="Other"
                    checked={false}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleMultiChange(questionIndex, 'Other', true);
                      }
                    }}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-checkbox" />
                </>
              ) : (
                <>
                  <input
                    type="radio"
                    name={inputName}
                    value="Other"
                    checked={false}
                    onChange={() => handleSingleChange(questionIndex, 'Other')}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-radio" />
                </>
              )}
              <div className="option-content">
                <div className="option-label-text">{t('toolCards.askUser.other')}</div>
                <div className="option-description">{t('toolCards.askUser.customInputHint')}</div>
              </div>
            </label>
          ) : (
            <div className="option-other-input" data-bf-component="ask-user-question-card" data-bf-part="customInput">
              {q.multiSelect ? (
                <>
                  <input
                    type="checkbox"
                    name={inputName}
                    value="Other"
                    checked={true}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        handleMultiChange(questionIndex, 'Other', false);
                      }
                    }}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-checkbox" />
                </>
              ) : (
                <>
                  <input
                    type="radio"
                    name={inputName}
                    value="Other"
                    checked={true}
                    onChange={() => {}}
                    disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                  />
                  <span className="custom-radio" />
                </>
              )}
              <input
                type="text"
                className="other-input-inline"
                placeholder={t('toolCards.askUser.pleaseSpecify')}
                value={otherInput}
                onChange={(e) => handleOtherInputChange(questionIndex, e.target.value)}
                disabled={isSubmitted || status === 'completed' || Boolean(isParamsStreaming)}
                autoFocus
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const getAnswerDisplay = (questionIndex: number): string => {
    const question = questions[questionIndex];
    const answer = getEffectiveAnswer(questionIndex);
    const otherInput = otherInputs[questionIndex] || '';
    const typed = otherInput.trim();

    if (question?.inputPlaceholder) {
      if (typed) return typed;
      if (!answer) return '';
      if (Array.isArray(answer)) return answer.filter(v => v !== 'Other').join(', ');
      return String(answer);
    }

    if (!answer) return '';
    if (Array.isArray(answer)) {
      return answer.map(v => v === 'Other' ? otherInput || 'Other' : v).join(', ');
    }
    return answer === 'Other' ? otherInput || 'Other' : String(answer);
  };

  const getAnswersSummary = (): string => {
    return questions.map((q, idx) => {
      const answerText = getAnswerDisplay(idx);
      return `${localize(q.header)}: ${answerText || t('toolCards.askUser.notAnswered')}`;
    }).join(' | ');
  };

  const renderResult = () => {
    if (!toolResult?.result) return null;
    
    const result = typeof toolResult.result === 'string' 
      ? JSON.parse(toolResult.result) 
      : toolResult.result;
    
    if (result.status === 'timeout') {
      return (
        <div data-bf-component="ask-user-question-card" data-bf-part="status" className="result-timeout">
          <AlertCircle size={16} />
          <span>{t('toolCards.askUser.timeout')}</span>
        </div>
      );
    }
    
    return null;
  };

  if (awaitingPayload) {
    return (
      <div data-bf-component="ask-user-question-card" data-bf-part="loading" data-bf-state="loading"
        ref={cardRootRef}
        data-tool-card-id={toolId ?? ''}
        className={`ask-user-question-card params-loading status-${status}`}
      >
        <div className="params-loading-row">
          <Loader2 size={16} className="status-icon-loading animate-spin" />
          <span className="params-loading-text">{t('toolCards.askUser.loadingQuestions')}</span>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div data-bf-component="ask-user-question-card" data-bf-part="root" data-bf-state="error" className="ask-user-question-card status-error">
        <div className="error-message" data-bf-component="ask-user-question-card" data-bf-part="error">{t('toolCards.askUser.parseError')}</div>
      </div>
    );
  }

  return (
    <>
      {presentation?.introKey ? (
        <div
          className="ask-user-question-intro"
          data-bf-component="ask-user-question-card"
          data-bf-part="intro"
        >
          {t(`toolCards.${presentation.introKey}`)}
        </div>
      ) : null}
      <div data-bf-component="ask-user-question-card" data-bf-part="root"
        data-bf-state={status === 'completed' ? 'completed' : undefined}
        ref={cardRootRef}
        data-tool-card-id={toolId ?? ''}
        className={`ask-user-question-card status-${status}`}
      >
      {!showCompletedSummary ? (
        <>
          <div className="card-header-row" data-bf-component="ask-user-question-card" data-bf-part="header">
            <div className="card-title">
              <span className="questions-count">
                {t('toolCards.askUser.questionsCount', { count: questions.length })}
              </span>
            </div>
          </div>

          <div className="questions-container" data-bf-component="ask-user-question-card" data-bf-part="questions">
            {questions.map((q, idx) => renderQuestion(q, idx))}
          </div>

          {submissionError ? (
            <div
              className="submission-error-message"
              data-bf-component="ask-user-question-card"
              data-bf-part="error"
              role="alert"
            >
              <AlertCircle size={14} />
              <span>{submissionError}</span>
            </div>
          ) : null}

          <div className="card-footer-row" data-bf-component="ask-user-question-card" data-bf-part="footer">
            {presentation?.hintKey ? (
              <div className="footer-hint" data-bf-component="ask-user-question-card" data-bf-part="hint">
                {t(`toolCards.${presentation.hintKey}`)}
              </div>
            ) : null}
            <div className="footer-actions">
              <Button
                variant="primary"
                size="small"
                className="submit-button"
                onClick={handleSubmit}
                disabled={!isAllAnswered() || isSubmitting || Boolean(isParamsStreaming)}
                isLoading={isSubmitting}
                title={!isAllAnswered() ? t('toolCards.askUser.answerAllBeforeSubmit') : ""}
              >
                {isSubmitting ? (
                  <span>{t('toolCards.askUser.submitting')}</span>
                ) : (
                  <>
                    <ArrowUp size={14} />
                    <span>{t('toolCards.askUser.submit')}</span>
                  </>
                )}
              </Button>
              <div className="tool-status" data-bf-component="ask-user-question-card" data-bf-part="status">
                {getStatusIcon()}
                <span className="status-text">{getStatusText()}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div 
            className="completed-summary"
            data-bf-component="ask-user-question-card"
            data-bf-part="summary"
            onClick={() => applyExpandedState(isExpanded, !isExpanded, setIsExpanded)}
          >
            <div className="summary-content">
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="summary-questions-count">{t('toolCards.askUser.questionsAnswered', { count: questions.length })}</span>
              <span className="summary-arrow">→</span>
              <span className="summary-answer">{getAnswersSummary()}</span>
            </div>
            <div className="tool-status">
              {getStatusIcon()}
              <span className="status-text">{getStatusText()}</span>
            </div>
          </div>

          <SmoothHeightCollapse
            isOpen={isExpanded}
            className="ask-user-question-card__answers-collapse"
          >
            <div className="questions-container expanded" data-bf-component="ask-user-question-card" data-bf-part="questions">
              {questions.map((q, idx) => renderQuestion(q, idx))}
            </div>
          </SmoothHeightCollapse>

          {renderResult()}
        </>
      )}
      </div>
    </>
  );
};