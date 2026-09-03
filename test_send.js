const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

// Configuration Defaults for the Test Script
const DEFAULT_CSV = './test_contacts.csv';
const DEFAULT_TEMPLATE = './template.txt';
const DEFAULT_PDF = './BNB_26_Maharashtra_Brochure.pdf';
const LOG_FILE = './sent_log.json';

// Async delay utility helper
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Configure Puppeteer launch options cross-platform.
 */
function getPuppeteerOptions() {
    const options = {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'linux' && fs.existsSync('/opt/google/chrome/google-chrome')) {
        options.executablePath = '/opt/google/chrome/google-chrome';
    }

    return options;
}

// Initialize WhatsApp Web Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: getPuppeteerOptions()
});

// Display QR code in terminal if not authenticated
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('\n📲 QR Code generated! Please scan it using WhatsApp on your mobile phone.\n');
});

// Main execution when ready
client.on('ready', async () => {
    console.log('\n🧪 [TEST RUNNER] WhatsApp Client authenticated and ready!\n');

    try {
        const csvFile = process.argv[2] || DEFAULT_CSV;
        const templateFile = process.argv[3] || DEFAULT_TEMPLATE;
        const pdfFile = process.argv[4] || DEFAULT_PDF;

        // 1. Verify Files Exist
        if (!fs.existsSync(csvFile)) {
            console.error(`❌ Error: Test CSV file "${csvFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        if (!fs.existsSync(templateFile)) {
            console.error(`❌ Error: Template file "${templateFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        if (!fs.existsSync(pdfFile)) {
            console.error(`❌ Error: PDF brochure file "${pdfFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        // 2. Load Contacts from CSV
        console.log(`📂 Loading test contacts from "${csvFile}"...`);
        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true });

        if (records.length === 0) {
            console.log('⚠️ CSV file is empty. Nothing to test.');
            await client.destroy();
            process.exit(0);
        }

        // Detect columns
        let nameIndex = -1;
        let phoneIndex = 0;
        let startIndex = 0;

        const firstRow = records[0].map(cell => (cell || '').toString().trim().toLowerCase());
        const detectedPhoneIdx = firstRow.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile'));
        const detectedNameIdx = firstRow.findIndex(h => h.includes('name') || h.includes('first'));

        if (detectedPhoneIdx !== -1) {
            phoneIndex = detectedPhoneIdx;
            if (detectedNameIdx !== -1) nameIndex = detectedNameIdx;
            startIndex = 1;
        } else if (records[0].length >= 3) {
            nameIndex = 2;
            phoneIndex = 4;
        }

        const testContacts = [];
        for (let i = startIndex; i < records.length; i++) {
            const row = records[i];
            let rawPhone = '';
            let rawName = '';

            if (row.length === 1) {
                rawPhone = (row[0] || '').toString().trim();
            } else {
                rawPhone = (row[phoneIndex] || row[0] || '').toString().trim();
                if (nameIndex !== -1 && row[nameIndex]) rawName = row[nameIndex].toString().trim();
            }

            if (!rawPhone || rawPhone.toLowerCase() === 'phone' || rawPhone.toLowerCase() === 'number') continue;

            let cleanedNumber = rawPhone.replace(/\D/g, '');
            if (cleanedNumber.length === 10) {
                cleanedNumber = '91' + cleanedNumber;
            } else if (!(cleanedNumber.startsWith('91') && cleanedNumber.length === 12)) {
                console.log(`⚠️ Skipping invalid test phone number "${rawPhone}"`);
                continue;
            }

            testContacts.push({ number: cleanedNumber, name: rawName });
        }

        // Load or initialize sent_log.json
        let sentLogData = [];
        if (fs.existsSync(LOG_FILE)) {
            try {
                sentLogData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
            } catch (e) {
                sentLogData = [];
            }
        } else {
            fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
            console.log(`📄 Created "${LOG_FILE}" for tracking sent numbers.`);
        }
        const sentLog = new Set(sentLogData);

        const contactsToProcess = [];
        let skippedCount = 0;
        for (const contact of testContacts) {
            if (!sentLog.has(contact.number)) {
                contactsToProcess.push(contact);
                sentLog.add(contact.number);
            } else {
                skippedCount++;
            }
        }

        if (skippedCount > 0) {
            console.log(`⏭️  Skipped ${skippedCount} contact(s) already recorded in ${LOG_FILE}`);
        }

        if (contactsToProcess.length === 0) {
            console.log('🎉 All test contacts have already been messaged! Exiting...');
            await client.destroy();
            process.exit(0);
        }

        // 3. Load Message Template & Attachments
        console.log(`📝 Loading message template from "${templateFile}"...`);
        const templateText = fs.readFileSync(templateFile, 'utf-8');

        console.log(`📎 Loading PDF brochure attachment from "${pdfFile}"...`);
        const pdfMedia = MessageMedia.fromFilePath(pdfFile);
        pdfMedia.filename = "BNB'26 Maharashtra Brochure.pdf";

        // Check for optional poster image (e.g. poster.jpg, poster.png, poster.jpeg)
        let posterMedia = null;
        const posterCandidates = ['./poster.jpg', './poster.png', './poster.jpeg', './BNB_Poster.jpg', './BNB_Poster.png'];
        const customPosterArg = process.argv[5];
        let posterPath = customPosterArg;

        if (!posterPath) {
            for (const cand of posterCandidates) {
                if (fs.existsSync(cand)) {
                    posterPath = cand;
                    break;
                }
            }
        }

        if (posterPath && fs.existsSync(posterPath)) {
            posterMedia = MessageMedia.fromFilePath(posterPath);
            console.log(`🖼️  Loaded poster image: "${posterPath}"`);
        }

        console.log(`\n🚀 Starting test delivery to ${contactsToProcess.length} recipient(s)...\n`);

        // 4. Send Message + PDF to each test contact
        for (let i = 0; i < contactsToProcess.length; i++) {
            const { number, name } = contactsToProcess[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${contactsToProcess.length}] Checking WhatsApp registration for number (${number})...`);

            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is NOT registered on WhatsApp. Skipping.`);
                    continue;
                }

                let finalMessage = templateText;
                if (templateText.includes('{{name}}')) {
                    finalMessage = templateText.replace(/\{\{name\}\}/g, name && name.length ? name : '');
                }

                if (posterMedia) {
                    // Send Poster Image with PR Message as Caption
                    console.log(`📤 [1/2] Sending poster image with PR message caption to ${number}...`);
                    await client.sendMessage(chatId, posterMedia, { caption: finalMessage });
                    console.log(`✅ Poster image with PR caption sent!`);
                } else {
                    // Send Standalone Text Message
                    console.log(`📤 [1/2] Sending standalone intro text message to ${number}...`);
                    await client.sendMessage(chatId, finalMessage);
                    console.log(`✅ Text message sent!`);
                }

                // Send PDF attachment as a separate message
                if (pdfMedia) {
                    await delay(1500); // 1.5s pause between poster/text and PDF
                    console.log(`📤 [2/2] Sending PDF attachment ("${pdfMedia.filename}") to ${number}...`);
                    await client.sendMessage(chatId, pdfMedia, { sendMediaAsDocument: true });
                    console.log(`✅ PDF document sent!`);
                }

                // Record sent log
                sentLogData.push(number);
                fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));

                console.log(`✅ TEST SUCCESS: Messages sent to ${number}!\n`);

            } catch (err) {
                console.error(`❌ TEST FAILED for ${number}:`, err.message);
            }

            if (i < contactsToProcess.length - 1) {
                console.log('⏳ Waiting 5 seconds before next test recipient...');
                await delay(5000);
            }
        }

        console.log('⏳ Waiting 10 seconds to allow WhatsApp network sync to finish...');
        await delay(10000);

        console.log('\n🎉 [TEST COMPLETE] Test run finished!');
        await client.destroy();
        process.exit(0);

    } catch (error) {
        console.error('❌ Test script error:', error);
        if (client) await client.destroy();
        process.exit(1);
    }
});

// Start initialization
client.initialize();
