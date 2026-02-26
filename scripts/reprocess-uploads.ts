
import { PrismaClient } from '@prisma/client';
import { BunnyStorageProvider } from '../src/services/storage/bunny-storage.provider';
import { Queue } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { WATERMARK_QUEUE_LABEL } from '../src/constants/watermark';

const prisma = new PrismaClient();
const storage = new BunnyStorageProvider();

// PDF Queue Connection
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const pdfQueue = new Queue('pdf-processing', { connection });

async function main() {
  console.log('Starting Reprocess Script...');

  // 1. Find PartFiles that are improperly stored (non-pdf extension)
  const candidates = await prisma.partFile.findMany({
    where: {
      type: 'PDF',
      NOT: {
        storageKey: {
            endsWith: '.pdf'
        }
      }
    }
  });

  console.log(`Found ${candidates.length} candidates for reprocessing.`);

  for (const file of candidates) {
    try {
        console.log(`Processing ${file.title} (${file.id})...`);
        const currentKey = file.storageKey;
        const ext = path.extname(currentKey) || '.bin';
        
        // 1. Download from Bunny
        console.log(`  Downloading from ${currentKey}...`);
        // Bunny downloadStream returns a stream. We need to save it.
        // But storage.downloadStream returns Axios response stream.
        // We can use a simpler approach if downloadStream isn't friendly for scripting:
        // Use download method if available? 
        // Checking BunnyStorageProvider... only has uploadPublic, uploadPrivate, downloadStream.
        
        const fileStream = await storage.downloadStream(currentKey);
        
        const tempPath = path.resolve(__dirname, `../temp/${file.id}-input${ext}`);
        await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
        
        const writer = fs.createWriteStream(tempPath);
        fileStream.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        console.log(`  Saved to ${tempPath}`);
        
        // 2. Queue for Processing
        await prisma.partFile.update({
            where: { id: file.id },
            data: { 
                renderStatus: 'PENDING',
                isSecure: true // Enforce security/conversion
            }
        });
        
        await pdfQueue.add('watermark-pdf', {
            filePath: tempPath,
            partFileId: file.id,
            adminName: WATERMARK_QUEUE_LABEL
        });
        
        console.log(`  Queued successfully.`);
        
    } catch (e: any) {
        console.error(`  Failed to reprocess ${file.id}: ${e.message}`);
    }
  }
  
  // 2. Retry FAILED jobs (that have isSecure=true)
  const failedFiles = await prisma.partFile.findMany({
      where: {
          renderStatus: 'FAILED',
          isSecure: true
      }
  });

  console.log(`Found ${failedFiles.length} FAILED files. (Manual intervention may be needed if temp files are gone)`);
  
  // For failed files, we can only retry if the temp file exists.
  // Or we could try to look for them in Bunny if they were partially uploaded? Unlikely.
  
  console.log('Done.');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    await pdfQueue.close();
  });
