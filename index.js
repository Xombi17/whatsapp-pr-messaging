const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTr0sbMLaDyfWEXov59O3EPWaELMUEojipzcCeeJ3zbKMt2Avto46_4uXPxv90SZA/pub?gid=856437775&single=true&output=csv";
const LOG_FILE = './sent_log.json';

// formatted message to send to everyone
const TARGET_MESSAGE = `Hey Team Lead! Quick check-in 🚀

Kindly share the *current status of your project/MVP.* 
Since build time on-site will be limited, we *strongly recommend working on improving/building your MVP to ensure your project is well progressed prior to the event*, so you can focus on refining, testing, and pitching there.

If your team is facing any blockers, please reach out to us for support to help you move forward.`;

const delay = ms => new Promise(res => setTimeout(res, ms));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('\nQR Code generated! Please scan it with your WhatsApp app.');
});

client.on('ready', async () => {
    console.log('\n✅ Client is ready! Fetching data from Google Sheets...');

    try {
        const response = await fetch(SHEET_URL);
        const csvText = await response.text();
        
        const records = parse(csvText, { skip_empty_lines: true });

        let allNumbers = [];

        // Extract numbers from CSV
        for (let row of records) {
            if (row[0] && row[0].includes('91')) {
                allNumbers.push(row[0]);
            }
            if (row[5] && row[5].includes('91')) {
                allNumbers.push(row[5]);
            }
        }

        // Load previously sent log
        let sentLogData = [];
        if (fs.existsSync(LOG_FILE)) {
            sentLogData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
        }
        let sentLog = new Set(sentLogData);

        let uniqueContacts = [];
        for (let num of allNumbers) {
            let cleanedNumber = num.replace(/\D/g, ''); 
            if (cleanedNumber.length === 10) cleanedNumber = '91' + cleanedNumber;
            
            // Only add if we haven't sent to them yet
            if (!sentLog.has(cleanedNumber)) {
                uniqueContacts.push(cleanedNumber);
                // Temporarily add to Set to avoid duplicates within the CSV itself
                sentLog.add(cleanedNumber);
            }
        }

        console.log(`Found ${uniqueContacts.length} new unique contacts to message.\n`);

        for (let i = 0; i < uniqueContacts.length; i++) {
            const number = uniqueContacts[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${uniqueContacts.length}] Sending to ${number}...`);
            
            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is not registered on WhatsApp. Skipping.`);
                    continue;
                }

                await client.sendMessage(chatId, TARGET_MESSAGE);
                console.log(`✅ Message sent to ${number}`);

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

        console.log('\n🎉 All messages sent! You can exit with Ctrl+C.');

    } catch (error) {
        console.error('Error during execution:', error);
    }
});

client.initialize();
