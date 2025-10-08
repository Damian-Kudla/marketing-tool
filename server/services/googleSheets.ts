import { google } from 'googleapis';

let sheetsClient: any = null;
let sheetsEnabled = false;

try {
  const visionKey = process.env.GOOGLE_CLOUD_VISION_KEY || '{}';
  
  if (visionKey.startsWith('{')) {
    const credentials = JSON.parse(visionKey);
    
    if (credentials.client_email && credentials.private_key) {
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
      
      sheetsClient = google.sheets({ version: 'v4', auth });
      sheetsEnabled = true;
      console.log('Google Sheets API initialized successfully');
    } else {
      console.warn('Google service account credentials missing required fields for Sheets API');
    }
  } else {
    console.warn('Google Sheets API disabled - invalid credentials format');
  }
} catch (error) {
  console.error('Failed to initialize Google Sheets client:', error);
  console.warn('Google Sheets functionality disabled');
}

export interface SheetsService {
  getValidPasswords(): Promise<string[]>;
  getPasswordUserMap(): Promise<Map<string, string>>;
  getUserByPassword(password: string): Promise<string | null>;
}

export interface UserCredentials {
  password: string;
  username: string;
}

class GoogleSheetsService implements SheetsService {
  private readonly SHEET_ID = '1IF9ieZQ_irKs9XU7XZmDuBaT4XqQrtm0EmfKbA3zB4s';
  private readonly WORKSHEET_NAME = 'Zugangsdaten';
  private readonly RANGE = 'A2:B'; // Both columns A and B starting from row 2

  async getValidPasswords(): Promise<string[]> {
    const passwordUserMap = await this.getPasswordUserMap();
    return Array.from(passwordUserMap.keys());
  }

  async getPasswordUserMap(): Promise<Map<string, string>> {
    if (!sheetsEnabled || !sheetsClient) {
      console.warn('Google Sheets API not available - authentication will fail');
      return new Map();
    }

    try {
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.SHEET_ID,
        range: `${this.WORKSHEET_NAME}!${this.RANGE}`,
      });

      const rows = response.data.values || [];
      const passwordUserMap = new Map<string, string>();
      
      // Process each row to extract password and username
      for (const row of rows) {
        const password = row[0]?.trim();
        const username = row[1]?.trim();
        
        if (password && username) {
          passwordUserMap.set(password, username);
        }
      }

      console.log(`Loaded ${passwordUserMap.size} valid password-username pairs from Google Sheets`);
      return passwordUserMap;
    } catch (error) {
      console.error('Error fetching password-username data from Google Sheets:', error);
      throw new Error('Failed to load authentication data');
    }
  }

  async getUserByPassword(password: string): Promise<string | null> {
    const passwordUserMap = await this.getPasswordUserMap();
    return passwordUserMap.get(password.trim()) || null;
  }
}

export const googleSheetsService = new GoogleSheetsService();