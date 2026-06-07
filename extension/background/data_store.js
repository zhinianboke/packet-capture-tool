/**
 * background/data_store.js
 * 本地数据存储：基于 IndexedDB 封装请求记录的持久化（保存、读取全部、清空）。
 * 选用 IndexedDB（需求 7.1）以存储大量记录与较长响应体。
 */

import { DB_NAME, DB_VERSION, STORE_NAME } from "../common/constants.js";

/**
 * IndexedDB 封装类。对象存储 "requests"，keyPath = "id"（自增）。
 */
export class DataStore {
  constructor() {
    this._db = null;
  }

  /**
   * 打开数据库并创建对象存储（若不存在）。重复调用幂等。
   * 打开失败时抛出错误，由上层以中文提示告知用户存储不可用。
   * @returns {Promise<IDBDatabase>}
   */
  init() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };
      req.onerror = () => reject(req.error || new Error("打开本地数据库失败"));
    });
  }

  /**
   * 写入一条请求记录，返回生成的自增 id（需求 1.5）。
   * @param {object} record 请求记录（不含 id，由存储生成）
   * @returns {Promise<number>} 生成的 id
   */
  async save(record) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("保存请求记录失败"));
    });
  }

  /**
   * 读取全部请求记录（需求 7.2 / 导出）。
   * @returns {Promise<object[]>}
   */
  async getAll() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("读取请求记录失败"));
    });
  }

  /**
   * 清空对象存储中全部记录（需求 7.3）。
   * @returns {Promise<void>}
   */
  async clear() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("清空请求记录失败"));
    });
  }
}
