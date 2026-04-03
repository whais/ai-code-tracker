/**
 * 多工作区支持工具函数
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 获取所有工作区文件夹
 * @returns 工作区文件夹数组，如果没有则返回空数组
 */
export function getWorkspaceFolders(): vscode.WorkspaceFolder[] {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }
  return Array.from(vscode.workspace.workspaceFolders);
}

/**
 * 根据文件路径获取对应的工作区文件夹
 * @param filePath 文件绝对路径
 * @returns 对应的工作区文件夹，如果没有找到则返回 null
 */
export function getWorkspaceFolderForFile(filePath: string): vscode.WorkspaceFolder | null {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }

  // 找到文件所属的最深（最具体）的工作区
  let matchedFolder: vscode.WorkspaceFolder | null = null;
  let matchedLength = 0;

  for (const folder of vscode.workspace.workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    
    // 检查文件是否在该工作区内
    if (filePath === folderPath || filePath.startsWith(folderPath + path.sep)) {
      // 选择路径最长的（最具体的）匹配
      if (folderPath.length > matchedLength) {
        matchedFolder = folder;
        matchedLength = folderPath.length;
      }
    }
  }

  return matchedFolder;
}

/**
 * 获取文件相对于其工作区的相对路径
 * @param filePath 文件绝对路径
 * @returns 相对路径，如果无法确定则返回原路径
 */
export function getRelativePath(filePath: string): string {
  const folder = getWorkspaceFolderForFile(filePath);
  if (!folder) {
    return filePath;
  }
  return path.relative(folder.uri.fsPath, filePath);
}

/**
 * 获取工作区的根路径
 * @param filePath 文件路径（用于确定工作区）
 * @returns 工作区根路径，如果没有找到则返回 null
 */
export function getWorkspaceRoot(filePath?: string): string | null {
  if (filePath) {
    const folder = getWorkspaceFolderForFile(filePath);
    return folder?.uri.fsPath || null;
  }
  
  // 如果没有提供文件路径，返回第一个工作区
  const folders = getWorkspaceFolders();
  return folders.length > 0 ? folders[0].uri.fsPath : null;
}

/**
 * 检查是否有多个工作区
 * @returns 是否有多个工作区
 */
export function hasMultipleWorkspaces(): boolean {
  return (vscode.workspace.workspaceFolders?.length || 0) > 1;
}

/**
 * 获取工作区的名称
 * @param filePath 文件路径（用于确定工作区）
 * @returns 工作区名称
 */
export function getWorkspaceName(filePath?: string): string {
  if (filePath) {
    const folder = getWorkspaceFolderForFile(filePath);
    if (folder) {
      return folder.name;
    }
  }
  
  const folders = getWorkspaceFolders();
  if (folders.length > 0) {
    return folders[0].name;
  }
  
  return '未命名工作区';
}

/**
 * 遍历所有工作区中的文件
 * @param callback 对每个工作区执行的回调函数
 */
export async function forEachWorkspace(
  callback: (folder: vscode.WorkspaceFolder, index: number) => Promise<void>
): Promise<void> {
  const folders = getWorkspaceFolders();
  
  for (let i = 0; i < folders.length; i++) {
    await callback(folders[i], i);
  }
}

/**
 * 在所有工作区中查找匹配的文件
 * @param predicate 匹配函数
 * @returns 匹配的文件路径数组
 */
export async function findFilesInAllWorkspaces(
  predicate: (filePath: string) => boolean
): Promise<string[]> {
  const results: string[] = [];
  const folders = getWorkspaceFolders();
  
  for (const folder of folders) {
    // 这里可以根据需要实现文件查找逻辑
    // 目前只是提供一个接口框架
    const folderPath = folder.uri.fsPath;
    // 实际实现中可以使用 vscode.workspace.findFiles
  }
  
  return results;
}
