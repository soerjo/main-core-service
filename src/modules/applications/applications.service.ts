import { Injectable, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ApplicationsRepository } from './applications.repository.js';
import type { CreateApplicationDto } from './dto/create-application.dto.js';
import type { UpdateApplicationDto } from './dto/update-application.dto.js';

@Injectable()
export class ApplicationsService {
  constructor(private applicationsRepository: ApplicationsRepository) {}

  async findAll() {
    const apps = await this.applicationsRepository.findAll();
    return apps.map(({ clientSecret: _clientSecret, ...rest }) => rest);
  }

  async findById(id: string) {
    const app = await this.applicationsRepository.findById(id);
    const { clientSecret: _clientSecret, ...result } = app;
    return result;
  }

  async create(dto: CreateApplicationDto) {
    const existing = await this.applicationsRepository.findByName(dto.name);
    if (existing) {
      throw new BadRequestException(`Application "${dto.name}" already exists`);
    }

    const clientId = uuidv4();
    const plainSecret = uuidv4() + uuidv4();
    const hashedSecret = await bcrypt.hash(plainSecret, 10);

    const app = await this.applicationsRepository.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      clientId,
      clientSecret: hashedSecret,
      redirectUris: dto.redirectUris
        ? JSON.stringify(dto.redirectUris)
        : undefined,
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    const { clientSecret: _cs, ...result } = app;
    return { ...result, clientSecret: plainSecret };
  }

  async update(id: string, dto: UpdateApplicationDto) {
    await this.applicationsRepository.findById(id);
    const updateData: { [key: string]: unknown } = { ...dto };
    if (dto.redirectUris) {
      updateData.redirectUris = JSON.stringify(dto.redirectUris);
    }
    return this.applicationsRepository.update(id, updateData);
  }

  async updateStatus(id: string, isActive: boolean) {
    await this.applicationsRepository.findById(id);
    return this.applicationsRepository.update(id, { isActive });
  }

  async regenerateSecret(id: string) {
    await this.applicationsRepository.findById(id);
    const plainSecret = uuidv4() + uuidv4();
    const hashedSecret = await bcrypt.hash(plainSecret, 10);

    await this.applicationsRepository.update(id, {
      clientSecret: hashedSecret,
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return { clientSecret: plainSecret };
  }

  async validateClientCredentials(clientId: string, clientSecret: string) {
    const app = await this.applicationsRepository.findByClientId(clientId);
    if (!app || !app.isActive) {
      return null;
    }

    const isValid = await bcrypt.compare(clientSecret, app.clientSecret);
    if (!isValid) {
      return null;
    }

    return app;
  }
}
