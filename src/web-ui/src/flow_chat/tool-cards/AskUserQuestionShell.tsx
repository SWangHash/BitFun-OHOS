/**
 * Shared interaction shell for the AskUserQuestion tool card family.
 *
 * The questionnaire chrome, per-surface draft persistence, interaction
 * acknowledgement, wait timer, submission, and the FlowChat virtualization
 * height contract live here once. A card owns only its own payload shape and
 * its own copy: it resolves the wire payload into {@link AskUserCardQuestion}
 * (labels included, so a card may render rich option lines) and hands it to
 * this shell.
 *
 * AskUser owns the rendered anatomy, interaction semantics, and styling.
 */

import {
  AskUser,
  type AskUserAnswers,
  type AskUserQuestion,
  type AskUserState,
} from '@bitfun/ui/flow-chat';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Tooltip } from '@bitfun/ui';
import { X } from 'lucide-react';
import { i18nService } from '@/infrastructure/i18n';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import {
  getActiveSurfaceScope,
  isSurfaceChangedError,
  onSurfaceActivated,
} from '@/infrastructure/peer-device/deviceSurface';
import { canSubmitUserQuestionsOnSurface } from '@/infrastructure/peer-device/peerCapabilityResolution';
import { usePeerDeviceModeOptional } from '@/infrastructure/peer-device/peerDeviceContextState';
import { pickWorkspaceDirectory } from '@/infrastructure/peer-device/pickWorkspaceDirectory';
import { createLogger } from '@/shared/utils/logger';
import type { FlowToolItem } from '../types/flow-chat';
import {
  askUserQuestionDraftKey,
  askUserQuestionDraftStore,
  createEmptyAskUserQuestionDraft,
  useAskUserQuestionDraftStore,
  type AskUserQuestionSubmissionPhase,
} from '../store/askUserQuestionDraftStore';
import { useToolCardHeightContract } from './useToolCardHeightContract';

const log = createLogger('AskUserQuestionCard');
const OTHER_OPTION_VALUE = 'Other';
const subscribeToSurfaceActivation = (listener: () => void): (() => void) =>
  onSurfaceActivated(() => listener());

/** One selectable option, already resolved into render and submit forms. */
export interface AskUserCardOption {
  /** Concrete value a selection submits. */
  value: string;
  /** Primary line. */
  label: React.ReactNode;
  /** Secondary line; the design renders it truncated on one line. */
  description?: React.ReactNode;
}

/** One question, already resolved into render and submit forms. */
export interface AskUserCardQuestion {
  /** Field id the backend binds the answer to (template questions). */
  field?: string;
  /** Field label chip, already localized. */
  header?: string;
  /** Free-text input placeholder, already localized. */
  inputPlaceholder?: string;
  multiSelect: boolean;
  options: AskUserCardOption[];
  /** Prompt, already localized. Also used as the path picker title. */
  prompt: string;
}

export interface AskUserQuestionShellProps {
  toolItem: FlowToolItem;
  isLastItem?: boolean;
  sessionId?: string;
  /** Questions the owning card resolved from its own payload. */
  questions: AskUserCardQuestion[];
  /**
   * Copy for a backend submit rejection this card's tool can produce. Returning
   * `null` keeps the shared "submit failed" message.
   */
  describeSubmitFailure?: (message: string, t: TFunction<'flow-chat'>) => string | null;
  /**
   * Opt-in default for a card whose options are candidates the backend already
   * measured (the Qt migration intake): its first candidate opens selected, so
   * the form is submittable without re-picking the value the backend just
   * resolved. Off by default — a model-authored question must open unanswered,
   * because this default becomes the submitted answer and can be submitted
   * without the user ever choosing it.
   */
  preselectFirstOption?: boolean;
}

type ToolAnswer = string | string[];

function normalizeToolResult(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeToolAnswer(input: unknown): ToolAnswer | undefined {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input.filter((value): value is string => typeof value === 'string');
  }
  return undefined;
}

