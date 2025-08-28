import os
import sys
import time
import random
import logging
from datetime import datetime
import threading
import pandas as pd
import pyperclip

# Create logs directory if it doesn't exist
LOGS_DIR = os.path.join(os.path.dirname(__file__), 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)
try:
    import pyautogui
except Exception:
    pyautogui = None

# Fast Windows platform detection to avoid potential WMI hang in Python 3.13
if sys.platform.startswith('win'):
    try:
        import platform as _platform
        _platform.system = (lambda: 'Windows')
    except Exception:
        pass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

# Fix Windows console encoding issues
if sys.platform.startswith('win'):
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# ====== LOGGING SETUP (NO EMOJIS) ======
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOGS_DIR, f'whatsapp_sender_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'), encoding='utf-8'),
        logging.StreamHandler()
    ]
)

# ====== CONFIG ======
GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRW84c1YtBx33dt8e5i57wgvgc3JKSgXiSgNYGf5L5huBCfkcEo6pTI2NSevcUwue1zdeV5mqgiQQtN/pub?gid=0&single=true&output=csv"
USE_BETA_UI = True  # Prioritize WhatsApp Web Beta UI selectors
# Speed controls (override via env)
# You can disable automatic delays by setting NO_DELAY=1 in the environment.
# You can also set a fixed delay with DELAY_SECONDS or use DELAY_MIN / DELAY_MAX.
NO_DELAY = os.environ.get('NO_DELAY', '0') == '1'
FAST_MODE = os.environ.get('FAST_MODE', '0') == '1'  # If true, trim internal fixed sleeps
SLEEP_SCALE = float(os.environ.get('SLEEP_SCALE', '1.0'))  # Multiply all controlled sleeps
if NO_DELAY and not FAST_MODE:
    # Auto-enable FAST_MODE when NO_DELAY requested
    FAST_MODE = True
if 'DELAY_SECONDS' in os.environ:
    try:
        d = int(os.environ.get('DELAY_SECONDS', '0'))
        DELAY_BETWEEN_CONTACTS = (d, d)
    except Exception:
        DELAY_BETWEEN_CONTACTS = (
            int(os.environ.get('DELAY_MIN', '0')),
            int(os.environ.get('DELAY_MAX', '0')),
        )
else:
    # Default now zero delay unless user explicitly sets env vars
    DELAY_BETWEEN_CONTACTS = (
        int(os.environ.get('DELAY_MIN', '0')),
        int(os.environ.get('DELAY_MAX', '0')),
    )
BATCH_SIZE = 5  # Number of contacts to process before taking a break (reset from 40)
BATCH_DELAY = 5  # Seconds to wait between batches (reduced from 10)
PERSISTENT_PROFILE_DIR = r"./chrome_profile"
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '2'))
CHAT_LOAD_TIMEOUT = int(os.environ.get('CHAT_LOAD_TIMEOUT', '20'))
MESSAGE_SEND_TIMEOUT = int(os.environ.get('MESSAGE_SEND_TIMEOUT', '1'))
WHATSAPP_LOAD_TIMEOUT = int(os.environ.get('WHATSAPP_LOAD_TIMEOUT', '45'))
SYNC_DURATION = int(os.environ.get('SYNC_DURATION', '0'))  # Seconds to keep sync-only session alive (0 = infinite until CTRL+C)

# Duplicate prevention
SENT_MESSAGES_LOG = os.path.join(LOGS_DIR, f"sent_messages_{datetime.now().strftime('%Y%m%d')}.log")
CHECK_DUPLICATES = True  # Set to False to disable duplicate checking

# Data balancing
AUTO_BALANCE_DATA = True  # Set to False to disable automatic data balancing
 
# ====== MANUAL DATA OVERRIDE (set via GUI) ======
MANUAL_DATA = None  # If set (DataFrame), run_campaign will use this instead of loading sheet

# More robust CONTACT_LIMIT handling
try:
    env_limit = os.environ.get('CONTACT_LIMIT')
    if env_limit:
        CONTACT_LIMIT = int(env_limit)
        logging.info(f"CONTACT_LIMIT set from environment: {CONTACT_LIMIT}")
    else:
        CONTACT_LIMIT = 999999
        logging.info(f"CONTACT_LIMIT using default: {CONTACT_LIMIT}")
except (ValueError, TypeError) as e:
    CONTACT_LIMIT = 999999
    logging.warning(f"Invalid CONTACT_LIMIT environment variable, using default: {CONTACT_LIMIT}")

DISABLE_IMAGES = os.environ.get('DISABLE_IMAGES', '1') == '1'

