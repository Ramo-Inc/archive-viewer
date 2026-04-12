import { invoke } from '@tauri-apps/api/core';

/**
 * Minimal wrapper around Tauri's `invoke`.
 * Logs errors to the console and re-throws so callers can handle them.
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[tauri:${command}]`, error);
    throw error;
  }
}
