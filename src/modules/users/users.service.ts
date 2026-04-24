import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

interface UserWithRoles {
  id: string;
  email: string;
  password: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  userRoles?: Array<{
    organization: {
      id: string;
      name: string;
      slug: string;
      logoUrl: string | null;
      isActive: boolean;
    };
    role: { id: string; name: string; displayName: string };
  }>;
}

@Injectable()
export class UsersService {
  constructor(
    private usersRepository: UsersRepository,
  ) {}

  async findAll(page = 1, limit = 20, organizationId?: string) {
    const skip = (page - 1) * limit;
    const { users, total } = await this.usersRepository.findAll({
      skip,
      take: limit,
      organizationId,
    });
    return {
      data: users,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);
    const {
      password: _password,
      userRoles,
      ...safeUser
    } = user as unknown as UserWithRoles;

    const organizations =
      userRoles?.map((ur) => ({
        organization: ur.organization,
        role: ur.role,
      })) ?? [];

    return { ...safeUser, organizations };
  }

  async getProfile(id: string) {
    return this.findById(id);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async create(dto: CreateUserDto) {
    const user = await this.usersRepository.create({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });
    const { password: _password, ...result } = user;

    // TODO: audit.log - postponed (see AGENTS.md)

    return result;
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.usersRepository.updateStatus(id, isActive);
  }

  async remove(id: string) {
    const result = await this.usersRepository.delete(id);

    // TODO: audit.log - postponed (see AGENTS.md)

    return result;
  }
}
