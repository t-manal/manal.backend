import { Worker, Job } from 'bullmq';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { BunnyStorageProvider as StorageService } from '../services/storage/bunny-storage.provider';
import { WATERMARK_BRAND, WATERMARK_PHONE } from '../constants/watermark';
import libre from 'libreoffice-convert';
import util from 'util';
import IORedis from 'ioredis';

const convertAsync = util.promisify(libre.convert);

const prisma = new PrismaClient();
const storageService = new StorageService();

interface PdfJobData {
  sourceKey: string;
  sourceMime: string;
  originalName: string;
  partFileId: string;
  adminName?: string;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function inferExtension(sourceMime: string, originalName: string): string {
  switch (sourceMime) {
    case 'application/pdf': return '.pdf';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return '.pptx';
    case 'application/vnd.ms-powerpoint': return '.ppt';
    case 'application/msword': return '.doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return '.docx';
    case 'text/plain': return '.txt';
  }

  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName) return fromName;

  return '.bin';
}

function logWorkerError(category: string, jobId: string, partFileId: string, sourceKey: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[PDF Worker][${category}] jobId=${jobId} partFileId=${partFileId} sourceKey=${sourceKey} error=${message}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Support Railway REDIS_URL with TLS (rediss://)
const connection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    })
  : new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null,
    });

