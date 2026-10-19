import { create } from 'zustand';

import {
  getActiveSurfaceId,
  surfaceScopedKey,
  type DeviceSurfaceId,
} from '@/infrastructure/peer-device/deviceSurface';

export type AskUserQuestionAnswer = string | string[];
export type AskUserQuestionSubmissionPhase = 'idle' | 'submitting' | 'submitted';

export interface AskUserQuestionDraft {
  answers: Record<number, AskUserQuestionAnswer>;
  otherInputs: Record<number, string>;
  submissionPhase: AskUserQuestionSubmissionPhase;
  updatedAt: number;
}

interface AskUserQuestionDraftState {
  drafts: Record<string, AskUserQuestionDraft>;
  inputOrigins: Record<string, Record<number, boolean>>;
  setSingleAnswer: (key: string, questionIndex: number, value: string) => void;
  setMultiAnswer: (
    key: string,
    questionIndex: number,
    value: string,
    checked: boolean,
  ) => void;
  setOtherInput: (
    key: string,
    questionIndex: number,
    value: string,
    preserveOtherSelection?: boolean,
  ) => void;
  setInputOrigin: (key: string, questionIndex: number, fromInput: boolean) => void;
  setSubmissionPhase: (key: string, phase: AskUserQuestionSubmissionPhase) => void;
  clearDraft: (key: string) => void;
  removeSessionDrafts: (sessionIds: Iterable<string>) => void;
  removeSurfaceDrafts: (surfaceId: DeviceSurfaceId) => void;
  reconcilePendingTools: (
    surfaceId: DeviceSurfaceId,
    sessionId: string,
    pendingToolIds: Iterable<string>,
  ) => void;
}

export function createEmptyAskUserQuestionDraft(): AskUserQuestionDraft {
  return {
    answers: {},
    otherInputs: {},
    submissionPhase: 'idle',
    updatedAt: 0,
  };
}

export function askUserQuestionDraftKey(
  sessionId: string,
  toolId: string,
  surfaceId = getActiveSurfaceId(),
): string {
  return surfaceScopedKey(surfaceId, sessionId, toolId);
}

function parseDraftKey(key: string): [DeviceSurfaceId, string, string] | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    if (
      !Array.isArray(parsed)
      || parsed.length !== 3
      || typeof parsed[0] !== 'string'
      || typeof parsed[1] !== 'string'
      || typeof parsed[2] !== 'string'
    ) {
      return null;
    }
    return [parsed[0], parsed[1], parsed[2]];
  } catch {
    return null;
  }
}

function updateDraft(
  state: AskUserQuestionDraftState,
  key: string,
  update: (draft: AskUserQuestionDraft) => AskUserQuestionDraft,
): Pick<AskUserQuestionDraftState, 'drafts'> {
  const current = state.drafts[key] ?? createEmptyAskUserQuestionDraft();
  return {
    drafts: {
      ...state.drafts,
      [key]: {
        ...update(current),
        updatedAt: Date.now(),
      },
    },
  };
}

function removeOtherAnswer(
  answers: Record<number, AskUserQuestionAnswer>,
  questionIndex: number,
): Record<number, AskUserQuestionAnswer> {
  const current = answers[questionIndex];
  if (Array.isArray(current)) {
    if (!current.includes('Other')) {
      return answers;
    }
    return {
      ...answers,
      [questionIndex]: current.filter(value => value !== 'Other'),
    };
  }
  if (current !== 'Other') {
    return answers;
  }
  const nextAnswers = { ...answers };
  delete nextAnswers[questionIndex];
  return nextAnswers;
}

function pruneKeys<T>(
  map: Record<string, T>,
  shouldRemove: (key: string) => boolean,
): Record<string, T> | null {
  let next: Record<string, T> | null = null;
  for (const key of Object.keys(map)) {
    if (!shouldRemove(key)) continue;
    next = next ?? { ...map };
    delete next[key];
  }
  return next;
}