# Debug: Show actual values
logging.info("Configuration loaded:")
logging.info("  CONTACT_LIMIT: %s", CONTACT_LIMIT)
logging.info("  DELAY_BETWEEN_CONTACTS: %s", DELAY_BETWEEN_CONTACTS)
logging.info("  NO_DELAY: %s", NO_DELAY)
logging.info("  FAST_MODE: %s", FAST_MODE)
logging.info("  SLEEP_SCALE: %s", SLEEP_SCALE)

# ====== CONTROL EVENTS FOR PAUSE/RESUME/STOP ======
PAUSE_EVENT = threading.Event()
PAUSE_EVENT.set()  # Start unpaused
STOP_EVENT = threading.Event()
CURRENT_DRIVER = None

def pause_sending():
    PAUSE_EVENT.clear()
    logging.info("PAUSED: Message sending paused")

def resume_sending():
    if not PAUSE_EVENT.is_set():
        PAUSE_EVENT.set()
        logging.info("RESUMED: Message sending resumed")

def stop_sending():
    STOP_EVENT.set()
    PAUSE_EVENT.set()
    logging.info("STOP REQUESTED: Will stop after current contact")
logging.info("  MAX_RETRIES: %s", MAX_RETRIES)

def set_manual_data(numbers, message):
    """Provide a list of phone numbers (strings) and a single message to send.
    Called by GUI to override spreadsheet loading.
    """
    global MANUAL_DATA
    rows = []
    for raw in numbers:
        if not raw:
            continue
        cleaned = str(raw).replace('+', '').replace(' ', '').strip()
        if not cleaned or cleaned.lower() == 'nan':
            continue
        rows.append({'Number': cleaned, 'IntroMessage': message})
    if rows:
        MANUAL_DATA = pd.DataFrame(rows)
        logging.info(f"Manual numbers loaded: {len(MANUAL_DATA)} contacts (spreadsheet will be skipped)")
    else:
        MANUAL_DATA = None
        logging.warning("Manual numbers list empty after cleaning; falling back to spreadsheet data")

