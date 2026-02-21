import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../../utils/api-response';
import { contactMessageSchema } from './contact.schema';
import { ContactService } from './contact.service';

const contactService = new ContactService();

export class ContactController {
    async send(req: Request, res: Response, next: NextFunction) {
        try {
            const input = contactMessageSchema.parse(req.body);
            const data = await contactService.sendMessage(input);
            return ApiResponse.success(res, data, 'Contact message sent successfully');
        } catch (error) {
            next(error);
        }
    }
}
