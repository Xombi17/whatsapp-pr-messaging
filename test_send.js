const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');
const { getContactOptions, saveContact, removeContact, describeContactOptions } = require('./contact_manager');

// Configuration Defaults for the Test Script
const DEFAULT_CSV = './test_contacts.csv';
const DEFAULT_INTRO = './intro.txt';
const DEFAULT_TEMPLATE = './template.txt';
const DEFAULT_PDF = './BNB_26_Maharashtra_Brochure.pdf';
const LOG_FILE = './sent_log.json';

// Positional file arguments, ignoring any --flags (e.g. --limit=20, --keep-contacts)
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));

// Async delay utility helper
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Utility helper for Spintax resolution.
 * Replaces patterns like "{Hey|Hi|Hello}" with a randomly selected choice per message.
 */
function applySpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)].trim();
    });
}

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
        const csvFile = ARGS[0] || DEFAULT_CSV;
        const introFile = ARGS[1] || DEFAULT_INTRO;
        const templateFile = ARGS[2] || DEFAULT_TEMPLATE;
        const pdfFile = ARGS[3] || DEFAULT_PDF;

        // 1. Verify Files Exist
        if (!fs.existsSync(csvFile)) {
            console.error(`❌ Error: Test CSV file "${csvFile}" not found.`);
            await client.destroy();
            process.exit(1);
        }

        // 2. Load Contacts from CSV
        console.log(`📂 Loading test contacts from "${csvFile}"...`);
        const csvText = fs.readFileSync(csvFile, 'utf-8');
        const records = parse(csvText, { skip_empty_lines: true, relax_column_count: true });

        if (records.length === 0) {
            console.log('⚠️ CSV file is empty. Nothing to test.');
            await client.destroy();
            process.exit(0);
        }

        // Detect columns across first few rows
        let nameIndex = -1;
        let phoneIndex = 0;
        let startIndex = 0;

        for (let r = 0; r < Math.min(5, records.length); r++) {
            const rowStr = records[r].map(cell => (cell || '').toString().trim().toLowerCase());
            const detectedPhoneIdx = rowStr.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile'));
            const detectedNameIdx = rowStr.findIndex(h => h.includes('name') || h.includes('first'));

            if (detectedPhoneIdx !== -1) {
                phoneIndex = detectedPhoneIdx;
                if (detectedNameIdx !== -1 && detectedNameIdx !== phoneIndex) nameIndex = detectedNameIdx;
                startIndex = r + 1;
            }
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

        const uniqueContacts = [];
        let skippedCount = 0;
        for (const contact of testContacts) {
            if (!sentLog.has(contact.number)) {
                uniqueContacts.push(contact);
                sentLog.add(contact.number);
            } else {
                skippedCount++;
            }
        }

        if (skippedCount > 0) {
            console.log(`⏭️  Skipped ${skippedCount} contact(s) already recorded in ${LOG_FILE}`);
        }

        if (uniqueContacts.length === 0) {
            console.log('🎉 All test contacts have already been messaged! Exiting...');
            await client.destroy();
            process.exit(0);
        }

        // Determine max contacts limit for this run (--limit=50 or LIMIT=50)
        let maxLimit = 50;
        const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
        if (limitArg) {
            const val = limitArg.split('=')[1].trim().toLowerCase();
            if (val === 'all' || val === '0' || val === 'false') {
                maxLimit = Infinity;
            } else {
                maxLimit = parseInt(val, 10) || 50;
            }
        } else if (process.env.LIMIT) {
            const val = process.env.LIMIT.trim().toLowerCase();
            if (val === 'all' || val === '0' || val === 'false') {
                maxLimit = Infinity;
            } else {
                maxLimit = parseInt(process.env.LIMIT, 10) || 50;
            }
        }

        let contactsToProcess = [...uniqueContacts];
        if (maxLimit < contactsToProcess.length) {
            console.log(`🎯 Limit Applied: Processing first ${maxLimit} contacts out of ${uniqueContacts.length} available.`);
            contactsToProcess = contactsToProcess.slice(0, maxLimit);
        }

        // Step 1 Text: Intro Message Variations & Spintax Support
        let introVariations = [];
        const defaultIntroFallback = `Hi {{name}},\n\nVarad here from GDSC CRCE \n\nWe have received your application for the junior council of 2026-27, we are happy to invite you for the interview round.\nThe interview will be conducted offline during the coming week.\n\nKindly let me know your availability so that we can schedule the interview at a convenient time.\n\nI will be your point of contact throughout the selection process. If you have any questions or require any clarification, please feel free to reach out.\n\nWe look forward to seeing your best 😊\n\nRegards,\nTeam GDSC CRCE`;

        if (fs.existsSync(introFile)) {
            const rawIntro = fs.readFileSync(introFile, 'utf-8').trim();
            if (rawIntro.includes('---')) {
                introVariations = rawIntro.split('---').map(s => s.trim()).filter(Boolean);
                console.log(`📝 Loaded ${introVariations.length} Intro Message variations from "${introFile}" (separated by '---')`);
            } else {
                introVariations.push(rawIntro);
                console.log(`📝 Loaded Intro Message from "${introFile}"`);
            }
        }

        const standaloneIntroFiles = ['./intro1.txt', './intro2.txt', './intro3.txt', './intro_1.txt', './intro_2.txt', './intro_3.txt'];
        for (const file of standaloneIntroFiles) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf-8').trim();
                if (content && !introVariations.includes(content)) {
                    introVariations.push(content);
                    console.log(`📝 Loaded additional Intro variation from "${file}"`);
                }
            }
        }

        if (introVariations.length === 0) {
            introVariations = [defaultIntroFallback];
        }

        // Step 2 Caption: PR Message Variations & Spintax Support
        let prVariations = [];
        const defaultPRFallback = "Hey this is Varad from GDG CRCE. We are excited to announce that we are back with our flagship international hackathon BIT N BUILD. Looking forward to see you there!";

        if (fs.existsSync(templateFile)) {
            const rawTemplate = fs.readFileSync(templateFile, 'utf-8').trim();
            if (rawTemplate.includes('---')) {
                prVariations = rawTemplate.split('---').map(s => s.trim()).filter(Boolean);
                console.log(`📝 Loaded ${prVariations.length} PR Message variations from "${templateFile}" (separated by '---')`);
            } else {
                prVariations.push(rawTemplate);
                console.log(`📝 Loaded PR Message Caption from "${templateFile}"`);
            }
        }

        const standaloneTemplateFiles = ['./template1.txt', './template2.txt', './template3.txt', './template_1.txt', './template_2.txt', './template_3.txt'];
        for (const file of standaloneTemplateFiles) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf-8').trim();
                if (content && !prVariations.includes(content)) {
                    prVariations.push(content);
                    console.log(`📝 Loaded additional PR Message variation from "${file}"`);
                }
            }
        }

        if (prVariations.length === 0) {
            prVariations = [defaultPRFallback];
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

        // Temporary address-book handling (save before send, delete after)
        const contactOptions = getContactOptions();
        console.log(`👤 ${describeContactOptions(contactOptions)}`);

        console.log(`\n🚀 Executing 3-Step Sequence for ${contactsToProcess.length} recipient(s):\n 1. Intro Message\n 2. Poster Image + PR Caption\n 3. PDF Brochure Document\n`);

        // 4. Execute 3-Step Sequence for each contact
        for (let i = 0; i < contactsToProcess.length; i++) {
            const { number, name } = contactsToProcess[i];
            const chatId = `${number}@c.us`;
            let savedContact = false;

            console.log(`[${i + 1}/${contactsToProcess.length}] Checking WhatsApp registration for number (${number})...`);

            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    console.log(`❌ Number ${number} is NOT registered on WhatsApp. Logging and skipping.`);
                    sentLogData.push(number);
                    fs.writeFileSync(LOG_FILE, JSON.stringify(sentLogData, null, 2));
                    continue;
                }

                const rawIntro = introVariations[i % introVariations.length];
                const rawPR = prVariations[i % prVariations.length];
                let finalIntro = rawIntro;
                let finalPR = rawPR;

                // Clean up any residual {{name}} placeholder safely
                finalIntro = finalIntro.replace(/\{\{name\}\}\s*/g, '');
                finalPR = finalPR.replace(/\{\{name\}\}\s*/g, '');

                finalIntro = applySpintax(finalIntro);
                finalPR = applySpintax(finalPR);

                // ── STEP 0: Temporarily save the recipient as a contact ────────
                savedContact = await saveContact(client, number, name, contactOptions);

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

            // Always clean up the temporary contact, even if a send failed above
            await removeContact(client, number, contactOptions, savedContact);

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
