export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export function generateProgressBar(percentage: number, length: number = 20): string {
  const filled = Math.round(percentage / 100 * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// 语言注释语法映射
export const COMMENT_SYNTAX: Record<string, string> = {
  'javascript': '//',
  'typescript': '//',
  'jsx': '//',
  'tsx': '//',
  'python': '#',
  'java': '//',
  'c': '//',
  'cpp': '//',
  'go': '//',
  'rust': '//',
  'ruby': '#',
  'php': '//',
  'html': '<!--',
  'vue': '<!--',
  'css': '/*',
  'less': '//',
  'scss': '//',
  'json': '//',
  'sql': '--',
  'yaml': '#',
  'yml': '#',
  'shell': '#',
  'bash': '#',
  'markdown': '<!--'
};

/**
 * 获取指定语言的注释语法
 * @param languageId VSCode 语言 ID
 * @returns 注释语法字符串
 */
export function getCommentSyntax(languageId: string): string {
  return COMMENT_SYNTAX[languageId] || '//';
}