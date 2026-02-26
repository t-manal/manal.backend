// POLICY: Centralized upload and body size limits
// These values are configurable policy settings, not architectural constraints
// They can be adjusted via environment variables or this config file

export const UPLOAD_LIMITS = {
    IMAGE: 5 * 1024 * 1024,        // POLICY: 5MB for thumbnails, avatars, generic uploads
    LOGO: 2 * 1024 * 1024,         // POLICY: 2MB for university logos
    PDF: 100 * 1024 * 1024,        // POLICY: 100MB for lesson documents (PDF/PPTX/DOC/TXT)
    CHUNK: 5 * 1024 * 1024,        // POLICY: 5MB per chunk (matches frontend CHUNK_SIZE)
    MAX_TOTAL_FILE: 500 * 1024 * 1024, // POLICY: 500MB max total file size for chunked uploads
    MAX_BODY_SIZE: '30mb'          // POLICY: 30MB max for JSON/urlencoded body (prevents DoS via large payloads)
} as const;
