# 📱 WhatsApp Web Bulk Messenger (`whatsapp-web.js`)

[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org/)
[![whatsapp-web.js](https://img.shields.io/badge/whatsapp--web.js-v1.34.6-brightgreen.svg)](https://wwebjs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A robust, automated WhatsApp bulk messaging utility built using **Node.js** and **`whatsapp-web.js`**. Designed for student organizations, teams, and committees (e.g., GDSC) to automate event announcements, interview invitations, and member updates reliably.

---

## ✨ Features

- 📲 **QR Code Terminal Auth**: Log in quickly by scanning a terminal QR code with WhatsApp's "Linked Devices".
- 🔐 **Persistent Session Management**: Session data is cached locally via `LocalAuth` so you only scan the QR code once.
- 📄 **Flexible CSV Contact Parsing**: Reads contacts directly from CSV files (`Year, Branch, First Name, Last Name, Phone` or standard `Name, Phone`).
- 📝 **Dynamic Personalized Templates**: Replaces `{{name}}` placeholders with recipient names loaded from custom template files (`template.txt`).
- 🔄 **Smart Deduplication & Logging**: Automatically records sent messages in `sent_log.json` to prevent sending duplicate messages if re-run.
- 🛡️ **Anti-Spam Batching & Rate Limiting**: Sends messages in batches of 5 contacts with 2–5s random delays between individual messages, followed by a **30–40 second pause** between batches. This prevents WhatsApp automated spam detection and gives you time to manually forward media or follow-up details.
- 💻 **Cross-Platform**: Operates out-of-the-box on Linux, macOS, and Windows.

---

## 📁 Repository Structure

```
whatsapp-pr-messaging/
├── index.js                          # Main bulk messaging script
├── test_send.js                      # Dedicated test script for message + PDF sending
├── BNB_26_Maharashtra_Brochure.pdf   # Official BNB '26 Maharashtra Event Brochure
├── template.txt                      # BNB PR broadcast message template
├── contacts_sample.csv               # Sample 1-column CSV phone number file
├── check_availability.js             # Specialized utility for targeted availability checks
├── package.json                      # NPM configuration and scripts
├── .gitignore                        # Excludes session data, logs, and node_modules
├── archive/                          # Legacy Python/Selenium scripts and old logs
└── README.md                         # Complete documentation
```

> **Note**: Upon first run, `.wwebjs_auth/` (session storage) and `sent_log.json` (delivery history) will be created automatically. These are git-ignored to protect privacy and session security.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: v16.x or higher ([Download Node.js](https://nodejs.org/))
- **Google Chrome** or **Chromium** browser installed on your machine
- A WhatsApp account on your mobile phone

### 1. Clone & Install

Clone this repository and install the dependencies:

```bash
git clone https://github.com/Xombi17/whatsapp-pr-messaging.git
cd whatsapp-pr-messaging
npm install
```

---

## 📖 Step-by-Step Usage Guide

### Step 1: Prepare your Contacts CSV File

Create a CSV file (e.g., `contacts.csv` or copy `contacts_sample.csv`). You can provide a simple single-column list of phone numbers (no names required):

**Simple Phone-Only CSV Format (`contacts.csv`):**
```csv
Phone
9876543210
919876543211
```

*(Note: Multi-column CSVs containing `Name` and `Phone` columns are also automatically supported).*

* **Phone Number Formatting**: Phone numbers can be 10 digits (e.g., `9876543210` — Indian numbers will automatically receive `91` country code prefix) or full E.164 without `+` (e.g., `919876543211`).

---

### Step 2: Customize Your Message Template

Edit `template.txt` or create a custom text file. Use the `{{name}}` placeholder where you want recipient names injected.

**Example `template.txt`:**
```text
Hi {{name}},

This is Varad from GDSC CRCE!

We have received your application for the Junior Council 2026-27, and we are excited to invite you for the interview round.

Kindly let us know your availability so that we can schedule your interview slot.

We look forward to seeing your best! 😊

Regards,
Team GDSC CRCE
```

---

### Step 3: Run the Bulk Messenger

Execute the messenger script using Node.js:

```bash
# 1. Text-Only Mode (uses default contacts.csv and template.txt)
npm start

# 2. Custom CSV & Template File
node index.js contacts.csv template.txt

### Testing PDF + Intro Message Sending

A dedicated test script [test_send.js](file:///home/varad/Documents/gdsc/whatsapp-pr-messaging/test_send.js) is provided for test runs:

```bash
# Run test script with BNB brochure and test contacts
npm test

# Or specify custom test contacts, template, and PDF:
node test_send.js test_contacts.csv template.txt BNB_26_Maharashtra_Brochure.pdf
```

---

### Step 4: Scan the QR Code

1. When you start the script for the first time, a **QR Code** will render directly in your terminal.
2. Open **WhatsApp** on your mobile phone.
3. Go to **Settings / Menu** > **Linked Devices** > **Link a Device**.
4. Scan the terminal QR Code.
5. Once authenticated, the script will process the contacts automatically!

---

## 🛠️ Additional Tools & Scripts

### Availability Check Utility

If you need to send follow-ups or check availability for specific candidates, use `check_availability.js`:

```bash
# Run availability check script
npm run check-availability

# Run in test mode (sends a single test message)
node check_availability.js --test
```

### Custom Chrome Executable Path

If Puppeteer fails to find your local Google Chrome binary, set the `PUPPETEER_EXECUTABLE_PATH` environment variable:

```bash
# Linux
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Windows (PowerShell)
$env:PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

---

## 🛡️ Best Practices & Responsible Use

1. **Avoid Spamming**: Only message contacts who have opted in or applied for your program/event.
2. **Start Small**: Test your messaging flow with a small CSV file (2–3 test numbers) before running large broadcasts.
3. **Respect Delays**: The script includes a 2–5 second random wait between messages. Do not remove this delay, as sending messages too quickly can result in temporary WhatsApp suspensions.
4. **Session Reset**: If you need to switch WhatsApp accounts, delete the `.wwebjs_auth/` folder and re-run the script to scan a new QR code.

---

## ❓ Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `Error: Cannot find module` | Missing node dependencies | Run `npm install` in the project directory. |
| Chrome fails to launch | Browser path mismatch | Install Google Chrome or set `PUPPETEER_EXECUTABLE_PATH`. |
| `Number is not registered` | Invalid phone number | Check CSV phone format. The script safely skips unregistered numbers. |
| QR Code repeats endlessly | Disconnected session | Clear `.wwebjs_auth/` folder and re-scan the QR code. |

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

---

**Crafted with ❤️ for GDSC CRCE & Community Leaders**
