import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { scrapeDayData } from './historicalDataScraper';
import type { DailyUserData, UserReport, DailyReport } from '../../shared/trackingTypes';
import { getBerlinDate } from '../utils/timezone';

/**
 * PDF Report Generator V3.0 - HTML Based (On-Demand)
 * - Uses Puppeteer to convert HTML to PDF
 * - Fetches data from Google Sheets via historicalDataScraper
 * - Reports are generated on-demand and deleted after download
 * - No persistent storage to save resources
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(process.cwd(), 'reports');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log('[ReportGenerator] Created reports directory:', REPORTS_DIR);
}

/**
 * Clean up old reports on startup (if any exist)
 */
export function cleanupOldReports(): void {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      return;
    }

    const files = fs.readdirSync(REPORTS_DIR);
    const pdfFiles = files.filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length > 0) {
      console.log(`[ReportGenerator] 🗑️ Cleaning up ${pdfFiles.length} old report(s)...`);
      pdfFiles.forEach(file => {
        const filePath = path.join(REPORTS_DIR, file);
        fs.unlinkSync(filePath);
      });
      console.log('[ReportGenerator] ✅ Old reports cleaned up');
    }
  } catch (error) {
    console.error('[ReportGenerator] Error cleaning up old reports:', error);
  }
}

// Cleanup on module load
cleanupOldReports();

/**
 * Generate daily report for all users
 */
export async function generateDailyReport(date: string): Promise<string> {
  console.log(`[ReportGenerator] Generating daily report for ${date}...`);

  // Fetch from Google Sheets via historicalDataScraper
  const allUsers = await scrapeDayData(date);

  if (allUsers.length === 0) {
    console.log('[ReportGenerator] No data found');
    throw new Error('No activity data found');
  }

  // Filter: minimum 10 GPS points OR 5 actions
  const users = allUsers.filter(userData => 
    userData.gpsPoints.length >= 10 || userData.totalActions >= 5
  );

  if (users.length === 0) {
    console.log('[ReportGenerator] No users with sufficient activity');
    throw new Error('No users with sufficient activity for report generation');
  }

  // Sort by activity score (LOWEST first as requested!)
  users.sort(
    (a, b) =>
      (a.activityScore ?? Number.MAX_SAFE_INTEGER) -
      (b.activityScore ?? Number.MAX_SAFE_INTEGER)
  );

  console.log(`[ReportGenerator] Generating report for ${users.length} users`);

  // Generate user reports
  const userReports: UserReport[] = users.map(userData => createUserReport(userData));

  const report: DailyReport = {
    date,
    generatedAt: Date.now(),
    totalUsers: users.length,
    userReports
  };

  // Generate PDF
  const filePath = await generatePDF(report);

  console.log(`[ReportGenerator] Report generated successfully: ${filePath}`);
  return filePath;
}

/**
 * Create UserReport from DailyUserData
 */
function createUserReport(userData: DailyUserData): UserReport {
  // Find peak hours (hours with most actions)
  const actionsByHour = new Map<number, number>();
  userData.rawLogs.forEach(log => {
    if (log.session?.actions) {
      log.session.actions.forEach(action => {
        const hour = new Date(action.timestamp).getHours();
        actionsByHour.set(hour, (actionsByHour.get(hour) || 0) + 1);
      });
    }
  });

  const peakHours = Array.from(actionsByHour.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => `${hour.toString().padStart(2, '0')}:00-${(hour + 1).toString().padStart(2, '0')}:00`);

  // Find first and last activity
  const timestamps = userData.rawLogs.map(log => log.timestamp);
  const firstActivity = Math.min(...timestamps);
  const lastActivity = Math.max(...timestamps);

  return {
    userId: userData.userId,
    username: userData.username,
    date: userData.date,
    activityScore: userData.activityScore ?? 0,
    summary: {
      totalDistance: userData.totalDistance,
      uniqueAddresses: userData.uniqueAddresses.size,
      totalSessionTime: userData.totalSessionTime,
      activeTime: userData.activeTime,
      idleTime: userData.totalIdleTime,
      totalActions: userData.totalActions,
      statusChanges: userData.statusChanges,
      scansPerHour: userData.scansPerHour,
      conversionRate: userData.conversionRate
    },
    timeline: {
      firstActivity,
      lastActivity,
      peakHours
    },
    device: {
      avgBatteryLevel: userData.avgBatteryLevel,
      lowBatteryEvents: userData.lowBatteryEvents,
      offlineEvents: userData.offlineEvents
    }
  };
}

