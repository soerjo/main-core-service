export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  isActive: boolean;
  organizationId: string;
  roles: string[];
}

export interface AuthServiceAccount {
  applicationId: string;
  name: string;
  permissions: string[];
}
