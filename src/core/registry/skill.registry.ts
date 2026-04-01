import type { ISkill, SkillManifest } from '../interfaces/skill.interface.js';
import { createLogger } from '../utils/logger.js';
import { SkillError } from '../utils/errors.js';

const logger = createLogger('SkillRegistry');

export class SkillRegistry {
  private skills = new Map<string, ISkill>();
  private manifests = new Map<string, SkillManifest>();

  register(skill: ISkill, manifest: SkillManifest): void {
    if (this.skills.has(skill.id)) {
      throw new SkillError(`Skill "${skill.id}" is already registered`, skill.id);
    }
    this.skills.set(skill.id, skill);
    this.manifests.set(skill.id, manifest);
    logger.info({ skillId: skill.id, version: skill.version }, 'Skill registered');
  }

  unregister(skillId: string): void {
    this.skills.delete(skillId);
    this.manifests.delete(skillId);
    logger.info({ skillId }, 'Skill unregistered');
  }

  get(skillId: string): ISkill | undefined {
    return this.skills.get(skillId);
  }

  getManifest(skillId: string): SkillManifest | undefined {
    return this.manifests.get(skillId);
  }

  getAll(): Array<{ skill: ISkill; manifest: SkillManifest }> {
    return Array.from(this.skills.entries()).map(([id, skill]) => ({
      skill,
      manifest: this.manifests.get(id)!,
    }));
  }

  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  get size(): number {
    return this.skills.size;
  }
}
