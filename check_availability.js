const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');

const CHECK_LOG_FILE = './check_availability_log.json';

const delay = ms => new Promise(res => setTimeout(res, ms));

// ── Configuration: the 8 people to check ─────────────────────────────────────
const TARGET_NAMES = [
    'Jerusha',
    'Swayam',
    'Myron',
    'Sujal',
    'Joshua',
    'Aarav',
    'Nigel',
    'Dhruv'
];

// ── Test mode: send a single test message to Anushka ─────────────────────────
const TEST_MODE = process.argv.includes('--test');
const TEST_RECIPIENT = {
    name: 'Anushka',
    number: '917738127494' // 7738127494 with country code 91
};

// Message template (name injected per recipient)
const CHECK_MESSAGE_TEMPLATE = `Hi {{name}},

I hope you're doing well.

We are in the process of scheduling interviews for this week and would like to know whether you will be available to attend the interview offline on campus.

Please let us know your availability at the earliest so that we can finalize the schedule accordingly.

Thank you, and we look forward to hearing from you.

Regards,
Varad Joshi
Team GDSC CRCE`;

function getPuppeteerOptions() {
    const options = {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'linux' && fs.existsSync('/opt/google/chrome/google-chrome')) {
        options.executablePath = '/opt/google/chrome/google-chrome';
    }
    return options;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: getPuppeteerOptions()
});


client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('\nQR Code generated! Please scan it with your WhatsApp app.');
});

client.on('ready', async () => {
    console.log('\n✅ Client is ready!');

    // ── Test mode: send a single message to Anushka only ─────────────────────
    if (TEST_MODE) {
        const { name, number } = TEST_RECIPIENT;
        const chatId = `${number}@c.us`;
        console.log(`\n🧪 TEST MODE: sending single test message to ${name} (${number})...\n`);

        try {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                console.log(`❌ Number ${number} is not registered on WhatsApp. Exiting.`);
                await client.destroy();
                process.exit(0);
            }

            const personalizedMessage = CHECK_MESSAGE_TEMPLATE.replace('{{name}}', name);
            await client.sendMessage(chatId, personalizedMessage);
            console.log(`✅ Test message sent to ${name} (${number})`);
        } catch (err) {
            console.error(`❌ Failed to send test message to ${name} (${number}):`, err.message);
        }

        console.log('\n🧪 Test complete! Exiting...');
        await client.destroy();
        process.exit(0);
    }

        const csvFile = process.argv[2] || (fs.existsSync('./contacts.csv') ? './contacts.csv' : './contacts_sample.csv');

        if (!fs.existsSync(csvFile)) {
            throw new Error(`CSV file not found: ${csvFile}`);
        }

        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true });

        // Expected columns: Year(0), Branch(1), First Name(2), Last Name(3), Phone(4)
        const targetContacts = [];

        for (let row of records) {
            const firstName = (row[2] || '').toString().trim();
            const rawPhone  = (row[4] || '').toString().trim();

            // Skip header
            if (rawPhone.toLowerCase() === 'phone') continue;
            if (!rawPhone) continue;

            // Only keep the 8 target people
            if (!TARGET_NAMES.includes(firstName)) continue;

            // Normalize phone to E.164-like "91XXXXXXXXXX"
            let cleanedNumber = rawPhone.replace(/\D/g, '');

            if (cleanedNumber.length === 10) {
                cleanedNumber = '91' + cleanedNumber;
            } else if (!(cleanedNumber.startsWith('91') && cleanedNumber.length === 12)) {
                console.log(`⚠️ Skipping invalid phone "${rawPhone}" (normalized="${cleanedNumber}")`);
                continue;
            }

            if (!cleanedNumber.startsWith('91')) continue;

            targetContacts.push({
                number: cleanedNumber,
                name: firstName
            });
        }

        if (targetContacts.length === 0) {
            console.log('❌ No target contacts found in interview1.csv. Exiting.');
            await client.destroy();
            process.exit(0);
        }

        console.log(`\n📋 Found ${targetContacts.length} target contact(s) to check:\n`);
        targetContacts.forEach((c, i) =>
            console.log(`  ${i + 1}. ${c.name} — ${c.number}`)
        );
        console.log('');

        // Load existing check log (to skip already-checked numbers)
        let checkLogData = [];
        if (fs.existsSync(CHECK_LOG_FILE)) {
            checkLogData = JSON.parse(fs.readFileSync(CHECK_LOG_FILE, 'utf-8'));
        }
        let checkLog = new Set(checkLogData);

        let contactsToCheck = [];
        for (let contact of targetContacts) {
            if (!checkLog.has(contact.number)) {
                contactsToCheck.push(contact);
                checkLog.add(contact.number);
            } else {
                console.log(`⏭️  Skipping ${contact.name} (${contact.number}) — already checked.`);
            }
        }

        if (contactsToCheck.length === 0) {
            console.log('\n✅ All target contacts have already been checked. Exiting.');
            await client.destroy();
            process.exit(0);
        }

        console.log(`\n🚀 Sending availability check to ${contactsToCheck.length} contact(s)...\n`);

        for (let i = 0; i < contactsToCheck.length; i++) {
            const { number, name } = contactsToCheck[i];
            const chatId = `${number}@c.us`;

            console.log(`[${i + 1}/${contactsToCheck.length}] Checking ${name} — ${number}...`);

            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is not registered on WhatsApp. Skipping.`);
                    continue;
                }

                const safeName = name && name.length ? name : 'there';
                const personalizedMessage = CHECK_MESSAGE_TEMPLATE.replace('{{name}}', safeName);

                await client.sendMessage(chatId, personalizedMessage);
                console.log(`✅ Message sent to ${name} (${number})`);

                // Mark as checked immediately
                checkLogData.push(number);
                fs.writeFileSync(CHECK_LOG_FILE, JSON.stringify(checkLogData, null, 2));

            } catch (err) {
                console.error(`❌ Failed to send to ${name} (${number}):`, err.message);
            }

            // Random delay between 2–5 seconds
            const waitTime = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000);
            await delay(waitTime);
        }

        console.log('\n🎉 All availability checks sent! Exiting...');
        await client.destroy();
        process.exit(0);

    } catch (error) {
        console.error('Error during execution:', error);
    }
});

client.initialize();
