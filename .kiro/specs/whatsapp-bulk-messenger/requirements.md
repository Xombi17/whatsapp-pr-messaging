# Requirements Document

## Introduction

This feature enables automated bulk messaging through WhatsApp Web for hackathon promotion and event registration campaigns. The system reads phone numbers from an Excel file, opens WhatsApp Web in Chrome, and automatically sends promotional messages along with hackathon brochures to potential participants without requiring users to save phone numbers to their contacts. This solution is designed for event organizers who need to reach out to multiple potential participants efficiently to increase hackathon registrations.

## Requirements

### Requirement 1

**User Story:** As a hackathon organizer, I want to send WhatsApp messages to multiple phone numbers from an Excel list, so that I can reach potential participants without manually adding each number to my contacts.

#### Acceptance Criteria

1. WHEN the system reads an Excel file THEN it SHALL extract phone numbers in international format (e.g., 919876543210)
2. WHEN a phone number is processed THEN the system SHALL open WhatsApp Web with that number without saving it to contacts
3. WHEN WhatsApp Web loads THEN the system SHALL automatically send the predefined intro message to the recipient
4. Attach an image for preview and
4. IF a phone number is invalid or unreachable THEN the system SHALL log the error and continue with the next number

### Requirement 2

**User Story:** As a hackathon organizer, I want to send a structured message sequence with multiple attachments, so that I can provide comprehensive information about myself and the hackathon event.

#### Acceptance Criteria

1. WHEN sending to a recipient THEN the system SHALL send messages in this sequence: intro message → preview image → main PR message → PDF brochure
2. WHEN any file (preview image or PDF brochure) is missing THEN the system SHALL log a warning and continue with available content
3. WHEN files are corrupted or invalid THEN the system SHALL skip the problematic attachment and continue with the sequence
4. WHEN all content is available THEN the system SHALL send the complete 4-part message sequence with appropriate delays between each part

### Requirement 3

**User Story:** As a user, I want to authenticate with WhatsApp Web once per session, so that I can send messages without repeatedly scanning QR codes.

#### Acceptance Criteria

1. WHEN the script runs for the first time THEN the system SHALL open Chrome and display WhatsApp Web QR code
2. WHEN the user scans the QR code THEN the system SHALL maintain the session for subsequent messages
3. WHEN the session expires THEN the system SHALL prompt the user to scan the QR code again
4. WHEN authentication is successful THEN the system SHALL proceed with message sending automatically

### Requirement 4

**User Story:** As a hackathon organizer, I want to customize multiple message components, so that I can craft a compelling personal introduction and promotional content.

#### Acceptance Criteria

1. WHEN configuring the script THEN the user SHALL be able to set a custom intro message about themselves
2. WHEN configuring the script THEN the user SHALL be able to set a custom main PR message about the hackathon
3. WHEN sending messages THEN the system SHALL use both predefined messages in the correct sequence for all recipients
4. WHEN messages contain placeholders THEN the system SHALL replace them with recipient-specific data if available
5. WHEN either message is empty THEN the system SHALL skip that part of the sequence and continue with available content

### Requirement 5

**User Story:** As a hackathon organizer, I want to include both a preview image and a PDF brochure, so that I can provide visual appeal and detailed information about the hackathon.

#### Acceptance Criteria

1. WHEN the script starts THEN the system SHALL verify the presence of both preview image and PDF brochure files in the script directory
2. WHEN sending the preview image THEN the system SHALL attach the image file after the intro message
3. WHEN sending the PDF brochure THEN the system SHALL attach the PDF file after the main PR message
4. WHEN either file is missing THEN the system SHALL log a warning but continue with the available files
5. WHEN file upload fails THEN the system SHALL retry once before continuing to the next part of the sequence

### Requirement 7

**User Story:** As a user, I want to track the progress of message sending, so that I can monitor the success rate and identify any issues.

#### Acceptance Criteria

1. WHEN the script starts THEN the system SHALL display the total number of recipients to process
2. WHEN each message is sent THEN the system SHALL log the success status with recipient number
3. WHEN an error occurs THEN the system SHALL log the error details and continue processing
4. WHEN all messages are processed THEN the system SHALL display a summary report with success/failure counts

### Requirement 8

**User Story:** As a user, I want the system to handle rate limiting and delays, so that my account doesn't get blocked by WhatsApp for spam.

#### Acceptance Criteria

1. WHEN sending messages THEN the system SHALL implement delays between each message (configurable, default 5-10 seconds)
2. WHEN WhatsApp detects unusual activity THEN the system SHALL pause and wait for user intervention
3. WHEN rate limits are hit THEN the system SHALL implement exponential backoff strategy
4. WHEN the session is blocked THEN the system SHALL notify the user and pause execution