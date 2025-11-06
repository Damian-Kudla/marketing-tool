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
  data?: any;
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
          range: `${worksheetName}!A1:J1`,
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
                'User Agent',
                'Data'
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
    existingCustomers?: any[],
    data?: any
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

      // Serialize data to JSON string if provided
      let dataString = '';
      if (data) {
        try {
          dataString = JSON.stringify(data);
        } catch (error) {
          console.error('Failed to serialize data:', error);
          dataString = String(data);
        }
      }

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
        req.get('User-Agent') || '', // User Agent
        dataString // Data (JSON)
      ];

      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A:J`,
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
        range: `${worksheetName}!A:J`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: rows,
        },
      });

      // Only log for larger batches (5+ rows) to reduce log noise
      if (rows.length >= 5) {
        console.log(`[GoogleSheetsLoggingService] Batch appended ${rows.length} rows to ${worksheetName}`);
      }
    } catch (error) {
      console.error(`[GoogleSheetsLoggingService] Failed to batch append to ${worksheetName}:`, error);
      throw error;
    }
  }

  // Insert rows chronologically by reading existing data, merging, sorting, and rewriting
  static async batchInsertChronologically(worksheetName: string, newRows: any[][]): Promise<void> {
    if (!sheetsEnabled || !sheetsClient) {
      throw new Error('Google Sheets API not available');
    }

    try {
      console.log(`[GoogleSheetsLoggingService] Reading existing data from ${worksheetName}...`);
      
      // Read all existing rows (skip header row A1:J1)
      let response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`,
      });

      let existingRows = response.data.values || [];
      
      // Fallback: If no rows returned (likely API limit on large sheets), read last 10000 rows
      if (existingRows.length === 0) {
        console.log(`[GoogleSheetsLoggingService] ⚠️ No rows returned, trying to read last 10000 rows as fallback...`);
        response = await sheetsClient.spreadsheets.values.get({
          spreadsheetId: this.LOG_SHEET_ID,
          range: `${worksheetName}!A2:J10001`, // Last 10000 rows
        });
        existingRows = response.data.values || [];
        
        if (existingRows.length > 0) {
          console.log(`[GoogleSheetsLoggingService] ⚠️ Fallback successful: Found ${existingRows.length} rows (showing last 10000 max)`);
          console.log(`[GoogleSheetsLoggingService] ⚠️ WARNING: This worksheet may have more data that wasn't loaded!`);
        }
      }
      
      console.log(`[GoogleSheetsLoggingService] Found ${existingRows.length} existing rows`);

      // Filter out duplicates: Check if new rows already exist in existing data
      // We identify duplicates by comparing: Timestamp (col 0), Username (col 2), and Data (col 9)
      const existingSet = new Set(
        existingRows.map((row: any) => `${row[0]}_${row[2]}_${row[9]}`)
      );
      
      const uniqueNewRows = newRows.filter((row: any) => {
        const key = `${row[0]}_${row[2]}_${row[9]}`;
        return !existingSet.has(key);
      });
      
      const duplicatesCount = newRows.length - uniqueNewRows.length;
      if (duplicatesCount > 0) {
        console.log(`[GoogleSheetsLoggingService] ⚠️ Filtered out ${duplicatesCount} duplicate rows`);
      }

      // Merge existing and unique new rows
      const allRows = [...existingRows, ...uniqueNewRows];
      console.log(`[GoogleSheetsLoggingService] Total rows after merge: ${allRows.length} (${uniqueNewRows.length} new, ${existingRows.length} existing)`);

      // Sort by timestamp (column A, index 0)
      allRows.sort((a, b) => {
        const timeA = new Date(a[0] || 0).getTime();
        const timeB = new Date(b[0] || 0).getTime();
        return timeA - timeB;
      });

      console.log(`[GoogleSheetsLoggingService] Sorted ${allRows.length} rows chronologically`);

      // Clear existing data (keep header)
      await sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`,
      });

      console.log(`[GoogleSheetsLoggingService] Cleared existing data`);

      // Write all rows back in sorted order
      if (allRows.length > 0) {
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.LOG_SHEET_ID,
          range: `${worksheetName}!A2:J`,
          valueInputOption: 'RAW',
          resource: {
            values: allRows,
          },
        });

        console.log(`[GoogleSheetsLoggingService] ✅ Inserted ${newRows.length} rows chronologically (total: ${allRows.length} rows)`);
      }
    } catch (error) {
      console.error(`[GoogleSheetsLoggingService] Failed to insert chronologically into ${worksheetName}:`, error);
      throw error;
    }
  }

  /**
   * Lädt alle Log-Einträge für einen Nutzer an einem bestimmten Datum
   * Wird verwendet, um externe Tracking-Daten aus den Logs zu extrahieren
   */
  static async getUserLogsForDate(username: string, date: Date): Promise<LogEntry[]> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('[GoogleSheetsLoggingService] Google Sheets API not available');
      return [];
    }

    try {
      // Finde den userId für diesen username
      const { googleSheetsService } = await import('./googleSheets');
      const allUsers = await googleSheetsService.getAllUsers();
      const user = allUsers.find(u => u.username === username);

      if (!user) {
        console.warn(`[GoogleSheetsLoggingService] No user found with username: ${username}`);
        return [];
      }

      const worksheetName = `${username}_${user.userId}`;

      // Prüfe, ob das Worksheet existiert
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId: this.LOG_SHEET_ID,
      });

      const existingSheets = response.data.sheets || [];
      const sheetExists = existingSheets.some((sheet: any) =>
        sheet.properties.title === worksheetName
      );

      if (!sheetExists) {
        console.log(`[GoogleSheetsLoggingService] No worksheet found for ${username}`);
        return [];
      }

      // Lade alle Daten aus dem Worksheet
      const dataResponse = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.LOG_SHEET_ID,
        range: `${worksheetName}!A2:J`, // Skip header row
      });

      const rows = dataResponse.data.values || [];

      // Filtere nach Datum
      const targetDate = new Date(date);
      const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const logsForDate: LogEntry[] = rows
        .filter((row: any[]) => {
          if (!row[0]) return false; // Skip rows without timestamp
          const timestamp = new Date(row[0]);
          return timestamp >= dayStart && timestamp < dayEnd;
        })
        .map((row: any[]) => ({
          timestamp: row[0] || '',
          userId: row[1] || '',
          username: row[2] || '',
          endpoint: row[3] || '',
          method: row[4] || '',
          address: row[5] || '',
          newProspects: row[6] ? row[6].split(', ').filter((p: string) => p.length > 0) : [],
          existingCustomers: row[7] ? row[7].split(', ').map((c: string) => {
            const match = c.match(/^(.+)\s\((.+)\)$/);
            return match ? { name: match[1], id: match[2] } : { name: c, id: '' };
          }) : [],
          userAgent: row[8] || '',
          data: row[9] || ''
        }));

      console.log(`[GoogleSheetsLoggingService] Found ${logsForDate.length} log entries for ${username} on ${date.toISOString().split('T')[0]}`);
      return logsForDate;
    } catch (error) {
      console.error(`[GoogleSheetsLoggingService] Error loading logs for ${username}:`, error);
      return [];
    }
  }
}