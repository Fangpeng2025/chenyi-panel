/**
 * 晨翼Agent 内核 - Skills 引擎
 * 加载、解析、执行 Skills
 */

import type { Skill, SkillContext, SkillTrigger, Message, Tool } from '../types';

export interface SkillEngineConfig {
  skillsPath?: string;
  builtinSkills?: Skill[];
}

export class SkillEngine {
  private skills: Map<string, Skill> = new Map();
  private skillsPath: string;

  constructor(config: SkillEngineConfig = {}) {
    this.skillsPath = config.skillsPath || './skills';
    
    // 加载内置 skills
    if (config.builtinSkills) {
      for (const skill of config.builtinSkills) {
        this.register(skill);
      }
    }
  }

  /**
   * 注册 Skill
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * 注销 Skill
   */
  unregister(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  /**
   * 获取 Skill
   */
  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取所有 Skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 根据描述匹配 Skills
   */
  matchByDescription(query: string): Skill[] {
    const lowerQuery = query.toLowerCase();
    
    return this.getAll().filter(skill => {
      const desc = skill.description.toLowerCase();
      const name = skill.name.toLowerCase();
      
      return desc.includes(lowerQuery) || name.includes(lowerQuery);
    });
  }

  /**
   * 根据 triggers 匹配 Skills
   */
  matchByTriggers(query: string): Skill[] {
    const matched: Skill[] = [];

    for (const skill of this.getAll()) {
      if (!skill.triggers) continue;

      for (const trigger of skill.triggers) {
        if (this.matchTrigger(trigger, query)) {
          matched.push(skill);
          break;
        }
      }
    }

    return matched;
  }

  /**
   * 匹配单个触发器
   */
  private matchTrigger(trigger: SkillTrigger, query: string): boolean {
    switch (trigger.type) {
      case 'keyword':
        return query.toLowerCase().includes(trigger.pattern.toLowerCase());
      
      case 'regex':
        try {
          return new RegExp(trigger.pattern, 'i').test(query);
        } catch {
          return false;
        }
      
      case 'description':
        return query.toLowerCase().includes(trigger.pattern.toLowerCase());
      
      default:
        return false;
    }
  }

  /**
   * 解析 SKILL.md 文件内容
   */
  parseSkillMarkdown(content: string): Partial<Skill> {
    const skill: Partial<Skill> = {};

    // 解析 frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const lines = frontmatter.split('\n');
      
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        
        switch (key.trim()) {
          case 'id':
            skill.id = value;
            break;
          case 'name':
            skill.name = value;
            break;
          case 'version':
            skill.version = value;
            break;
          case 'description':
            skill.description = value;
            break;
          case 'tools':
            skill.tools = value.split(',').map(t => t.trim());
            break;
        }
      }
    }

    // 提取主要内容
    const mainContent = frontmatterMatch 
      ? content.slice(frontmatterMatch[0].length).trim()
      : content;
    
    skill.content = mainContent;

    return skill;
  }

  /**
   * 从文件加载 Skill
   */
  async loadSkill(path: string): Promise<Skill> {
    // 在 Node.js 环境中使用 fs
    if (typeof require !== 'undefined') {
      const fs = await import('fs/promises');
      const content = await fs.readFile(path, 'utf-8');
      const parsed = this.parseSkillMarkdown(content);
      
      return {
        id: parsed.id || '',
        name: parsed.name || '',
        description: parsed.description || '',
        version: parsed.version || '1.0.0',
        content: parsed.content || '',
        tools: parsed.tools,
        triggers: parsed.triggers
      };
    }

    throw new Error('File system not available in this environment');
  }

  /**
   * 加载目录下的所有 Skills
   */
  async loadSkillsFromDirectory(dir: string): Promise<number> {
    if (typeof require === 'undefined') {
      throw new Error('File system not available in this environment');
    }

    const fs = await import('fs/promises');
    const path = await import('path');
    
    let count = 0;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const skillPath = path.join(dir, entry.name, 'SKILL.md');
        try {
          const skill = await this.loadSkill(skillPath);
          skill.id = skill.id || entry.name;
          this.register(skill);
          count++;
        } catch (e) {
          console.warn(`[SkillEngine] Failed to load skill from ${skillPath}:`, e);
        }
      }
    } catch (e) {
      console.warn(`[SkillEngine] Failed to read directory ${dir}:`, e);
    }

    return count;
  }

  /**
   * 获取最佳匹配的 Skill
   */
  getBestMatch(query: string): Skill | undefined {
    const byDescription = this.matchByDescription(query);
    const byTriggers = this.matchByTriggers(query);
    
    // 合并并去重
    const all = [...new Map([...byDescription, ...byTriggers].map(s => [s.id, s])).values()];
    
    return all[0];
  }

  /**
   * 检查 Skill 是否存在
   */
  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /**
   * 获取 Skill 数量
   */
  size(): number {
    return this.skills.size;
  }
}
