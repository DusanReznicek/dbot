import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('AuthStateManager');

export interface AuthState {
  state: {
    creds: AuthenticationCreds;
    keys: {
      get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => Promise<Record<string, SignalDataTypeMap[T]>>;
      set: (data: Record<string, Record<string, unknown>>) => Promise<void>;
    };
  };
  saveCreds: () => Promise<void>;
}

/**
 * Production-grade auth state persistence using JSON files.
 * Each key is stored as a separate file for granular updates.
 */
export async function createAuthState(dir: string): Promise<AuthState> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger.info({ dir }, 'Created auth state directory');
  }

  const credsFile = join(dir, 'creds.json');

  const readData = (file: string): unknown | null => {
    try {
      const raw = readFileSync(file, { encoding: 'utf-8' });
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (file: string, data: unknown): void => {
    writeFileSync(file, JSON.stringify(data, BufferJSON.replacer, 2));
  };

  const removeData = (file: string): void => {
    try {
      unlinkSync(file);
    } catch {
      // File may not exist — ignore
    }
  };

  // Load or create credentials
  const creds: AuthenticationCreds = (readData(credsFile) as AuthenticationCreds) || initAuthCreds();

  const state: AuthState['state'] = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: Record<string, SignalDataTypeMap[T]> = {};
        for (const id of ids) {
          const file = join(dir, `${type}-${id}.json`);
          const data = readData(file);
          if (data) {
            // Handle pre-key type specifically
            if (type === 'app-state-sync-key') {
              result[id] = proto.Message.AppStateSyncKeyData.fromObject(data as Record<string, unknown>) as unknown as SignalDataTypeMap[T];
            } else {
              result[id] = data as SignalDataTypeMap[T];
            }
          }
        }
        return result;
      },
      set: async (data) => {
        for (const [category, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            const file = join(dir, `${category}-${id}.json`);
            if (value) {
              writeData(file, value);
            } else {
              removeData(file);
            }
          }
        }
      },
    },
  };

  const saveCreds = async (): Promise<void> => {
    writeData(credsFile, state.creds);
  };

  logger.info({ dir, hasCreds: existsSync(credsFile) }, 'Auth state loaded');

  return { state, saveCreds };
}
