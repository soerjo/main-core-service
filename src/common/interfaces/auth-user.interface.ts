import { $Enums } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: $Enums.RoleName;
  organizationId: string;
}