# ====== ENHANCED SELENIUM SETUP ======
def setup_driver():
    """Setup Chrome driver with optimized settings for WhatsApp Web"""
    options = Options()
    options.add_argument(f"user-data-dir={os.path.abspath(PERSISTENT_PROFILE_DIR)}")
    try:
        options.page_load_strategy = 'eager'
    except Exception:
        pass
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-plugins-discovery")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-web-security")
    options.add_argument("--allow-running-insecure-content")
    options.add_argument("--disable-features=VizDisplayCompositor")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-background-timer-throttling")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--disable-backgrounding-occluded-windows")
    options.add_argument("--mute-audio")
    options.add_argument("--no-first-run")
    options.add_argument("--no-service-autorun")
    options.add_argument("--disable-component-update")
    if DISABLE_IMAGES:
        options.add_experimental_option(
            "prefs",
            {"profile.managed_default_content_settings.images": 2},
        )
    options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    driver = webdriver.Chrome(options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    driver.set_window_size(1366, 768)
    return driver

# ====== SLEEP HELPERS ======
def controlled_sleep(seconds: float, reason: str = ""):
    """Sleep utility that can be shortened or skipped when FAST_MODE is enabled.
    Large sleeps (>0.6s) become 0s in FAST_MODE; small micro waits become 0.05s.
    A SLEEP_SCALE factor can globally scale durations (ignored when FAST_MODE trims)."""
    if seconds <= 0:
        return
    original = seconds
    if FAST_MODE:
        if seconds > 0.6:
            seconds = 0  # skip long waits entirely
        else:
            seconds = 0.05  # keep a tiny buffer for stability
    else:
        seconds = seconds * SLEEP_SCALE
    if seconds > 0:
        if reason:
            logging.debug(f"Sleep {seconds:.2f}s (orig {original:.2f}s) - {reason}")
        time.sleep(seconds)
    else:
        if reason:
            logging.debug(f"Skipped sleep (orig {original:.2f}s) - {reason}")

def wait_for_whatsapp_load(driver, timeout=WHATSAPP_LOAD_TIMEOUT):
    """Wait for WhatsApp Web to fully load with better detection"""
    logging.info("Waiting for WhatsApp Web to load...")
    try:
        logging.info("Step 1: Waiting for basic page elements...")
        WebDriverWait(driver, 20).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        logging.info("Step 2: Looking for WhatsApp interface...")
        fast_selectors = ["//div[@id='app']", "//div[@id='main']", "//div[@data-testid='pane-side']"]
        whatsapp_loaded = False
        for selector in fast_selectors:
            try:
                WebDriverWait(driver, 8).until(EC.presence_of_element_located((By.XPATH, selector)))
                whatsapp_loaded = True
                break
            except TimeoutException:
                continue
        if not whatsapp_loaded:
            logging.warning("No WhatsApp elements found with standard selectors. Trying fallback...")
            time.sleep(5)
            page_text = driver.execute_script("return document.body.innerText.toLowerCase()")
            if "whatsapp" in page_text or "qr code" in page_text:
                logging.info("WhatsApp text detected, assuming page loaded")
                whatsapp_loaded = True
        if not whatsapp_loaded:
            raise TimeoutException("Could not detect WhatsApp Web interface")
        logging.info("Step 3: Checking login status...")
        time.sleep(3)
        qr_selectors = ["//canvas", "//div[contains(@class, 'qr-')]", "//img[contains(@alt, 'QR')]"]
        qr_found = False
        for qr_selector in qr_selectors:
            if driver.find_elements(By.XPATH, qr_selector):
                logging.info("QR code detected. Please scan to continue...")
                qr_found = True
                break
        if qr_found:
            logging.info("Waiting for QR code scan (up to 120 seconds)...")
            main_selectors = ["//div[@id='main']", "//div[contains(@class, 'two')]", "//div[@id='pane-side']", "//div[contains(@class, '_2Ts6i')]"]
            main_loaded = False
            for main_selector in main_selectors:
                try:
                    WebDriverWait(driver, 120).until(EC.presence_of_element_located((By.XPATH, main_selector)))
                    logging.info("QR scan successful, main interface loaded")
                    main_loaded = True
                    break
                except TimeoutException:
                    continue
            if not main_loaded:
                logging.error("QR scan timeout or failed")
                return False
        time.sleep(1)
        logging.info("SUCCESS: WhatsApp Web loaded successfully!")
        return True
    except TimeoutException as e:
        logging.error(f"TIMEOUT: WhatsApp Web failed to load - {str(e)}")
        try:
            current_url = driver.current_url
            page_title = driver.title
            logging.error(f"Current URL: {current_url}")
            logging.error(f"Page title: {page_title}")
        except:
            pass
        return False
    except Exception as e:
        logging.error(f"ERROR: Unexpected error loading WhatsApp Web - {str(e)}")
        return False

def search_and_open_chat(driver, number, name=None):
    """Search for contact and open chat - more reliable method"""
    try:
        logging.info(f"Opening chat for {number}")
        direct_url = f"https://web.whatsapp.com/send?phone={number}"
        logging.info(f"Trying direct URL: {direct_url}")
        driver.get(direct_url)
        controlled_sleep(2, "post driver.get direct chat load")

        chat_indicators = [
            "//div[@contenteditable='true'][@data-tab='10']",
            "//div[@contenteditable='true'][@data-tab='6']",
            "//div[@contenteditable='true'][@data-tab='3']",
            "//div[@contenteditable='true'][contains(@class, 'selectable-text')]",
            "//div[@role='textbox'][@contenteditable='true']",
            "//div[contains(@class, '_13NKt')][@contenteditable='true']",
            "//*[@data-testid='conversation-compose-box-input']",
            "//*[@data-testid='compose-box-input']"
        ]

        chat_loaded = False
        for i, indicator in enumerate(chat_indicators, 1):
            try:
                logging.info(f"Checking chat indicator {i}/{len(chat_indicators)}: {indicator}")
                WebDriverWait(driver, CHAT_LOAD_TIMEOUT).until(EC.presence_of_element_located((By.XPATH, indicator)))
                logging.info(f"SUCCESS: Chat loaded using indicator {i}")
                chat_loaded = True
                break
            except TimeoutException:
                logging.info(f"Indicator {i} not found, trying next...")
                continue

        if chat_loaded:
            controlled_sleep(1, "after chat indicators detected")
            page_text = driver.execute_script("return document.body.innerText.toLowerCase()")
            if "invalid number" in page_text or "phone number shared" in page_text:
                logging.error(f"Invalid number detected for {number}")
                return False
            logging.info(f"SUCCESS: Chat opened for {number}")
            return True

        logging.info(f"Direct URL failed for {number}, trying search method...")
        return search_contact_via_search_box(driver, number, name)
    except Exception as e:
        logging.error(f"ERROR: Failed to open chat for {number} - {str(e)}")
        return False

def search_contact_via_search_box(driver, number, name=None):
    """Alternative method: Search via WhatsApp search box"""
    try:
        logging.info(f"Searching via search box for {number}")
        driver.get("https://web.whatsapp.com")
        controlled_sleep(3, "post driver.get main page for search")

        search_selectors = [
            "//div[@contenteditable='true'][@data-tab='3']",
            "//div[contains(@class, 'selectable-text')][@contenteditable='true'][@data-tab='3']",
            "//input[@type='text'][@placeholder='Search or start new chat']",
            "//div[@title='Search or start new chat']",
            "//div[@contenteditable='true'][@data-tab='6']",
            "//div[@contenteditable='true'][@data-tab='1']",
            "//*[@data-testid='chat-list-search']",
            "//div[contains(@class, 'search')]//div[@contenteditable='true']"
        ]

        search_box = None
        for search_selector in search_selectors:
            try:
                search_box = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.XPATH, search_selector)))
                logging.info(f"Found search box with selector: {search_selector}")
                break
            except TimeoutException:
                continue

        if not search_box:
            logging.error("Could not find search box")
            return False

        search_terms = []
        if name and name.strip() and name.lower() != 'nan':
            search_terms.append(name.strip())
        search_terms.append(number)

        for search_term in search_terms:
            logging.info(f"Searching for: {search_term}")
            try:
                search_box.click()
                controlled_sleep(0.5, "focus search box")
                search_box.clear()
                search_box.send_keys(str(search_term))
                controlled_sleep(3, "wait for search results populate")

                result_selectors = [
                    "//div[@id='pane-side']//div[contains(@class, 'zoWT4')]//span",
                    "//div[contains(@class, 'chat-list')]//div[contains(@class, 'chat')]",
                    "//div[@role='listitem']//div[contains(@class, 'contact')]",
                    "//div[contains(@class, 'chat')]//div[contains(@class, 'contact')]",
                    "//div[@role='listitem']//div[contains(@class, 'chat')]",
                    "//div[contains(@class, '_199zF')]",
                    "//div[contains(@class, 'zoWT4')]"
                ]

                for result_selector in result_selectors:
                    try:
                        contact_result = WebDriverWait(driver, 5).until(EC.element_to_be_clickable((By.XPATH, result_selector)))
                        contact_result.click()
                        controlled_sleep(3, "after clicking search result to load chat")

                        chat_indicators = [
                            "//div[@contenteditable='true'][@data-tab='10']",
                            "//div[@contenteditable='true'][@data-tab='6']",
                            "//div[@contenteditable='true'][@data-tab='3']",
                            "//div[@contenteditable='true'][contains(@class, 'selectable-text')]",
                            "//*[@data-testid='conversation-compose-box-input']",
                            "//*[@data-testid='compose-box-input']"
                        ]

                        for chat_indicator in chat_indicators:
                            if driver.find_elements(By.XPATH, chat_indicator):
                                logging.info(f"SUCCESS: Chat opened via search for {search_term}")
                                return True

                        logging.info(f"Chat indicator not found after clicking result for {search_term}")
                    except TimeoutException:
                        continue
            except Exception as e:
                logging.warning(f"Error during search for {search_term}: {str(e)}")
                continue

        logging.error(f"Search method failed for {number}")
        return False
    except Exception as e:
        logging.error(f"ERROR: Search method failed for {number} - {str(e)}")
        return False