export const pdfWorker = new Worker<PdfJobData>(
  'pdf-processing',
  async (job: Job<PdfJobData>) => {
    const { sourceKey, sourceMime, originalName, partFileId } = job.data;
    const jobId = String(job.id ?? 'unknown');
    console.log(`[PDF Worker] Processing job ${jobId} for PartFile ${partFileId} sourceKey=${sourceKey}`);
    
    // Smoke Test: Check LibreOffice Availability
    try {
        const { execSync } = require('child_process');
        // Try soffice or libreoffice
        try {
            const version = execSync('soffice --version', { encoding: 'utf8' }).trim();
            console.log(`[PDF Worker] LibreOffice Check: Detected (${version})`);
        } catch (e) {
            console.warn(`[PDF Worker] LibreOffice Check: 'soffice' command failed. Trying default path...`);
        }
    } catch(err) {
        console.warn(`[PDF Worker] LibreOffice Check: Failed to execute smoke test.`);
    }

    try {
      console.log(`[PDF Worker] Step 1: Updating status to PROCESSING for ${partFileId}`);
      await prisma.partFile.update({
        where: { id: partFileId },
        data: { renderStatus: 'PROCESSING' },
      });

      // 2. Download source file from shared storage
      console.log(`[PDF Worker] Step 2: Downloading source from storage. sourceKey=${sourceKey}`);
      let sourceBytes: Buffer;
      try {
        const sourceStream = await storageService.downloadStream(sourceKey);
        sourceBytes = await streamToBuffer(sourceStream);
      } catch (error) {
        logWorkerError('SOURCE_NOT_FOUND', jobId, partFileId, sourceKey, error);
        throw error;
      }

      // 3. Normalize to PDF (Universal Doc Support)
      let pdfBytes: Buffer;
      const ext = inferExtension(sourceMime, originalName);
      
      console.log(`[PDF Worker] Step 3: Normalization. Extension: ${ext}`);

      if (ext !== '.pdf') {
          console.log(`[PDF Worker] Converting ${ext} to PDF using libreoffice...`);
          try {
            pdfBytes = await convertAsync(sourceBytes, 'pdf', undefined);
          } catch (error) {
            logWorkerError('CONVERT_FAILED', jobId, partFileId, sourceKey, error);
            throw error;
          }
          console.log(`[PDF Worker] Conversion successful. New Buffer Size: ${pdfBytes.length}`);
      } else {
          console.log(`[PDF Worker] File is already PDF. Using source bytes directly.`);
          pdfBytes = sourceBytes;
      }

      // 4. Load PDF for Watermarking
      console.log(`[PDF Worker] Step 4: Loading PDF Document for Watermarking...`);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // 5. Watermark Pages
      const pages = pdfDoc.getPages();
      const brandFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const phoneFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      console.log(`[PDF Worker] Step 5: Applying Watermark '${WATERMARK_BRAND} / ${WATERMARK_PHONE}' to ${pages.length} pages...`);

      pages.forEach((page) => {
        const { width, height } = page.getSize();

        const minSide = Math.min(width, height);
        const brandSize = clamp(minSide * 0.052, 18, 44);
        const phoneSize = clamp(minSide * 0.032, 12, 24);
        const footerSize = clamp(minSide * 0.018, 8, 12);

        const brandWidth = brandFont.widthOfTextAtSize(WATERMARK_BRAND, brandSize);
        const phoneWidth = phoneFont.widthOfTextAtSize(WATERMARK_PHONE, phoneSize);
        const footerText = `${WATERMARK_BRAND} | ${WATERMARK_PHONE}`;
        const footerWidth = phoneFont.widthOfTextAtSize(footerText, footerSize);

        const centerX = width / 2;
        const centerY = height / 2;
        const rotation = degrees(34);

        page.drawText(WATERMARK_BRAND, {
          x: centerX - brandWidth / 2,
          y: centerY + brandSize * 0.45,
          size: brandSize,
          font: brandFont,
          color: rgb(0.44, 0.44, 0.44),
          opacity: 0.18,
          rotate: rotation,
        });

        page.drawText(WATERMARK_PHONE, {
          x: centerX - phoneWidth / 2,
          y: centerY - phoneSize * 1.25,
          size: phoneSize,
          font: phoneFont,
          color: rgb(0.4, 0.4, 0.4),
          opacity: 0.22,
          rotate: rotation,
        });

        page.drawText(footerText, {
          x: width - footerWidth - 24,
          y: 16,
          size: footerSize,
          font: phoneFont,
          color: rgb(0.42, 0.42, 0.42),
          opacity: 0.22,
        });
      });

      // 6. Save processed PDF
      console.log('[PDF Worker] Step 6: Serializing watermarked PDF...');
      const processedPdfBytes = await pdfDoc.save();
      
      // Mock Multer File for the provider
      const filePayload: any = {
        buffer: processedPdfBytes,
        mimetype: 'application/pdf',
        originalname: `${path.parse(originalName || `${partFileId}`).name}.pdf`
      };

      // 7. Upload to Bunny (Secure/Private Zone)
      const destinationPath = `/secured/${partFileId}.pdf`; 
      console.log(`[PDF Worker] Step 7: Uploading to Bunny Storage at ${destinationPath}...`);
      try {
        await storageService.uploadPrivate(filePayload, destinationPath);
      } catch (error) {
        logWorkerError('UPLOAD_FAILED', jobId, partFileId, sourceKey, error);
        throw error;
      }
      console.log(`[PDF Worker] Upload successful.`);

      // 8. Update DB Status
      console.log(`[PDF Worker] Step 8: Updating DB Record to COMPLETED...`);
      try {
        await prisma.partFile.update({
          where: { id: partFileId },
          data: { 
            renderStatus: 'COMPLETED',
            storageKey: destinationPath,
            title: path.parse(originalName || `${partFileId}`).name + '.pdf',
            pageCount: pages.length // FIX: Phase 10-FINAL - Ensure page count is saved
          },
        });
      } catch (error) {
        logWorkerError('DB_UPDATE_FAILED', jobId, partFileId, sourceKey, error);
        throw error;
      }

      // 9. Cleanup staged source file (best effort)
      try {
        await storageService.delete(sourceKey);
        console.log(`[PDF Worker] Step 9: Deleted staged source file. sourceKey=${sourceKey}`);
      } catch (error) {
        console.warn(`[PDF Worker] Step 9: Failed to delete staged source file. sourceKey=${sourceKey}`);
      }

      console.log(`[PDF Worker] Job ${jobId} completed successfully. partFileId=${partFileId} sourceKey=${sourceKey}`);

    } catch (error: any) {
      console.error(`[PDF Worker] CRITICAL ERROR jobId=${jobId} partFileId=${partFileId} sourceKey=${sourceKey}:`, error);
      
      try {
          await prisma.partFile.update({
            where: { id: partFileId },
            data: { renderStatus: 'FAILED' },
          });
          console.log(`[PDF Worker] Marked job ${jobId} as FAILED in DB.`);
      } catch (dbError) {
          logWorkerError('DB_UPDATE_FAILED', jobId, partFileId, sourceKey, dbError);
      }

      throw error;
    }
  },
  { connection }
);

console.log('[PDF Worker] Worker Service Initialized and Listening...');

pdfWorker.on('completed', (job) => {
  const partFileId = job.data?.partFileId || 'unknown';
  const sourceKey = job.data?.sourceKey || 'unknown';
  console.log(`[PDF Worker] Job ${job.id} has completed! partFileId=${partFileId} sourceKey=${sourceKey}`);
});

pdfWorker.on('failed', (job, err) => {
  const partFileId = job?.data?.partFileId || 'unknown';
  const sourceKey = job?.data?.sourceKey || 'unknown';
  console.error(`[PDF Worker] Job ${job?.id} has failed with ${err.message}. partFileId=${partFileId} sourceKey=${sourceKey}`);
});
