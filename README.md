# 📱 WhatsApp Web Bulk Messenger (`whatsapp-web.js`)

[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org/)
[![whatsapp-web.js](https://img.shields.io/badge/whatsapp--web.js-v1.34.6-brightgreen.svg)](https://wwebjs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A robust, automated WhatsApp bulk messaging utility built using **Node.js** and **`whatsapp-web.js`**. Designed for student organizations, teams, and committees (e.g., GDG) to automate event announcements, interview invitations, and member updates reliably while maintaining strict anti-spam protections.

---

## ✨ Features

- 📲 **QR Code Terminal Auth**: Log in quickly by scanning a terminal QR code with WhatsApp's "Linked Devices".
- 🔐 **Persistent Session Management**: Session data is cached locally via `LocalAuth` so you only scan the QR code once.
- 📄 **Robust CSV Contact Parsing**: Reads contacts directly from CSV files with flexible multi-row headers and column count tolerance.
- 🔀 **Spintax & Text Variation Engine**: Supports `{Hey|Hi|Hello}` spintax in both `intro.txt` and `template.txt` to generate unique variations per contact and evade automated spam fingerprinting.
- 🔄 **Multi-Template & Intro Rotation**: Rotates through multiple message variations separated by `---` or loaded from `intro1.txt`/`template1.txt`.
- 🎯 **Per-Run Batch Limiting (`--limit=N`)**: Safely cap sending volume (default 50 contacts per run, customizable via `--limit=20`, `--limit=100`, or `--limit=all`).
- 🖼️ **Optimized Media Delivery**: Automatically attaches poster images (`poster.jpg`) and lightened PDF brochures (`BNB_26_Maharashtra_Brochure.pdf`, ~3.6 MB compressed) without crashing Puppeteer memory.
- 📝 **Smart Logging & Unregistered Number Caching**: Records sent and unregistered numbers immediately in `sent_log.json` to prevent duplicate messaging and redundant network checks.
- 🛡️ **Anti-Spam Batching & Rate Limiting**: Sends messages in batches of 5 contacts with random delays between individual contacts and mandatory pauses between batches.
- 💻 **Cross-Platform**: Operates out-of-the-box on Linux, macOS, and Windows.

---

## 📁 Repository Structure

```
whatsapp-pr-messaging/
├── index.js                          # Main bulk messaging script with batching & limits
├── test_send.js                      # Dedicated test script for 3-step sequence
├── intro.txt                         # Step 1: Intro message text (supports '---' variations & spintax)
├── template.txt                      # Step 2: PR message caption (supports '---' variations & spintax)
├── poster.jpg                        # Step 2: Event poster image
├── BNB_26_Maharashtra_Brochure.pdf   # Step 3: Official compressed BNB '26 Event Brochure (3.6 MB)
├── contacts_sample.csv               # Sample CSV phone number file
├── package.json                      # NPM configuration and scripts
├── .gitignore                        # Excludes session data, contacts.csv, sent_log.json
└── README.md                         # Project documentation
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: v16.x or higher ([Download Node.js](https://nodejs.org/))
- **Google Chrome** or **Chromium** browser installed on your machine
- A WhatsApp account on your mobile phone

### 1. Install Dependencies

```bash
git clone https://github.com/Xombi17/whatsapp-pr-messaging.git
cd whatsapp-pr-messaging
npm install
```

---

## 📖 Usage & Features Guide

### Step 1: Prepare Contacts (`contacts.csv`)

Create `contacts.csv` (or use `contacts_sample.csv`). Single-column or multi-column formats are both supported:

```csv
Phone
9876543210
919876543211
```

- **Phone Number Normalization**: 10-digit Indian numbers automatically receive the `91` country code.

---

### Step 2: Set Up Spintax & Multi-Text Variations

To prevent WhatsApp from flagging identical text across hundreds of contacts, add **Spintax** and **multi-intro variations** in `intro.txt` and `template.txt`.

#### Example `intro.txt` (3 Rotated Variations with Spintax):

```text
{Hey|Hi|Hello}! This is Varad from GDG CRCE. We saw that you are part of active tech/hackathon communities. We are {excited|thrilled} to announce BIT N BUILD '26!
---
{Greetings|Hello|Hey there}! Hope you are doing well. Varad Joshi here from GDG CRCE. We are officially opening registrations for BIT N BUILD '26.
---
{Hi|Hey there}! Varad here from GDG/GDG CRCE. Reaching out with an exciting opportunity for BIT N BUILD '26!
```

#### Example `template.txt` (PR Caption with Spintax):

```text
*{The|Our}* _Ultimate Stage_ *to compete against IITs, NITs, and premier global institutions* 🌍

{Announcing|Presenting|Introducing} *Bit N Build '26*, the flagship International Hackathon presented by *Google Developer Groups (GDG)* at Fr. CRCE, Mumbai.
...
```

---

### Step 3: Run the Messenger

Execute the main script:

```bash
# 1. Standard Run (Processes first 50 unmessaged contacts by default)
npm start

# 2. Specify Custom Contact Limit (e.g. 20 contacts)
node index.js contacts.csv --limit=20

# 3. Process ALL Remaining Contacts (No Limit)
node index.js contacts.csv --limit=all

# 4. Custom Limit via Environment Variable
LIMIT=30 npm start
```

### Testing (`test_send.js`)

Run a test batch using test contacts:

```bash
npm test
# Or with custom limit:
node test_send.js test_contacts.csv --limit=5
```

---

### Step 4: Scan the QR Code

1. On first launch, a **QR Code** will render in your terminal.
2. Open **WhatsApp** on your phone > **Settings / Menu** > **Linked Devices** > **Link a Device**.
3. Scan the terminal QR code.
4. Session data will save automatically to `.wwebjs_auth/` for future runs.

---

## 🛡️ Anti-Ban Best Practices

1. **Daily Volume Limits**: Send in small batches (30–50 contacts per run) using `--limit=50`.
2. **Use Spintax**: Keep `{option1|option2}` syntax in `intro.txt` and `template.txt` so every recipient gets a unique message.
3. **Respect Rate Limits**: Keep batch pauses enabled (30–40s after every 5 contacts).
4. **Lightweight Attachments**: Ensure PDFs remain compressed (<5 MB) to avoid browser socket timeouts.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

---

**Crafted with ❤️ for GDG CRCE & Community Leaders**
