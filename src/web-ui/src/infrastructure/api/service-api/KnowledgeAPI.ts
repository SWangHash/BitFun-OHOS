import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'directory';

export type KnowledgeItemStatus =
  | 'idle'
  | 'preparing'
  | 'processing'
  | 'reading'
  | 'embedding'
  | 'completed'
  | 'failed'
  | 'deleting';

export type KnowledgeBaseStatus = 'completed' | 'failed';

export interface KnowledgeBase {
  id: string;
  name: string;
  embeddingModelId?: string | null;
  dimensions?: number | null;
  rerankModelId?: string | null;
  status: KnowledgeBaseStatus;
  error?: string | null;
  chunkSize: number;
  chunkOverlap: number;
  chunkStrategy: string;
  chunkSeparator: string;
  threshold?: number | null;
  documentCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  baseId: string;
  groupId?: string | null;
  type: KnowledgeItemType;
  data: Record<string, unknown>;
  status: KnowledgeItemStatus;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeAddItemInput =
  | { type: 'file'; groupId?: string | null; data: { source: string; path: string } }
  | { type: 'url'; groupId?: string | null; data: { source: string; url: string } }
  | { type: 'note'; groupId?: string | null; data: { source: string; content: string } }
  | { type: 'directory'; groupId?: string | null; data: { source: string } };

export interface KnowledgeChunkMetadata {
  itemId: string;
  itemType: KnowledgeItemType;
  source: string;
  chunkIndex: number;
  tokenCount: number;
}

export interface KnowledgeSearchResult {
  pageContent: string;
  score: number;
  scoreKind: string;
  rank: number;
  metadata: KnowledgeChunkMetadata;
  itemId: string;
  chunkId: string;
}

export interface KnowledgeItemChunk {
  id: string;
  itemId: string;
  content: string;
  metadata: KnowledgeChunkMetadata;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  embeddingModelId?: string | null;
  dimensions?: number | null;
  rerankModelId?: string | null;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkStrategy?: string;
  chunkSeparator?: string;
  threshold?: number;
  documentCount?: number;
}

export class KnowledgeAPI {
  async createBase(request: CreateKnowledgeBaseRequest): Promise<KnowledgeBase> {
    try {
      return await api.invoke<KnowledgeBase>('knowledge_create_base', { request });
    } catch (error) {
      throw createTauriCommandError('knowledge_create_base', error, request);
    }
  }

  async listBases(): Promise<KnowledgeBase[]> {
    try {
      return await api.invoke<KnowledgeBase[]>('knowledge_list_bases');
    } catch (error) {
      throw createTauriCommandError('knowledge_list_bases', error);
    }
  }

  async getBase(baseId: string): Promise<KnowledgeBase> {
    try {
      return await api.invoke<KnowledgeBase>('knowledge_get_base', { request: { baseId } });
    } catch (error) {
      throw createTauriCommandError('knowledge_get_base', error, { baseId });
    }
  }

  async deleteBase(baseId: string): Promise<boolean> {
    try {
      return await api.invoke<boolean>('knowledge_delete_base', { request: { baseId } });
    } catch (error) {
      throw createTauriCommandError('knowledge_delete_base', error, { baseId });
    }
  }

  async addItems(baseId: string, items: KnowledgeAddItemInput[]): Promise<KnowledgeItem[]> {
    try {
      return await api.invoke<KnowledgeItem[]>('knowledge_add_items', {
        request: { baseId, items },
      });
    } catch (error) {
      throw createTauriCommandError('knowledge_add_items', error, { baseId, items });
    }
  }

  async listItems(baseId: string): Promise<KnowledgeItem[]> {
    try {
      return await api.invoke<KnowledgeItem[]>('knowledge_list_items', { request: { baseId } });
    } catch (error) {
      throw createTauriCommandError('knowledge_list_items', error, { baseId });
    }
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<boolean> {
    try {
      return await api.invoke<boolean>('knowledge_delete_items', {
        request: { baseId, itemIds },
      });
    } catch (error) {
      throw createTauriCommandError('knowledge_delete_items', error, { baseId, itemIds });
    }
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<boolean> {
    try {
      return await api.invoke<boolean>('knowledge_reindex_items', {
        request: { baseId, itemIds },
      });
    } catch (error) {
      throw createTauriCommandError('knowledge_reindex_items', error, { baseId, itemIds });
    }
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    try {
      return await api.invoke<KnowledgeSearchResult[]>('knowledge_search', {
        request: { baseId, query },
      });
    } catch (error) {
      throw createTauriCommandError('knowledge_search', error, { baseId, query });
    }
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    try {
      return await api.invoke<KnowledgeItemChunk[]>('knowledge_list_item_chunks', {
        request: { baseId, itemId },
      });
    } catch (error) {
      throw createTauriCommandError('knowledge_list_item_chunks', error, { baseId, itemId });
    }
  }

  async getFilePath(itemId: string): Promise<string> {
    try {
      return await api.invoke<string>('knowledge_get_file_path', { request: { itemId } });
    } catch (error) {
      throw createTauriCommandError('knowledge_get_file_path', error, { itemId });
    }
  }
}

export const knowledgeAPI = new KnowledgeAPI();
