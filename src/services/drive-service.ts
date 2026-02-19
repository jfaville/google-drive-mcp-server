/**
 * Google Drive API Service Client
 * Handles authentication and API requests
 */

import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_DRIVE_SCOPES } from '../constants.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, '../../.tokens.json');

export class DriveService {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive | null = null;

  constructor(clientId: string, clientSecret: string, redirectUri: string = 'http://localhost') {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Load persisted tokens on startup
    if (existsSync(TOKEN_PATH)) {
      try {
        const tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
        this.oauth2Client.setCredentials(tokens);
        this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
        console.error('Loaded saved credentials from disk.');
      } catch {
        console.error('Failed to load saved credentials, starting fresh.');
      }
    }
  }

  private saveTokens(): void {
    try {
      writeFileSync(TOKEN_PATH, JSON.stringify(this.oauth2Client.credentials), 'utf-8');
    } catch {
      console.error('Warning: could not persist tokens to disk.');
    }
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_DRIVE_SCOPES,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async setCredentials(code: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.saveTokens();
  }

  /**
   * Set credentials directly from token
   */
  async setTokens(tokens: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
  }): Promise<void> {
    this.oauth2Client.setCredentials(tokens);
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.saveTokens();
  }

  /**
   * Get current tokens
   */
  getTokens(): {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  } {
    return this.oauth2Client.credentials;
  }

  /**
   * Get Drive API client (throws if not authenticated)
   */
  getDrive(): drive_v3.Drive {
    if (!this.drive) {
      throw new Error('Not authenticated. Call setCredentials() or setTokens() first.');
    }
    return this.drive;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.drive !== null && this.oauth2Client.credentials.access_token !== undefined;
  }

  /**
   * Get a fresh access token for client-side APIs (like Picker).
   * Auto-refreshes via refresh token if expired.
   */
  async getFreshAccessToken(): Promise<string> {
    const { token } = await this.oauth2Client.getAccessToken();
    if (!token) throw new Error('Failed to obtain access token');
    // Persist any newly refreshed credentials
    this.saveTokens();
    return token;
  }

  /**
   * Get client ID for client-side APIs
   */
  getClientId(): string {
    return this.oauth2Client._clientId || '';
  }
}
