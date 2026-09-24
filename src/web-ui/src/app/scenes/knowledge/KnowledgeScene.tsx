/**
 * Knowledge scene — manage knowledge bases, add note/url sources, and run
 * retrieval (BM25 or hybrid). Ingestion is asynchronous, so the item list is
 * polled while any item is still processing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Empty, Input, Search, Textarea } from '@/component-library';
import {
  aiApi,
  knowledgeAPI,
  workspaceAPI,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeSearchResult,
} from '@/infrastructure/api';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import './KnowledgeScene.scss';

const log = createLogger('KnowledgeScene');

const ACTIVE_STATUSES = new Set(['idle', 'preparing', 'processing', 'reading', 'embedding']);
const POLL_INTERVAL_MS = 1500;

/** File extensions offered in the native picker; mirrors the backend's accepted sources. */
const KNOWLEDGE_PICKER_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'mdx',
  'csv',
  'json',
  'html',
  'htm',
  'log',
  'yaml',
  'yml',
  'toml',
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'epub',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
];

const KnowledgeScene: React.FC = () => {
  const { t } = useI18n('common');
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [newBaseName, setNewBaseName] = useState('');
  const [embeddingModelId, setEmbeddingModelId] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [rerankModelId, setRerankModelId] = useState('');
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [filePath, setFilePath] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const selectedBase = useMemo(
    () => bases.find(base => base.id === selectedBaseId) ?? null,
    [bases, selectedBaseId],
  );

  const loadBases = useCallback(async () => {
    try {
      const loaded = await knowledgeAPI.listBases();
      setBases(loaded);
      setSelectedBaseId(current =>
        current && loaded.some(base => base.id === current) ? current : (loaded[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(String(loadError));
      log.warn('Failed to load knowledge bases', { error: loadError });
    }
  }, []);

  const loadItems = useCallback(async (baseId: string) => {
    try {
      setItems(await knowledgeAPI.listItems(baseId));
    } catch (loadError) {
      setError(String(loadError));
      log.warn('Failed to load knowledge items', { error: loadError });
    }
  }, []);

  useEffect(() => {
    void loadBases();
  }, [loadBases]);

  // Populate the embedding/rerank model dropdowns from configured models.
  useEffect(() => {
    void (async () => {
      try {
        const list = (await aiApi.listModels()) ?? [];
        const mapped = list
          .map((model: Record<string, unknown>) => ({
            id: String(model.id ?? model.modelId ?? model.model ?? model.name ?? ''),
            label: String(model.name ?? model.model ?? model.id ?? ''),
          }))
          .filter(entry => entry.id);
        setModels(mapped);
      } catch (modelError) {
        log.warn('Failed to load AI models for knowledge config', { error: modelError });
      }
    })();
  }, []);

  // Platform-aware picker: desktop uses the Tauri dialog; OpenHarmony routes
  // through the ArkTS DocumentViewPicker bridge (the Tauri dialog plugin has no
  // runtime in the OHOS ArkWeb host). `workspaceAPI.open_oh_file_dialog` owns
  // that branch, so call sites stay platform-neutral.
  const pickPath = useCallback(async (directory: boolean): Promise<string | null> => {
    try {
      const selected = await workspaceAPI.open_oh_file_dialog({
        multiple: false,
        directory,
        filters: directory ? undefined : [{ name: 'Documents', extensions: KNOWLEDGE_PICKER_EXTENSIONS }],
      });
      return typeof selected === 'string' && selected.length > 0 ? selected : null;
    } catch (pickError) {
      log.warn('Knowledge path picker failed', { error: pickError });
      return null;
    }
  }, []);

  useEffect(() => {
    setResults([]);
    setQuery('');
    if (selectedBaseId) {
      void loadItems(selectedBaseId);
    } else {
      setItems([]);
    }
  }, [selectedBaseId, loadItems]);

  // Poll while any item is still being ingested so status badges settle.
  useEffect(() => {
    const hasActiveItem = items.some(item => ACTIVE_STATUSES.has(item.status));
    if (!selectedBaseId || !hasActiveItem) {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    pollTimerRef.current = window.setTimeout(() => {
      void loadItems(selectedBaseId);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [items, selectedBaseId, loadItems]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (actionError) {
        setError(String(actionError));
        log.warn('Knowledge action failed', { error: actionError });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleCreateBase = useCallback(() => {
    const name = newBaseName.trim();
    if (!name) return;
    const modelId = embeddingModelId.trim();
    const parsedDimensions = Number.parseInt(dimensions, 10);
    const rerank = rerankModelId.trim();
    void run(async () => {
      const base = await knowledgeAPI.createBase({
        name,
        ...(modelId && Number.isFinite(parsedDimensions) && parsedDimensions > 0
          ? { embeddingModelId: modelId, dimensions: parsedDimensions }
          : {}),
        ...(rerank ? { rerankModelId: rerank } : {}),
      });
      setNewBaseName('');
      setEmbeddingModelId('');
      setDimensions('');
      setRerankModelId('');
      await loadBases();
      setSelectedBaseId(base.id);
    });
  }, [newBaseName, embeddingModelId, dimensions, rerankModelId, run, loadBases]);

  const handleAddNote = useCallback(() => {
    if (!selectedBaseId) return;
    const content = noteContent.trim();
    if (!content) return;
    const source = noteTitle.trim() || content.split('\n')[0].slice(0, 80);
    void run(async () => {
      await knowledgeAPI.addItems(selectedBaseId, [
        { type: 'note', data: { source, content } },
      ]);
      setNoteTitle('');
      setNoteContent('');
      await loadItems(selectedBaseId);
    });
  }, [selectedBaseId, noteTitle, noteContent, run, loadItems]);

  const handleAddUrl = useCallback(() => {
    if (!selectedBaseId) return;
    const url = urlValue.trim();
    if (!url) return;
    void run(async () => {
      await knowledgeAPI.addItems(selectedBaseId, [
        { type: 'url', data: { source: url, url } },
      ]);
      setUrlValue('');
      await loadItems(selectedBaseId);
    });
  }, [selectedBaseId, urlValue, run, loadItems]);

  const handleAddFile = useCallback(() => {
    if (!selectedBaseId) return;
    const path = filePath.trim();
    if (!path) return;
    void run(async () => {
      await knowledgeAPI.addItems(selectedBaseId, [
        { type: 'file', data: { source: path, path } },
      ]);
      setFilePath('');
      await loadItems(selectedBaseId);
    });
  }, [selectedBaseId, filePath, run, loadItems]);

  const handleAddDirectory = useCallback(() => {
    if (!selectedBaseId) return;
    const path = directoryPath.trim();
    if (!path) return;
    void run(async () => {
      await knowledgeAPI.addItems(selectedBaseId, [
        { type: 'directory', data: { source: path } },
      ]);
      setDirectoryPath('');
      await loadItems(selectedBaseId);
    });
  }, [selectedBaseId, directoryPath, run, loadItems]);

  const handleSearch = useCallback(() => {
    if (!selectedBaseId || !query.trim()) return;
    void run(async () => {
      setResults(await knowledgeAPI.search(selectedBaseId, query.trim()));
    });
  }, [selectedBaseId, query, run]);

  const handleDeleteBase = useCallback(() => {
    if (!selectedBaseId) return;
    void run(async () => {
      await knowledgeAPI.deleteBase(selectedBaseId);
      await loadBases();
    });
  }, [selectedBaseId, run, loadBases]);

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      if (!selectedBaseId) return;
      void run(async () => {
        await knowledgeAPI.deleteItems(selectedBaseId, [itemId]);
        await loadItems(selectedBaseId);
      });
    },
    [selectedBaseId, run, loadItems],
  );

  const handleReindexItem = useCallback(
    (itemId: string) => {
      if (!selectedBaseId) return;
      void run(async () => {
        await knowledgeAPI.reindexItems(selectedBaseId, [itemId]);
        await loadItems(selectedBaseId);
      });
    },
    [selectedBaseId, run, loadItems],
  );

  return (
    <div className="bf-knowledge" data-bf-scene="knowledge">
      <header className="bf-knowledge__head">
        <div className="bf-knowledge__head-main">
          <span className="bf-knowledge__head-icon" aria-hidden="true">
            <BookOpen size={16} />
          </span>
          <div>
            <h2 className="bf-knowledge__title">{t('knowledge.title')}</h2>
            <p className="bf-knowledge__subtitle">{t('knowledge.subtitle')}</p>
          </div>
        </div>
        <Button variant="ghost" size="small" onClick={() => void loadBases()} disabled={busy}>
          <RefreshCw size={14} />
          {t('knowledge.actions.refresh')}
        </Button>
      </header>

      {error && <p className="bf-knowledge__error">{error}</p>}

      <div className="bf-knowledge__body">
        <aside className="bf-knowledge__sidebar">
          <div className="bf-knowledge__create">
            <Input
              value={newBaseName}
              placeholder={t('knowledge.base.namePlaceholder')}
              onChange={event => setNewBaseName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') handleCreateBase();
              }}
            />
            {models.length > 0 ? (
              <select
                className="bf-knowledge__select"
                value={embeddingModelId}
                onChange={event => setEmbeddingModelId(event.target.value)}
                aria-label={t('knowledge.base.embeddingModelPlaceholder')}
              >
                <option value="">{t('knowledge.base.embeddingModelNone')}</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={embeddingModelId}
                placeholder={t('knowledge.base.embeddingModelPlaceholder')}
                onChange={event => setEmbeddingModelId(event.target.value)}
              />
            )}
            <Input
              value={dimensions}
              placeholder={t('knowledge.base.dimensionsPlaceholder')}
              onChange={event => setDimensions(event.target.value)}
            />
            {models.length > 0 && (
              <select
                className="bf-knowledge__select"
                value={rerankModelId}
                onChange={event => setRerankModelId(event.target.value)}
                aria-label={t('knowledge.base.rerankModelPlaceholder')}
              >
                <option value="">{t('knowledge.base.rerankModelNone')}</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            )}
            <Button size="small" onClick={handleCreateBase} disabled={busy || !newBaseName.trim()}>
              <Plus size={14} />
              {t('knowledge.base.create')}
            </Button>
          </div>

          {bases.length === 0 ? (
            <Empty description={t('knowledge.base.empty')} imageSize="small" />
          ) : (
            <ul className="bf-knowledge__base-list">
              {bases.map(base => (
                <li key={base.id}>
                  <button
                    type="button"
                    className={`bf-knowledge__base-row${base.id === selectedBaseId ? ' is-active' : ''}`}
                    onClick={() => setSelectedBaseId(base.id)}
                  >
                    <span className="bf-knowledge__base-name">{base.name}</span>
                    <span className="bf-knowledge__base-meta">
                      {t('knowledge.base.status', { status: base.status })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="bf-knowledge__main">
          {!selectedBase ? (
            <Empty description={t('knowledge.base.selectPrompt')} />
          ) : (
            <>
              <div className="bf-knowledge__toolbar">
                <Search
                  value={query}
                  placeholder={t('knowledge.search.placeholder')}
                  onChange={setQuery}
                  onSearch={handleSearch}
                  size="small"
                />
                <Button size="small" onClick={handleSearch} disabled={busy || !query.trim()}>
                  {t('knowledge.search.run')}
                </Button>
                <Button variant="danger" size="small" onClick={handleDeleteBase} disabled={busy}>
                  <Trash2 size={14} />
                  {t('knowledge.base.delete')}
                </Button>
              </div>

              <div className="bf-knowledge__columns">
                <div className="bf-knowledge__panel">
                  <div className="bf-knowledge__panel-head">
                    <span>{t('knowledge.items.title')}</span>
                  </div>
                  <div className="bf-knowledge__note-editor">
                    <Input
                      value={noteTitle}
                      placeholder={t('knowledge.items.noteTitlePlaceholder')}
                      onChange={event => setNoteTitle(event.target.value)}
                    />
                    <Textarea
                      value={noteContent}
                      placeholder={t('knowledge.items.noteContentPlaceholder')}
                      onChange={event => setNoteContent(event.target.value)}
                      rows={3}
                    />
                    <Button
                      size="small"
                      onClick={handleAddNote}
                      disabled={busy || !noteContent.trim()}
                    >
                      <Plus size={14} />
                      {t('knowledge.items.addNote')}
                    </Button>
                  </div>
                  <div className="bf-knowledge__source-row">
                    <Input
                      value={urlValue}
                      placeholder={t('knowledge.items.urlPlaceholder')}
                      onChange={event => setUrlValue(event.target.value)}
                    />
                    <Button size="small" onClick={handleAddUrl} disabled={busy || !urlValue.trim()}>
                      {t('knowledge.items.addUrl')}
                    </Button>
                  </div>
                  <div className="bf-knowledge__source-row">
                    <Input
                      value={filePath}
                      placeholder={t('knowledge.items.filePlaceholder')}
                      onChange={event => setFilePath(event.target.value)}
                    />
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => {
                        void pickPath(false).then(selected => {
                          if (selected) setFilePath(selected);
                        });
                      }}
                      disabled={busy}
                    >
                      {t('knowledge.items.browse')}
                    </Button>
                    <Button size="small" onClick={handleAddFile} disabled={busy || !filePath.trim()}>
                      {t('knowledge.items.addFile')}
                    </Button>
                  </div>
                  <div className="bf-knowledge__source-row">
                    <Input
                      value={directoryPath}
                      placeholder={t('knowledge.items.directoryPlaceholder')}
                      onChange={event => setDirectoryPath(event.target.value)}
                    />
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => {
                        void pickPath(true).then(selected => {
                          if (selected) setDirectoryPath(selected);
                        });
                      }}
                      disabled={busy}
                    >
                      {t('knowledge.items.browse')}
                    </Button>
                    <Button
                      size="small"
                      onClick={handleAddDirectory}
                      disabled={busy || !directoryPath.trim()}
                    >
                      {t('knowledge.items.addDirectory')}
                    </Button>
                  </div>
                  {items.length === 0 ? (
                    <Empty description={t('knowledge.items.empty')} imageSize="small" />
                  ) : (
                    <ul className="bf-knowledge__item-list">
                      {items.map(item => (
                        <li key={item.id} className="bf-knowledge__item-row">
                          <div className="bf-knowledge__item-main">
                            <span className="bf-knowledge__item-title">
                              {String(item.data.source ?? item.id)}
                            </span>
                            <span
                              className={`bf-knowledge__status bf-knowledge__status--${item.status}`}
                            >
                              {item.status}
                            </span>
                          </div>
                          <div className="bf-knowledge__item-actions">
                            <Button
                              variant="ghost"
                              size="small"
                              onClick={() => handleReindexItem(item.id)}
                              disabled={busy}
                            >
                              <RefreshCw size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="small"
                              onClick={() => handleDeleteItem(item.id)}
                              disabled={busy}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="bf-knowledge__panel">
                  <div className="bf-knowledge__panel-head">
                    <span>{t('knowledge.results.title')}</span>
                  </div>
                  {results.length === 0 ? (
                    <Empty description={t('knowledge.results.empty')} imageSize="small" />
                  ) : (
                    <ul className="bf-knowledge__result-list">
                      {results.map(result => (
                        <li key={result.chunkId} className="bf-knowledge__result-row">
                          <div className="bf-knowledge__result-meta">
                            <span>#{result.rank}</span>
                            <span>{result.metadata.source}</span>
                            <span>{result.score.toFixed(3)}</span>
                          </div>
                          <p className="bf-knowledge__result-content">{result.pageContent}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default KnowledgeScene;
