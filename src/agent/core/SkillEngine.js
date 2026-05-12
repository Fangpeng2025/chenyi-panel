"use strict";
/**
 * 晨翼Agent 内核 - Skills 引擎
 * 加载、解析、执行 Skills
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillEngine = void 0;
class SkillEngine {
    skills = new Map();
    skillsPath;
    constructor(config = {}) {
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
    register(skill) {
        this.skills.set(skill.id, skill);
    }
    /**
     * 注销 Skill
     */
    unregister(skillId) {
        return this.skills.delete(skillId);
    }
    /**
     * 获取 Skill
     */
    get(skillId) {
        return this.skills.get(skillId);
    }
    /**
     * 获取所有 Skills
     */
    getAll() {
        return Array.from(this.skills.values());
    }
    /**
     * 根据描述匹配 Skills
     */
    matchByDescription(query) {
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
    matchByTriggers(query) {
        const matched = [];
        for (const skill of this.getAll()) {
            if (!skill.triggers)
                continue;
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
    matchTrigger(trigger, query) {
        switch (trigger.type) {
            case 'keyword':
                return query.toLowerCase().includes(trigger.pattern.toLowerCase());
            case 'regex':
                try {
                    return new RegExp(trigger.pattern, 'i').test(query);
                }
                catch {
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
    parseSkillMarkdown(content) {
        const skill = {};
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
    async loadSkill(path) {
        // 在 Node.js 环境中使用 fs
        if (typeof require !== 'undefined') {
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
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
    async loadSkillsFromDirectory(dir) {
        if (typeof require === 'undefined') {
            throw new Error('File system not available in this environment');
        }
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        let count = 0;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const skillPath = path.join(dir, entry.name, 'SKILL.md');
                try {
                    const skill = await this.loadSkill(skillPath);
                    skill.id = skill.id || entry.name;
                    this.register(skill);
                    count++;
                }
                catch (e) {
                    console.warn(`[SkillEngine] Failed to load skill from ${skillPath}:`, e);
                }
            }
        }
        catch (e) {
            console.warn(`[SkillEngine] Failed to read directory ${dir}:`, e);
        }
        return count;
    }
    /**
     * 获取最佳匹配的 Skill
     */
    getBestMatch(query) {
        const byDescription = this.matchByDescription(query);
        const byTriggers = this.matchByTriggers(query);
        // 合并并去重
        const all = [...new Map([...byDescription, ...byTriggers].map(s => [s.id, s])).values()];
        return all[0];
    }
    /**
     * 检查 Skill 是否存在
     */
    has(skillId) {
        return this.skills.has(skillId);
    }
    /**
     * 获取 Skill 数量
     */
    size() {
        return this.skills.size;
    }
}
exports.SkillEngine = SkillEngine;
