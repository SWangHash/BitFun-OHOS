
import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { SkillLevel } from '@/infrastructure/config/types';

export interface MatrixTag {
  id: string;
  serviceType: string;
  name: string;
  enName: string;
  type?: string;
  createTime?: string;
  updateTime?: string;
  linked?: boolean;
}

export interface MatrixSkillOwner {
  id?: string;
  userId?: string;
  source?: string;
  account?: string;
  enName?: string;
  cnName?: string;
  image?: string;
}

export interface MatrixSkillOrganization {
  id?: string;
  type?: string;
  name?: string;
  enName?: string;
  image?: string;
  description?: string;
  link?: string;
  source?: string;
  creator?: string;
  status?: string;
}

export interface MatrixSkillCategory {
  id?: string;
  moduleType?: string;
  enName?: string;
  cnName?: string;
  enDescription?: string;
  cnDescription?: string;
  sortOrder?: number;
}

export interface MatrixSkillSummary {
  id: string;
  name: string;
  enName: string;
  owner?: MatrixSkillOwner;
  categoryList?: MatrixSkillCategory[];
  orgId?: string;
  tagIds?: string[];
  description?: string;
  version?: string;
  repository?: string;
  download?: number;
  view?: number;
  favor?: number;
  zipSha256?: string;
  zipObsSize?: number;
  zipObsCreateTime?: string;
  latestVersion?: string;
  versionCount?: number;
  isFeatured?: boolean;
  tags?: MatrixTag[];
  organization?: MatrixSkillOrganization;
  sourceUrl?: string;
  status?: number;
}

export interface MatrixSkillsPage {
  count: number;
  list: MatrixSkillSummary[];
}

export interface MatrixSkillChecksum {
  enName: string;
  sha256: string;
  size: number;
  createTime?: string;
}

export interface MatrixSkillInstallResult {
  enName: string;
  version?: string;
  installPath: string;
  sha256: string;
  size: number;
  sourceId: string;
  skillMdPresent: boolean;
}

export interface MatrixSkillsListRequest {
  pageNum: string;
  pageSize: string;
  keyword?: string;
  categoryId?: string;
  orgId?: string;
  tagIds?: string[];
  isFeatured?: boolean;
}

export interface MatrixSidebarItem {
  id: string;
  name?: string;
  enName?: string;
  count?: number;
}

export interface MatrixCategoryItem {
  id: string;
  cnName?: string;
  enName?: string;
  count?: number;
  sortOrder?: number;
}

export interface MatrixOrgSidebarPage {
  list: MatrixSidebarItem[];
}

export interface MatrixOrgSidebarRequest {
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface MatrixApiError {
  kind: string;
  message: string;
  matrixCode?: string;
}

class MatrixSkillAPI {
  async listTags(serviceType: string = 'skill'): Promise<MatrixTag[]> {
    try {
      return await api.invoke<MatrixTag[]>('list_matrix_tags', { serviceType });
    } catch (error) {
      throw createTauriCommandError('list_matrix_tags', error, { serviceType });
    }
  }

  async listSkills(request: MatrixSkillsListRequest): Promise<MatrixSkillsPage> {
    try {
      return await api.invoke<MatrixSkillsPage>('list_matrix_skills', { request });
    } catch (error) {
      throw createTauriCommandError('list_matrix_skills', error, { request });
    }
  }

  async listCategories(): Promise<MatrixCategoryItem[]> {
    try {
      return await api.invoke<MatrixCategoryItem[]>('list_matrix_categories');
    } catch (error) {
      throw createTauriCommandError('list_matrix_categories', error);
    }
  }

  async listOrganizations(request?: MatrixOrgSidebarRequest): Promise<MatrixOrgSidebarPage> {
    try {
      return await api.invoke<MatrixOrgSidebarPage>('list_matrix_organizations', { request });
    } catch (error) {
      throw createTauriCommandError('list_matrix_organizations', error, { request });
    }
  }

  async installSkill(
    enName: string,
    level?: SkillLevel,
    workspacePath?: string,
  ): Promise<MatrixSkillInstallResult> {
    try {
      return await api.invoke<MatrixSkillInstallResult>('install_matrix_skill', {
        enName,
        level,
        workspacePath,
      });
    } catch (error) {
      throw createTauriCommandError('install_matrix_skill', error, { enName, level, workspacePath });
    }
  }

  async checkChecksum(enName: string): Promise<MatrixSkillChecksum> {
    try {
      return await api.invoke<MatrixSkillChecksum>('check_matrix_skill_checksum', { enName });
    } catch (error) {
      throw createTauriCommandError('check_matrix_skill_checksum', error, { enName });
    }
  }
}

export const matrixSkillAPI = new MatrixSkillAPI();
