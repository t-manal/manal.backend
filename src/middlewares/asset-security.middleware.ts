
import { Request, Response, NextFunction } from 'express';

/**
 * RELAXED CSP FOR ASSET FRAMING
 * 
 * Allows the Student Frontend (http://localhost:3000) to embed this response in an iframe.
 * Required for PDF/PPTX viewing in the student portal.
 * 
 * POLICY:
 * - Content-Security-Policy: frame-ancestors 'self' http://localhost:3000
 * - X-Frame-Options: REMOVED (Strict XFO blocks framing even with CSP)
 */
export const assetFramingGuard = (req: Request, res: Response, next: NextFunction) => {
    // 1. Allow iframe embedding from localhost:3000
    res.setHeader(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://student-frontend-bice.vercel.app"
    );

    // 2. Remove strict X-Frame-Options (Helmet default is SAMEORIGIN, which blocks localhost:3000)
    res.removeHeader('X-Frame-Options');

    next();
};
