export interface AuthUser {
  sub: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  isActive: boolean;
  organizationId: string;
  applicationId?: string;
  roles: string[];
}