def send_message(driver, message, retry_count=0):
    """Send text message with retry logic"""
    try:
        logging.info("Sending message...")
        message_selectors = [
            "//*[@data-testid='conversation-compose-box-input']" if USE_BETA_UI else None,
            "//*[@data-testid='compose-box-input']" if USE_BETA_UI else None,
            "//div[@contenteditable='true'][@data-tab='10']",
            "//div[@contenteditable='true'][contains(@class, 'selectable-text')]",
            "//div[@role='textbox'][@contenteditable='true']",
            "//div[contains(@class, '_13NKt')][@contenteditable='true']"
        ]
        message_selectors = [ms for ms in message_selectors if ms]
        primary_selector = message_selectors[0]
        message_box = None
        try:
            message_box = WebDriverWait(driver, 2).until(EC.element_to_be_clickable((By.XPATH, primary_selector)))
        except TimeoutException:
            for selector in message_selectors[1:]:
                try:
                    message_box = WebDriverWait(driver, 2).until(EC.element_to_be_clickable((By.XPATH, selector)))
                    break
                except TimeoutException:
                    continue
        if not message_box:
            raise Exception("Could not find message input box")
        message_box.click()
        controlled_sleep(0.3, "after focusing message box")
        message_box.send_keys(Keys.CONTROL, 'a')
        message_box.send_keys(Keys.DELETE)
        try:
            pyperclip.copy(message)
            message_box.send_keys(Keys.CONTROL, 'v')
        except Exception:
            chunks = [message[i:i+1000] for i in range(0, len(message), 1000)] if len(message) > 1000 else [message]
            for idx, chunk in enumerate(chunks):
                lines = chunk.split('\n')
                for line_i, line in enumerate(lines):
                    message_box.send_keys(line)
                    if line_i < len(lines) - 1:
                        message_box.send_keys(Keys.SHIFT, Keys.ENTER)
                if idx < len(chunks) - 1:
                    controlled_sleep(0.3, "between chunk pastes")
        message_box.send_keys(Keys.ENTER)
        controlled_sleep(0.3, "post ENTER send stabilization")
        logging.info("SUCCESS: Message sent")
        return True
    except Exception as e:
        if retry_count < MAX_RETRIES:
            logging.warning(f"Message send failed, retrying... ({retry_count + 1}/{MAX_RETRIES})")
            controlled_sleep(3, "retry backoff after failed send")
            return send_message(driver, message, retry_count + 1)
        else:
            logging.error(f"FAILED: Could not send message after {MAX_RETRIES} attempts - {str(e)}")
            return False