/**
 * Generate PDF using Puppeteer (HTML → PDF)
 */
async function generatePDF(report: DailyReport): Promise<string> {
  const fileName = `daily-report-${report.date}.pdf`;
  const filePath = path.join(REPORTS_DIR, fileName);

  const html = generateHTML(report);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  await page.pdf({
    path: filePath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }
  });
  
  await browser.close();
  console.log('[ReportGenerator] PDF generated:', filePath);
  return filePath;
}

/**
 * Generate HTML for the entire report
 */
function generateHTML(report: DailyReport): string {
  const rows = report.userReports.map((u, i) => {
    const total = Array.from(u.summary.statusChanges.values()).reduce((s, c) => s + c, 0);
    const dist = (u.summary.totalDistance / 1000).toFixed(1);
    const conv = u.summary.conversionRate.toFixed(0);
    const score = u.activityScore ?? 0;
    const cls = score >= 75 ? 'score-high' : score >= 50 ? 'score-medium' : 'score-low';
    return `<tr>
      <td style="text-align:center;font-weight:600">${i + 1}</td>
      <td style="font-weight:600">${u.username}</td>
      <td><span class="score ${cls}">${score}</span></td>
      <td style="text-align:center">${u.summary.totalActions}</td>
      <td style="text-align:center">${total}</td>
      <td style="text-align:center">${dist} km</td>
      <td style="text-align:center">${conv}%</td>
    </tr>`;
  }).join('');
  
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Tagesbericht ${report.date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #1f2937; }
    .page { padding: 20mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #2563eb; }
    .header h1 { font-size: 32px; color: #1e40af; margin-bottom: 10px; }
    .header .date { font-size: 20px; color: #4b5563; }
    .summary { background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 30px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    table thead { background: #2563eb; color: white; }
    table th { padding: 12px 8px; text-align: left; font-weight: 600; }
    table td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }
    table tbody tr:nth-child(even) { background: #f9fafb; }
    .score { font-weight: 700; padding: 4px 8px; border-radius: 4px; display: inline-block; }
    .score-high { background: #dcfce7; color: #166534; }
    .score-medium { background: #fef3c7; color: #92400e; }
    .score-low { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>📊 Tagesbericht</h1>
      <div class="date">${formatDate(report.date)}</div>
    </div>
    <div class="summary">
      <p><strong>Aktive Mitarbeiter:</strong> ${report.totalUsers}</p>
      <p style="margin-top:5px;font-size:12px;color:#6b7280">Sortiert nach Activity Score (niedrigster zuerst)</p>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:50px;text-align:center">Rang</th>
          <th>Mitarbeiter</th>
          <th style="width:70px">Score</th>
          <th style="width:80px;text-align:center">Actions</th>
          <th style="width:100px;text-align:center">Status-Änd.</th>
          <th style="width:90px;text-align:center">Distanz</th>
          <th style="width:80px;text-align:center">Conv. %</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format duration in milliseconds to readable string
 */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/**
 * Format timestamp to time string
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Get current date string
 */
function getCurrentDate(): string {
  const now = new Date();
  return getBerlinDate(now);
}

/**
 * Check if report exists for date
 */
export function reportExists(date: string): boolean {
  const fileName = `daily-report-${date}.pdf`;
  const filePath = path.join(REPORTS_DIR, fileName);
  return fs.existsSync(filePath);
}

/**
 * Get report file path
 */
export function getReportPath(date: string): string {
  const fileName = `daily-report-${date}.pdf`;
  return path.join(REPORTS_DIR, fileName);
}
