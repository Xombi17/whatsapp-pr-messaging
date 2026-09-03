const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

// Log file to track sent messages and avoid duplicates across runs
const LOG_FILE = './sent_log.json';

// Rate Limiting & Batching Configuration
const BATCH_SIZE = 5;                   // Process 5 contacts per batch
const PER_CONTACT_DELAY_MIN = 2000;      // 2 seconds minimum delay between individual contacts
const PER_CONTACT_DELAY_MAX = 5000;      // 5 seconds maximum delay between individual contacts
const BATCH_PAUSE_MIN = 30000;           // 30 seconds minimum pause after every 5 contacts
const BATCH_PAUSE_MAX = 40000;           // 40 seconds maximum pause after every 5 contacts

// Utility helper for async delays (human-like pacing)
const delay = ms => new Promise(res => setTimeout(res, ms));

// Default message template if no template file is supplied
const DEFAULT_TEMPLATE = `Hey everyone! 👋

This is from Team GDSC CRCE. 🚀

We are excited to announce our upcoming event — Bits & Bytes (BNB)! 🔥

Get ready for an incredible experience with hands-on workshops, exciting challenges, and networking opportunities.

📅 Date: [Insert Date Here]
⏰ Time: [Insert Time Here]
📍 Venue: [Insert Venue / Campus Location]

🔗 Register Now: [Insert Registration Link]

Don't miss out! Feel free to reach out if you have any questions or need more details.

Best regards,
Team GDSC CRCE`;

