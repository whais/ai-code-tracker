/**
 * LRU (Least Recently Used) 缓存实现
 * 用于缓存 Git blame 等计算结果，提高性能
 */

export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttl: number; // 过期时间（毫秒）

  constructor(maxSize: number = 100, ttl: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或 undefined
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // 更新访问顺序（LRU：移动到末尾表示最近使用）
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   */
  set(key: K, value: V): void {
    // 如果已存在，先删除旧值以更新访问顺序
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 如果超出容量限制，删除最久未使用的（Map 的第一个元素）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey as K);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * 检查缓存中是否存在未过期的键
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存项
   * @param key 缓存键
   */
  delete(key: K): void {
    this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    // 清理过期项后返回实际大小
    this.cleanup();
    return this.cache.size;
  }

  /**
   * 清理过期缓存项
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.size(),
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }
}

/**
 * 全局缓存管理器
 */
export class CacheManager {
  private static instance: CacheManager;
  private caches: Map<string, LRUCache<any, any>> = new Map();

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * 获取或创建缓存
   * @param name 缓存名称
   * @param maxSize 最大容量
   * @param ttl 过期时间（毫秒）
   */
  getCache<K, V>(name: string, maxSize?: number, ttl?: number): LRUCache<K, V> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new LRUCache<K, V>(maxSize, ttl));
    }
    return this.caches.get(name) as LRUCache<K, V>;
  }

  /**
   * 删除指定缓存
   * @param name 缓存名称
   */
  clearCache(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.clear();
      this.caches.delete(name);
    }
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.caches.clear();
  }

  /**
   * 获取所有缓存统计信息
   */
  getAllStats(): Record<string, { size: number; maxSize: number; ttl: number }> {
    const stats: Record<string, { size: number; maxSize: number; ttl: number }> = {};
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    return stats;
  }
}
