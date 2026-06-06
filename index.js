const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

const LOG_FILE = './sent_log.json';

const delay = ms => new Promise(res => setTimeout(res, ms));

// Message template (name injected per recipient)
const TARGET_MESSAGE_TEMPLATE = `Hi {{name}},

Varad here from GDSC CRCE 

We have received your application for the junior council of 2026-27, we are happy to invite you for the interview round.
The interview will be conducted offline during the coming week.

Kindly let me know your availability so that we can schedule the interview at a convenient time.

I will be your point of contact throughout the selection process. If you have any questions or require any clarification, please feel free to reach out.

We look forward to seeing your best 😊

Regards,
Team GDSC CRCE`;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/opt/google/chrome/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('\nQR Code generated! Please scan it with your WhatsApp app.');
});

client.on('ready', async () => {
    console.log('\n✅ Client is ready! Loading data from CSV...');

    try {
        const csvFile = process.argv[2];
        if (!csvFile) {
            throw new Error('Missing CSV filename. Usage: node index.js interview.csv');
        }

        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true });

        // Expected columns (based on your interview.csv):
        // Year(0), Branch(1), First Name(2), Last Name(3), Phone(4)
        const allContacts = [];

        for (let row of records) {
            const firstName = (row[2] || '').toString().trim();
            const rawPhone = (row[4] || '').toString().trim();

            // Skip CSV header row (and any accidental duplicates of the header)
            if (rawPhone.toLowerCase() === 'phone') continue;

            if (!rawPhone) continue;

            // Normalize phone into E.164-like "91XXXXXXXXXX" (no '+' like your previous script)
            // - If CSV already has country code (e.g. starts with 91 and length==12), keep it
            // - If it's 10 digits, prepend 91
            // - Otherwise skip (and log)
            let cleanedNumber = rawPhone.replace(/\D/g, '');

            if (cleanedNumber.length === 10) {
                cleanedNumber = '91' + cleanedNumber;
            } else if (!(cleanedNumber.startsWith('91') && cleanedNumber.length === 12)) {
                console.log(`⚠️ Skipping invalid phone "${rawPhone}" (normalized="${cleanedNumber}")`);
                continue;
            }

            if (!cleanedNumber.startsWith('91')) continue;

            allContacts.push({
                number: cleanedNumber,
                name: firstName
            });
        }

        // Load previously sent log
        let sentLogData = [];
        if (fs.existsSync(LOG_FILE)) {
            sentLogData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
        }
        let sentLog = new Set(sentLogData);

        let uniqueContacts = [];
        for (let contact of allContacts) {
            const { number, name } = contact;

            if (!sentLog.has(number)) {
                uniqueContacts.push({ number, name });
                // Temporarily add to Set to avoid duplicates within the CSV itself
                sentLog.add(number);
            }
        }

        console.log(`Found ${uniqueContacts.length} new unique contacts to message.\n`);

        for (let i = 0; i < uniqueContacts.length; i++) {
            const { number, name } = uniqueContacts[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${uniqueContacts.length}] Sending to ${number}...`);
            
            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is not registered on WhatsApp. Skipping.`);
                    continue;
                }

                const safeName = name && name.length ? name : 'there';
                const personalizedMessage = TARGET_MESSAGE_TEMPLATE.replace('{{name}}', safeName);

                await client.sendMessage(chatId, personalizedMessage);
                console.log(`✅ Message sent to ${number} (${safeName})`);

                // Mark as done immediately in the JSON file
                sentLogData.push(number);
                fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));

            } catch (err) {
                console.error(`❌ Failed to send to ${number}:`, err.message);
            }

            // Wait 2-5 seconds randomly
            const waitTime = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000);
            await delay(waitTime);
        }

        console.log('\n🎉 All messages sent! Exiting...');
        await client.destroy();
        process.exit(0);

    } catch (error) {
        console.error('Error during execution:', error);
    }
});

client.initialize();