/** Same source as FileOperationToolCard: partial JSON while streaming, then final toolCall.input. */
function isAwaitingQuestionPayload(
  isParamsStreaming: boolean | undefined,
  status: FlowToolItem['status'],
): boolean {
  if (isParamsStreaming) return true;
  const rawStatus = status as string;
  return status === 'preparing'
    || status === 'streaming'
    || status === 'pending'
    || rawStatus === 'receiving';
}

export const AskUserQuestionShell: React.FC<AskUserQuestionShellProps> = ({
  toolItem,
  isLastItem,
  sessionId,
  questions,
  describeSubmitFailure,
  preselectFirstOption = false,
}) => {
  const { t } = useTranslation('flow-chat');
  const peerDevice = usePeerDeviceModeOptional();
  const activeSurfaceScope = useSyncExternalStore(
    subscribeToSurfaceActivation,
    getActiveSurfaceScope,
    getActiveSurfaceScope,
  );
  const { status, toolCall, toolResult, isParamsStreaming } = toolItem;
  const normalizedResult = useMemo(
    () => normalizeToolResult(toolResult?.result),
    [toolResult?.result],
  );
  const timedOut = normalizedResult?.status === 'timeout';
  const cancelled = status === 'cancelled' || normalizedResult?.status === 'cancelled';
  const rejected = status === 'rejected';
  const failed = status === 'error' || toolResult?.success === false;
  const endedWithoutAnswer = timedOut || cancelled || rejected || failed;
  const finished = status === 'completed' || endedWithoutAnswer;
  const awaitingPayload = !finished && isAwaitingQuestionPayload(
    isParamsStreaming,
    status,
  );

  const toolId = toolItem.id ?? toolCall?.id;
  const draftToolId = toolCall?.id || toolId;
  const activeSurfaceId = activeSurfaceScope.surfaceId;
  const canSubmitUserAnswers = canSubmitUserQuestionsOnSurface(
    peerDevice?.peerMode.active === true,
    peerDevice?.currentPeerCapabilities ?? null,
  );
  const canAnswer = !finished && !awaitingPayload && canSubmitUserAnswers;
  const deadline = toolItem.userQuestionWait?.deadlineMs;
  const [interactionAcknowledged, setInteractionAcknowledged] = useState(false);
  const [clockNow, setClockNow] = useState(() => performance.now());
  const showTimer = canAnswer && !interactionAcknowledged
    && !toolItem.userQuestionWait?.interactionStarted && typeof deadline === 'number';
  useEffect(() => {
    setInteractionAcknowledged(false);
  }, [activeSurfaceId, sessionId, toolId]);
  useEffect(() => {
    if (!showTimer || typeof deadline !== 'number') return;
    setClockNow(performance.now());
    const interval = window.setInterval(() => setClockNow(performance.now()), 250);
    return () => window.clearInterval(interval);
  }, [deadline, showTimer]);
  const remainingSeconds = typeof deadline === 'number'
    ? Math.max(0, Math.ceil(((toolItem.userQuestionWait?.monotonicDeadlineMs ?? clockNow) - clockNow) / 1000)) : null;
  const countdown = remainingSeconds === null ? null
    : remainingSeconds === 0 ? t('toolCards.askUser.awaitingTimeoutConfirmation') : `${
    i18nService.formatNumber(Math.floor(remainingSeconds / 60), { useGrouping: false })
  }:${
    i18nService.formatNumber(remainingSeconds % 60, { minimumIntegerDigits: 2, useGrouping: false })
  }`;
  const submissionScope = useRef(0);
  const draftKey = useMemo(
    () => sessionId && draftToolId
      ? askUserQuestionDraftKey(sessionId, draftToolId, activeSurfaceId)
      : null,
    [activeSurfaceId, draftToolId, sessionId],
  );
  useLayoutEffect(() => {
    submissionScope.current += 1;
    return () => { submissionScope.current += 1; };
  }, [draftKey, canAnswer]);
  const storedDraft = useAskUserQuestionDraftStore((state) => (
    draftKey ? state.drafts[draftKey] : undefined
  ));
  const [localDraft, setLocalDraft] = useState(createEmptyAskUserQuestionDraft);
  const draft = storedDraft ?? localDraft;
  const { answers, otherInputs, submissionPhase } = draft;
  const isSubmitting = submissionPhase === 'submitting';
  const isSubmitted = submissionPhase === 'submitted';
  const [submissionFailed, setSubmissionFailed] = useState(false);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState<string | null>(null);
  const [interactionFailed, setInteractionFailed] = useState(false);
  const interactionAttempt = useRef<number | null>(null);
  const startInteraction = useCallback(() => {
    if (!canAnswer || !sessionId || interactionAttempt.current === submissionScope.current) return;
    const scope = submissionScope.current;
    if (peerDevice?.peerMode.active && peerDevice.currentPeerCapabilities?.userQuestionInteraction !== true) {
      setInteractionFailed(true);
      return;
    }
    interactionAttempt.current = scope;
    setInteractionFailed(false);
    void toolAPI.startUserQuestionInteraction(toolId, sessionId).then(() => {
      if (submissionScope.current === scope) setInteractionAcknowledged(true);
    }).catch((error) => {
      if (submissionScope.current !== scope) return;
      interactionAttempt.current = null;
      setInteractionFailed(true);
      log.error('Failed to acknowledge user question interaction', { toolId, sessionId, error });
    });
  }, [canAnswer, peerDevice, sessionId, toolId]);
  const handleInteraction = useCallback((event: React.SyntheticEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, [data-bitfun-part="option"], [data-bitfun-part="custom-option"]')) {
      startInteraction();
    }
  }, [startInteraction]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCompletedSummary, setShowCompletedSummary] = useState(status === 'completed');
  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
    toolId,
    toolName: toolItem.toolName,
  });

  useLayoutEffect(() => {
    const shouldCompactCompleted = status === 'completed'
      && isLastItem !== true
      && !showCompletedSummary;

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

  useEffect(() => {
    setSubmissionFailed(false);
    setSubmissionErrorMessage(null);
    setInteractionFailed(false);
  }, [draftKey]);

  useEffect(() => {
    if (
      draftKey
      && finished
    ) {
      askUserQuestionDraftStore.getState().clearDraft(draftKey);
    }
  }, [draftKey, finished]);

  const setSubmissionPhase = useCallback((phase: AskUserQuestionSubmissionPhase) => {
    if (draftKey) {
      askUserQuestionDraftStore.getState().setSubmissionPhase(draftKey, phase);
      return;
    }
    setLocalDraft((current) => ({
      ...current,
      submissionPhase: phase,
      updatedAt: Date.now(),
    }));
  }, [draftKey]);

  const isAllAnswered = useCallback(() => {
    if (questions.length === 0) return false;

    for (let index = 0; index < questions.length; index += 1) {
      const answer = answers[index];
      const otherInput = otherInputs[index]?.trim() || '';
      // A question that declares its own input accepts a typed or picked value
      // on its own; its option list is a convenience, not a requirement.
      if (questions[index]?.inputPlaceholder) {
        const hasOption = Array.isArray(answer)
          ? answer.some((value) => value !== OTHER_OPTION_VALUE || otherInput.length > 0)
          : Boolean(answer);
        if (otherInput.length === 0 && !hasOption) return false;
        continue;
      }
      if (!answer) return false;
      if (
        Array.isArray(answer)
        && !answer.some((value) => value !== OTHER_OPTION_VALUE || otherInput.length > 0)
      ) return false;
      if (typeof answer === 'string' && answer === '') return false;
      if (answer === OTHER_OPTION_VALUE && otherInput.length === 0) return false;
    }
    return true;
  }, [answers, otherInputs, questions]);

  const handleSingleChange = useCallback((questionIndex: number, value: string) => {
    if (draftKey) {
      askUserQuestionDraftStore.getState().setSingleAnswer(draftKey, questionIndex, value);
      return;
    }
    setLocalDraft((current) => ({
      ...current,
      answers: {
        ...current.answers,
        [questionIndex]: value,
      },
      updatedAt: Date.now(),
    }));
  }, [draftKey]);

  const handleMultiChange = useCallback((
    questionIndex: number,
    value: string,
    checked: boolean,
  ) => {
    if (draftKey) {
      askUserQuestionDraftStore.getState().setMultiAnswer(
        draftKey,
        questionIndex,
        value,
        checked,
      );
      return;
    }
    setLocalDraft((current) => {
      const currentAnswer = current.answers[questionIndex];
      const currentValues = Array.isArray(currentAnswer) ? currentAnswer : [];
      const nextValues = checked
        ? currentValues.includes(value) ? currentValues : [...currentValues, value]
        : currentValues.filter((candidate) => candidate !== value);
      return {
        ...current,
        answers: {
          ...current.answers,
          [questionIndex]: nextValues,
        },
        updatedAt: Date.now(),
      };
    });
  }, [draftKey]);

  // Opt-in candidate default (`preselectFirstOption`): a card whose options are
  // backend-measured candidates opens on the first one so its form is
  // submittable without re-picking what the backend just resolved. The policy
  // belongs to the owning card — a model-authored question must open unanswered,
  // because the pre-selection is a real answer that can be submitted as-is. A
  // draft restored from the store — or the persisted answer of a finished card —
  // always wins, and multi-select questions keep their opt-in semantics.
  //
  // MERGE NOTE (this split is going to remote main): main still carries the
  // pre-split card, where this effect was unconditional — it pre-selected every
  // single-select question and a later main commit also pre-selected
  // multi-select. Keep this opt-in form when resolving that conflict: the
  // default is the owning card's policy (see QtMigrationIntakeCard), never a
  // shared default, and multi-select never opens selected.
  useEffect(() => {
    if (!preselectFirstOption || finished || awaitingPayload) return;
    questions.forEach((question, questionIndex) => {
      if (
        question.multiSelect
        || question.options.length === 0
        || answers[questionIndex] !== undefined
      ) return;
      handleSingleChange(questionIndex, question.options[0].value);
    });
  }, [
    answers,
    awaitingPayload,
    finished,
    handleSingleChange,
    preselectFirstOption,
    questions,
  ]);

  const handleOtherInputChange = useCallback((
    questionIndex: number,
    value: string,
    preserveOtherSelection = false,
  ) => {
    if (draftKey) {
      askUserQuestionDraftStore.getState().setOtherInput(
        draftKey,
        questionIndex,
        value,
        preserveOtherSelection,
      );
      return;
    }
    setLocalDraft((current) => {
      const isEmpty = value.trim().length === 0;
      const currentAnswer = current.answers[questionIndex];
      let nextAnswers = current.answers;
      if (
        isEmpty
        && !preserveOtherSelection
        && Array.isArray(currentAnswer)
        && currentAnswer.includes(OTHER_OPTION_VALUE)
      ) {
        nextAnswers = {
          ...current.answers,
          [questionIndex]: currentAnswer.filter((answer) => answer !== OTHER_OPTION_VALUE),
        };
      } else if (
        isEmpty
        && !preserveOtherSelection
        && currentAnswer === OTHER_OPTION_VALUE
      ) {
        nextAnswers = { ...current.answers };
        delete nextAnswers[questionIndex];
      }
      return {
        ...current,
        answers: nextAnswers,
        otherInputs: {
          ...current.otherInputs,
          [questionIndex]: isEmpty ? '' : value,
        },
        updatedAt: Date.now(),
      };
    });
  }, [draftKey]);

  // Open a native directory picker (or the in-app peer browser in Peer Device
  // Mode) and fill the question's input with the selected folder. Falls back to
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
    if (!selected) return;
    // The picked path is the answer, so any option highlight is cleared.
    handleOtherInputChange(questionIndex, selected, true);
    const currentAnswer = answers[questionIndex];
    if (Array.isArray(currentAnswer)) {
      currentAnswer.forEach((value) => handleMultiChange(questionIndex, value, false));
      return;
    }
    handleSingleChange(questionIndex, '');
  }, [answers, handleMultiChange, handleOtherInputChange, handleSingleChange, otherInputs]);

  const handleBrowseCustomAnswer = useCallback((questionId: string) => {
    const questionIndex = Number(questionId);
    const question = questions[questionIndex];
    if (!Number.isInteger(questionIndex) || !question) return;
    void handleBrowsePath(questionIndex, question.prompt);
  }, [handleBrowsePath, questions]);

  const handleSubmit = useCallback(async () => {
    if (!canAnswer || !isAllAnswered() || isSubmitting || isSubmitted) return;
    const scope = submissionScope.current;

    setSubmissionFailed(false);
    setSubmissionErrorMessage(null);
    setSubmissionPhase('submitting');
    try {
      activeSurfaceScope.assertCurrent('submitUserAnswers');
      const processedAnswers: Record<string, string | string[]> = {};

      for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        // Template-backed questions are submitted by field id so the backend
        // re-validation binds answers to the exact waiting request; plain
        // questions keep the positional key.
        const answerKey = question?.field ?? String(index);
        const answer = answers[index];
        const otherInput = otherInputs[index]?.trim() || '';

        if (Array.isArray(answer)) {
          processedAnswers[answerKey] = answer.flatMap((value) => (
            value === OTHER_OPTION_VALUE
              ? otherInput ? [otherInput] : []
              : [value]
          ));
        } else if (answer === OTHER_OPTION_VALUE) {
          if (otherInput) processedAnswers[answerKey] = otherInput;
        } else {
          // A question that declares its own input owns the answer: the typed or
          // picked value wins over an option highlight, mirroring the field that
          // is always visible for that question.
          const value = question?.inputPlaceholder
            ? otherInput || answer
            : answer || otherInput;
          if (value) processedAnswers[answerKey] = value;
        }
      }

      await toolAPI.submitUserAnswers(toolId, processedAnswers, sessionId);
      activeSurfaceScope.assertCurrent('submitUserAnswers');
      if (scope !== submissionScope.current) return;
      setSubmissionPhase('submitted');
    } catch (error) {
      if (scope !== submissionScope.current) return;
      setSubmissionPhase('idle');
      if (isSurfaceChangedError(error)) {
        return;
      }
      setSubmissionFailed(true);
      const rawMessage = error instanceof Error && error.message.trim()
        ? error.message
        : '';
      setSubmissionErrorMessage(describeSubmitFailure?.(rawMessage, t) ?? null);
      log.error('Failed to submit answers', { toolId, sessionId, error });
    }
  }, [
    activeSurfaceScope,
    answers,
    canAnswer,
    describeSubmitFailure,
    isAllAnswered,
    isSubmitted,
    isSubmitting,
    otherInputs,
    questions,
    setSubmissionPhase,
    sessionId,
    t,
    toolId,
  ]);

  const resultAnswers = normalizedResult?.answers;

  const getEffectiveAnswer = useCallback((questionIndex: number): ToolAnswer | undefined => {
    const localAnswer = answers[questionIndex];
    if (localAnswer !== undefined) return localAnswer;
    if (
      status === 'completed'
      && resultAnswers
      && typeof resultAnswers === 'object'
      && !Array.isArray(resultAnswers)
    ) {
      // Template answers persist under their field id, plain ones positionally.
      const persisted = resultAnswers as Record<string, unknown>;
      const keys = [questions[questionIndex]?.field, String(questionIndex)]
        .filter((key): key is string => Boolean(key));
      for (const key of keys) {
        const persistedAnswer = normalizeToolAnswer(persisted[key]);
        if (persistedAnswer !== undefined && persistedAnswer !== '') {
          return persistedAnswer;
        }
      }
    }
    return undefined;
  }, [answers, questions, resultAnswers, status]);

  const presentation = useMemo(() => {
    const nextAnswers: Record<string, readonly string[]> = {};
    const nextCustomAnswers: Record<string, string> = {};

    questions.forEach((question, questionIndex) => {
      const answer = getEffectiveAnswer(questionIndex);
      const answerValues = Array.isArray(answer)
        ? answer
        : answer === undefined || answer === '' ? [] : [answer];
      const knownValues = new Set(question.options.map((option) => option.value));
      const selectedValues: string[] = [];
      const customValues: string[] = [];

      answerValues.forEach((value) => {
        if (value === OTHER_OPTION_VALUE) {
          selectedValues.push(OTHER_OPTION_VALUE);
        } else if (knownValues.has(value)) {
          selectedValues.push(value);
        } else if (value) {
          if (!selectedValues.includes(OTHER_OPTION_VALUE)) {
            selectedValues.push(OTHER_OPTION_VALUE);
          }
          customValues.push(value);
        }
      });

      nextAnswers[String(questionIndex)] = selectedValues;
      nextCustomAnswers[String(questionIndex)] = otherInputs[questionIndex]
        || customValues.join(', ');
    });

    return {
      answers: nextAnswers as AskUserAnswers,
      customAnswers: nextCustomAnswers,
    };
  }, [getEffectiveAnswer, otherInputs, questions]);

  const designQuestions = useMemo<AskUserQuestion[]>(
    () => questions.map((question, questionIndex) => ({
      customOption: {
        description: t('toolCards.askUser.customInputHint'),
        inputLabel: t('toolCards.askUser.pleaseSpecify'),
        label: t('toolCards.askUser.other'),
        placeholder: question.inputPlaceholder ?? t('toolCards.askUser.pleaseSpecify'),
        value: OTHER_OPTION_VALUE,
      },
      header: question.header,
      id: String(questionIndex),
      // Declaring the placeholder keeps the answer field mounted for the whole
      // question instead of only after the custom option is selected.
      inputPlaceholder: question.inputPlaceholder,
      options: question.options,
      prompt: question.prompt,
      selectionMode: question.multiSelect ? 'multiple' : 'single',
    })),
    [questions, t],
  );

  const handleAnswersChange = useCallback((
    questionId: string,
    nextValues: readonly string[],
  ) => {
    const questionIndex = Number(questionId);
    const question = questions[questionIndex];
    if (!question || !Number.isInteger(questionIndex)) return;

    if (!question.multiSelect) {
      handleSingleChange(questionIndex, nextValues[0] ?? '');
      return;
    }

    const currentAnswer = answers[questionIndex];
    const currentValues = Array.isArray(currentAnswer) ? currentAnswer : [];
    const changedValue = [...new Set([...currentValues, ...nextValues])]
      .find((value) => currentValues.includes(value) !== nextValues.includes(value));
    if (changedValue !== undefined) {
      handleMultiChange(questionIndex, changedValue, nextValues.includes(changedValue));
    }
  }, [answers, handleMultiChange, handleSingleChange, questions]);

  const getAnswerDisplay = useCallback((questionIndex: number): string => {
    const answer = getEffectiveAnswer(questionIndex);
    const otherInput = otherInputs[questionIndex] || '';
    // A declared input owns the display; a typed or picked value is the answer
    // even when no option is highlighted.
    if (questions[questionIndex]?.inputPlaceholder && otherInput) return otherInput;
    if (!answer) return otherInput;
    if (Array.isArray(answer)) {
      return answer.map((value) => (
        value === OTHER_OPTION_VALUE ? otherInput || OTHER_OPTION_VALUE : value
      )).join(', ');
    }
    return answer === OTHER_OPTION_VALUE
      ? otherInput || OTHER_OPTION_VALUE
      : String(answer);
  }, [getEffectiveAnswer, otherInputs, questions]);

  const answersSummary = useMemo(
    () => questions.map((question, questionIndex) => {
      const answerText = getAnswerDisplay(questionIndex);
      const label = question.header || question.prompt;
      return `${label}: ${answerText || t('toolCards.askUser.notAnswered')}`;
    }).join(' | '),
    [getAnswerDisplay, questions, t],
  );

  const responseUnsupported = status !== 'completed' && !canSubmitUserAnswers;
  // The runtime QT toolchain provisioning is rendered as its own waterfall row
  // (see QtToolchainProvisionItem): the card collapses as soon as its answer is
  // accepted and never reports install progress itself.
  const statusText = status === 'completed'
    ? t('toolCards.askUser.completed')
    : responseUnsupported
      ? t('toolCards.askUser.unsupportedOnPeer')
      : isSubmitted
        ? t('toolCards.askUser.submittedWaiting')
        : isSubmitting
          ? t('toolCards.askUser.submitting')
          : interactionFailed
            ? t('toolCards.askUser.interactionFailed')
            : submissionFailed
              ? submissionErrorMessage ?? t('toolCards.askUser.submitFailed')
              : t('toolCards.askUser.waitingAnswer');

  if (endedWithoutAnswer) {
    const terminalLabel = timedOut
      ? t('toolCards.askUser.timeout')
      : cancelled
        ? t('toolCards.default.cancelled')
        : rejected
          ? t('toolCards.default.rejected')
          : t('toolCards.default.failed');
    return (
      <AskUser
        data-tool-card-id={toolId ?? ''}
        questions={[]}
        ref={cardRootRef}
        state="error"
        statusLabel={terminalLabel}
      />
    );
  }

  if (awaitingPayload) {
    return (
      <AskUser
        data-tool-card-id={toolId ?? ''}
        questions={[]}
        ref={cardRootRef}
        state="loading"
        statusLabel={t('toolCards.askUser.loadingQuestions')}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <AskUser
        data-tool-card-id={toolId ?? ''}
        questions={[]}
        ref={cardRootRef}
        state="error"
        statusLabel={t('toolCards.askUser.parseError')}
      />
    );
  }

  const componentState: AskUserState = status === 'completed'
    ? 'completed'
    : responseUnsupported
      ? 'error'
      : isSubmitting
        ? 'submitting'
        : isSubmitted
          ? 'submitted'
          : 'asking';
  const showSubmit = componentState === 'asking'
    || componentState === 'submitting'
    || componentState === 'submitted';

  return (
    <AskUser
      answers={presentation.answers}
      aria-label={t('toolCards.askUser.questionsCount', { count: questions.length })}
      browseCustomAnswerLabel={t('toolCards.askUser.browsePath')}
      customAnswers={presentation.customAnswers}
      data-tool-card-id={toolId ?? ''}
      disabled={!canAnswer}
      expanded={showCompletedSummary ? isExpanded : undefined}
      header={showCompletedSummary
        ? undefined
        : t('toolCards.askUser.questionsCount', { count: questions.length })}
      onClickCapture={handleInteraction}
      headerTrailing={showTimer && !isSubmitted ? (
        <Tooltip content={t('toolCards.askUser.timeoutSettingsHint')} placement="top">
          <Button
            variant="text"
            size="xs"
            labelBehavior="static"
            aria-label={t('toolCards.askUser.cancelCountdown')}
            disabled={!sessionId}
            trailingIcon={<X aria-hidden="true" />}
            onClick={startInteraction}
          >
            <span role="timer">{countdown}</span>
          </Button>
        </Tooltip>
      ) : undefined}
      onFocusCapture={handleInteraction}
      onAnswersChange={handleAnswersChange}
      onBrowseCustomAnswer={handleBrowseCustomAnswer}
      onCustomAnswerChange={(questionId, value, meta) => {
        handleOtherInputChange(Number(questionId), value, meta.isComposing);
      }}
      onExpandedChange={showCompletedSummary
        ? (nextExpanded) => {
            applyExpandedState(isExpanded, nextExpanded, setIsExpanded);
          }
        : undefined}
      onSubmit={handleSubmit}
      questions={designQuestions}
      ref={cardRootRef}
      state={componentState}
      statusLabel={showCompletedSummary ? undefined : statusText}
      submitDisabled={
        !isAllAnswered()
        || isSubmitted
        || !canAnswer
      }
      submitLabel={showSubmit ? t('toolCards.askUser.submit') : undefined}
      submittingLabel={t('toolCards.askUser.submitting')}
      submitTitle={!isAllAnswered()
        ? t('toolCards.askUser.answerAllBeforeSubmit')
        : undefined}
      summaryDetail={showCompletedSummary ? answersSummary : undefined}
      summaryLabel={showCompletedSummary
        ? t('toolCards.askUser.questionsAnswered', { count: questions.length })
        : undefined}
    />
  );
};
