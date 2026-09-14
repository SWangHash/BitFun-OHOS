import type { SkillInfo, SkillLevel } from '@/infrastructure/config/types';
import { isOpenBitFunManagedSkill } from '@/infrastructure/config/skillSourcePresentation';

export function suggestSkillImportName(skill: SkillInfo, level: SkillLevel, skills: SkillInfo[], reserved: string[] = []) {
  const names = new Set([...skills.filter((entry) => isOpenBitFunManagedSkill(entry) && entry.level === level)
    .flatMap((entry) => [entry.name, entry.dirName]), ...reserved].map((name) => name.toLowerCase()));
  if (!names.has(skill.name.toLowerCase()) && !names.has(skill.dirName.toLowerCase())) return undefined;
  const base = `${skill.dirName}-${skill.sourceId}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90);
  let name = base;
  for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) name = `${base}-${suffix}`;
  return name;
}

export function importErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}
