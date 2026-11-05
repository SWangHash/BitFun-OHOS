import { OverflowText } from '../../primitives/OverflowText';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  CircleAlert,
  FolderSearch,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { Icon } from "../../components/Icon";
import { Input } from "../../components/Input";
import { Radio } from "../../components/Radio";
import { Tooltip } from "../../components/Tooltip";
import { classNames } from "../../internal/classNames";
import { isImeOwnedKeyboardEvent } from "../../internal/ime";
import styles from "./AskUser.module.css";

export type AskUserState =
  | "asking"
  | "submitting"
  | "submitted"
  | "completed"
  | "loading"
  | "error"
  | "timeout";

export interface AskUserOption {
  description?: ReactNode;
  label: ReactNode;
  value: string;
}

export interface AskUserCustomOption extends AskUserOption {
  inputLabel?: string;
  placeholder?: string;
}

export interface AskUserQuestion {
  customOption?: AskUserCustomOption;
  description?: ReactNode;
  id: string;
  /**
   * Declares a free-text answer rendered below the options, so a path or an
   * identifier can be typed or picked without selecting the custom option
   * first.
   */
  inputPlaceholder?: string;
  /** Short subject shown beside the question count in the header. */
  label?: ReactNode;
  options: readonly AskUserOption[];
  prompt: ReactNode;
  selectionMode?: "multiple" | "single";
}

export type AskUserAnswers = Readonly<
  Record<string, readonly string[] | undefined>
>;

export interface AskUserCustomAnswerChangeMeta {
  isComposing: boolean;
}

export interface AskUserNavigation {
  backLabel: ReactNode;
  nextLabel: ReactNode;
  progressLabel: (current: number, total: number) => string;
  selectionLabel: (selected: number, total: number) => ReactNode;
}

/**
 * Header-right wait timing. A running host deadline renders a dismissible
 * countdown; an unbounded wait renders the settled label instead so the header
 * never loses its timing affordance.
 */
export interface AskUserWaitTiming {
  cancelLabel?: string;
  cancelDisabled?: boolean;
  hint?: ReactNode;
  onCancel?: () => void;
  remainingLabel?: ReactNode;
  settledLabel?: ReactNode;
}

export interface AskUserProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> {
  answers?: AskUserAnswers;
  /** Accessible name and title of the optional per-question picker button. */
  browseCustomAnswerLabel?: string;
  customAnswers?: Readonly<Record<string, string | undefined>>;
  defaultExpanded?: boolean;
  disabled?: boolean;
  /** A collapsed entry that opens an editable questionnaire. */
  disclosure?: { label: ReactNode; collapseLabel: string; skipped?: boolean };
  expanded?: boolean;
  header?: ReactNode;
  headerTrailing?: ReactNode;
  /** Show one question at a time; submitted answers display every question and answer. */
  navigation?: AskUserNavigation;
  onAnswersChange?: (questionId: string, values: readonly string[]) => void;
  /**
   * Renders a picker button beside every declared custom input. The component
   * stays surface-agnostic: the owner owns the dialog and the resulting value.
   */
  onBrowseCustomAnswer?: (questionId: string) => void;
  onCustomAnswerChange?: (
    questionId: string,
    value: string,
    meta: AskUserCustomAnswerChangeMeta,
  ) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onSubmit?: () => void;
  questions: readonly AskUserQuestion[];
  state?: AskUserState;
  statusLabel?: ReactNode;
  submitDisabled?: boolean;
  submitLabel?: ReactNode;
  submitTitle?: string;
  submittingLabel?: ReactNode;
  summaryDetail?: ReactNode;
  summaryLabel?: ReactNode;
  waitTiming?: AskUserWaitTiming;
}

function hasAnswer(
  question: AskUserQuestion,
  answers: AskUserAnswers,
  customAnswers: AskUserProps["customAnswers"],
) {
  return (answers[question.id] ?? []).some((value) => (
    value === question.customOption?.value
      ? Boolean(customAnswers?.[question.id]?.trim())
      : question.options.some((option) => option.value === value)
  ));
}

function StatusIcon({ state }: { state: AskUserState }) {
  if (state === "loading" || state === "submitting") {
    return <Icon name="progress-25" size="md" />;
  }
  if (state === "completed" || state === "submitted") {
    return <Icon name="check-circle" size="md" />;
  }
  if (state === "timeout") {
    return <Icon name="circle-arrow-right" size="md" />;
  }
  return <Icon glyph={CircleAlert} size="md" />;
}