def show_batch_progress(current_batch, total_batches, contacts_in_current_batch, total_contacts):
    """Show progress information for the current batch"""
    logging.info(f"📊 BATCH PROGRESS: {current_batch}/{total_batches}")
    logging.info(f"📱 Contacts in current batch: {contacts_in_current_batch}/{BATCH_SIZE}")
    logging.info(f"📈 Overall progress: {total_contacts} contacts processed")

def random_delay():
    """Generate random delay between contacts to appear more human-like"""
    if NO_DELAY:
        logging.info("NO_DELAY enabled: skipping delay between messages")
        return

    low, high = DELAY_BETWEEN_CONTACTS
    # If both bounds are zero, skip sleeping
    if low == 0 and high == 0:
        return

    delay = random.randint(low, high) if high >= low else low
    if delay > 0:
        logging.info(f"Waiting {delay} seconds before next contact...")
        time.sleep(delay)
    else:
        logging.debug("Calculated delay is 0, continuing immediately")

def batch_delay():
    """Wait between batches"""
    logging.info(f"⏸️  BATCH BREAK: Waiting {BATCH_DELAY} seconds...")
    for remaining in range(BATCH_DELAY, 0, -1):
        if remaining % 10 == 0 or remaining <= 5:  # Show countdown every 10 seconds or last 5 seconds
            logging.info(f"⏳ Resuming in {remaining} seconds...")
        time.sleep(1)
    logging.info("▶️  Resuming with next batch...")

