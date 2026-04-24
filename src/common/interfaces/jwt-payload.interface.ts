export interface JwtUserPayload {
  sub: string;
  email: string;
  type: 'user';
  organizationId: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface JwtServicePayload {
  sub: string;
  type: 'service';
  applicationId: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export type JwtPayload = JwtUserPayload | JwtServicePayload;