export const AskUser = forwardRef<HTMLDivElement, AskUserProps>(function AskUser({
  answers = {},
  browseCustomAnswerLabel,
  className,
  customAnswers = {},
  defaultExpanded = false,
  disabled = false,
  disclosure,
  expanded,
  header,
  headerTrailing,
  navigation,
  onAnswersChange,
  onBrowseCustomAnswer,
  onCustomAnswerChange,
  onExpandedChange,
  onSubmit,
  questions,
  state = "asking",
  statusLabel,
  submitDisabled = false,
  submitLabel,
  submitTitle,
  submittingLabel,
  summaryDetail,
  summaryLabel,
  waitTiming,
  ...props
}, ref) {
  const instanceId = useId();
  const detailsId = `${instanceId}-details`;
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [activeQuestionId, setActiveQuestionId] = useState(() => (
    questions.find((question) => !hasAnswer(question, answers, customAnswers))?.id
      ?? questions[0]?.id
  ));
  const promptRef = useRef<HTMLLegendElement>(null);
  const focusQuestionRef = useRef(false);
  const composingQuestionsRef = useRef(new Set<string>());
  const hasSummary = summaryLabel !== undefined && summaryLabel !== null;
  const resolvedExpanded = hasSummary || disclosure
    ? expanded ?? internalExpanded
    : true;
  const interactionDisabled = disabled || state !== "asking";
  const paginated = Boolean(navigation && !hasSummary && questions.length);
  const activeQuestionIndex = Math.max(0, questions.findIndex((question) => question.id === activeQuestionId));
  const activeQuestion = questions[activeQuestionIndex];
  const isLastQuestion = activeQuestionIndex === questions.length - 1;
  const currentAnswered = activeQuestion && hasAnswer(activeQuestion, answers, customAnswers);
  const selectedCount = activeQuestion
    ? activeQuestion.options.filter((option) => answers[activeQuestion.id]?.includes(option.value)).length
      + (activeQuestion.customOption && answers[activeQuestion.id]?.includes(activeQuestion.customOption.value) ? 1 : 0)
    : 0;

  useEffect(() => {
    if (focusQuestionRef.current) {
      promptRef.current?.focus({ preventScroll: true });
      focusQuestionRef.current = false;
    }
  }, [activeQuestionId, resolvedExpanded]);
  const showStatusOnly = state === "loading"
    || (state === "error" || state === "timeout") && questions.length === 0;

  function setExpanded(nextExpanded: boolean) {
    if (nextExpanded) focusQuestionRef.current = true;
    if (expanded === undefined) {
      setInternalExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  }

  function goToQuestion(index: number) {
    if (interactionDisabled || !questions[index]) return;
    focusQuestionRef.current = true;
    setActiveQuestionId(questions[index].id);
  }

  function updateAnswer(
    question: AskUserQuestion,
    value: string,
    checked: boolean,
  ) {
    if (interactionDisabled) return;
    const currentValues = answers[question.id] ?? [];
    const nextValues = question.selectionMode === "multiple"
      ? checked
        ? currentValues.includes(value)
          ? currentValues
          : [...currentValues, value]
        : currentValues.filter((candidate) => candidate !== value)
      : checked ? [value] : [];
    onAnswersChange?.(question.id, nextValues);
  }

  if (showStatusOnly) {
    return (
      <div
        {...props}
        className={classNames(styles.root, styles.statusOnly, className)}
        data-bitfun-component="ask-user"
        data-bitfun-part="root"
        data-bitfun-state={state}
        ref={ref}
        role={state === "error" ? "alert" : "status"}
      >
        <span className={styles.statusIcon} data-bitfun-icon-slot="true" data-bitfun-part="status-icon">
          <StatusIcon state={state} />
        </span>
        <span className={styles.statusText} data-bitfun-part="status-label">
          {statusLabel}
        </span>
      </div>
    );
  }

  if (state === "submitted" || state === "completed") {
    return (
      <div
        {...props}
        className={classNames(styles.answerMessage, className)}
        data-bitfun-component="ask-user"
        data-bitfun-part="root"
        data-bitfun-state={state}
        ref={ref}
      >
        <dl className={styles.answerList} data-bitfun-part="answers">
          {questions.map((question) => (
            <div className={styles.answerPair} data-bitfun-part="answer-pair" key={question.id}>
              <dt className={styles.answeredQuestion} data-bitfun-part="answered-question">
                {question.prompt}
              </dt>
              <dd className={styles.answer} data-bitfun-part="answer">
                {(answers[question.id] ?? []).map((value) => {
                  const answer = value === question.customOption?.value
                    ? customAnswers[question.id]?.trim()
                    : question.options.find((option) => option.value === value)?.label ?? value;
                  if (answer === undefined || answer === null || answer === "") return null;
                  return <div data-bitfun-part="answer-value" key={value}>{answer}</div>;
                })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const showFeedback = (state === "error" || state === "timeout")
    && statusLabel !== undefined
    && statusLabel !== null;
  const showFooter = !hasSummary && (paginated ||
    submitLabel !== undefined && submitLabel !== null
    || statusLabel !== undefined && statusLabel !== null
  );
  const headerIcon = (
    <Icon
      className={classNames(styles.headerIcon, disclosure?.skipped && styles.skippedIcon)}
      data-bitfun-part="header-icon"
      name="message-circle-question"
      size="md"
    />
  );
  const hasWaitCountdown = waitTiming?.onCancel !== undefined
    && waitTiming.remainingLabel !== undefined
    && waitTiming.remainingLabel !== null;
  const hasSettledWait = waitTiming?.settledLabel !== undefined
    && waitTiming.settledLabel !== null;
  const waitNode = hasWaitCountdown && waitTiming
    ? (
      <span className={styles.waitTiming} data-counting="true" data-bitfun-part="wait-timing">
        <Tooltip content={waitTiming.hint} disabled={!waitTiming.hint} placement="top">
          <Button
            aria-label={waitTiming.cancelLabel}
            disabled={waitTiming.cancelDisabled}
            labelBehavior="static"
            onClick={waitTiming.onCancel}
            size="xs"
            trailingIcon={<Icon name="xmark" size="xs" />}
            variant="text"
          >
            <span role="timer">{waitTiming.remainingLabel}</span>
          </Button>
        </Tooltip>
      </span>
    )
    : hasSettledWait && waitTiming
      ? (
        <span className={styles.waitTiming} data-counting="false" data-bitfun-part="wait-timing">
          <span className={styles.waitSettled} data-bitfun-part="wait-settled">
            {waitTiming.settledLabel}
          </span>
        </span>
      )
      : null;

  return (
    <div
      {...props}
      className={classNames(styles.root, className)}
      data-bitfun-component="ask-user"
      data-bitfun-expanded={resolvedExpanded ? "true" : "false"}
      data-bitfun-has-summary={hasSummary ? "true" : "false"}
      data-bitfun-paginated={paginated ? "true" : "false"}
      data-bitfun-part="root"
      data-bitfun-state={state}
      data-disabled={disabled ? "true" : "false"}
      ref={ref}
    >
      {disclosure && !resolvedExpanded ? (
        <button data-overflow-trigger
          aria-controls={detailsId}
          aria-expanded={false}
          className={styles.summaryButton}
          data-bitfun-part="disclosure"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <span className={styles.headerLeading}>
            {headerIcon}
            <OverflowText>{disclosure.label}</OverflowText>
          </span>
          <span className={styles.summaryAction} data-bitfun-icon-slot="true">
            <Icon name="chevron-down" size="md" />
          </span>
        </button>
      ) : hasSummary ? (
        <button data-overflow-trigger
          aria-controls={detailsId}
          aria-expanded={resolvedExpanded}
          className={styles.summaryButton}
          data-bitfun-part="summary"
          onClick={() => setExpanded(!resolvedExpanded)}
          type="button"
        >
          <span className={styles.summaryLeading}>
            <span className={styles.summaryIcon} data-bitfun-icon-slot="true" data-bitfun-part="summary-icon">
              <Icon name="check-circle" size="md" />
            </span>
            <span className={styles.summaryCopy}>
              <span className={styles.summaryLabel} data-bitfun-part="summary-label">
                {summaryLabel}
              </span>
              {summaryDetail !== undefined && summaryDetail !== null && (
                <>
                  <span aria-hidden="true" className={styles.summaryArrow}>→</span>
                  <OverflowText className={styles.summaryDetail} data-bitfun-part="summary-detail">
                    {summaryDetail}
                  </OverflowText>
                </>
              )}
            </span>
          </span>
          <span className={styles.summaryAction} data-bitfun-icon-slot="true" data-bitfun-part="summary-action">
            {resolvedExpanded
              ? <Icon name="chevron-up" size="md" />
              : <Icon name="chevron-down" size="md" />}
          </span>
        </button>
      ) : paginated && navigation ? (
        <div className={styles.navigation} data-bitfun-part="navigation">
          <div className={styles.header} data-disclosure={disclosure ? "true" : undefined} data-bitfun-part="header">
            {disclosure && (
              <button
                aria-controls={detailsId}
                aria-expanded={true}
                aria-label={disclosure.collapseLabel}
                className={styles.headerToggle}
                data-bitfun-part="collapse"
                onClick={() => setExpanded(false)}
                type="button"
              />
            )}
            <span className={styles.headerLeading}>
              {headerIcon}
              <span className={styles.questionCount} data-bitfun-part="question-count" id={`${instanceId}-progress`}>
                {navigation.progressLabel(activeQuestionIndex + 1, questions.length)}
              </span>
              {activeQuestion?.label !== undefined && activeQuestion.label !== null && activeQuestion.label !== "" && (
                <OverflowText className={styles.headerSubject} data-bitfun-part="question-label">
                  {activeQuestion.label}
                </OverflowText>
              )}
            </span>
            <span className={styles.headerTrailing}>
              {waitNode}
              {headerTrailing}
              {activeQuestionIndex > 0 && (
                <span data-bitfun-part="back">
                  <Button
                    disabled={interactionDisabled}
                    leadingIcon={<Icon name="arrow-left" size="sm" />}
                    onClick={() => goToQuestion(activeQuestionIndex - 1)}
                    size="sm"
                    variant="fill"
                  >
                    {navigation.backLabel}
                  </Button>
                </span>
              )}
              {disclosure && (
                <span className={styles.summaryAction} data-bitfun-icon-slot="true">
                  <Icon name="chevron-up" size="md" />
                </span>
              )}
            </span>
          </div>
          <progress
            aria-labelledby={`${instanceId}-progress`}
            className={styles.progress}
            data-bitfun-part="progress"
            max={questions.length}
            value={activeQuestionIndex + 1}
          />
        </div>
      ) : header !== undefined && header !== null || disclosure ? (
        <div className={styles.header} data-disclosure={disclosure ? "true" : undefined} data-bitfun-part="header">
          {disclosure && (
            <button
              aria-controls={detailsId}
              aria-expanded={true}
              aria-label={disclosure.collapseLabel}
              className={styles.headerToggle}
              data-bitfun-part="collapse"
              onClick={() => setExpanded(false)}
              type="button"
            />
          )}
          <span className={styles.headerLeading}>
            {headerIcon}
            <OverflowText>{header ?? disclosure?.label}</OverflowText>
          </span>
          {(waitNode || (headerTrailing !== undefined && headerTrailing !== null)) && (
            <span className={styles.headerTrailing}>{waitNode}{headerTrailing}</span>
          )}
          {disclosure && (
            <span className={styles.summaryAction} data-bitfun-icon-slot="true">
              <Icon name="chevron-up" size="md" />
            </span>
          )}
        </div>
      ) : null}

      <div
        aria-hidden={hasSummary && !resolvedExpanded ? true : undefined}
        className={styles.details}
        data-bitfun-part="details"
        hidden={Boolean(disclosure && !resolvedExpanded)}
        id={detailsId}
      >
        {(!disclosure || resolvedExpanded) && (
        <div className={styles.detailsInner}>
          <div className={styles.body} data-bitfun-part="body">
            {questions.map((question, questionIndex) => {
              if (paginated && questionIndex !== activeQuestionIndex) return null;
              const multiple = question.selectionMode === "multiple";
              const SelectionControl = multiple ? Checkbox : Radio;
              const selectedValues = answers[question.id] ?? [];
              const customOption = question.customOption;
              const customSelected = customOption
                ? selectedValues.includes(customOption.value)
                : false;
              const hasDeclaredInput = Boolean(question.inputPlaceholder);
              const inputLabel = customOption?.inputLabel
                ?? (typeof customOption?.label === "string"
                  ? customOption.label
                  : undefined)
                ?? question.inputPlaceholder;
              const isComposing = () => composingQuestionsRef.current.has(question.id);

              /**
               * The custom input row renders inline inside the "Other" option
               * after it is checked. When the question declares its own
               * inputPlaceholder the row also carries a browse button so the
               * user can pick a path instead of typing — but it is still the
               * "Other" option that owns the answer, so selection follows the
               * same checkbox/radio toggle as every other option.
               */
              const customInputRow = () => (
                <span
                  className={classNames(
                    styles.customInput,
                  )}
                  data-bitfun-part="custom-input"
                >
                  <input
                    aria-label={inputLabel}
                    autoFocus
                    className={styles.customInputField}
                    disabled={interactionDisabled}
                    onChange={(event) => {
                      onCustomAnswerChange?.(
                        question.id,
                        event.currentTarget.value,
                        {
                          isComposing: isComposing()
                            || (event.nativeEvent as InputEvent).isComposing,
                        },
                      );
                    }}
                    onCompositionEnd={(event) => {
                      onCustomAnswerChange?.(
                        question.id,
                        event.currentTarget.value,
                        { isComposing: true },
                      );
                      queueMicrotask(() => {
                        composingQuestionsRef.current.delete(question.id);
                      });
                    }}
                    onCompositionStart={() => {
                      composingQuestionsRef.current.add(question.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        (event.key === "Enter" || event.key === "Escape")
                        && isImeOwnedKeyboardEvent(event, isComposing())
                      ) {
                        event.stopPropagation();
                      }
                    }}
                    placeholder={customOption?.placeholder ?? question.inputPlaceholder}
                    type="text"
                    value={customAnswers[question.id] ?? ""}
                  />
                  {/* A declared input may also pick a path from the file
                      system; a plain custom option stays free-text only. */}
                  {hasDeclaredInput && onBrowseCustomAnswer !== undefined && (
                    <button
                      aria-label={browseCustomAnswerLabel}
                      className={styles.browseButton}
                      data-bitfun-part="browse"
                      disabled={interactionDisabled}
                      onClick={() => onBrowseCustomAnswer(question.id)}
                      title={browseCustomAnswerLabel}
                      type="button"
                    >
                      <FolderSearch aria-hidden="true" />
                    </button>
                  )}
                </span>
              );

              return (
                <fieldset
                  aria-describedby={question.description ? `${instanceId}-${questionIndex}-hint` : undefined}
                  className={styles.question}
                  data-bitfun-part="question"
                  disabled={interactionDisabled}
                  key={question.id}
                >
                  <legend
                    className={styles.prompt}
                    data-bitfun-part="prompt"
                    ref={paginated ? promptRef : undefined}
                    tabIndex={paginated ? -1 : undefined}
                  >
                    {question.prompt}
                  </legend>
                  {question.description && (
                    <div className={styles.questionDescription} data-bitfun-part="question-description" id={`${instanceId}-${questionIndex}-hint`}>
                      {question.description}
                    </div>
                  )}
                  <div className={styles.options} data-bitfun-part="options">
                    {question.options.map((option, optionIndex) => {
                      const optionId = `${instanceId}-${questionIndex}-${optionIndex}`;
                      const selected = selectedValues.includes(option.value);

                      return (
                        <div
                          className={styles.option}
                          data-bitfun-part="option"
                          data-selected={selected ? "true" : "false"}
                          key={option.value}
                        >
                          <SelectionControl
                            checked={selected}
                            className={styles.optionSelector}
                            disabled={interactionDisabled && !selected}
                            readOnly={interactionDisabled && selected}
                            id={optionId}
                            name={`${instanceId}-${questionIndex}`}
                            onCheckedChange={(checked) => updateAnswer(
                              question,
                              option.value,
                              checked,
                            )}
                            size={multiple ? "lg" : "md"}
                            value={option.value}
                          >
                            <span className={styles.optionCopy}>
                              <span className={styles.optionLabel} data-bitfun-part="label">
                                {option.label}
                              </span>
                              {option.description !== undefined && option.description !== null && (
                                <span className={styles.optionDescription} data-bitfun-part="description">
                                  {option.description}
                                </span>
                              )}
                            </span>
                          </SelectionControl>
                        </div>
                      );
                    })}

                    {/* The "Other" option always renders: whether the question
                        declares its own input or not, the custom answer is an
                        opt-in selection that follows the same toggle as every
                        other option. A declared input only adds a browse
                        button to the inline field. */}
                    {customOption && (() => {
                      const optionId = `${instanceId}-${questionIndex}-custom`;

                      return (
                        <div
                          className={styles.option}
                          data-bitfun-part="option"
                          data-custom="true"
                          data-selected={customSelected ? "true" : "false"}
                        >
                          <SelectionControl
                            checked={customSelected}
                            className={styles.optionSelector}
                            disabled={interactionDisabled && !customSelected}
                            readOnly={interactionDisabled && customSelected}
                            id={optionId}
                            name={`${instanceId}-${questionIndex}`}
                            onCheckedChange={(checked) => updateAnswer(
                              question,
                              customOption.value,
                              checked,
                            )}
                            size={multiple ? "lg" : "md"}
                            value={customOption.value}
                          >
                            <span className={styles.optionCopy}>
                              <span className={styles.optionLabel} data-bitfun-part="label">
                                {customOption.label}
                              </span>
                              {!customSelected
                                && customOption.description !== undefined
                                && customOption.description !== null && (
                                  <span className={styles.optionDescription} data-bitfun-part="description">
                                    {customOption.description}
                                  </span>
                                )}
                            </span>
                          </SelectionControl>
                          {customSelected && (
                            <span className={styles.customInput} data-bitfun-part="custom-input">
                              <Input
                                aria-label={inputLabel}
                                autoFocus={!interactionDisabled}
                                readOnly={interactionDisabled}
                                onChange={(event) => {
                                  onCustomAnswerChange?.(
                                    question.id,
                                    event.currentTarget.value,
                                    {
                                      isComposing: composingQuestionsRef.current.has(question.id)
                                        || (event.nativeEvent as InputEvent).isComposing,
                                    },
                                  );
                                }}
                                onCompositionEnd={(event) => {
                                  onCustomAnswerChange?.(
                                    question.id,
                                    event.currentTarget.value,
                                    { isComposing: true },
                                  );
                                  queueMicrotask(() => {
                                    composingQuestionsRef.current.delete(question.id);
                                  });
                                }}
                                onCompositionStart={() => {
                                  composingQuestionsRef.current.add(question.id);
                                }}
                                placeholder={customOption.placeholder}
                                size="sm"
                                value={customAnswers[question.id] ?? ""}
                              />
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </fieldset>
              );
            })}
          </div>

          {showFeedback && (
            <div
              className={styles.feedback}
              data-bitfun-part="feedback"
              role={state === "error" ? "alert" : "status"}
            >
              <span className={styles.statusIcon} data-bitfun-icon-slot="true" data-bitfun-part="status-icon">
                <StatusIcon state={state} />
              </span>
              <span className={styles.statusText} data-bitfun-part="status-label">
                {statusLabel}
              </span>
            </div>
          )}
        </div>
        )}
      </div>

      {showFooter && resolvedExpanded && (
        <div className={styles.footer} data-bitfun-part="footer">
          {paginated && navigation && activeQuestion?.selectionMode === "multiple" && (
            <span aria-live="polite" className={styles.counter} data-bitfun-part="selection-count">
              {navigation.selectionLabel(
                selectedCount,
                activeQuestion.options.length + (activeQuestion.customOption ? 1 : 0),
              )}
            </span>
          )}
          {statusLabel !== undefined && statusLabel !== null && !showFeedback && (
            <span className={styles.status} data-bitfun-part="status" role="status">
              <span className={styles.statusIcon} data-bitfun-icon-slot="true" data-bitfun-part="status-icon">
                <StatusIcon state={state} />
              </span>
              <span className={styles.statusText} data-bitfun-part="status-label">
                {statusLabel}
              </span>
            </span>
          )}
          {paginated && navigation && !isLastQuestion ? (
            <span className={styles.submit} data-bitfun-part="next">
              <Button
                disabled={interactionDisabled || !currentAnswered}
                onClick={() => goToQuestion(activeQuestionIndex + 1)}
                size="sm"
                variant="primary"
              >
                {navigation.nextLabel}
              </Button>
            </span>
          ) : submitLabel !== undefined && submitLabel !== null && (
            <span className={styles.submit} data-bitfun-part="submit">
              <Button
                disabled={interactionDisabled || submitDisabled}
                loading={state === "submitting"}
                onClick={onSubmit}
                size="sm"
                title={submitTitle}
                variant="primary"
              >
                {state === "submitting" && submittingLabel !== undefined
                  ? submittingLabel
                  : submitLabel}
              </Button>
            </span>
          )}
        </div>
      )}
    </div>
  );
});
