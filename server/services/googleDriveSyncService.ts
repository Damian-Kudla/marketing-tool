import fs from "fs/promises";
import path from "path";
import { google, drive_v3 } from "googleapis";

class GoogleDriveSyncService {
  private driveClient: drive_v3.Drive | null = null;
  private folderId: string;
  private cacheDir: string;
  private syncIntervalMs = 60 * 60 * 1000;
  private syncHandle: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
    this.cacheDir = path.join(process.cwd(), "data", "snapped-routes-cache");
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });

      const driveClient = await this.createDriveClient();
      if (!driveClient) {
        console.warn("[GoogleDriveSync] Drive credentials missing – sync disabled.");
        return;
      }

      this.driveClient = driveClient;
      this.initialized = true;
      console.log("[GoogleDriveSync] Initialized successfully");

      this.startHourlySync();
    } catch (error) {
      console.error("[GoogleDriveSync] Error initializing:", error);
    }
  }

  private async createDriveClient(): Promise<drive_v3.Drive | null> {
    const sheetsKey = process.env.GOOGLE_SHEETS_KEY;
    let clientEmail: string | undefined;
    let privateKey: string | undefined;

    if (sheetsKey) {
      try {
        const parsed = JSON.parse(sheetsKey);
        clientEmail = parsed.client_email;
        privateKey = parsed.private_key;
        console.log("[GoogleDriveSync] Using Google Sheets service account for Drive access");
      } catch (error) {
        console.warn("[GoogleDriveSync] Failed to parse GOOGLE_SHEETS_KEY:", error);
      }
    }

    if (!clientEmail || !privateKey) {
      clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
      privateKey = process
        .env
        .GOOGLE_DRIVE_PRIVATE_KEY
        ?.replace(/\\n/g, "\n");
    }

    if (!clientEmail || !privateKey || !this.folderId) {
      return null;
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
  }

  private startHourlySync(): void {
    if (this.syncHandle) {
      clearInterval(this.syncHandle);
    }

    setTimeout(() => this.syncAllCacheFiles(), 60 * 1000);
    this.syncHandle = setInterval(() => {
      this.syncAllCacheFiles();
    }, this.syncIntervalMs);

    console.log("[GoogleDriveSync] Hourly sync started");
  }

  async syncAllCacheFiles(): Promise<void> {
    if (!this.driveClient) {
      console.log("[GoogleDriveSync] Skipping sync – Drive client not ready");
      return;
    }

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      console.log(`[GoogleDriveSync] Syncing ${jsonFiles.length} cache files...`);
      for (const filename of jsonFiles) {
        await this.syncFile(filename);
      }
      console.log("[GoogleDriveSync] Sync completed");
    } catch (error) {
      console.error("[GoogleDriveSync] Error during sync:", error);
    }
  }

  private async syncFile(filename: string): Promise<void> {
    if (!this.driveClient) return;

    try {
      const filePath = path.join(this.cacheDir, filename);
      const content = await fs.readFile(filePath, "utf-8");
      const existing = await this.findFileInDrive(filename);

      if (existing) {
        await this.driveClient.files.update({
          fileId: existing.id!,
          media: {
            mimeType: "application/json",
            body: content,
          },
        });
        console.log(`[GoogleDriveSync] Updated ${filename} in Drive`);
      } else {
        await this.driveClient.files.create({
          requestBody: {
            name: filename,
            parents: [this.folderId],
            mimeType: "application/json",
          },
          media: {
            mimeType: "application/json",
            body: content,
          },
        });
        console.log(`[GoogleDriveSync] Created ${filename} in Drive`);
      }
    } catch (error) {
      console.error(`[GoogleDriveSync] Error syncing ${filename}:`, error);
    }
  }

  private async findFileInDrive(name: string): Promise<drive_v3.Schema$File | null> {
    if (!this.driveClient) return null;

    try {
      const response = await this.driveClient.files.list({
        q: `name='${name}' and '${this.folderId}' in parents and trashed=false`,
        fields: "files(id, name)",
        spaces: "drive",
      });
      const files = response.data.files;
      return files && files.length > 0 ? files[0] : null;
    } catch (error) {
      console.error("[GoogleDriveSync] Error finding file:", error);
      return null;
    }
  }

  async loadCacheFromDrive(filename: string): Promise<string | null> {
    if (!this.driveClient) return null;

    try {
      const remoteFile = await this.findFileInDrive(filename);
      if (!remoteFile?.id) return null;

      const response = await this.driveClient.files.get(
        { fileId: remoteFile.id, alt: "media" },
        { responseType: "text" }
      );

      console.log(`[GoogleDriveSync] Loaded ${filename} from Drive`);
      return response.data as string;
    } catch (error) {
      console.error(`[GoogleDriveSync] Error loading ${filename} from Drive:`, error);
      return null;
    }
  }

  async syncFileNow(filename: string): Promise<void> {
    if (!this.driveClient) {
      console.log("[GoogleDriveSync] Immediate sync skipped – Drive not initialized");
      return;
    }
    await this.syncFile(filename);
  }

  /**
   * List all daily report files in Google Drive
   * NOTE: Reports are stored in GOOGLE_DRIVE_REPORTS_FOLDER_ID, NOT in the cache folder
   */
  async listReports(): Promise<Array<{ name: string; id: string }>> {
    if (!this.driveClient) {
      console.log("[GoogleDriveSync] List reports skipped – Drive not initialized");
      return [];
    }

    const reportsFolderId = process.env.GOOGLE_DRIVE_REPORTS_FOLDER_ID || '';
    if (!reportsFolderId) {
      console.error("[GoogleDriveSync] GOOGLE_DRIVE_REPORTS_FOLDER_ID not configured");
      return [];
    }

    try {
      const response = await this.driveClient.files.list({
        q: `name contains 'daily-report-' and '${reportsFolderId}' in parents and trashed=false`,
        fields: "files(id, name)",
        spaces: "drive",
      });
      
      const files = response.data.files || [];
      console.log(`[GoogleDriveSync] Found ${files.length} reports in Drive`);
      return files.map(file => ({ 
        name: file.name || '', 
        id: file.id || '' 
      }));
    } catch (error) {
      console.error("[GoogleDriveSync] Error listing reports:", error);
      return [];
    }
  }

  stop(): void {
    if (this.syncHandle) {
      clearInterval(this.syncHandle);
      this.syncHandle = null;
      console.log("[GoogleDriveSync] Sync stopped");
    }
  }

  isReady(): boolean {
    return this.initialized && !!this.driveClient;
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
