import { google } from 'googleapis';
import { AuthenticatedRequest } from '../middleware/auth';

let sheetsClient: any = null;
let sheetsEnabled = false;

try {
  const sheetsKey = process.env.GOOGLE_SHEETS_KEY || '{}';
  
  if (sheetsKey.startsWith('{')) {
    const credentials = JSON.parse(sheetsKey);
    
    if (credentials.client_email && credentials.private_key) {
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file',
        ],
      });
      
      sheetsClient = google.sheets({ version: 'v4', auth });
      sheetsEnabled = true;
      console.log('Google Sheets Logging API initialized successfully');
    } else {
      console.warn('Google service account credentials missing required fields for Sheets Logging API');
    }
  } else {
    console.warn('Google Sheets Logging API disabled - invalid credentials format');
  }
} catch (error) {
  console.error('Failed to initialize Google Sheets Logging client:', error);
  console.warn('Google Sheets Logging functionality disabled');
}

export interface LogEntry {
  timestamp: string;
  userId: string;
  username: string;
  endpoint: string;
  address?: string;
  newProspects?: string[];
  existingCustomers?: any[];
  method: string;
  userAgent?: string;
}

export class GoogleSheetsLoggingService {
  private static readonly LOG_SHEET_ID = '1Gt1qF9ipcuABiHnzlKn2EqhUcF_OzzYLiAWN0lR1Dxw';
  private static readonly worksheetCache = new Map<string, boolean>();

  // Ensure worksheet exists for user, create if it doesn't
  static async ensureUserWorksheet(userId: string, username: string): Promise<string> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    const worksheetName = `${username}_${userId}`;
    
    // Check cache first
    if (this.worksheetCache.has(worksheetName)) {
      return worksheetName;
    }

    try {
      // Get existing worksheets
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId: this.LOG_SHEET_ID,
      });

      const existingSheets = response.data.sheets || [];
      const sheetExists = existingSheets.some((sheet: any) => 
        sheet.properties.title === worksheetName
      );

      if (!sheetExists) {
        // Create new worksheet
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.LOG_SHEET_ID,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: worksheetName,
                  },
                },
              },
            ],
          },
        });

        // Add header row
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.LOG_SHEET_ID,
          range: `${worksheetName}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [
              [
                'Timestamp',
                'User ID',
                'Username',
                'Endpoint',
                'Method',
                'Address',
                'New Prospects',
                'Existing Customers',
                'User Agent'
              ]
            ],
          },
        });

        console.log(`Created new worksheet: ${worksheetName}`);
      }

      // Cache the worksheet
      this.worksheetCache.set(worksheetName, true);
      return worksheetName;

    } catch (error) {
      console.error(`Error ensuring worksheet for user ${username}_${userId}:`, error);
      throw error;
    }
  }

  // Log user activity to their worksheet
  static async logUserActivity(
    req: AuthenticatedRequest, 
    address?: string, 
    newProspects?: string[], 
    existingCustomers?: any[]
  ): Promise<void> {
    if (!req.userId || !req.username) {
      return; // No user info, skip logging
    }

    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets Logging API not available - skipping log');
      return;
    }

    try {
      const worksheetName = await this.ensureUserWorksheet(req.userId, req.username);

      const logRow = [
        new Date().toISOString(), // Timestamp
        req.userId, // User ID
        req.username, // Username
        req.path, // Endpoint
        req.method, // Method
        address || '', // Address
        newProspects && newProspects.length > 0 ? newProspects.join(', ') : '', // New Prospects
        existingCustomers && existingCustomers.length > 0 
          ? existingCustomers.map(c => `${c.name} (${c.id})`).join(', ') 
          : '', // Existing Customers
        req.get('User-Agent') || '' // User Agent
      ];

      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A:I`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [logRow],
        },
      });

    } catch (error) {
      console.error(`Failed to log to Google Sheets for user ${req.username}:`, error);
    }
  }

  // Log authentication attempts
  static async logAuthAttempt(
    ip: string, 
    success: boolean, 
    username?: string,
    userId?: string, 
    reason?: string
  ): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets Logging API not available - skipping auth log');
      return;
    }

    try {
      // Log authentication attempts to a special "AuthLogs" worksheet
      const authWorksheetName = 'AuthLogs';
      
      // Ensure auth logs worksheet exists
      try {
        const response = await sheetsClient.spreadsheets.get({
          spreadsheetId: this.LOG_SHEET_ID,
        });

        const existingSheets = response.data.sheets || [];
        const authSheetExists = existingSheets.some((sheet: any) => 
          sheet.properties.title === authWorksheetName
        );

        if (!authSheetExists) {
          // Create auth logs worksheet
          await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId: this.LOG_SHEET_ID,
            resource: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: authWorksheetName,
                    },
                  },
                },
              ],
            },
          });

          // Add header row
          await sheetsClient.spreadsheets.values.update({
            spreadsheetId: this.LOG_SHEET_ID,
            range: `${authWorksheetName}!A1:F1`,
            valueInputOption: 'RAW',
            resource: {
              values: [
                ['Timestamp', 'IP Address', 'Success', 'Username', 'User ID', 'Reason']
              ],
            },
          });
        }
      } catch (error) {
        console.error('Error ensuring auth logs worksheet:', error);
        return;
      }

      const authLogRow = [
        new Date().toISOString(),
        ip,
        success ? 'SUCCESS' : 'FAILED',
        username || 'unknown',
        userId || 'unknown',
        reason || (success ? 'valid_password' : 'invalid_password')
      ];

      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${authWorksheetName}!A:F`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [authLogRow],
        },
      });

    } catch (error) {
      console.error('Failed to log authentication attempt to Google Sheets:', error);
    }
  }

  // Batch append multiple rows to a worksheet
  static async batchAppendToWorksheet(worksheetName: string, rows: any[][]): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A:I`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: rows,
        },
      });

      console.log(`[GoogleSheetsLoggingService] Batch appended ${rows.length} rows to ${worksheetName}`);
    } catch (error) {
      console.error(`[GoogleSheetsLoggingService] Failed to batch append to ${worksheetName}:`, error);
      throw error;
    }
  }
}