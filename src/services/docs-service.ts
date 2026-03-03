/**
 * Google Docs API Service Client
 * Wraps the Docs API using a shared OAuth2 client from DriveService
 */

import { google, docs_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class DocsService {
  private docs: docs_v1.Docs;

  constructor(oauth2Client: OAuth2Client) {
    this.docs = google.docs({ version: 'v1', auth: oauth2Client });
  }

  getDocs(): docs_v1.Docs {
    return this.docs;
  }
}
