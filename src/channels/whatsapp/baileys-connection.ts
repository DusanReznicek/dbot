import makeWASocket, {
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'eventemitter3';
import type { WhatsAppChannelConfig } from '../../core/config/config.schema.js';
import { createAuthState, type AuthState } from './auth-state.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('BaileysConnection');

export interface ConnectionEvents {
  'qr': (qr: string) => void;
  'connected': () => void;
  'disconnected': (reason: string) => void;
  'message': (message: BaileysEventMap['messages.upsert']) => void;
}

export class BaileysConnectionManager extends EventEmitter<ConnectionEvents> {
  private socket: WASocket | null = null;
  private authState: AuthState | null = null;
  private config: WhatsAppChannelConfig;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  constructor(config: WhatsAppChannelConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    this.isShuttingDown = false;
    this.authState = await createAuthState(this.config.authStateDir);

    await this.createSocket();
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    logger.info('Disconnected from WhatsApp');
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.user !== undefined;
  }

  private async createSocket(): Promise<void> {
    if (!this.authState) return;

    this.socket = makeWASocket({
      auth: this.authState.state,
      printQRInTerminal: this.config.authMethod === 'qr',
      logger: logger as any, // Baileys expects pino logger
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.socket || !this.authState) return;

    const sock = this.socket;
    const auth = this.authState;

    // Connection state updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR code received — scan with WhatsApp');
        this.emit('qr', qr);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = reason === DisconnectReason.loggedOut;

        if (loggedOut) {
          logger.warn('Logged out from WhatsApp — auth state invalidated');
          this.emit('disconnected', 'logged_out');
          return;
        }

        if (!this.isShuttingDown) {
          await this.handleReconnect();
        }
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0;
        const user = sock.user;
        logger.info(
          { jid: user?.id, name: user?.name },
          'Connected to WhatsApp',
        );
        this.emit('connected');
      }
    });

    // Credential updates — save immediately
    sock.ev.on('creds.update', async () => {
      await auth.saveCreds();
    });

    // Incoming messages
    sock.ev.on('messages.upsert', (upsert) => {
      this.emit('message', upsert);
    });
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(
        { attempts: this.reconnectAttempts },
        'Max reconnect attempts reached',
      );
      this.emit('disconnected', 'max_reconnect_attempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);

    logger.info(
      { attempt: this.reconnectAttempts, delayMs: Math.round(delay) },
      'Reconnecting to WhatsApp...',
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!this.isShuttingDown) {
      await this.createSocket();
    }
  }
}
