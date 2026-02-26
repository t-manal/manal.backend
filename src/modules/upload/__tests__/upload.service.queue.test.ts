import { UploadService } from '../upload.service';
import { prismaMock } from '../../../__tests__/setup';
import { BunnyStorageProvider } from '../../../services/storage/bunny-storage.provider';
import { WATERMARK_QUEUE_LABEL } from '../../../constants/watermark';

const mockQueueAdd = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-file-id',
}));

jest.mock('../../../queues/pdf.queue', () => ({
  pdfQueue: {
    add: (...args: any[]) => mockQueueAdd(...args),
  },
}));

jest.mock('../../../services/storage/bunny-storage.provider');

describe('UploadService - Queue Payload Contract', () => {
  let uploadService: UploadService;

  beforeEach(() => {
    process.env.BUNNY_STORAGE_API_KEY = 'test-key';
    process.env.BUNNY_STORAGE_ZONE = 'test-zone';

    uploadService = new UploadService();
    mockQueueAdd.mockReset();
    mockQueueAdd.mockResolvedValue({ id: 'job-123' });

    (BunnyStorageProvider.prototype.uploadPrivate as jest.Mock).mockResolvedValue({
      key: '/staging/pdf-input/file-1/source.pdf',
    });

    prismaMock.part.findUnique.mockResolvedValue({
      id: 'part-1',
      lecture: {
        course: {
          id: 'course-1',
          instructorId: 'instructor-1',
        },
      },
    } as any);

    prismaMock.partFile.findFirst.mockResolvedValue(null);
    prismaMock.partFile.create.mockResolvedValue({
      id: 'file-1',
      partId: 'part-1',
      renderStatus: 'PROCESSING',
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues secure jobs with storage-key payload and no local file path', async () => {
    const file = {
      fieldname: 'file',
      originalname: 'lecture-notes.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: 128,
      buffer: Buffer.from('pdf-data'),
      destination: '',
      filename: '',
      path: '',
      stream: null,
    } as unknown as Express.Multer.File;

    const result = await uploadService.uploadLessonPdf('instructor-1', 'part-1', file, 'Notes', true);

    expect(BunnyStorageProvider.prototype.uploadPrivate).toHaveBeenCalledTimes(1);
    const sourceKey = (BunnyStorageProvider.prototype.uploadPrivate as jest.Mock).mock.calls[0][1];
    expect(sourceKey).toMatch(/^\/staging\/pdf-input\/[^/]+\/source\.pdf$/);

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload] = mockQueueAdd.mock.calls[0];
    expect(jobName).toBe('watermark-pdf');
    expect(payload).toEqual(
      expect.objectContaining({
        sourceKey,
        sourceMime: 'application/pdf',
        originalName: 'lecture-notes.pdf',
        partFileId: expect.any(String),
        adminName: WATERMARK_QUEUE_LABEL,
      })
    );
    expect(payload.filePath).toBeUndefined();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'QUEUED',
        id: expect.any(String),
      })
    );
  });
});
