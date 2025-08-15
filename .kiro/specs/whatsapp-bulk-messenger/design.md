# Design Document

## Overview

The WhatsApp Bulk Messenger is a Python-based automation tool that uses Selenium WebDriver to interact with WhatsApp Web for sending structured promotional messages. The system reads contact data from Excel files and sends a 4-part message sequence: personal introduction, preview image, main promotional message, and PDF brochure. The design emphasizes reliability, rate limiting, and user experience while maintaining WhatsApp's terms of service compliance.

## Architecture

The system is a simple command-line script with modular functions:

```
main.py (Entry Point)
├── Excel Reader Functions
│   ├── load_contacts_from_excel()
│   ├── validate_phone_number()
│   └── format_international_number()
├── WhatsApp Automation Functions  
│   ├── initialize_whatsapp_driver()
│   ├── authenticate_session()
│   ├── send_message_sequence()
│   └── upload_file()
├── File Management Functions
│   ├── validate_required_files()
│   ├── get_file_paths()
│   └── check_file_sizes()
└── Utility Functions
    ├── apply_delay()
    ├── log_progress()
    └── handle_errors()
```

## Components and Interfaces

### 1. Excel Reader Component
**Purpose:** Parse Excel files and extract phone numbers with validation

**Interface:**
```python
class ExcelReader:
    def load_contacts(self, file_path: str) -> List[Contact]
    def validate_phone_number(self, phone: str) -> bool
    def format_international(self, phone: str) -> str
```

**Key Features:**
- Supports .xlsx and .xls formats
- International phone number validation
- Duplicate detection and removal
- Error handling for malformed data

### 2. WhatsApp Driver Component
**Purpose:** Selenium-based WhatsApp Web automation

**Interface:**
```python
class WhatsAppDriver:
    def initialize_browser(self) -> None
    def authenticate_session(self) -> bool
    def send_message_sequence(self, contact: Contact, messages: MessageSequence) -> bool
    def upload_file(self, file_path: str) -> bool
    def wait_for_element(self, selector: str, timeout: int) -> WebElement
```

**Key Features:**
- Chrome WebDriver with persistent session
- QR code authentication handling
- Element waiting and error recovery
- File upload automation for images and PDFs

### 3. Message Processing Functions
**Purpose:** Process contacts list with rate limiting and retry logic

**Functions:**
```python
def process_contacts(contacts: List[dict], driver) -> None
def send_to_single_contact(contact: dict, driver) -> bool
def apply_rate_limit(delay_seconds: int) -> None
def retry_failed_contact(contact: dict, driver, max_retries: int) -> bool
```

**Key Features:**
- Simple loop through contacts with delays
- Configurable delays between messages (5-10 seconds default)
- Basic retry logic for failures
- Console progress output

### 4. File Manager Component
**Purpose:** Handle file validation and path management

**Interface:**
```python
class FileManager:
    def validate_files(self) -> ValidationResult
    def get_preview_image_path(self) -> str
    def get_pdf_brochure_path(self) -> str
    def check_file_exists(self, file_path: str) -> bool
```

**Key Features:**
- File existence validation at startup
- Supported formats: JPG, PNG for images; PDF for brochures
- File size validation (WhatsApp limits)
- Path resolution and error handling

## Data Models

### Contact Model
```python
@dataclass
class Contact:
    phone_number: str
    name: Optional[str] = None
    country_code: str = "91"  # Default to India
    status: MessageStatus = MessageStatus.PENDING
    retry_count: int = 0
    last_attempt: Optional[datetime] = None
```

### Message Sequence Model
```python
@dataclass
class MessageSequence:
    intro_message: str
    preview_image_path: str
    main_pr_message: str
    pdf_brochure_path: str
    delays: MessageDelays = MessageDelays()
```

