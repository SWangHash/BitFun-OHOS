/**
 * Qt migration intake card.
 *
 * The Qt template is template-driven: the backend resolves the four migration
 * paths and emits them on `questionRequest.qtMigrationQuestions` in this card's
 * own shape, which keeps the Qt-only concerns (candidate path, Qt major version,
 * managed download option, migration-specific submit rejections) out of the
 * generic question card. Interaction, drafts, submission and sizing are shared
 * through {@link AskUserQuestionShell}.
 *
 * A candidate renders as `<path><Qt5 badge>`: the version is a structured field,
 * never text appended to the path, so the value a click submits stays the clean
 * path the backend re-validates. Both the toolchain candidates and the source
 * project candidates carry one — the kit layout decides the toolchain version and
 * the project's own C++ API decides the project version.
 *
 * Opening on the first candidate is this card's own policy, requested from the
 * shell through `preselectFirstOption` — a plain question must open unanswered.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { createLogger } from '@/shared/utils/logger';
import {
  AskUserQuestionShell,
  type AskUserCardOption,
  type AskUserCardQuestion,
} from './AskUserQuestionShell';

const log = createLogger('QtMigrationIntakeCard');

/** Backend template id the Qt intake is resolved from. */
export const QT_MIGRATION_PATHS_TEMPLATE_ID = 'qt-migration-paths';

/**
 * One candidate in the template's own shape. `path` is the concrete path a
 * click submits; `version` is the Qt major version a candidate carries (measured
 * for a toolchain, read from the project's code for a source project), and the
 * managed download option carries `value` (and its own description) instead of a
 * path.
 */
export interface QtMigrationOption {
  /** i18n key for the option's role line (`askUser.qtMigration.option.*`). */
  label: string;
  /** i18n key for the second line of an option that has no path. */
  description?: string;
  path: string;
  /** Explicit submitted value (`__official__`). */
  value?: string;
  version?: number;
}

/** One Qt migration intake question in the template's own shape. */
export interface QtMigrationQuestion {
  /** Field id the answer binds to (`source_project`, ...). */
  field: string;
  /** i18n key for the field label chip. */
  header: string;
  /** i18n key for the prompt. */
  prompt: string;
  /** i18n key for the free-text input placeholder. */
  placeholder?: string;
  required: boolean;
  options: QtMigrationOption[];
  /** i18n key for a notice rendered under the prompt. */
  notice?: string;
  /** External documentation the notice links to. */
  noticeUrl?: string;
}

/**
 * Backend rejections for migration answers. Stable machine formats emitted by
 * the coordinator:
 * - `qt_migration_path_not_found: field=<id>; path=<value>`
 * - `qt_migration_output_is_artifact: field=<id>; path=<value>`
 */
const PATH_NOT_FOUND_PATTERN =
  /qt_migration_path_not_found:\s*field=([^;]+);\s*path=(.+)/;
const OUTPUT_ARTIFACT_PATTERN =
  /qt_migration_output_is_artifact:\s*field=([^;]+);\s*path=(.+)/;

type SubmitRejectionCode = 'path-not-found' | 'output-artifact';

/** Static i18n keys for the migration field ids rejected by the backend. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  source_project: 'toolCards.askUser.fieldName.source_project',
  output_project: 'toolCards.askUser.fieldName.output_project',
  toolchain: 'toolCards.askUser.fieldName.toolchain',
  template: 'toolCards.askUser.fieldName.template',
};

function parseSubmitRejection(
  message: string,
): { code: SubmitRejectionCode; field: string; path: string } | null {
  const trimmed = message.trim();
  const pathNotFound = PATH_NOT_FOUND_PATTERN.exec(trimmed);
  if (pathNotFound) {
    return {
      code: 'path-not-found',
      field: pathNotFound[1].trim(),
      path: pathNotFound[2].trim(),
    };
  }
  const outputArtifact = OUTPUT_ARTIFACT_PATTERN.exec(trimmed);
  if (outputArtifact) {
    return {
      code: 'output-artifact',
      field: outputArtifact[1].trim(),
      path: outputArtifact[2].trim(),
    };
  }
  return null;
}

/**
 * Template-owned text may carry a stable i18n key instead of literal copy; the
 * card localizes it through the `flow-chat` catalog (the keys are relative to
 * the `toolCards.` namespace root). Concrete values (paths) pass through.
 */
