import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { StorageService } from './storage.service.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../common/interfaces/jwt-payload.interface.js';

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async upload(
    @UploadedFile()
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    @Req() req: Request,
  ) {
    const user = req.user as JwtUserPayload;
    return this.storageService.upload(file, user.organizationId, 'general');
  }

  @Get(':key/presign')
  getPresignedUrl(@Param('key') key: string) {
    return this.storageService.getPresignedUrl(key);
  }

  @Delete(':key')
  @Permissions('storage:delete')
  delete(@Param('key') key: string) {
    return this.storageService.delete(key);
  }
}