def load_sent_messages():
    """Load the list of contacts that have already received intro messages"""
    sent_contacts = set()
    try:
        if os.path.exists(SENT_MESSAGES_LOG):
            with open(SENT_MESSAGES_LOG, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        # Format: timestamp|number|name|message_preview
                        parts = line.split('|')
                        if len(parts) >= 2:
                            sent_contacts.add(parts[1])  # Add phone number
            logging.info(f"Loaded {len(sent_contacts)} previously sent contacts from log")
        else:
            logging.info("No previous sent messages log found - starting fresh")
    except Exception as e:
        logging.warning(f"Error loading sent messages log: {str(e)}")
        logging.info("Starting with empty sent messages list")
    
    return sent_contacts

def save_sent_message(number, name, message_preview):
    """Save a contact to the sent messages log"""
    try:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp}|{number}|{name}|{message_preview[:50]}{'...' if len(message_preview) > 50 else ''}\n"
        
        with open(SENT_MESSAGES_LOG, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        
        logging.info(f"Saved {number} to sent messages log")
    except Exception as e:
        logging.error(f"Failed to save sent message log: {str(e)}")

def is_message_already_sent(number, sent_contacts):
    """Check if a message has already been sent to this contact"""
    if not CHECK_DUPLICATES:
        return False
    
    # Clean the number for comparison
    clean_number = str(number).replace("+", "").replace(" ", "").replace("-", "").strip()
    
    # Check if this number exists in sent contacts
    for sent_number in sent_contacts:
        sent_clean = str(sent_number).replace("+", "").replace(" ", "").replace("-", "").strip()
        if clean_number == sent_clean:
            return True
    
    return False

def open_chats_check_only(numbers):
    """Open each provided number's chat (no messages sent) and log whether an intro was previously sent.
    numbers: iterable of raw number strings.
    """
    logging.info("CHECK-ONLY MODE: Opening chats to inspect prior send status (no messages will be sent)")
    driver = setup_driver()
    global CURRENT_DRIVER
    CURRENT_DRIVER = driver
    try:
        logging.info("Loading WhatsApp Web...")
        driver.get("https://web.whatsapp.com")
        if not wait_for_whatsapp_load(driver):
            logging.error("Failed to load WhatsApp Web.")
            return
        sent_contacts = load_sent_messages()
        processed = 0
        already = 0
        fresh = 0
        for raw in numbers:
            if STOP_EVENT.is_set():
                break
            number = str(raw).replace('+','').replace(' ','').replace('-','').strip()
            if not number:
                continue
            status = 'UNKNOWN'
            previously = is_message_already_sent(number, sent_contacts)
            status = 'SENT_BEFORE' if previously else 'NOT_SENT'
            if search_and_open_chat(driver, number):
                logging.info(f"[CHECK] {number}: {status}")
            else:
                logging.info(f"[CHECK] {number}: CHAT_OPEN_FAILED")
            processed += 1
            already += 1 if previously else 0
            fresh += 0 if previously else 1
            if DELAY_BETWEEN_CONTACTS[0] or DELAY_BETWEEN_CONTACTS[1]:
                controlled_sleep( (DELAY_BETWEEN_CONTACTS[0]+DELAY_BETWEEN_CONTACTS[1])/2.0 ,"between checks")
        logging.info(f"CHECK SUMMARY: Total={processed} PreviouslySent={already} NotSent={fresh}")
    finally:
        logging.info("Check-only session complete. Browser left open for manual review.")

def show_duplicate_prevention_info(sent_contacts, total_contacts):
    """Show information about duplicate prevention"""
    if CHECK_DUPLICATES:
        logging.info(f"🔄 Duplicate Prevention: ENABLED")
        logging.info(f"📋 Previously sent: {len(sent_contacts)} contacts")
        logging.info(f"📊 Total contacts: {total_contacts} contacts")
        if sent_contacts:
            logging.info(f"⏭️  Will skip {len(sent_contacts)} previously sent contacts")
    else:
        logging.info(f"🔄 Duplicate Prevention: DISABLED")
        logging.info(f"⚠️  Messages may be sent multiple times to same contact")

def balance_spreadsheet_data(data):
    """Automatically balance spreadsheet data by duplicating/removing intro messages"""
    logging.info("Balancing spreadsheet data...")
    
    # Get the intro message from the first row
    if len(data) > 0:
        first_intro = data.iloc[0]['IntroMessage'] if 'IntroMessage' in data.columns else ""
        logging.info(f"Using intro message: {first_intro[:50]}{'...' if len(first_intro) > 50 else ''}")
        
        # Create a new dataframe with balanced data
        balanced_data = []
        
        for idx, row in data.iterrows():
            # Convert number to string and clean it properly
            raw_number = row['Number']
            if pd.isna(raw_number):
                logging.warning(f"Skipping row {idx + 1}: NaN number")
                continue
                
            # Convert to string and remove .0 if it's a float
            number = str(raw_number).replace(".0", "").replace("+", "").replace(" ", "").strip()
            name = row.get('Name', '') if 'Name' in data.columns else ''
            
            # Skip invalid numbers
            if not number or number.lower() == 'nan':
                logging.warning(f"Skipping row {idx + 1}: Invalid number")
                continue
            
            # Create balanced row with same intro message
            balanced_row = {
                'Number': number,  # Use cleaned number
                'IntroMessage': first_intro
            }
            
            # Add Name column if it exists
            if 'Name' in data.columns:
                balanced_row['Name'] = name
            
            balanced_data.append(balanced_row)
        
        # Convert back to DataFrame
        balanced_df = pd.DataFrame(balanced_data)
        
        logging.info(f"Data balanced: {len(balanced_df)} contacts with same intro message")
        logging.info(f"Original data: {len(data)} rows")
        logging.info(f"Balanced data: {len(balanced_df)} rows")
        
        return balanced_df
    
    return data

def show_data_balance_info(original_data, balanced_data):
    """Show information about data balancing"""
    original_count = len(original_data)
    balanced_count = len(balanced_data)
    
    logging.info("📊 DATA BALANCING SUMMARY:")
    logging.info(f"  📋 Original rows: {original_count}")
    logging.info(f"  ⚖️  Balanced rows: {balanced_count}")
    
    if balanced_count > original_count:
        logging.info(f"  ➕ Added {balanced_count - original_count} rows")
    elif balanced_count < original_count:
        logging.info(f"  ➖ Removed {original_count - balanced_count} rows")
    else:
        logging.info(f"  ✅ No changes needed")
    
    # Show sample of balanced data
    if len(balanced_data) > 0:
        logging.info("  📝 Sample balanced data:")
        for i, row in balanced_data.head(3).iterrows():
            number = row.get('Number', 'N/A')
            name = row.get('Name', 'N/A')
            intro = row.get('IntroMessage', 'N/A')
            logging.info(f"    Row {i+1}: Number='{number}', Name='{name}', Intro='{intro[:30]}{'...' if len(intro) > 30 else ''}'")

# ====== MAIN EXECUTION ======
def run_campaign():
    logging.info("Starting WhatsApp Bulk Sender...")
    sync_only = ('--sync-only' in sys.argv) or (os.environ.get('SYNC_ONLY', '0') == '1')
    if sync_only:
        logging.info("SYNC-ONLY MODE: Will open WhatsApp Web without sending messages.")
        logging.info("Set SYNC_DURATION env var to a number of seconds to auto-exit, or leave 0 for manual CTRL+C.")
    # Skip data loading entirely if in sync-only mode
    if not sync_only:
        if MANUAL_DATA is not None:
            data = MANUAL_DATA.copy()
            logging.info(f"Using MANUAL DATA: {len(data)} contacts provided via GUI")
        else:
            try:
                logging.info("Fetching Google Sheet data...")
                data = pd.read_csv(GOOGLE_SHEET_CSV_URL)
                required_cols = ['Number', 'IntroMessage']
                present_cols = [c for c in required_cols if c in data.columns]
                data = data.dropna(subset=present_cols)
                logging.info(f"Loaded {len(data)} contacts from spreadsheet")
                
                # Debug: Show data info
                logging.info(f"Data shape: {data.shape}")
                logging.info(f"Data columns: {list(data.columns)}")
                logging.info(f"First few rows:")
                for i, row in data.head(3).iterrows():
                    logging.info(f"  Row {i}: Number='{row.get('Number', 'N/A')}', Message='{row.get('IntroMessage', 'N/A')}'")
                
                # Balance the data (duplicate/remove intro messages as needed)
                original_data = data.copy()
                if AUTO_BALANCE_DATA:
                    data = balance_spreadsheet_data(data)
                    show_data_balance_info(original_data, data)
                else:
                    logging.info("Data balancing is disabled. Using original data.")
                
            except Exception as e:
                logging.error(f"Failed to load data: {str(e)}")
                return
    
    logging.info("Setting up Chrome driver...")
    driver = setup_driver()
    global CURRENT_DRIVER
    CURRENT_DRIVER = driver
    
    try:
        logging.info("Loading WhatsApp Web...")
        driver.get("https://web.whatsapp.com")
        if not wait_for_whatsapp_load(driver):
            logging.error("Failed to load WhatsApp Web. Please check your internet connection and try again.")
            return

        if sync_only:
            logging.info("SYNC-ONLY MODE: WhatsApp loaded. Chats will sync using your persistent profile.")
            if SYNC_DURATION > 0:
                logging.info(f"Will keep browser open for {SYNC_DURATION} seconds then exit (browser stays open until manually closed).")
                try:
                    end_time = time.time() + SYNC_DURATION
                    while time.time() < end_time:
                        time.sleep(1)
                except KeyboardInterrupt:
                    logging.info("Sync-only session interrupted by user.")
            else:
                logging.info("Press CTRL+C to end sync-only session (browser will remain open).")
                try:
                    while True:
                        time.sleep(60)
                except KeyboardInterrupt:
                    logging.info("Sync-only session ended by user.")
            logging.info("Exiting sync-only mode without sending messages.")
            return
        
        success_count = 0
        failed_contacts = []
        processed_count = 0
        skipped_duplicates = 0
        
        logging.info(f"Starting to process {len(data)} contacts...")
        logging.info(f"Batch processing: {BATCH_SIZE} contacts per batch, {BATCH_DELAY} seconds between batches")
        
        # Calculate total batches
        total_batches = (len(data) + BATCH_SIZE - 1) // BATCH_SIZE
        current_batch = 1
        contacts_in_current_batch = 0
        
        sent_contacts = load_sent_messages()
        show_duplicate_prevention_info(sent_contacts, len(data))
        
        for idx, row in data.iterrows():
            if STOP_EVENT.is_set():
                logging.info("Stop flag detected. Exiting loop.")
                break
            while not PAUSE_EVENT.is_set():
                time.sleep(0.2)
            # Convert number to string and clean it properly
            raw_number = row['Number']
            if pd.isna(raw_number):
                logging.warning(f"Skipping contact {idx + 1}: NaN number")
                failed_contacts.append({"number": "NaN", "reason": "NaN number"})
                continue
                
            # Convert to string and remove .0 if it's a float
            number = str(raw_number).replace(".0", "").replace("+", "").replace(" ", "").strip()
            name = row.get('Name', '') if 'Name' in data.columns else ''
            intro_msg = str(row['IntroMessage']).strip()
            
            # Show batch progress at the start of each batch
            if processed_count % BATCH_SIZE == 0:
                show_batch_progress(current_batch, total_batches, contacts_in_current_batch, processed_count)
            
            logging.info(f"=== Processing contact {idx + 1}/{len(data)}: {number} ===")
            
            # Skip if number is empty or invalid
            if not number or number.lower() == 'nan':
                logging.warning(f"Skipping contact {idx + 1}: Invalid number")
                failed_contacts.append({"number": number, "reason": "Invalid number"})
                continue
            
            # Check if message already sent
            if is_message_already_sent(number, sent_contacts):
                logging.info(f"⏭️  SKIPPING {number} - already received intro message")
                skipped_duplicates += 1
                continue
            
            if not search_and_open_chat(driver, number, name):
                logging.error(f"Could not open chat for {number}")
                failed_contacts.append({"number": number, "reason": "Could not open chat"})
                continue
            
            controlled_sleep(2, "post chat open before sending intro")
            
            intro_success = True
            if intro_msg and intro_msg.lower() != 'nan':
                if send_message(driver, intro_msg):
                    logging.info(f"✅ Intro message sent to {number}")
                    controlled_sleep(1, "post send assurance")
                    # Save to sent messages log
                    save_sent_message(number, name, intro_msg)
                    # Add to sent contacts set for current session
                    sent_contacts.add(number)
                else:
                    logging.error(f"❌ Failed to send intro message to {number}")
                    failed_contacts.append({"number": number, "reason": "Failed to send intro message"})
                    intro_success = False
            else:
                logging.info(f"No intro message for {number}, skipping message send")
            
            if intro_success:
                success_count += 1
                logging.info(f"SUCCESS: Contact {number} processed successfully")
            else:
                logging.warning(f"PARTIAL FAILURE: Contact {number} had issues")
            
            processed_count += 1
            contacts_in_current_batch += 1
            logging.info(f"Progress: {processed_count}/{len(data)} contacts processed")
            
            # Check if we need to take a batch break
            if processed_count % BATCH_SIZE == 0 and idx < len(data) - 1:
                logging.info(f"🎯 BATCH {current_batch} COMPLETED: {processed_count} contacts processed")
                logging.info(f"✅ Successfully processed: {success_count} contacts")
                logging.info(f"⏭️  Skipped duplicates: {skipped_duplicates} contacts")
                logging.info(f"❌ Failed: {len(failed_contacts)} contacts")
                
                # Take batch break
                batch_delay()
                
                # Prepare for next batch
                current_batch += 1
                contacts_in_current_batch = 0
                logging.info(f"🚀 STARTING BATCH {current_batch}")
            
            logging.info(f"DEBUG: processed_count={processed_count}, CONTACT_LIMIT={CONTACT_LIMIT}")
            if processed_count >= CONTACT_LIMIT:
                logging.info(f"Reached contact limit of {CONTACT_LIMIT}, stopping...")
                break
                
            if idx < len(data) - 1 and not STOP_EVENT.is_set():
                random_delay()
            else:
                logging.info("All contacts processed!")
        
        logging.info("Campaign completed!")
        logging.info(f"✅ Successfully sent to {success_count} contacts")
        logging.info(f"⏭️  Skipped duplicates: {skipped_duplicates} contacts")
        logging.info(f"❌ Failed to send to {len(failed_contacts)} contacts")
        
        if failed_contacts:
            logging.info("Failed contacts:")
            for contact in failed_contacts:
                logging.info(f"  - {contact['number']}: {contact['reason']}")
    
    except KeyboardInterrupt:
        logging.info("Campaign stopped by user")
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
    finally:
        logging.info("Campaign completed. Browser will remain open for manual review.")
        logging.info("You can manually close the browser when you're done.")
        # Keep browser open - don't call driver.quit()
        # try:
        #     driver.quit()
        # except:
        #     pass

def main():
    run_campaign()

if __name__ == "__main__":
    main()