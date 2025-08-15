import os
import sys
import time
import random
import logging
from datetime import datetime
import pandas as pd
import pyperclip
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
        logging.FileHandler(f'whatsapp_sender_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)

# ====== CONFIG ======
GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRW84c1YtBx33dt8e5i57wgvgc3JKSgXiSgNYGf5L5huBCfkcEo6pTI2NSevcUwue1zdeV5mqgiQQtN/pub?gid=0&single=true&output=csv"
USE_BETA_UI = True  # Prioritize WhatsApp Web Beta UI selectors
# Speed controls (override via env)
DELAY_BETWEEN_CONTACTS = (
    int(os.environ.get('DELAY_MIN', '2')),
    int(os.environ.get('DELAY_MAX', '5')),
)
PERSISTENT_PROFILE_DIR = r"./chrome_profile"
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '2'))
CHAT_LOAD_TIMEOUT = int(os.environ.get('CHAT_LOAD_TIMEOUT', '20'))
MESSAGE_SEND_TIMEOUT = int(os.environ.get('MESSAGE_SEND_TIMEOUT', '5'))
WHATSAPP_LOAD_TIMEOUT = int(os.environ.get('WHATSAPP_LOAD_TIMEOUT', '45'))

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
logging.info(f"Configuration loaded:")
logging.info(f"  CONTACT_LIMIT: {CONTACT_LIMIT}")
logging.info(f"  DELAY_BETWEEN_CONTACTS: {DELAY_BETWEEN_CONTACTS}")
logging.info(f"  MAX_RETRIES: {MAX_RETRIES}")

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
        time.sleep(2)  # Increased from 0.1 to 2 seconds
        
        # Multiple chat indicators for better reliability
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
            time.sleep(1)  # Increased from 0.1 to 1 second
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
        time.sleep(3)
        
        # Multiple search box selectors for better reliability
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
                time.sleep(0.5)
                search_box.clear()
                search_box.send_keys(str(search_term))
                time.sleep(3)
                
                # Multiple result selectors for better reliability
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
                        time.sleep(3)
                        
                        # Check if chat is actually opened
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
        message_selectors = ["//*[@data-testid='conversation-compose-box-input']" if USE_BETA_UI else None, "//*[@data-testid='compose-box-input']" if USE_BETA_UI else None, "//div[@contenteditable='true'][@data-tab='10']", "//div[@contenteditable='true'][contains(@class, 'selectable-text')]", "//div[@role='textbox'][@contenteditable='true']", "//div[contains(@class, '_13NKt')][@contenteditable='true']"]
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
        time.sleep(0.3)
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
                    time.sleep(0.3)
        message_box.send_keys(Keys.ENTER)
        time.sleep(0.3)
        logging.info("SUCCESS: Message sent")
        return True
    except Exception as e:
        if retry_count < MAX_RETRIES:
            logging.warning(f"Message send failed, retrying... ({retry_count + 1}/{MAX_RETRIES})")
            time.sleep(3)
            return send_message(driver, message, retry_count + 1)
        else:
            logging.error(f"FAILED: Could not send message after {MAX_RETRIES} attempts - {str(e)}")
            return False

def random_delay():
    """Generate random delay between contacts to appear more human-like"""
    delay = random.randint(DELAY_BETWEEN_CONTACTS[0], DELAY_BETWEEN_CONTACTS[1])
    logging.info(f"Waiting {delay} seconds before next contact...")
    time.sleep(delay)

# ====== MAIN EXECUTION ======
def main():
    logging.info("Starting WhatsApp Bulk Sender...")
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
        
    except Exception as e:
        logging.error(f"Failed to load data: {str(e)}")
        return
    
    logging.info("Setting up Chrome driver...")
    driver = setup_driver()
    
    try:
        logging.info("Loading WhatsApp Web...")
        driver.get("https://web.whatsapp.com")
        if not wait_for_whatsapp_load(driver):
            logging.error("Failed to load WhatsApp Web. Please check your internet connection and try again.")
            return
        
        success_count = 0
        failed_contacts = []
        processed_count = 0
        
        logging.info(f"Starting to process {len(data)} contacts...")
        
        for idx, row in data.iterrows():
            number = str(row['Number']).replace("+", "").replace(" ", "").strip()
            name = row.get('Name', '') if 'Name' in row else ''
            intro_msg = str(row['IntroMessage']).strip()
            
            logging.info(f"=== Processing contact {idx + 1}/{len(data)}: {number} ===")
            
            # Skip if number is empty or invalid
            if not number or number.lower() == 'nan':
                logging.warning(f"Skipping contact {idx + 1}: Invalid number")
                failed_contacts.append({"number": number, "reason": "Invalid number"})
                continue
            
            if not search_and_open_chat(driver, number, name):
                logging.error(f"Could not open chat for {number}")
                failed_contacts.append({"number": number, "reason": "Could not open chat"})
                continue
            
            time.sleep(2)
            
            intro_success = True
            if intro_msg and intro_msg.lower() != 'nan':
                if send_message(driver, intro_msg):
                    logging.info(f"Intro message sent to {number}")
                    time.sleep(1)  # Small delay to ensure message is processed
                else:
                    logging.error(f"Failed to send intro message to {number}")
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
            logging.info(f"Progress: {processed_count}/{len(data)} contacts processed")
            
            logging.info(f"DEBUG: processed_count={processed_count}, CONTACT_LIMIT={CONTACT_LIMIT}")
            if processed_count >= CONTACT_LIMIT:
                logging.info(f"Reached contact limit of {CONTACT_LIMIT}, stopping...")
                break
                
            if idx < len(data) - 1:
                random_delay()
            else:
                logging.info("All contacts processed!")
        
        logging.info("Campaign completed!")
        logging.info(f"Successfully sent to {success_count} contacts")
        logging.info(f"Failed to send to {len(failed_contacts)} contacts")
        
        if failed_contacts:
            logging.info("Failed contacts:")
            for contact in failed_contacts:
                logging.info(f"  - {contact['number']}: {contact['reason']}")
    
    except KeyboardInterrupt:
        logging.info("Campaign stopped by user")
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
    finally:
        logging.info("Closing browser...")
        try:
            driver.quit()
        except:
            pass

if __name__ == "__main__":
    main()