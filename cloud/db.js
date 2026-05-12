/**
 * 晨翼Agent - SQLite 数据库层
 * 提供 Map 兼容接口，实现数据持久化
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chenyi-cloud.db');

let db = null;

/**
 * SqliteMap - 兼容 Map API 的 SQLite 存储
 * 
 * 用法与 Map 完全一致：
 *   const users = new SqliteMap('users', 'email', 'value')
 *   users.set('a@b.com', { id: 1, name: 'test' })
 *   users.get('a@b.com') // => { id: 1, name: 'test' }
 */
class SqliteMap {
  constructor(tableName, keyColumn = 'key', valueColumn = 'value') {
    this.tableName = tableName;
    this.keyColumn = keyColumn;
    this.valueColumn = valueColumn;
    this._ensureTable();
  }

  _checkDb() {
    if (!db) throw new Error('数据库未初始化，请先调用 init()');
  }

  _ensureTable() {
    this._checkDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        ${this.keyColumn} TEXT PRIMARY KEY,
        ${this.valueColumn} TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);
  }

  get(key) {
    this._checkDb();
    if (typeof key !== 'string') return undefined;
    const row = db.prepare(
      `SELECT ${this.valueColumn} FROM ${this.tableName} WHERE ${this.keyColumn} = ?`
    ).get(key);
    return row ? JSON.parse(row[this.valueColumn]) : undefined;
  }

  set(key, value) {
    this._checkDb();
    const data = JSON.stringify(value);
    db.prepare(`
      INSERT INTO ${this.tableName} (${this.keyColumn}, ${this.valueColumn}, created_at, updated_at)
      VALUES (?, ?, strftime('%s','now') * 1000, strftime('%s','now') * 1000)
      ON CONFLICT(${this.keyColumn}) DO UPDATE SET
        ${this.valueColumn} = excluded.${this.valueColumn},
        updated_at = strftime('%s','now') * 1000
    `).run(key, data);
    return this;
  }

  has(key) {
    this._checkDb();
    if (typeof key !== 'string') return false;
    const row = db.prepare(
      `SELECT 1 FROM ${this.tableName} WHERE ${this.keyColumn} = ?`
    ).get(key);
    return !!row;
  }

  delete(key) {
    this._checkDb();
    const result = db.prepare(
      `DELETE FROM ${this.tableName} WHERE ${this.keyColumn} = ?`
    ).run(key);
    return result.changes > 0;
  }

  clear() {
    this._checkDb();
    db.prepare(`DELETE FROM ${this.tableName}`).run();
  }

  get size() {
    this._checkDb();
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName}`
    ).get();
    return row.count;
  }

  keys() {
    this._checkDb();
    return db.prepare(
      `SELECT ${this.keyColumn} FROM ${this.tableName} ORDER BY created_at`
    ).all().map(r => r[this.keyColumn]);
  }

  values() {
    this._checkDb();
    return db.prepare(
      `SELECT ${this.valueColumn} FROM ${this.tableName} ORDER BY created_at`
    ).all().map(r => JSON.parse(r[this.valueColumn]));
  }

  entries() {
    this._checkDb();
    const rows = db.prepare(
      `SELECT ${this.keyColumn}, ${this.valueColumn} FROM ${this.tableName} ORDER BY created_at`
    ).all();
    return rows.map(r => [r[this.keyColumn], JSON.parse(r[this.valueColumn])]);
  }

  forEach(callback) {
    for (const [key, value] of this.entries()) {
      callback(value, key, this);
    }
  }

  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }

  // 按前缀查询（用于 userDevices: userId → Set<deviceId>）
  findByPrefix(prefix) {
    this._checkDb();
    const rows = db.prepare(
      `SELECT ${this.keyColumn}, ${this.valueColumn} FROM ${this.tableName}
       WHERE ${this.keyColumn} LIKE ? ORDER BY created_at`
    ).all(`${prefix}%`);
    return rows.map(r => [r[this.keyColumn], JSON.parse(r[this.valueColumn])]);
  }

  // 按值中的字段查询（用于按 userId 过滤）
  findByField(field, value) {
    this._checkDb();
    const rows = db.prepare(
      `SELECT ${this.keyColumn}, ${this.valueColumn} FROM ${this.tableName} ORDER BY created_at`
    ).all();
    return rows
      .map(r => [r[this.keyColumn], JSON.parse(r[this.valueColumn])])
      .filter(([k, v]) => v[field] === value);
  }
}

/**
 * 初始化数据库
 */
function init(options = {}) {
  const dbPath = options.path || DB_PATH;

  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath, {
    // WAL模式 - 读写不冲突
    // 同步模式 - 数据不丢失
  });

  // 启用 WAL 模式（并发读写性能更好）
  db.pragma('journal_mode = WAL');
  // 同步写入（crash-safe）
  db.pragma('synchronous = FULL');

  console.log(`[DB] 数据库已初始化: ${dbPath}`);
  return db;
}

/**
 * 关闭数据库
 */
function close() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] 数据库已关闭');
  }
}

module.exports = {
  SqliteMap,
  init,
  close,
  get db() { return db; }
};
