/**
 * contact_manager.js
 *
 * Temporarily saves a recipient into the WhatsApp address book right before
 * messaging them, then removes them again once delivery is finished.
 *
 * Rationale: messaging a large number of *unsaved* numbers is one of the
 * behavioural patterns WhatsApp's anti-spam heuristics weight heavily. Saving
 * the contact first makes the conversation look like a normal 1:1 chat.
 * Deleting afterwards keeps the address book clean.
 *
 * This is a risk-reduction measure, NOT a guarantee. Recipient blocks and
 * "report spam" taps remain the dominant ban signal.
 *
 * Uses whatsapp-web.js >= 1.34.6:
 *   client.saveOrEditAddressbookContact(phoneNumber, firstName, lastName, syncToAddressbook)
 *   client.deleteAddressbookContact(phoneNumber)
 */

const delay = ms => new Promise(res => setTimeout(res, ms));

// Pause after saving before sending, so the contact write propagates.
const POST_SAVE_DELAY = 2500;
// Pause after the last message before deleting, so delivery is not disturbed.
const PRE_DELETE_DELAY = 4000;

/**
 * Resolve contact-management behaviour from CLI flags and env vars.
 *
 *   --no-save-contact / SAVE_CONTACTS=false   disable saving entirely
 *   --keep-contacts   / KEEP_CONTACTS=true    save but never delete afterwards
 *   --sync-addressbook / SYNC_ADDRESSBOOK=true  also push to the phone's address book
 */
function getContactOptions(argv = process.argv, env = process.env) {
    const has = flag => argv.includes(flag);
    const envTrue = v => typeof v === 'string' && ['1', 'true', 'yes'].includes(v.trim().toLowerCase());
    const envFalse = v => typeof v === 'string' && ['0', 'false', 'no'].includes(v.trim().toLowerCase());

    const save = !(has('--no-save-contact') || envFalse(env.SAVE_CONTACTS));
    const remove = save && !(has('--keep-contacts') || envTrue(env.KEEP_CONTACTS));
    const sync = has('--sync-addressbook') || envTrue(env.SYNC_ADDRESSBOOK);

    return { save, remove, sync };
}

/**
 * Build the display name written into the address book.
 * Prefers the CSV name; otherwise a neutral label plus the last 4 digits so
 * entries stay distinguishable while they exist.
 */
function buildContactName(number, name) {
    const trimmed = (name || '').trim();
    if (trimmed) {
        const parts = trimmed.split(/\s+/);
        return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
    }
    return { firstName: 'BNB26', lastName: number.slice(-4) };
}

/**
 * Save the contact before messaging. Never throws — a failure here must not
 * abort the send, it just means this recipient is messaged unsaved.
 * @returns {Promise<boolean>} true if the contact was actually saved.
 */
async function saveContact(client, number, name, options) {
    if (!options || !options.save) return false;
    if (typeof client.saveOrEditAddressbookContact !== 'function') {
        console.log('⚠️  Installed whatsapp-web.js has no saveOrEditAddressbookContact() — skipping contact save (needs >= 1.34.6).');
        return false;
    }

    const { firstName, lastName } = buildContactName(number, name);
    try {
        await client.saveOrEditAddressbookContact(number, firstName, lastName, options.sync);
        console.log(`👤 Saved ${number} to address book as "${firstName} ${lastName}".`);
        await delay(POST_SAVE_DELAY);
        return true;
    } catch (err) {
        console.log(`⚠️  Could not save ${number} as a contact (${err.message}). Continuing unsaved.`);
        return false;
    }
}

/**
 * Remove the temporary contact once messaging is done. Never throws.
 */
async function removeContact(client, number, options, wasSaved) {
    if (!wasSaved || !options || !options.remove) return;
    if (typeof client.deleteAddressbookContact !== 'function') return;

    await delay(PRE_DELETE_DELAY);
    try {
        await client.deleteAddressbookContact(number);
        console.log(`🧹 Removed temporary contact ${number} from address book.`);
    } catch (err) {
        console.log(`⚠️  Could not remove contact ${number} (${err.message}). It may need deleting manually.`);
    }
}

/**
 * One-line summary of the active configuration, for the startup banner.
 */
function describeContactOptions(options) {
    if (!options.save) return 'Contact handling: disabled (messaging numbers unsaved).';
    const tail = options.remove ? 'deleted after delivery' : 'kept after delivery';
    return `Contact handling: save before send, ${tail}${options.sync ? ', synced to phone address book' : ''}.`;
}

module.exports = {
    getContactOptions,
    buildContactName,
    saveContact,
    removeContact,
    describeContactOptions,
    POST_SAVE_DELAY,
    PRE_DELETE_DELAY
};