function localizeQtMigrationText(
  t: TFunction<'flow-chat'>,
  text: string,
): string {
  return text.startsWith('askUser.qtMigration.') ? t(`toolCards.${text}`) : text;
}

/**
 * Value an option submits. A candidate submits its path and the managed
 * download option submits its explicit value; the display label is never a
 * submitted answer, because the backend rejects placeholder-looking values.
 */
function qtMigrationOptionValue(option: QtMigrationOption): string {
  return option.value?.trim() || option.path.trim();
}

function normalizeQtMigrationQuestions(input: unknown): QtMigrationQuestion[] {
  if (!input || typeof input !== 'object') return [];
  const raw = (input as Record<string, unknown>).qtMigrationQuestions;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((candidate): QtMigrationQuestion[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const rawQuestion = candidate as Record<string, unknown>;
    const field = typeof rawQuestion.field === 'string' ? rawQuestion.field.trim() : '';
    const prompt = typeof rawQuestion.prompt === 'string' ? rawQuestion.prompt.trim() : '';
    if (!field || !prompt) return [];

    const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
    const options = rawOptions.flatMap((option): QtMigrationOption[] => {
      if (!option || typeof option !== 'object') return [];
      const rawOption = option as Record<string, unknown>;
      const label = typeof rawOption.label === 'string' ? rawOption.label.trim() : '';
      if (!label) return [];
      const version = typeof rawOption.version === 'number' && Number.isFinite(rawOption.version)
        ? rawOption.version
        : undefined;
      return [{
        label,
        description: typeof rawOption.description === 'string' && rawOption.description.trim()
          ? rawOption.description.trim()
          : undefined,
        path: typeof rawOption.path === 'string' ? rawOption.path.trim() : '',
        value: typeof rawOption.value === 'string' && rawOption.value.trim()
          ? rawOption.value.trim()
          : undefined,
        version,
      }];
    });

    const header = typeof rawQuestion.header === 'string' ? rawQuestion.header.trim() : '';
    const placeholder = typeof rawQuestion.placeholder === 'string'
      ? rawQuestion.placeholder.trim()
      : '';
    const notice = typeof rawQuestion.notice === 'string' ? rawQuestion.notice.trim() : '';
    const noticeUrl = typeof rawQuestion.noticeUrl === 'string'
      && /^https:\/\//i.test(rawQuestion.noticeUrl.trim())
      ? rawQuestion.noticeUrl.trim()
      : '';

    return [{
      field,
      header: header || field,
      notice: notice || undefined,
      noticeUrl: noticeUrl || undefined,
      options,
      placeholder: placeholder || undefined,
      prompt,
      required: Boolean(rawQuestion.required),
    }];
  });
}

/**
 * The Qt major version badge; `undefined` when the backend could not measure one
 * (a template candidate, or the managed download option, which carries no path at
 * all). A source project candidate always has one: its version is read from its
 * own code, which can only answer Qt5 or Qt6.
 *
 * Styled inline rather than through a stylesheet: a stylesheet import would make
 * this card a styled owner that must publish its own Appearance contract, and a
 * Qt-only version badge is not worth a new skin surface. The tokens come from the
 * design system the surrounding AskUser anatomy already uses.
 */
function qtVersionBadge(version: number | undefined): React.ReactNode {
  if (version === undefined) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        marginInlineStart: 'var(--bitfun-space-2)',
        paddingInline: 'var(--bitfun-space-1)',
        border: 'var(--bitfun-border-width-default) solid var(--bitfun-color-border-subtle)',
        borderRadius: 'var(--bitfun-radius-base)',
        background: 'var(--bitfun-color-surface-raised)',
        color: 'var(--bitfun-color-content-secondary)',
        fontSize: 'var(--bitfun-type-support-font-size)',
        fontWeight: 600,
        lineHeight: 1.6,
        verticalAlign: 'baseline',
      }}
    >
      {`Qt${version}`}
    </span>
  );
}