/**
 * Configure Puppeteer launch options cross-platform.
 * Uses environment variable PUPPETEER_EXECUTABLE_PATH if set,
 * or checks for system Chrome, otherwise lets Puppeteer use bundled Chromium.
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
    }

    return options;
}

// Initialize WhatsApp Web Client with LocalAuth (persists session QR scan)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: getPuppeteerOptions()
});

// Display QR code in the terminal when authentication is needed
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('\n📲 QR Code generated! Scan it using WhatsApp on your phone (Linked Devices).\n');
});

// Event triggered once WhatsApp Web authentication succeeds
client.on('ready', async () => {
    console.log('\n✅ WhatsApp Client is authenticated and ready!');

    try {
        // Determine input CSV file path
        const csvFile = process.argv[2] || (fs.existsSync('./contacts.csv') ? './contacts.csv' : null);

        if (!csvFile) {
            console.error('❌ Error: No CSV file provided!');
            console.log('Usage: node index.js <contacts.csv> [template.txt] [attachment.pdf]');
            console.log('Example Text Only: node index.js contacts.csv template.txt');
            console.log('Example Text + PDF: node index.js contacts.csv template.txt brochure.pdf');
            await client.destroy();
            process.exit(1);
        }

        if (!fs.existsSync(csvFile)) {
            console.error(`❌ Error: CSV file "${csvFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        console.log(`📂 Reading contact numbers from "${csvFile}"...`);
        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true });

        if (records.length === 0) {
            console.log('⚠️ CSV file is empty. Nothing to process.');
            await client.destroy();
            process.exit(0);
        }

        // Determine column indexes dynamically or fallback for 1-column / multi-column CSVs
        let phoneIndex = 0;
        let nameIndex = -1;
        let startIndex = 0;

        const firstRow = records[0].map(cell => (cell || '').toString().trim().toLowerCase());
        const detectedPhoneIdx = firstRow.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile'));
        const detectedNameIdx = firstRow.findIndex(h => h.includes('name') || h.includes('first'));

        if (detectedPhoneIdx !== -1) {
            phoneIndex = detectedPhoneIdx;
            if (detectedNameIdx !== -1) nameIndex = detectedNameIdx;
            startIndex = 1; // Skip header row
        } else if (records[0].length >= 3) {
            nameIndex = 2; // Default for: Year(0), Branch(1), First Name(2), Last Name(3), Phone(4)
            phoneIndex = 4;
        }

        const allContacts = [];
        for (let i = startIndex; i < records.length; i++) {
            const row = records[i];
            
            let rawPhone = '';
            let rawName = '';

            if (row.length === 1) {
                rawPhone = (row[0] || '').toString().trim();
            } else {
                rawPhone = (row[phoneIndex] || row[0] || '').toString().trim();
                if (nameIndex !== -1 && row[nameIndex]) {
                    rawName = row[nameIndex].toString().trim();
                }
            }

            if (!rawPhone || rawPhone.toLowerCase() === 'phone' || rawPhone.toLowerCase() === 'number') continue;

            // Normalize phone number into E.164 format without '+' prefix (e.g. 91XXXXXXXXXX)
            let cleanedNumber = rawPhone.replace(/\D/g, '');

            if (cleanedNumber.length === 10) {
                cleanedNumber = '91' + cleanedNumber; // Default country code: India (+91)
            } else if (!(cleanedNumber.startsWith('91') && cleanedNumber.length === 12)) {
                console.log(`⚠️ Skipping invalid phone number "${rawPhone}" (normalized: "${cleanedNumber}")`);
                continue;
            }

            allContacts.push({
                number: cleanedNumber,
                name: rawName
            });
        }

        // Initialize or load sent_log.json to prevent duplicate sends
        let sentLogData = [];
        if (fs.existsSync(LOG_FILE)) {
            try {
                sentLogData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
            } catch (e) {
                sentLogData = [];
            }
        } else {
            // Automatically create sent_log.json on first run
            fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
            console.log(`📄 Created log file "${LOG_FILE}" to track sent contacts.`);
        }
        const sentLog = new Set(sentLogData);

        // Filter out contacts that were already messaged in previous runs
        const uniqueContacts = [];
        let skippedCount = 0;
        for (const contact of allContacts) {
            if (!sentLog.has(contact.number)) {
                uniqueContacts.push(contact);
                sentLog.add(contact.number); // Prevent intra-CSV duplicates
            } else {
                skippedCount++;
            }
        }

        console.log(`📊 Total Valid Phone Numbers: ${allContacts.length}`);
        if (skippedCount > 0) {
            console.log(`⏭️  Already Messaged Previously: ${skippedCount} (Skipped automatically)`);
        }
        console.log(`✉️  New Numbers to Message: ${uniqueContacts.length}`);
        console.log(`⚙️  Batch Configuration: ${BATCH_SIZE} contacts/batch, 2-5s contact delay, 30-40s batch pause\n`);

        if (uniqueContacts.length === 0) {
            console.log('🎉 All contacts have already been messaged! Exiting...');
            await client.destroy();
            process.exit(0);
        }

        // Load message template from file or default
        let templateText = DEFAULT_TEMPLATE;
        const customTemplateFile = process.argv[3] || (fs.existsSync('./template.txt') ? './template.txt' : null);
        if (customTemplateFile && fs.existsSync(customTemplateFile)) {
            templateText = fs.readFileSync(customTemplateFile, 'utf-8');
            console.log(`📝 Loaded custom template from "${customTemplateFile}"`);
        } else {
            console.log('📝 Using default message template');
        }

        // Optional PDF/Media attachment handling
        let attachmentMedia = null;
        const defaultBnbPdf = './BNB_26_Maharashtra_Brochure.pdf';
        const attachmentArg = process.argv[4] || (fs.existsSync(defaultBnbPdf) ? defaultBnbPdf : null);
        if (attachmentArg && fs.existsSync(attachmentArg)) {
            attachmentMedia = MessageMedia.fromFilePath(attachmentArg);
            attachmentMedia.filename = "BNB'26 Maharashtra Brochure.pdf";
            console.log(`📎 Loaded attachment file: "${attachmentArg}" (WhatsApp Display Title: "${attachmentMedia.filename}")`);
        }

        console.log('\n🚀 Starting message delivery...\n');

        // Loop and send messages with 5-contact batching & 30-40s pauses
        for (let i = 0; i < uniqueContacts.length; i++) {
            const { number, name } = uniqueContacts[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${uniqueContacts.length}] Processing number (${number})...`);

            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is not registered on WhatsApp. Skipping.`);
                } else {
                    // Replace {{name}} placeholder if present, else fallback cleanly
                    let finalMessage = templateText;
                    if (templateText.includes('{{name}}')) {
                        finalMessage = templateText.replace(/\{\{name\}\}/g, name && name.length ? name : '');
                    }

                    // Step 1: Send standalone intro text message
                    console.log(`📤 Sending intro text message to ${number}...`);
                    await client.sendMessage(chatId, finalMessage);
                    console.log(`✅ Text message sent to ${number}`);

                    // Step 2: Send PDF attachment as separate message if provided
                    if (attachmentMedia) {
                        await delay(1500); // 1.5 second pause between text and PDF
                        console.log(`📤 Sending PDF document (${attachmentMedia.filename}) to ${number}...`);
                        await client.sendMessage(chatId, attachmentMedia, { sendMediaAsDocument: true });
                        console.log(`✅ PDF document sent to ${number}`);
                    }

                    // Log sent contact immediately to sent_log.json
                    sentLogData.push(number);
                    fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));
                }
            } catch (err) {
                console.error(`❌ Failed to send to ${number}:`, err.message);
            }

            // Check if we reached the end of a 5-contact batch (and not at the very last contact)
            const isBatchEnd = (i + 1) % BATCH_SIZE === 0;
            const isLastContact = (i === uniqueContacts.length - 1);

            if (isBatchEnd && !isLastContact) {
                const batchPause = Math.floor(Math.random() * (BATCH_PAUSE_MAX - BATCH_PAUSE_MIN + 1) + BATCH_PAUSE_MIN);
                console.log(`\n⏸️  [Batch Completed] Sent ${BATCH_SIZE} messages. Pausing for ${(batchPause / 1000).toFixed(1)} seconds to prevent WhatsApp rate limits and allow message forwarding...\n`);
                await delay(batchPause);
            } else if (!isLastContact) {
                const contactDelay = Math.floor(Math.random() * (PER_CONTACT_DELAY_MAX - PER_CONTACT_DELAY_MIN + 1) + PER_CONTACT_DELAY_MIN);
                console.log(`⏳ Waiting ${(contactDelay / 1000).toFixed(1)}s before next contact...`);
                await delay(contactDelay);
            }
        }

        console.log('⏳ Waiting 8 seconds to allow WhatsApp network sync to finish...');
        await delay(8000);

        console.log('\n🎉 Bulk message delivery completed successfully!');
        await client.destroy();
        process.exit(0);

    } catch (error) {
        console.error('❌ An unexpected error occurred during execution:', error);
        if (client) await client.destroy();
        process.exit(1);
    }
});

// Start WhatsApp Client initialization
client.initialize();
