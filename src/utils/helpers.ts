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