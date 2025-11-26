/**
 * Google API Wrapper
 * 
 * Provides a unified interface to Google APIs using the lightweight
 * @googleapis/sheets and @googleapis/drive packages instead of the
 * monolithic 'googleapis' package (saves ~180MB in node_modules).
 * 
 * This wrapper maintains API compatibility with the old 'google' object
 * pattern to minimize changes in existing code.
 */

import { sheets, sheets_v4 } from '@googleapis/sheets';
import { drive, drive_v3 } from '@googleapis/drive';
import { JWT, GoogleAuth } from 'google-auth-library';

// Re-export types for convenience
export type { sheets_v4, drive_v3 };

/**
 * Google API wrapper that mimics the old 'google' object structure
 */
export const google = {
  auth: {
    JWT: JWT,
    GoogleAuth: GoogleAuth
  },
  
  /**
   * Create a Google Sheets client
   */
  sheets: (options: { version: 'v4'; auth: JWT | GoogleAuth }): sheets_v4.Sheets => {
    return sheets({ version: options.version, auth: options.auth as any });
  },
  
  /**
   * Create a Google Drive client
   */
  drive: (options: { version: 'v3'; auth: JWT | GoogleAuth }): drive_v3.Drive => {
    return drive({ version: options.version, auth: options.auth as any });
  }
};

/**
 * Helper function to create a JWT auth client from service account credentials
 */
export function createJWTAuth(credentials: {
  client_email: string;
  private_key: string;
}, scopes: string[]): JWT {
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: scopes
  });
}

/**
 * Parse Google Sheets key from environment variable
 */
export function parseGoogleCredentials(): { client_email: string; private_key: string } | null {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
  if (!sheetsKey) {
    console.error('[GoogleAPI] GOOGLE_SHEETS_KEY not set');
    return null;
  }

  try {
    const credentials = JSON.parse(sheetsKey);
    if (!credentials.client_email || !credentials.private_key) {
      console.error('[GoogleAPI] Invalid credentials format - missing client_email or private_key');
      return null;
    }
    return credentials;
  } catch (error) {
    console.error('[GoogleAPI] Error parsing GOOGLE_SHEETS_KEY:', error);
    return null;
  }
}
