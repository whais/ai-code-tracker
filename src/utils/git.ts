import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getCurrentGitUser(): Promise<{ name: string; email: string }> {
  if (!vscode.workspace.workspaceFolders) {
    return Promise.resolve({ name: 'unknown', email: 'unknown' });
  }
  
  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  
  const [nameResult, emailResult] = await Promise.all([
    execAsync('git config user.name', { cwd: workspacePath }).catch(() => ({ stdout: 'unknown' })),
    execAsync('git config user.email', { cwd: workspacePath }).catch(() => ({ stdout: 'unknown' }))
  ]);
  
  return {
    name: nameResult.stdout.trim(),
    email: emailResult.stdout.trim()
  };
}

export async function initTeamConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiCodeTracker');
  const teamMembers = config.get('teamMembers') as Record<string, string> || {};
  
  if (!vscode.workspace.workspaceFolders?.length) return;
  
  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  
  try {
    const { stdout: emailStdout } = await execAsync('git config user.email', { cwd: workspacePath });
    const email = emailStdout.trim();
    
    if (email && !teamMembers[email]) {
      try {
        const { stdout: nameStdout } = await execAsync('git config user.name', { cwd: workspacePath });
        const name = nameStdout.trim();
        teamMembers[email] = name || email.split('@')[0];
        await config.update('teamMembers', teamMembers, vscode.ConfigurationTarget.Workspace);
      } catch {
        teamMembers[email] = email.split('@')[0];
        await config.update('teamMembers', teamMembers, vscode.ConfigurationTarget.Workspace);
      }
    }
  } catch {
    console.debug('未检测到 Git 配置');
  }
}