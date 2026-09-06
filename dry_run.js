/**
 * dry_run.js — offline rehearsal of the send pipeline.
 *
 * Runs index.js's real logic against a MOCK WhatsApp client: nothing is sent,
 * no QR scan, no browser. Use it to verify CSV parsing, phone normalisation,
 * spintax variation, the save-contact / delete-contact cycle and the pacing
 * plan before you point the real script at live numbers.
 *
 *   node dry_run.js test_contacts.csv --limit=10
 *   node dry_run.js test_contacts.csv --limit=10 --fast    (skip real waiting)
 *
 * Flags from contact_manager (--no-save-contact, --keep-contacts) work here too.
 */

const Module = require('module');
const path = require('path');
const EventEmitter = require('events');

const FAST = process.argv.includes('--fast');

// ── Mock whatsapp-web.js ────────────────────────────────────────────────────
const addressBook = new Map();
const sentMessages = [];
let readyCb = null;

class MockClient extends EventEmitter {
    constructor() { super(); }
    initialize() { setImmediate(() => this.emit('ready')); }
    async destroy() {}

    async isRegisteredUser(id) {
        // Treat any number ending in 0 as unregistered, to exercise that branch.
        return !id.startsWith('0') && !id.split('@')[0].endsWith('0');
    }

    async sendMessage(chatId, content, opts = {}) {
        // DRY_RUN_FAIL_ON=<substring> forces failures, to test cleanup on error
        if (process.env.DRY_RUN_FAIL_ON && chatId.includes(process.env.DRY_RUN_FAIL_ON)) {
            throw new Error('simulated send failure');
        }
        const kind = typeof content === 'string'
            ? 'text'
            : (opts.sendMediaAsDocument ? 'document' : 'media');
        const preview = typeof content === 'string'
            ? content.replace(/\s+/g, ' ').slice(0, 70)
            : (content.filename || content.mimetype || 'media');
        sentMessages.push({ chatId, kind, preview, caption: opts.caption ? opts.caption.slice(0, 40) : null });
        console.log(`      [MOCK SEND] ${kind} -> ${chatId} :: ${preview}${preview.length >= 70 ? '…' : ''}`);
        if (!addressBook.has(chatId.split('@')[0])) {
            console.log(`      [MOCK WARN] messaging ${chatId} while NOT in address book`);
        }
        return { id: { _serialized: 'mock' } };
    }

    async saveOrEditAddressbookContact(number, first, last, sync) {
        if (addressBook.has(number)) throw new Error(`duplicate save for ${number}`);
        addressBook.set(number, { first, last, sync: !!sync });
    }

    async deleteAddressbookContact(number) {
        if (!addressBook.has(number)) throw new Error(`delete of unsaved contact ${number}`);
        addressBook.delete(number);
    }
}

class MockLocalAuth {}
const MockMessageMedia = {
    fromFilePath(p) { return { mimetype: 'mock', filename: path.basename(p), data: '' }; }
};

// ── Intercept require('whatsapp-web.js') and qrcode-terminal ────────────────
const realResolve = Module._resolveFilename;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'whatsapp-web.js') {
        return { Client: MockClient, LocalAuth: MockLocalAuth, MessageMedia: MockMessageMedia };
    }
    if (request === 'qrcode-terminal') {
        return { generate: () => {} };
    }
    return realLoad.apply(this, arguments);
};

// ── Optionally collapse all the anti-spam waiting ───────────────────────────
if (FAST) {
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...rest) => realTimeout(fn, Math.min(ms || 0, 5), ...rest);
}

// ── Keep sent_log.json out of the way ───────────────────────────────────────
const fs = require('fs');
const os = require('os');
const scratchLog = path.join(os.tmpdir(), `dry_run_sent_log_${Date.now()}.json`);
const realWriteFileSync = fs.writeFileSync;
const realReadFileSync = fs.readFileSync;
const realExistsSync = fs.existsSync;
const isLog = p => typeof p === 'string' && p.includes('sent_log.json');
fs.writeFileSync = (p, ...a) => realWriteFileSync(isLog(p) ? scratchLog : p, ...a);
fs.readFileSync = (p, ...a) => realReadFileSync(isLog(p) ? scratchLog : p, ...a);
fs.existsSync = p => (isLog(p) ? realExistsSync(scratchLog) : realExistsSync(p));

// ── Report on exit ──────────────────────────────────────────────────────────
const realExit = process.exit.bind(process);
process.exit = code => {
    console.log('\n──────────── DRY RUN SUMMARY ────────────');
    console.log(`Messages that would have been sent: ${sentMessages.length}`);
    const byKind = sentMessages.reduce((a, m) => (a[m.kind] = (a[m.kind] || 0) + 1, a), {});
    console.log(`  by type: ${JSON.stringify(byKind)}`);
    const uniqueTexts = new Set(sentMessages.filter(m => m.kind === 'text').map(m => m.preview));
    console.log(`  distinct intro texts: ${uniqueTexts.size} (higher = better spintax coverage)`);
    if (addressBook.size === 0) {
        console.log('✅ Address book is clean — every temporary contact was deleted.');
    } else {
        console.log(`❌ LEAKED CONTACTS (${addressBook.size}): ${[...addressBook.keys()].join(', ')}`);
    }
    console.log('─────────────────────────────────────────');
    try { fs.unlinkSync(scratchLog); } catch (e) {}
    realExit(code);
};

// ── Run the real script ─────────────────────────────────────────────────────
const target = process.argv.includes('--single') ? './send_single.js' : './index.js';
console.log(`🧪 DRY RUN of ${target} (no messages will actually be sent)\n`);
require(target);
