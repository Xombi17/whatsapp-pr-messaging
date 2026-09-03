const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

// Log file to track sent messages and avoid duplicates across runs
const LOG_FILE = './sent_log.json';

// Utility helper for async delays (human-like pacing)
const delay = ms => new Promise(res => setTimeout(res, ms));

// Default message template if no template file is supplied
const DEFAULT_TEMPLATE = `Hi {{name}},

This is a message from GDSC CRCE!

We have received your application for the junior council of 2026-27, and we are excited to invite you for the interview round.

Kindly let us know your availability so that we can schedule the interview at a convenient time.

If you have any questions or require any clarification, please feel free to reach out.

We look forward to seeing your best! 😊

Regards,
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
            console.log('Usage: node index.js <path-to-contacts.csv> [path-to-template.txt]');
            console.log('Example: node index.js contacts.csv template.txt');
            await client.destroy();
            process.exit(1);
        }

        if (!fs.existsSync(csvFile)) {
            console.error(`❌ Error: CSV file "${csvFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        console.log(`📂 Reading contact records from "${csvFile}"...`);
        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true });

        if (records.length === 0) {
            console.log('⚠️ CSV file is empty. Nothing to process.');
            await client.destroy();
            process.exit(0);
        }

        // Determine column indexes dynamically or fallback to standard indexes
        let nameIndex = 2; // Default for: Year(0), Branch(1), First Name(2), Last Name(3), Phone(4)
        let phoneIndex = 4;
        let startIndex = 0;

        const firstRow = records[0].map(cell => (cell || '').toString().trim().toLowerCase());
        const detectedPhoneIdx = firstRow.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile'));
        const detectedNameIdx = firstRow.findIndex(h => h.includes('name') || h.includes('first'));

        if (detectedPhoneIdx !== -1) {
            phoneIndex = detectedPhoneIdx;
            if (detectedNameIdx !== -1) nameIndex = detectedNameIdx;
            startIndex = 1; // Skip header row
        } else if (records[0].length === 2) {
            nameIndex = 0;
            phoneIndex = 1;
        }

        const allContacts = [];
        for (let i = startIndex; i < records.length; i++) {
            const row = records[i];
            const rawName = (row[nameIndex] || '').toString().trim();
            const rawPhone = (row[phoneIndex] || '').toString().trim();

            if (!rawPhone || rawPhone.toLowerCase() === 'phone') continue;

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

        // Load previously logged sent contacts
        let sentLogData = [];
        if (fs.existsSync(LOG_FILE)) {
            try {
                sentLogData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
            } catch (e) {
                sentLogData = [];
            }
        }
        const sentLog = new Set(sentLogData);

        // Filter out contacts that were already messaged
        const uniqueContacts = [];
        for (const contact of allContacts) {
            if (!sentLog.has(contact.number)) {
                uniqueContacts.push(contact);
                sentLog.add(contact.number); // Prevent intra-CSV duplicates
            }
        }

        console.log(`📊 Total Valid Contacts: ${allContacts.length}`);
        console.log(`✉️  New Contacts to Message: ${uniqueContacts.length}\n`);

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

        console.log('\n🚀 Starting message delivery...\n');

        // Loop and send messages
        for (let i = 0; i < uniqueContacts.length; i++) {
            const { number, name } = uniqueContacts[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${uniqueContacts.length}] Processing ${name ? name : 'Contact'} (${number})...`);

            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is not registered on WhatsApp. Skipping.`);
                    continue;
                }

                const safeName = name && name.length ? name : 'there';
                const personalizedMessage = templateText.replace(/\{\{name\}\}/g, safeName);

                await client.sendMessage(chatId, personalizedMessage);
                console.log(`✅ Message successfully sent to ${number} (${safeName})`);

                // Update sent log file immediately
                sentLogData.push(number);
                fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));

            } catch (err) {
                console.error(`❌ Failed to send to ${number}:`, err.message);
            }

            // Random delay between 2 to 5 seconds to simulate natural typing/pacing
            const waitTime = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000);
            console.log(`⏳ Waiting ${ (waitTime / 1000).toFixed(1) }s before next message...`);
            await delay(waitTime);
        }

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