### Configuration (Simple Variables)
```python
# Configuration at top of script
EXCEL_FILE = "contacts.xlsx"
INTRO_MESSAGE = "Hi! I'm [Your Name], organizing an exciting hackathon..."
MAIN_PR_MESSAGE = "🚀 Join our hackathon! Amazing prizes and learning opportunities..."
PREVIEW_IMAGE = "hackathon_preview.jpg"
PDF_BROCHURE = "hackathon_brochure.pdf"
MESSAGE_DELAY = 7  # seconds between messages
MAX_RETRIES = 3
```

## Error Handling

### Error Categories and Responses

1. **Authentication Errors**
   - QR code timeout → Prompt user to rescan
   - Session expired → Automatic re-authentication
   - Account blocked → Pause execution, notify user

2. **File Errors**
   - Missing files → Log warning, continue with available content
   - Upload failures → Retry once, then skip file
   - Invalid file formats → Validate at startup, reject invalid files

3. **Network Errors**
   - Connection timeout → Retry with exponential backoff
   - WhatsApp Web unavailable → Pause and retry later
   - Rate limiting detected → Increase delays automatically

4. **Data Errors**
   - Invalid phone numbers → Skip and log error
   - Excel parsing errors → Show detailed error message
   - Empty contact list → Terminate with clear message

### Error Recovery Strategy
```python
class ErrorHandler:
    def handle_authentication_error(self) -> RecoveryAction
    def handle_file_upload_error(self, file_path: str) -> RecoveryAction
    def handle_rate_limit_error(self) -> RecoveryAction
    def handle_network_error(self) -> RecoveryAction
```

## Testing Strategy

### Unit Testing
- **Excel Reader:** Test phone number validation, format conversion, duplicate handling
- **File Manager:** Test file validation, path resolution, error conditions
- **Message Queue:** Test rate limiting, retry logic, queue persistence
- **Config Manager:** Test configuration loading, validation, defaults

### Integration Testing
- **WhatsApp Driver:** Test browser automation, element interactions (using test environment)
- **End-to-End Flow:** Test complete message sequence with mock WhatsApp interface
- **Error Scenarios:** Test recovery from various failure conditions

### Manual Testing
- **Authentication Flow:** Verify QR code scanning and session persistence
- **Message Delivery:** Confirm 4-part message sequence delivery
- **File Uploads:** Verify image and PDF attachment functionality
- **Rate Limiting:** Confirm delays prevent account blocking

### Test Data Management
```python
# Test fixtures for different scenarios
test_contacts = [
    Contact("919876543210", "Test User 1"),
    Contact("invalid_number", "Invalid User"),  # Error case
    Contact("447123456789", "UK User"),  # International
]

test_files = {
    "valid_image": "test_preview.jpg",
    "valid_pdf": "test_brochure.pdf",
    "missing_file": "nonexistent.jpg",
    "invalid_format": "document.txt"
}
```

## Security and Compliance Considerations

### WhatsApp Terms of Service
- Implement reasonable delays to avoid spam detection
- Respect rate limits and user privacy
- No automated account creation or contact scraping
- Clear user consent for message recipients

### Data Protection
- No persistent storage of phone numbers after execution
- Secure handling of user credentials and session data
- Option to clear browser data after completion
- Logging excludes sensitive information

### Rate Limiting Strategy
```python
class RateLimiter:
    base_delay: int = 7  # seconds
    max_delay: int = 60  # seconds
    backoff_multiplier: float = 1.5
    
    def calculate_delay(self, attempt_count: int) -> int
    def detect_rate_limiting(self, response_time: float) -> bool
    def adjust_delays_dynamically(self) -> None
```

## Performance Considerations

### Browser Optimization
- Use headless Chrome for better performance (optional)
- Implement browser profile persistence for faster startup
- Optimize element waiting strategies
- Memory management for long-running sessions

### File Handling Optimization
- Pre-validate all files before starting automation
- Implement file caching for repeated uploads
- Compress images if they exceed WhatsApp limits
- Batch file operations where possible

### Scalability Limits
- Recommended batch size: 50-100 contacts per session
- Memory usage scales with contact list size
- Browser session stability decreases over time
- Network bandwidth considerations for file uploads