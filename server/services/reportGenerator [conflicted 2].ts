import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { scrapeDayData } from './historicalDataScraper';
import type { DailyUserData, UserReport, DailyReport } from '../../shared/trackingTypes';

/**
 * PDF Report Generator V3.0 - HTML Based
 * Uses Puppeteer to convert HTML to PDF
 * Fetches data from Google Sheets via historicalDataScraper
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
  users.sort((a, b) => a.activityScore - b.activityScore);

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
    activityScore: userData.activityScore,
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
 * Generate PDF document
 */
async function generatePDF(report: DailyReport): Promise<string> {
  const fileName = `daily-report-${report.date}.pdf`;
  const filePath = path.join(REPORTS_DIR, fileName);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Tagesbericht ${report.date}`,
          Author: 'Energy Scan Capture System',
          Subject: 'Mitarbeiter-Aktivitätsbericht',
          CreationDate: new Date()
        }
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Page 1: Title page with ranking
      generateTitlePage(doc, report);

      // Pages 2-N: User detail pages
      report.userReports.forEach((userReport, index) => {
        doc.addPage();
        generateUserPage(doc, userReport, index + 1, report.totalUsers);
      });

      doc.end();

      stream.on('finish', () => {
        console.log('[ReportGenerator] PDF written successfully:', filePath);
        resolve(filePath);
      });

      stream.on('error', (error) => {
        console.error('[ReportGenerator] PDF write error:', error);
        reject(error);
      });
    } catch (error) {
      console.error('[ReportGenerator] PDF generation error:', error);
      reject(error);
    }
  });
}

/**
 * Generate title page with user ranking
 */
function generateTitlePage(doc: PDFKit.PDFDocument, report: DailyReport): void {
  // Header
  doc.fontSize(24)
    .font('Helvetica-Bold')
    .text('Tagesbericht', { align: 'center' });

  doc.fontSize(16)
    .font('Helvetica')
    .text(formatDate(report.date), { align: 'center' })
    .moveDown(0.5);

  doc.fontSize(10)
    .fillColor('#666666')
    .text(`Erstellt am: ${new Date(report.generatedAt).toLocaleString('de-DE')}`, { align: 'center' })
    .fillColor('#000000')
    .moveDown(2);

  // Summary stats
  doc.fontSize(12)
    .font('Helvetica-Bold')
    .text('Übersicht', { underline: true })
    .moveDown(0.5);

  doc.fontSize(10)
    .font('Helvetica')
    .text(`Aktive Mitarbeiter: ${report.totalUsers}`)
    .moveDown(1.5);

  // Ranking table header
  doc.fontSize(12)
    .font('Helvetica-Bold')
    .text('Mitarbeiter-Ranking', { underline: true })
    .fillColor('#666666')
    .fontSize(9)
    .text('(Sortiert nach Activity Score - niedrigster zuerst)', { align: 'left' })
    .fillColor('#000000')
    .moveDown(1);

  // Table header
  const tableTop = doc.y;
  const rowHeight = 20;
  const colWidths = [40, 150, 80, 80, 100];
  const colX = [50, 90, 240, 320, 400];

  doc.fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#FFFFFF');

  // Header background
  doc.rect(50, tableTop, 495, rowHeight)
    .fill('#2563eb');

  // Header text
  doc.fillColor('#FFFFFF')
    .text('Rang', colX[0], tableTop + 5, { width: colWidths[0] })
    .text('Mitarbeiter', colX[1], tableTop + 5, { width: colWidths[1] })
    .text('Score', colX[2], tableTop + 5, { width: colWidths[2] })
    .text('Actions', colX[3], tableTop + 5, { width: colWidths[3] })
    .text('Status-Änderungen', colX[4], tableTop + 5, { width: colWidths[4] });

  // Table rows
  doc.fillColor('#000000').font('Helvetica');

  report.userReports.forEach((userReport, index) => {
    const rowY = tableTop + rowHeight * (index + 1);

    // Alternate row background
    if (index % 2 === 0) {
      doc.rect(50, rowY, 495, rowHeight).fill('#f3f4f6');
    }

    // Row data with clickable link
    const statusChangesTotal = Array.from(userReport.summary.statusChanges.values())
      .reduce((sum, count) => sum + count, 0);

    // Score color coding
    let scoreColor = '#000000';
    if (userReport.activityScore < 50) scoreColor = '#dc2626'; // Red
    else if (userReport.activityScore < 75) scoreColor = '#f59e0b'; // Yellow
    else scoreColor = '#16a34a'; // Green

    doc.fillColor('#000000')
      .text(`${index + 1}`, colX[0], rowY + 5, { width: colWidths[0] });

    // Username as link to user page
    doc.fillColor('#2563eb')
      .underline(colX[1], rowY + 5, colWidths[1], rowHeight, { color: '#2563eb' })
      .text(userReport.username, colX[1], rowY + 5, { 
        width: colWidths[1],
        link: `#user-${userReport.userId}`,
        underline: true
      });

    doc.fillColor(scoreColor)
      .font('Helvetica-Bold')
      .text(userReport.activityScore.toString(), colX[2], rowY + 5, { width: colWidths[2] });

    doc.fillColor('#000000')
      .font('Helvetica')
      .text(userReport.summary.totalActions.toString(), colX[3], rowY + 5, { width: colWidths[3] })
      .text(statusChangesTotal.toString(), colX[4], rowY + 5, { width: colWidths[4] });
  });

  // Footer
  doc.fontSize(8)
    .fillColor('#666666')
    .text('Klicken Sie auf einen Mitarbeiter, um zu dessen Detail-Seite zu springen.', 50, 750, { align: 'center' });
}

