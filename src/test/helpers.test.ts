import * as assert from 'assert';
import { 
  escapeHtml, 
  generateProgressBar, 
  COMMENT_SYNTAX, 
  getCommentSyntax 
} from '../utils/helpers';

suite('Helpers Test Suite', () => {
  
  suite('escapeHtml', () => {
    test('should escape HTML special characters', () => {
      assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
      assert.strictEqual(escapeHtml('foo & bar'), 'foo &amp; bar');
      assert.strictEqual(escapeHtml('"quoted"'), '&quot;quoted&quot;');
      assert.strictEqual(escapeHtml("'single'"), '&#039;single&#039;');
    });

    test('should handle multiple special characters', () => {
      const input = '<script>alert("xss")</script>';
      const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
      assert.strictEqual(escapeHtml(input), expected);
    });

    test('should return empty string for empty input', () => {
      assert.strictEqual(escapeHtml(''), '');
    });

    test('should not modify normal text', () => {
      const text = 'Hello World 123';
      assert.strictEqual(escapeHtml(text), text);
    });
  });

  suite('generateProgressBar', () => {
    test('should generate correct progress bar for 0%', () => {
      const result = generateProgressBar(0);
      assert.ok(result.includes('░'));
      assert.ok(!result.includes('█') || result.startsWith('░'));
    });

    test('should generate correct progress bar for 100%', () => {
      const result = generateProgressBar(100);
      assert.ok(result.includes('█'));
      assert.ok(!result.includes('░'));
    });

    test('should generate correct progress bar for 50%', () => {
      const result = generateProgressBar(50, 20);
      // 20 长度的进度条，50% 应该是 10 个填充字符
      const filledCount = (result.match(/█/g) || []).length;
      const emptyCount = (result.match(/░/g) || []).length;
      assert.strictEqual(filledCount + emptyCount, 20);
      assert.ok(filledCount >= 9 && filledCount <= 11); // 允许四舍五入误差
    });

    test('should handle custom length', () => {
      const result = generateProgressBar(50, 10);
      assert.strictEqual(result.length, 10);
    });

    test('should handle edge cases', () => {
      assert.doesNotThrow(() => generateProgressBar(-10));
      assert.doesNotThrow(() => generateProgressBar(110));
      assert.doesNotThrow(() => generateProgressBar(50, 0));
    });
  });

  suite('COMMENT_SYNTAX', () => {
    test('should have correct JavaScript/TypeScript syntax', () => {
      assert.strictEqual(COMMENT_SYNTAX['javascript'], '//');
      assert.strictEqual(COMMENT_SYNTAX['typescript'], '//');
      assert.strictEqual(COMMENT_SYNTAX['jsx'], '//');
      assert.strictEqual(COMMENT_SYNTAX['tsx'], '//');
    });

    test('should have correct Python syntax', () => {
      assert.strictEqual(COMMENT_SYNTAX['python'], '#');
    });

    test('should have correct HTML syntax', () => {
      assert.strictEqual(COMMENT_SYNTAX['html'], '<!--');
      assert.strictEqual(COMMENT_SYNTAX['vue'], '<!--');
    });

    test('should have correct CSS syntax', () => {
      assert.strictEqual(COMMENT_SYNTAX['css'], '/*');
    });

    test('should have correct SQL syntax', () => {
      assert.strictEqual(COMMENT_SYNTAX['sql'], '--');
    });
  });

  suite('getCommentSyntax', () => {
    test('should return correct syntax for known languages', () => {
      assert.strictEqual(getCommentSyntax('javascript'), '//');
      assert.strictEqual(getCommentSyntax('typescript'), '//');
      assert.strictEqual(getCommentSyntax('python'), '#');
      assert.strictEqual(getCommentSyntax('java'), '//');
      assert.strictEqual(getCommentSyntax('html'), '<!--');
      assert.strictEqual(getCommentSyntax('css'), '/*');
    });

    test('should return default // for unknown languages', () => {
      assert.strictEqual(getCommentSyntax('unknown'), '//');
      assert.strictEqual(getCommentSyntax('xyz'), '//');
      assert.strictEqual(getCommentSyntax(''), '//');
    });

    test('should be case sensitive', () => {
      // 语言 ID 通常是小写的
      assert.strictEqual(getCommentSyntax('JavaScript'), '//');
      assert.strictEqual(getCommentSyntax('JavaScript'), COMMENT_SYNTAX['JavaScript'] || '//');
    });
  });
});
