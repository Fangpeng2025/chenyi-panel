/**
 * 晨翼Agent 内核 - 记忆管理器
 * 管理长期记忆和每日笔记
 */

import type { MemoryEntry, DailyNote, TaskItem } from '../types';

export interface MemoryManagerConfig {
  persistPath?: string;
  maxDailyNotes?: number;
}

export class MemoryManager {
  private persistPath: string;
  private maxDailyNotes: number;
  private memory: MemoryEntry | null = null;
  private dailyNotes: Map<string, DailyNote> = new Map();

  constructor(config: MemoryManagerConfig = {}) {
    this.persistPath = config.persistPath || './memory';
    this.maxDailyNotes = config.maxDailyNotes || 30;
  }

  /**
   * 初始化 - 加载记忆
   */
  async initialize(): Promise<void> {
    await this.loadMemory();
    await this.loadDailyNotes();
  }

  /**
   * 获取长期记忆 (MEMORY.md)
   */
  getMemory(): string {
    return this.memory?.content || '';
  }

  /**
   * 更新长期记忆
   */
  async updateMemory(content: string): Promise<void> {
    if (this.memory) {
      this.memory.content = content;
      this.memory.updatedAt = new Date();
    } else {
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
  async appendMemory(content: string): Promise<void> {
    const current = this.getMemory();
    const updated = current ? `${current}\n\n${content}` : content;
    await this.updateMemory(updated);
  }

  /**
   * 获取今日笔记
   */
  getTodayNote(): DailyNote | undefined {
    const today = this.getDateString(new Date());
    return this.dailyNotes.get(today);
  }

  /**
   * 获取指定日期的笔记
   */
  getDailyNote(date: Date | string): DailyNote | undefined {
    const dateStr = typeof date === 'string' ? date : this.getDateString(date);
    return this.dailyNotes.get(dateStr);
  }

  /**
   * 创建或更新每日笔记
   */
  async updateDailyNote(date: Date | string, content: string): Promise<void> {
    const dateStr = typeof date === 'string' ? date : this.getDateString(date);
    
    const existing = this.dailyNotes.get(dateStr);
    if (existing) {
      existing.content = content;
      existing.updatedAt = new Date();
    } else {
      const note: DailyNote = {
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
  async addTask(task: string): Promise<void> {
    const today = this.getDateString(new Date());
    const note = this.dailyNotes.get(today);

    if (note) {
      if (!note.tasks) note.tasks = [];
      note.tasks.push({ content: task, completed: false });
      note.updatedAt = new Date();
    } else {
      await this.updateDailyNote(today, `# ${today}\n\n## Tasks\n- [ ] ${task}\n`);
    }

    await this.saveDailyNotes();
  }

  /**
   * 完成任务
   */
  async completeTask(date: Date | string, taskIndex: number): Promise<void> {
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
  getAllDailyNotes(): DailyNote[] {
    return Array.from(this.dailyNotes.values())
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * 清理旧的每日笔记
   */
  async cleanupOldNotes(): Promise<number> {
    const notes = this.getAllDailyNotes();
    if (notes.length <= this.maxDailyNotes) return 0;

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
  search(query: string): MemoryEntry[] {
    const results: MemoryEntry[] = [];
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

  private async loadMemory(): Promise<void> {
    try {
      if (typeof require !== 'undefined') {
        const fs = await import('fs/promises');
        const path = await import('path');
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
    } catch (e) {
      // 文件不存在，初始化为空
      this.memory = null;
    }
  }

  private async saveMemory(): Promise<void> {
    if (!this.memory || typeof require === 'undefined') return;

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      await fs.mkdir(this.persistPath, { recursive: true });
      const filePath = path.join(this.persistPath, 'MEMORY.md');
      await fs.writeFile(filePath, this.memory.content, 'utf-8');
    } catch (e) {
      console.error('[MemoryManager] Failed to save memory:', e);
    }
  }

  private async loadDailyNotes(): Promise<void> {
    try {
      if (typeof require !== 'undefined') {
        const fs = await import('fs/promises');
        const path = await import('path');
        const notesDir = path.join(this.persistPath, 'daily');
        
        const files = await fs.readdir(notesDir);
        
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          
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
    } catch (e) {
      // 目录不存在，初始化为空
    }
  }

  private async saveDailyNotes(): Promise<void> {
    if (typeof require === 'undefined') return;

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const notesDir = path.join(this.persistPath, 'daily');
      
      await fs.mkdir(notesDir, { recursive: true });
      
      for (const [date, note] of this.dailyNotes) {
        const filePath = path.join(notesDir, `${date}.md`);
        await fs.writeFile(filePath, note.content, 'utf-8');
      }
    } catch (e) {
      console.error('[MemoryManager] Failed to save daily notes:', e);
    }
  }

  private getDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
