const fs = require('fs');
const path = require('path');

const inputFile = 'egon_history_since_17_11.txt';
const outputFile = 'egon_history_adjusted.txt';

// Mappings
const NIC_NAME = 'Nicolas Grandezka';
const DAVID_NAME = 'David Rietberg';

function parseDate(dateStr) {
    // Format: DD.MM.YYYY HH:mm:ss
    const [datePart, timePart] = dateStr.split(' ');
    const [day, month, year] = datePart.split('.');
    const [hour, minute, second] = timePart.split(':');
    return new Date(year, month - 1, day, hour, minute, second);
}

function formatDate(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
}

function formatContractDate(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function processFile() {
    const content = fs.readFileSync(inputFile, 'utf8');
    const lines = content.split('\n');
    
    const entries = [];
    const headerLines = [];

    // Parse lines
    for (const line of lines) {
        if (!line.includes('|') || line.includes('Timestamp | Reseller')) {
            headerLines.push(line);
            continue;
        }
        
        const parts = line.split('|').map(s => s.trim());
        if (parts.length < 4) continue;

        const [timestampStr, reseller, orderNo, contractDateStr] = parts;
        entries.push({
            timestamp: parseDate(timestampStr),
            reseller,
            orderNo,
            contractDate: contractDateStr, // Keep as string or parse if needed
            originalLine: line
        });
    }

    const newEntries = [];
    
    // Helper to check if date is specific day
    const isDate = (date, d, m, y) => {
        return date.getDate() === d && date.getMonth() === (m - 1) && date.getFullYear() === y;
    };

    // 1. Process existing entries
    for (const entry of entries) {
        // DAVID LOGIC
        if (entry.reseller === DAVID_NAME) {
            // Delete 09.12 data (Skip adding to newEntries)
            if (isDate(entry.timestamp, 9, 12, 2025)) {
                console.log(`Dropping David entry from 09.12: ${entry.orderNo}`);
                continue; 
            }
        }

        // NIC LOGIC
        if (entry.reseller === NIC_NAME) {
            // Move 09.12 data to 08.12
            if (isDate(entry.timestamp, 9, 12, 2025)) {
                console.log(`Moving Nic entry from 09.12 to 08.12: ${entry.orderNo}`);
                // Shift -1 day
                const newTime = new Date(entry.timestamp);
                newTime.setDate(newTime.getDate() - 1);
                
                // Also update contract date if it matches? Usually contract date matches timestamp date roughly
                // Let's just update timestamp for sorting/display, contract date might be business logic
                // But for consistency let's update contract date string too if it matches 09.12
                let newContractDate = entry.contractDate;
                if (entry.contractDate === '09.12.2025') {
                    newContractDate = '08.12.2025';
                }

                newEntries.push({
                    ...entry,
                    timestamp: newTime,
                    contractDate: newContractDate
                });
                continue;
            }
        }

        // Keep all other entries
        newEntries.push(entry);
    }

    // 2. Generate shifted entries (Copy 17.11 -> 09.12)
    const targetDate = new Date(2025, 11, 9); // Month is 0-indexed: 11 = Dec
    const sourceDate = new Date(2025, 10, 17); // 10 = Nov
    
    // Calculate shift in ms (approximate, or just set date)
    // Better to calculate delta to preserve time of day
    const timeShift = targetDate.getTime() - sourceDate.getTime();

    for (const entry of entries) {
        // Check for 17.11 entries for David and Nic
        if (isDate(entry.timestamp, 17, 11, 2025)) {
            if (entry.reseller === DAVID_NAME || entry.reseller === NIC_NAME) {
                console.log(`Cloning ${entry.reseller} entry from 17.11 to 09.12: ${entry.orderNo}`);
                
                const newTimestamp = new Date(entry.timestamp.getTime() + timeShift);
                
                // Update contract date
                let newContractDate = entry.contractDate;
                if (entry.contractDate === '17.11.2025') {
                    newContractDate = '09.12.2025';
                }

                newEntries.push({
                    ...entry,
                    timestamp: newTimestamp,
                    contractDate: newContractDate,
                    orderNo: entry.orderNo + '-SIM' // Optional: mark as simulated? No, user wants it to look real.
                });
            }
        }
    }

    // Sort by timestamp descending
    newEntries.sort((a, b) => b.timestamp - a.timestamp);

    // Generate output
    const outputLines = [...headerLines];
    // Ensure separator line exists if not in headerLines (it usually is)
    
    for (const entry of newEntries) {
        const line = `${formatDate(entry.timestamp)} | ${entry.reseller} | ${entry.orderNo} | ${entry.contractDate}`;
        outputLines.push(line);
    }

    fs.writeFileSync(outputFile, outputLines.join('\n'));
    console.log(`Processed ${entries.length} entries. Wrote ${newEntries.length} entries to ${outputFile}`);
}

processFile();