/**
 * A backend notice under the prompt (e.g. "install the Qt6 toolchain yourself
 * first"), with an optional link to the external guide. Inline-styled for the
 * same reason as {@link qtVersionBadge}. The link opens in the system browser.
 */
function qtMigrationNotice(
  text: string,
  url: string | undefined,
  linkLabel: string,
): React.ReactNode {
  return (
    <span
      data-qt-migration-notice=""
      style={{
        display: 'block',
        marginBlockStart: 'var(--bitfun-space-1)',
        color: 'var(--bitfun-color-status-warning-content)',
        fontSize: 'var(--bitfun-type-support-font-size)',
        fontWeight: 'normal',
        lineHeight: 1.5,
      }}
    >
      {text}
      {url ? (
        <>
          {' '}
          <a
            href={url}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void systemAPI.openExternal(url).catch((error: unknown) => {
                log.warn('Failed to open Qt toolchain guide', { error });
              });
            }}
            style={{
              color: 'var(--bitfun-color-accent-default)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {linkLabel}
          </a>
        </>
      ) : null}
    </span>
  );
}

export const QtMigrationIntakeCard: React.FC<ToolCardProps> = ({
  toolItem,
  isLastItem,
  sessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const localize = useCallback(
    (text: string) => localizeQtMigrationText(t, text),
    [t],
  );
  const questions = useMemo(
    () => normalizeQtMigrationQuestions(toolItem.questionRequest),
    [toolItem.questionRequest],
  );
  const cardQuestions = useMemo<AskUserCardQuestion[]>(
    () => questions.map((question) => ({
      field: question.field,
      header: localize(question.header),
      inputPlaceholder: question.placeholder
        ? localize(question.placeholder)
        : undefined,
      multiSelect: false,
      prompt: localize(question.prompt),
      notice: question.notice
        ? qtMigrationNotice(
          localize(question.notice),
          question.noticeUrl,
          t('toolCards.askUser.qtMigration.notice.openGuide'),
        )
        : undefined,
      options: question.options.map((option): AskUserCardOption => {
        const role = localize(option.label);
        // A candidate option renders its role line plus the Qt major badge, and
        // the clean path as the second line. The badge must not trail the path:
        // the design renders that line as a single non-wrapping, clipped and
        // right-edge-faded line, so a long toolchain path swallows anything
        // appended to its end. The role line wraps instead, so the badge stays
        // visible however long the path is.
        if (option.path) {
          return {
            value: qtMigrationOptionValue(option),
            label: <>{role}{qtVersionBadge(option.version)}</>,
            description: option.path,
          };
        }
        // The managed download option has no path; its description key is the
        // second line.
        return {
          value: qtMigrationOptionValue(option),
          label: role,
          description: option.description ? localize(option.description) : undefined,
        };
      }),
    })),
    [localize, questions, t],
  );
  const describeSubmitFailure = useCallback(
    (message: string, translate: TFunction<'flow-chat'>) => {
      const rejection = parseSubmitRejection(message);
      if (!rejection) return null;
      const fieldLabelKey = FIELD_LABEL_KEYS[rejection.field];
      const fieldLabel = fieldLabelKey ? translate(fieldLabelKey) : rejection.field;
      return rejection.code === 'output-artifact'
        ? translate('toolCards.askUser.submitOutputArtifact', {
          field: fieldLabel,
          path: rejection.path,
        })
        : translate('toolCards.askUser.submitPathNotFound', {
          field: fieldLabel,
          path: rejection.path,
        });
    },
    [],
  );

  return (
    <AskUserQuestionShell
      describeSubmitFailure={describeSubmitFailure}
      isLastItem={isLastItem}
      questions={cardQuestions}
      sessionId={sessionId}
      toolItem={toolItem}
      // The intake's options are the candidates the backend just measured, not
      // suggestions: opening on the first one keeps the four paths submittable
      // without re-picking what was probed. This is the Qt intake's own policy —
      // a model-authored question must open unanswered.
      preselectFirstOption
    />
  );
};
