import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';

interface DecodedUserToken {
  sub: string;
  type: 'user';
  organizationId: string;
  roles: string[];
}

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
    credentials: true,
  },
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private publicKey: string;

  constructor(private configService: ConfigService) {
    this.publicKey = this.configService
      .get<string>('JWT_PUBLIC_KEY')!
      .replace(/\\n/g, '\n');
  }

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const decoded = verify(token, this.publicKey, {
        algorithms: ['ES256'],
      }) as DecodedUserToken;

      if (decoded.type === 'user' && decoded.sub) {
        void client.join(`user:${decoded.sub}`);
        if (decoded.organizationId) {
          void client.join(`org:${decoded.organizationId}`);
        }
        this.logger.log(
          `Client connected: ${client.id} user:${decoded.sub} org:${decoded.organizationId}`,
        );
      } else {
        this.logger.log(`Client connected: ${client.id} (service token)`);
      }
    } catch {
      this.logger.warn(`Invalid token, disconnecting client: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  sendToUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  sendToOrg(orgId: string, event: string, data: unknown) {
    this.server.to(`org:${orgId}`).emit(event, data);
  }

  broadcast(event: string, data: unknown) {
    this.server.emit(event, data);
  }
}
