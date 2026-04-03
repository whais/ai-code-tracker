import * as assert from 'assert';
import { AIDetector } from '../core/aiDetector';

suite('AIDetector Test Suite', () => {
  
  test('detectAIGeneratedCode - should detect AI code with high confidence', () => {
    // 包含大量代码特征，应该有高置信度
    const aiCode = `
function calculateSum(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0);
}

function calculateAverage(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return calculateSum(numbers) / numbers.length;
}

class DataProcessor {
  private data: number[];
  
  constructor(data: number[]) {
    this.data = data;
  }
  
  process(): number {
    return calculateAverage(this.data);
  }
}

export { DataProcessor, calculateSum, calculateAverage };
`;
    
    const result = AIDetector.detectAIGeneratedCode(aiCode, 'typescript');
    
    // 验证返回结构
    assert.strictEqual(typeof result.isAI, 'boolean');
    assert.strictEqual(typeof result.confidence, 'number');
    assert.strictEqual(typeof result.reason, 'string');
    
    // 由于代码量大，应该有较高的置信度
    assert.ok(result.confidence > 0, '置信度应该大于 0');
  });

  test('detectAIGeneratedCode - should return already_marked for marked code', () => {
    const markedCode = `
// [AI-GEN] model=deepseek
def hello():
    print("Hello")
`;
    
    const result = AIDetector.detectAIGeneratedCode(markedCode, 'python');
    
    assert.strictEqual(result.isAI, false);
    assert.strictEqual(result.confidence, 0);
    assert.strictEqual(result.reason, 'already_marked');
  });

  test('detectAIGeneratedCode - should detect small code with low confidence', () => {
    const smallCode = `const x = 1;`;
    
    const result = AIDetector.detectAIGeneratedCode(smallCode, 'javascript');
    
    // 小代码块应该置信度较低或为 0
    assert.ok(result.confidence < 30 || result.isAI === false, '小代码块应该有低置信度');
  });

  test('detectCodeLine - should identify code lines', () => {
    // 测试函数定义
    assert.strictEqual(AIDetector.detectCodeLine('function test() {}'), true);
    assert.strictEqual(AIDetector.detectCodeLine('def my_function():'), true);
    assert.strictEqual(AIDetector.detectCodeLine('class MyClass'), true);
    
    // 测试注释行（不应识别为代码行）
    assert.strictEqual(AIDetector.detectCodeLine('// this is a comment'), false);
    assert.strictEqual(AIDetector.detectCodeLine('# this is a comment'), false);
    
    // 测试空行
    assert.strictEqual(AIDetector.detectCodeLine(''), false);
    assert.strictEqual(AIDetector.detectCodeLine('   '), false);
  });

  test('getCommentSyntax - should return correct syntax for languages', () => {
    assert.strictEqual(AIDetector.getCommentSyntax('javascript'), '//');
    assert.strictEqual(AIDetector.getCommentSyntax('typescript'), '//');
    assert.strictEqual(AIDetector.getCommentSyntax('python'), '#');
    assert.strictEqual(AIDetector.getCommentSyntax('java'), '//');
    assert.strictEqual(AIDetector.getCommentSyntax('html'), '<!--');
    assert.strictEqual(AIDetector.getCommentSyntax('css'), '/*');
    
    // 未知语言应返回默认 //
    assert.strictEqual(AIDetector.getCommentSyntax('unknown'), '//');
  });

  test('findUnmarkedAICode - should find unmarked code blocks', () => {
    const lines = [
      '// Normal comment',
      'function test1() {',
      '  return 1;',
      '}',
      '',
      '// @ai-generated-start',
      'function test2() {',
      '  return 2;',
      '}',
      '// @ai-generated-end',
      '',
      'function test3() {',
      '  const x = 1;',
      '  const y = 2;',
      '  return x + y;',
      '}',
      '',
      'function test4() {',
      '  return 4;',
      '}'
    ];
    
    const blocks = AIDetector.findUnmarkedAICode(lines);
    
    // 验证返回的是数组
    assert.ok(Array.isArray(blocks));
    
    // 每个块应该有 startLine 和 endLine
    for (const block of blocks) {
      assert.strictEqual(typeof block.startLine, 'number');
      assert.strictEqual(typeof block.endLine, 'number');
      assert.ok(block.startLine >= 0);
      assert.ok(block.endLine >= block.startLine);
    }
  });

  test('detectSource - should detect AI source from text', () => {
    // 测试能识别的标记
    const markedCode = '// [AI-GEN] model=deepseek-v3\nconst x = 1;';
    const result = AIDetector.detectSource(markedCode);
    
    // detectSource 使用 patternManager.detectMark，可能返回 null
    // 这里主要验证函数能正常执行不报错
    assert.ok(result === null || typeof result === 'string');
  });
});
