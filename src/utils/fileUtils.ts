import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileUtils {
  /**
   * 获取工作区根目录
   */
  static getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * 获取相对路径
   */
  static getRelativePath(filePath: string): string {
    const root = this.getWorkspaceRoot();
    if (!root) return filePath;
    return path.relative(root, filePath);
  }

  /**
   * 检查文件是否存在
   */
  static fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * 读取文件内容
   */
  static readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
      return null;
    }
  }

  /**
   * 写入文件
   */
  static writeFile(filePath: string, content: string): boolean {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error(`写入文件失败: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 追加内容到文件
   */
  static appendFile(filePath: string, content: string): boolean {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error(`追加文件失败: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 获取文件扩展名
   */
  static getFileExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }

  /**
   * 获取文件名（不含路径）
   */
  static getFileName(filePath: string): string {
    return path.basename(filePath);
  }

  /**
   * 获取文件名（不含扩展名）
   */
  static getFileNameWithoutExt(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
  }

  /**
   * 检查是否是代码文件
   */
  static isCodeFile(filePath: string): boolean {
    const codeExtensions = [
      '.ts', '.js', '.py', '.java', '.go', '.rs', '.cpp', '.c', 
      '.jsx', '.tsx', '.vue', '.php', '.rb', '.swift', '.kt', 
      '.scala', '.cs', '.m', '.h', '.hpp'
    ];
    const ext = this.getFileExtension(filePath);
    return codeExtensions.includes(ext);
  }

  /**
   * 检查是否应该忽略该文件/目录
   */
  static shouldIgnore(fileOrDir: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.vscode',
      '.idea',
      '__pycache__',
      'venv',
      'env',
      '.venv',
      '.env',
      'coverage',
      '.nyc_output',
      '.next',
      '.nuxt',
      '.cache'
    ];
    
    const basename = path.basename(fileOrDir);
    return ignorePatterns.includes(basename) || basename.startsWith('.');
  }

  /**
   * 递归获取目录下所有代码文件
   */
  static async getAllCodeFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    async function walk(currentDir: string) {
      try {
        const entries = fs.readdirSync(currentDir);
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry);
          
          if (FileUtils.shouldIgnore(fullPath)) {
            continue;
          }
          
          let stat: fs.Stats;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          
          if (stat.isDirectory()) {
            await walk(fullPath);
          } else if (stat.isFile() && FileUtils.isCodeFile(fullPath)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`遍历目录失败: ${currentDir}`, error);
      }
    }
    
    await walk(dir);
    return files;
  }

  /**
   * 获取文件的行数
   */
  static getLineCount(filePath: string): number {
    const content = this.readFile(filePath);
    if (!content) return 0;
    return content.split('\n').length;
  }

  /**
   * 获取文件大小（字节）
   */
  static getFileSize(filePath: string): number {
    try {
      const stat = fs.statSync(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * 获取文件最后修改时间
   */
  static getFileMtime(filePath: string): Date | null {
    try {
      const stat = fs.statSync(filePath);
      return stat.mtime;
    } catch {
      return null;
    }
  }

  /**
   * 创建目录（如果不存在）
   */
  static ensureDir(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (error) {
      console.error(`创建目录失败: ${dirPath}`, error);
      return false;
    }
  }

  /**
   * 删除文件
   */
  static deleteFile(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error) {
      console.error(`删除文件失败: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 复制文件
   */
  static copyFile(src: string, dest: string): boolean {
    try {
      this.ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      return true;
    } catch (error) {
      console.error(`复制文件失败: ${src} -> ${dest}`, error);
      return false;
    }
  }

  /**
   * 移动文件
   */
  static moveFile(src: string, dest: string): boolean {
    try {
      this.ensureDir(path.dirname(dest));
      fs.renameSync(src, dest);
      return true;
    } catch (error) {
      console.error(`移动文件失败: ${src} -> ${dest}`, error);
      return false;
    }
  }

  /**
   * 获取目录下的文件统计信息
   */
  static getDirectoryStats(dir: string): {
    totalFiles: number;
    totalLines: number;
    totalSize: number;
    fileTypes: Map<string, number>;
  } {
    const stats = {
      totalFiles: 0,
      totalLines: 0,
      totalSize: 0,
      fileTypes: new Map<string, number>()
    };
    
    function walk(currentDir: string) {
      try {
        const entries = fs.readdirSync(currentDir);
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry);
          
          if (FileUtils.shouldIgnore(fullPath)) {
            continue;
          }
          
          try {
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              walk(fullPath);
            } else if (stat.isFile()) {
              stats.totalFiles++;
              stats.totalSize += stat.size;
              
              const ext = FileUtils.getFileExtension(fullPath);
              stats.fileTypes.set(ext, (stats.fileTypes.get(ext) || 0) + 1);
              
              if (FileUtils.isCodeFile(fullPath)) {
                const content = FileUtils.readFile(fullPath);
                if (content) {
                  stats.totalLines += content.split('\n').length;
                }
              }
            }
          } catch {
            continue;
          }
        }
      } catch {
        // 忽略无法访问的目录
      }
    }
    
    walk(dir);
    return stats;
  }
}