/**
 * Generate user detail page
 */
function generateUserPage(doc: PDFKit.PDFDocument, userReport: UserReport, userIndex: number, totalUsers: number): void {
  // Anchor for linking
  doc.addNamedDestination(`user-${userReport.userId}`);

  // Back link
  doc.fontSize(9)
    .fillColor('#2563eb')
    .text('← Zurück zur Übersicht', 50, 50, {
      link: '#page-1',
      underline: true
    })
    .fillColor('#000000')
    .moveDown(1);

  // User header
  doc.fontSize(20)
    .font('Helvetica-Bold')
    .text(userReport.username, { align: 'center' })
    .moveDown(0.5);

  // Activity Score (prominent)
  const scoreColor = userReport.activityScore < 50 ? '#dc2626' : 
                     userReport.activityScore < 75 ? '#f59e0b' : '#16a34a';

  doc.fontSize(14)
    .font('Helvetica')
    .fillColor('#666666')
    .text('Activity Score', { align: 'center' })
    .fontSize(36)
    .font('Helvetica-Bold')
    .fillColor(scoreColor)
    .text(userReport.activityScore.toString(), { align: 'center' })
    .fillColor('#000000')
    .moveDown(1.5);

  // KPI Grid
  const leftCol = 50;
  const rightCol = 300;
  let currentY = doc.y;

  // Column 1
  doc.fontSize(10).font('Helvetica-Bold').text('Aktivität', leftCol, currentY);
  currentY += 15;
  doc.fontSize(9).font('Helvetica');
  doc.text(`Gesamtdistanz: ${(userReport.summary.totalDistance / 1000).toFixed(2)} km`, leftCol, currentY);
  currentY += 12;
  doc.text(`Eindeutige Adressen: ${userReport.summary.uniqueAddresses}`, leftCol, currentY);
  currentY += 12;
  doc.text(`Aktive Zeit: ${formatDuration(userReport.summary.activeTime)}`, leftCol, currentY);
  currentY += 12;
  doc.text(`Idle Zeit: ${formatDuration(userReport.summary.idleTime)}`, leftCol, currentY);
  currentY += 12;
  doc.text(`Gesamt Actions: ${userReport.summary.totalActions}`, leftCol, currentY);
  currentY += 12;
  doc.text(`Scans/Stunde: ${userReport.summary.scansPerHour.toFixed(1)}`, leftCol, currentY);
  currentY += 12;
  doc.text(`Conversion Rate: ${userReport.summary.conversionRate.toFixed(1)}%`, leftCol, currentY);

  // Column 2
  currentY = doc.y - (7 * 12);
  doc.fontSize(10).font('Helvetica-Bold').text('Status-Änderungen', rightCol, currentY);
  currentY += 15;
  doc.fontSize(9).font('Helvetica');

  const statusIcons = {
    'interessiert': '✓',
    'nicht_interessiert': '✗',
    'nicht_angetroffen': '○',
    'termin_vereinbart': '★'
  };

  Array.from(userReport.summary.statusChanges.entries()).forEach(([status, count]) => {
    const icon = statusIcons[status as keyof typeof statusIcons] || '-';
    doc.text(`${icon} ${status.replace('_', ' ')}: ${count}`, rightCol, currentY);
    currentY += 12;
  });

  // Timeline section
  doc.moveDown(3);
  doc.fontSize(10).font('Helvetica-Bold').text('Zeitstrahl', leftCol);
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica');
  doc.text(`Erste Aktivität: ${formatTime(userReport.timeline.firstActivity)}`);
  doc.text(`Letzte Aktivität: ${formatTime(userReport.timeline.lastActivity)}`);
  doc.text(`Peak Hours: ${userReport.timeline.peakHours.join(', ')}`);

  // Device section
  doc.moveDown(1.5);
  doc.fontSize(10).font('Helvetica-Bold').text('Gerätestatus', leftCol);
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica');
  doc.text(`Ø Batterie: ${userReport.device.avgBatteryLevel.toFixed(0)}%`);
  doc.text(`Low Battery Events: ${userReport.device.lowBatteryEvents}`);
  doc.text(`Offline Events: ${userReport.device.offlineEvents}`);

  // Footer
  doc.fontSize(8)
    .fillColor('#666666')
    .text(`Seite ${userIndex + 1} von ${totalUsers + 1}`, 50, 750, { align: 'center' });
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
  return now.toISOString().split('T')[0];
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