function pruneKeyedState(
  state: AskUserQuestionDraftState,
  shouldRemove: (key: string) => boolean,
): Pick<AskUserQuestionDraftState, 'drafts' | 'inputOrigins'> | AskUserQuestionDraftState {
  const drafts = pruneKeys(state.drafts, shouldRemove);
  const inputOrigins = pruneKeys(state.inputOrigins, shouldRemove);
  if (!drafts && !inputOrigins) return state;
  return {
    drafts: drafts ?? state.drafts,
    inputOrigins: inputOrigins ?? state.inputOrigins,
  };
}

export const useAskUserQuestionDraftStore = create<AskUserQuestionDraftState>((set) => ({
  drafts: {},
  inputOrigins: {},

  setSingleAnswer: (key, questionIndex, value) => {
    set(state => updateDraft(state, key, draft => ({
      ...draft,
      answers: {
        ...draft.answers,
        [questionIndex]: value,
      },
    })));
  },

  setMultiAnswer: (key, questionIndex, value, checked) => {
    set(state => updateDraft(state, key, draft => {
      const current = draft.answers[questionIndex];
      const currentValues = Array.isArray(current) ? current : [];
      const nextValues = checked
        ? (currentValues.includes(value) ? currentValues : [...currentValues, value])
        : currentValues.filter(candidate => candidate !== value);
      return {
        ...draft,
        answers: {
          ...draft.answers,
          [questionIndex]: nextValues,
        },
      };
    }));
  },

  setOtherInput: (key, questionIndex, value, preserveOtherSelection = false) => {
    set(state => updateDraft(state, key, draft => {
      const isEmpty = value.trim().length === 0;
      return {
        ...draft,
        answers: isEmpty && !preserveOtherSelection
          ? removeOtherAnswer(draft.answers, questionIndex)
          : draft.answers,
        otherInputs: {
          ...draft.otherInputs,
          [questionIndex]: isEmpty ? '' : value,
        },
      };
    }));
  },

  setInputOrigin: (key, questionIndex, fromInput) => {
    set(state => {
      const current = state.inputOrigins[key];
      if (current?.[questionIndex] === fromInput) return state;
      return {
        inputOrigins: {
          ...state.inputOrigins,
          [key]: { ...(current ?? {}), [questionIndex]: fromInput },
        },
      };
    });
  },

  setSubmissionPhase: (key, submissionPhase) => {
    set(state => {
      if (!(key in state.drafts)) {
        return state;
      }
      return updateDraft(state, key, draft => ({
        ...draft,
        submissionPhase,
      }));
    });
  },

  clearDraft: (key) => {
    set(state => {
      if (!(key in state.drafts)) {
        return state;
      }
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    });
  },

  removeSessionDrafts: (sessionIds) => {
    const activeSurfaceId = getActiveSurfaceId();
    const removedSessionIds = new Set(sessionIds);
    if (removedSessionIds.size === 0) {
      return;
    }
    set(state => pruneKeyedState(state, key => {
      const parsed = parseDraftKey(key);
      return parsed !== null
        && parsed[0] === activeSurfaceId
        && removedSessionIds.has(parsed[1]);
    }));
  },

  removeSurfaceDrafts: (surfaceId) => {
    set(state => pruneKeyedState(state, key => parseDraftKey(key)?.[0] === surfaceId));
  },

  reconcilePendingTools: (surfaceId, sessionId, pendingToolIds) => {
    const retainedToolIds = new Set(pendingToolIds);
    // Drafts of tools that are no longer waiting go stale; an input origin does
    // not — the card it belongs to is exactly the one that stopped waiting.
    set(state => {
      const drafts = pruneKeys(state.drafts, key => {
        const parsed = parseDraftKey(key);
        return parsed !== null
          && parsed[0] === surfaceId
          && parsed[1] === sessionId
          && !retainedToolIds.has(parsed[2]);
      });
      return drafts ? { drafts } : state;
    });
  },
}));

export const askUserQuestionDraftStore = useAskUserQuestionDraftStore;
