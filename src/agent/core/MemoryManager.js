"use strict";
/**
 * 晨翼Agent 内核 - 记忆管理器
 * 管理长期记忆和每日笔记
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
exports.MemoryManager = void 0;
class MemoryManager {
    persistPath;
    maxDailyNotes;
    memory = null;
    dailyNotes = new Map();
    constructor(config = {}) {
        this.persistPath = config.persistPath || './memory';
        this.maxDailyNotes = config.maxDailyNotes || 30;
    }
    /**
     * 初始化 - 加载记忆
     */
    async initialize() {
        await this.loadMemory();
        await this.loadDailyNotes();
    }
    /**
     * 获取长期记忆 (MEMORY.md)
     */
    getMemory() {
        return this.memory?.content || '';
    }
    /**
     * 更新长期记忆
     */
    async updateMemory(content) {
        if (this.memory) {
            this.memory.content = content;
            this.memory.updatedAt = new Date();
        }
        else {
            this.memory = {
                id: 'memory',
                type: 'long_term',
                content,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }
        await this.saveMemory();
    }
    /**
     * 追加到长期记忆
     */
    async appendMemory(content) {
        const current = this.getMemory();
        const updated = current ? `${current}\n\n${content}` : content;
        await this.updateMemory(updated);
    }
    /**
     * 获取今日笔记
     */
    getTodayNote() {
        const today = this.getDateString(new Date());
        return this.dailyNotes.get(today);
    }
    /**
     * 获取指定日期的笔记
     */
    getDailyNote(date) {
        const dateStr = typeof date === 'string' ? date : this.getDateString(date);
        return this.dailyNotes.get(dateStr);
    }
    /**
     * 创建或更新每日笔记
     */
    async updateDailyNote(date, content) {
        const dateStr = typeof date === 'string' ? date : this.getDateString(date);
        const existing = this.dailyNotes.get(dateStr);
        if (existing) {
            existing.content = content;
            existing.updatedAt = new Date();
        }
        else {
            const note = {
                id: `daily-${dateStr}`,
                type: 'daily',
                content,
                date: dateStr,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            this.dailyNotes.set(dateStr, note);
        }
        await this.saveDailyNotes();
    }
    /**
     * 添加任务到今日笔记
     */
    async addTask(task) {
        const today = this.getDateString(new Date());
        const note = this.dailyNotes.get(today);
        if (note) {
            if (!note.tasks)
                note.tasks = [];
            note.tasks.push({ content: task, completed: false });
            note.updatedAt = new Date();
        }
        else {
            await this.updateDailyNote(today, `# ${today}\n\n## Tasks\n- [ ] ${task}\n`);
        }
        await this.saveDailyNotes();
    }
    /**
     * 完成任务
     */
    async completeTask(date, taskIndex) {
        const note = this.getDailyNote(date);
        if (note?.tasks && note.tasks[taskIndex]) {
            note.tasks[taskIndex].completed = true;
            note.updatedAt = new Date();
            await this.saveDailyNotes();
        }
    }
    /**
     * 获取所有每日笔记
     */
    getAllDailyNotes() {
        return Array.from(this.dailyNotes.values())
            .sort((a, b) => b.date.localeCompare(a.date));
    }
    /**
     * 清理旧的每日笔记
     */
    async cleanupOldNotes() {
        const notes = this.getAllDailyNotes();
        if (notes.length <= this.maxDailyNotes)
            return 0;
        const toRemove = notes.slice(this.maxDailyNotes);
        for (const note of toRemove) {
            this.dailyNotes.delete(note.date);
        }
        await this.saveDailyNotes();
        return toRemove.length;
    }
    /**
     * 搜索记忆
     */
    search(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        // 搜索长期记忆
        if (this.memory?.content.toLowerCase().includes(lowerQuery)) {
            results.push(this.memory);
        }
        // 搜索每日笔记
        for (const note of this.dailyNotes.values()) {
            if (note.content.toLowerCase().includes(lowerQuery)) {
                results.push(note);
            }
        }
        return results;
    }
    // ==================== 持久化方法 ====================
    async loadMemory() {
        try {
            if (typeof require !== 'undefined') {
                const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
                const path = await Promise.resolve().then(() => __importStar(require('path')));
                const filePath = path.join(this.persistPath, 'MEMORY.md');
                const content = await fs.readFile(filePath, 'utf-8');
                this.memory = {
                    id: 'memory',
                    type: 'long_term',
                    content,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
            }
        }
        catch (e) {
            // 文件不存在，初始化为空
            this.memory = null;
        }
    }
    async saveMemory() {
        if (!this.memory || typeof require === 'undefined')
            return;
        try {
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const path = await Promise.resolve().then(() => __importStar(require('path')));
            await fs.mkdir(this.persistPath, { recursive: true });
            const filePath = path.join(this.persistPath, 'MEMORY.md');
            await fs.writeFile(filePath, this.memory.content, 'utf-8');
        }
        catch (e) {
            console.error('[MemoryManager] Failed to save memory:', e);
        }
    }
    async loadDailyNotes() {
        try {
            if (typeof require !== 'undefined') {
                const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
                const path = await Promise.resolve().then(() => __importStar(require('path')));
                const notesDir = path.join(this.persistPath, 'daily');
                const files = await fs.readdir(notesDir);
                for (const file of files) {
                    if (!file.endsWith('.md'))
                        continue;
                    const dateStr = file.replace('.md', '');
                    const filePath = path.join(notesDir, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    this.dailyNotes.set(dateStr, {
                        id: `daily-${dateStr}`,
                        type: 'daily',
                        content,
                        date: dateStr,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        }
        catch (e) {
            // 目录不存在，初始化为空
        }
    }
    async saveDailyNotes() {
        if (typeof require === 'undefined')
            return;
        try {
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const path = await Promise.resolve().then(() => __importStar(require('path')));
            const notesDir = path.join(this.persistPath, 'daily');
            await fs.mkdir(notesDir, { recursive: true });
            for (const [date, note] of this.dailyNotes) {
                const filePath = path.join(notesDir, `${date}.md`);
                await fs.writeFile(filePath, note.content, 'utf-8');
            }
        }
        catch (e) {
            console.error('[MemoryManager] Failed to save daily notes:', e);
        }
    }
    getDateString(date) {
        return date.toISOString().split('T')[0];
    }
}
exports.MemoryManager = MemoryManager;
