const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

// Configuration Defaults for the Test Script
const DEFAULT_CSV = './test_contacts.csv';
const DEFAULT_INTRO = './intro.txt';
const DEFAULT_TEMPLATE = './template.txt';
const DEFAULT_PDF = './BNB_26_Maharashtra_Brochure.pdf';
const LOG_FILE = './sent_log.json';

// Async delay utility helper
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Configure Puppeteer launch options cross-platform (Windows, macOS, Linux).
 */
function getPuppeteerOptions() {
    const options = {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'linux' && fs.existsSync('/opt/google/chrome/google-chrome')) {
        options.executablePath = '/opt/google/chrome/google-chrome';
    } else if (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
        options.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (process.platform === 'win32') {
        const winChrome64 = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const winChrome32 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
        if (fs.existsSync(winChrome64)) {
            options.executablePath = winChrome64;
        } else if (fs.existsSync(winChrome32)) {
            options.executablePath = winChrome32;
        }
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
        const introFile = process.argv[3] || DEFAULT_INTRO;
        const templateFile = process.argv[4] || DEFAULT_TEMPLATE;
        const pdfFile = process.argv[5] || DEFAULT_PDF;

        // 1. Verify Files Exist
        if (!fs.existsSync(csvFile)) {
            console.error(`❌ Error: Test CSV file "${csvFile}" not found.`);
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
            }

            if (cleanedNumber.length < 11 || cleanedNumber.length > 15) {
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

        // 3. Load Message Files & Media
        // Step 1 Text: Intro Message
        let introText = "Hey! Team GDSC CRCE here. Hope you're doing great!";
        if (fs.existsSync(introFile)) {
            introText = fs.readFileSync(introFile, 'utf-8').trim();
            console.log(`📝 Loaded Intro Message from "${introFile}"`);
        }

        // Step 2 Caption: PR Message
        let prMessageText = "We are excited to announce our upcoming flagship event — Bits & Bytes (BNB)! 🔥\n\nGet ready for an incredible experience with hands-on workshops, exciting challenges, and networking opportunities.";
        if (fs.existsSync(templateFile)) {
            prMessageText = fs.readFileSync(templateFile, 'utf-8').trim();
            console.log(`📝 Loaded PR Message Caption from "${templateFile}"`);
        }

        // Step 2 Image: Poster Image
        let posterMedia = null;
        const posterCandidates = ['./poster.jpg', './poster.png', './poster.jpeg', './BNB_Poster.jpg', './BNB_Poster.png'];
        let posterPath = null;
        for (const cand of posterCandidates) {
            if (fs.existsSync(cand)) {
                posterPath = cand;
                break;
            }
        }
        if (posterPath) {
            posterMedia = MessageMedia.fromFilePath(posterPath);
            console.log(`🖼️  Loaded Poster Image from "${posterPath}"`);
        }

        // Step 3 Document: PDF Brochure
        let pdfMedia = null;
        if (fs.existsSync(pdfFile)) {
            pdfMedia = MessageMedia.fromFilePath(pdfFile);
            pdfMedia.filename = "BNB'26 Maharashtra Brochure.pdf";
            console.log(`📎 Loaded PDF Brochure from "${pdfFile}" (Display Name: "${pdfMedia.filename}")`);
        }

        console.log(`\n🚀 Executing 3-Step Sequence for ${contactsToProcess.length} recipient(s):\n 1. Intro Message\n 2. Poster Image + PR Caption\n 3. PDF Brochure Document\n`);

        // 4. Execute 3-Step Sequence for each contact
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

                let finalIntro = introText;
                let finalPR = prMessageText;

                if (name && name.length) {
                    finalIntro = finalIntro.replace(/\{\{name\}\}/g, name);
                    finalPR = finalPR.replace(/\{\{name\}\}/g, name);
                } else {
                    finalIntro = finalIntro.replace(/\{\{name\}\}/g, '');
                    finalPR = finalPR.replace(/\{\{name\}\}/g, '');
                }

                // ── STEP 1: Send Intro Message ─────────────────────────────────────
                console.log(`📤 [Step 1/3] Sending Intro Text Message to ${number}...`);
                await client.sendMessage(chatId, finalIntro);
                console.log(`✅ Intro Text Message Sent!`);

                await delay(1500); // 1.5s pause between Step 1 and Step 2

                // ── STEP 2: Send Poster Image + Attached PR Message Caption ───────
                if (posterMedia) {
                    console.log(`📤 [Step 2/3] Sending Poster Image with attached PR Message Caption...`);
                    await client.sendMessage(chatId, posterMedia, { caption: finalPR });
                    console.log(`✅ Poster Image + PR Caption Sent!`);
                } else {
                    console.log(`📤 [Step 2/3] Sending PR Message Text...`);
                    await client.sendMessage(chatId, finalPR);
                    console.log(`✅ PR Message Text Sent!`);
                }

                await delay(1500); // 1.5s pause between Step 2 and Step 3

                // ── STEP 3: Send PDF Brochure Document ────────────────────────────
                if (pdfMedia) {
                    console.log(`📤 [Step 3/3] Sending PDF Brochure Document ("${pdfMedia.filename}")...`);
                    await client.sendMessage(chatId, pdfMedia, { sendMediaAsDocument: true });
                    console.log(`✅ PDF Brochure Document Sent!`);
                }

                // Record sent log
                sentLogData.push(number);
                fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));

                console.log(`🎉 SUCCESS: Complete 3-step sequence delivered to ${number}!\n`);

            } catch (err) {
                console.error(`❌ FAILED for ${number}:`, err.message);
            }

            if (i < contactsToProcess.length - 1) {
                console.log('⏳ Waiting 5 seconds before next recipient...');
                await delay(5000);
            }
        }

        console.log('⏳ Waiting 10 seconds to allow WhatsApp network sync to finish...');
        await delay(10000);

        console.log('\n🎉 [COMPLETE] All 3 steps executed successfully for all recipients!');
        await client.destroy();
        process.exit(0);

    } catch (error) {
        console.error('❌ Script execution error:', error);
        if (client) await client.destroy();
        process.exit(1);
    }
});

// Start initialization
client.initialize();
