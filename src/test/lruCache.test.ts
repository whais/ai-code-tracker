import * as assert from 'assert';
import { LRUCache, CacheManager } from '../utils/lruCache';

suite('LRUCache Test Suite', () => {
  
  test('basic get/set operations', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.get('c'), 3);
  });

  test('should return undefined for non-existent key', () => {
    const cache = new LRUCache<string, number>(3);
    
    assert.strictEqual(cache.get('non-existent'), undefined);
  });

  test('should evict oldest item when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // 应该驱逐 'a'
    
    assert.strictEqual(cache.get('a'), undefined);
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.get('c'), 3);
  });

  test('should update access order on get', () => {
    const cache = new LRUCache<string, number>(2);
    
    cache.set('a', 1);
    cache.set('b', 2);
    
    // 访问 'a'，使其成为最近使用
    cache.get('a');
    
    // 添加新项目，应该驱逐 'b' 而不是 'a'
    cache.set('c', 3);
    
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('c'), 3);
  });

  test('should update access order on set', () => {
    const cache = new LRUCache<string, number>(2);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // 更新 'a'，使其成为最近使用
    
    cache.set('c', 3); // 应该驱逐 'b'
    
    assert.strictEqual(cache.get('a'), 10);
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('c'), 3);
  });

  test('should expire items after TTL', (done) => {
    const cache = new LRUCache<string, number>(10, 100); // 100ms TTL
    
    cache.set('a', 1);
    assert.strictEqual(cache.get('a'), 1);
    
    // 等待过期
    setTimeout(() => {
      assert.strictEqual(cache.get('a'), undefined);
      done();
    }, 150);
  });

  test('delete should remove item', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.delete('a');
    
    assert.strictEqual(cache.get('a'), undefined);
  });

  test('clear should remove all items', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    
    assert.strictEqual(cache.get('a'), undefined);
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.size(), 0);
  });

  test('has should return correct value', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    
    assert.strictEqual(cache.has('a'), true);
    assert.strictEqual(cache.has('b'), false);
  });

  test('has should return false for expired items', (done) => {
    const cache = new LRUCache<string, number>(10, 100);
    
    cache.set('a', 1);
    
    setTimeout(() => {
      assert.strictEqual(cache.has('a'), false);
      done();
    }, 150);
  });

  test('cleanup should remove expired items', (done) => {
    const cache = new LRUCache<string, number>(10, 100);
    
    cache.set('a', 1);
    cache.set('b', 2);
    
    setTimeout(() => {
      cache.cleanup();
      assert.strictEqual(cache.size(), 0);
      done();
    }, 150);
  });

  test('getStats should return correct statistics', () => {
    const cache = new LRUCache<string, number>(5, 60000);
    
    cache.set('a', 1);
    cache.set('b', 2);
    
    const stats = cache.getStats();
    
    assert.strictEqual(stats.size, 2);
    assert.strictEqual(stats.maxSize, 5);
    assert.strictEqual(stats.ttl, 60000);
  });
});

suite('CacheManager Test Suite', () => {
  
  test('getInstance should return singleton', () => {
    const instance1 = CacheManager.getInstance();
    const instance2 = CacheManager.getInstance();
    
    assert.strictEqual(instance1, instance2);
  });

  test('getCache should create new cache', () => {
    const manager = CacheManager.getInstance();
    const cache = manager.getCache<string, number>('test-cache', 10);
    
    cache.set('key', 123);
    assert.strictEqual(cache.get('key'), 123);
    
    // 清理
    manager.clearCache('test-cache');
  });

  test('getCache should return existing cache', () => {
    const manager = CacheManager.getInstance();
    
    const cache1 = manager.getCache<string, number>('same-cache', 10);
    cache1.set('key', 1);
    
    const cache2 = manager.getCache<string, number>('same-cache');
    
    // 应该返回同一个缓存实例
    assert.strictEqual(cache1.get('key'), cache2.get('key'));
    
    // 清理
    manager.clearCache('same-cache');
  });

  test('clearCache should remove specific cache', () => {
    const manager = CacheManager.getInstance();
    
    const cache = manager.getCache<string, number>('cache-to-clear', 10);
    cache.set('key', 1);
    
    manager.clearCache('cache-to-clear');
    
    // 重新获取应该是新的空缓存
    const newCache = manager.getCache<string, number>('cache-to-clear');
    assert.strictEqual(newCache.get('key'), undefined);
  });

  test('clearAll should remove all caches', () => {
    const manager = CacheManager.getInstance();
    
    manager.getCache<string, number>('cache1');
    manager.getCache<string, number>('cache2');
    
    manager.clearAll();
    
    const stats = manager.getAllStats();
    assert.deepStrictEqual(stats, {});
  });

  test('getAllStats should return all cache statistics', () => {
    const manager = CacheManager.getInstance();
    
    // 清理之前的状态
    manager.clearAll();
    
    const cache1 = manager.getCache<string, number>('stats-cache1', 5);
    const cache2 = manager.getCache<string, number>('stats-cache2', 10);
    
    cache1.set('a', 1);
    cache2.set('b', 2);
    cache2.set('c', 3);
    
    const stats = manager.getAllStats();
    
    assert.strictEqual(stats['stats-cache1'].size, 1);
    assert.strictEqual(stats['stats-cache1'].maxSize, 5);
    assert.strictEqual(stats['stats-cache2'].size, 2);
    assert.strictEqual(stats['stats-cache2'].maxSize, 10);
    
    // 清理
    manager.clearAll();
  });
});
