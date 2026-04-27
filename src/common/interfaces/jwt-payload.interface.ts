export interface JwtBasePayload {
  sub: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export interface JwtUserPayload extends JwtBasePayload {
  type: 'user';
  email: string;
  organizationId: string;
  applicationId?: string;
  roles: string[];
}

export interface JwtServicePayload extends JwtBasePayload {
  type: 'service';
  applicationId: string;
}

export type JwtPayload = JwtUserPayload | JwtServicePayload;
