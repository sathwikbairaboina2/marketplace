import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { ZodType } from 'zod';
import { AuthError, runWithTenant, TenantPrincipal } from '@marketplace/auth';
import {
  AGENT_EVENTS,
  AgentStateSnapshot,
  ConfirmSchema,
  RejectSchema,
  SendMessageSchema,
  ThreadResumeSchema,
} from '@marketplace/contracts';
import { JwtVerifierService } from '../auth/jwt-verifier.service';
import { GraphService } from '../graph/graph.service';
import { ThreadRegistryService } from '../threads/thread-registry.service';
import { ProblemException } from '../common/problem';
import { toProblem } from '../common/problem.filter';

interface SocketData {
  principal: TenantPrincipal;
  token: string;
}

@WebSocketGateway({ namespace: '/agents', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly verifier: JwtVerifierService,
    private readonly threads: ThreadRegistryService,
    private readonly graph: GraphService,
  ) {}

  /**
   * Browsers cannot set headers on a WebSocket upgrade, so the token arrives in
   * the socket.io handshake. Verification is connection middleware rather than
   * a `handleConnection` hook: middleware rejects before the connection is
   * established, so an unauthenticated client gets `connect_error` instead of a
   * connection that succeeds and is then torn down.
   */
  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      try {
        if (!token) throw new AuthError('missing token');
        const principal = await this.verifier.verify(token);
        (socket.data as SocketData) = { principal, token };
        next();
      } catch (err) {
        this.logger.warn({ err }, 'rejected socket handshake');
        next(new Error('unauthorized'));
      }
    });
  }

  @SubscribeMessage(AGENT_EVENTS.threadStart)
  async onThreadStart(@ConnectedSocket() socket: Socket): Promise<void> {
    await this.handle(socket, async ({ principal }) => {
      const threadId = await this.threads.create(principal);
      return this.graph.snapshot(threadId);
    });
  }

  @SubscribeMessage(AGENT_EVENTS.threadResume)
  async onThreadResume(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId } = this.parse(ThreadResumeSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.snapshot(threadId);
    });
  }

  @SubscribeMessage(AGENT_EVENTS.message)
  async onMessage(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId, content } = this.parse(SendMessageSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token },
        action: 'message',
        content,
      });
    });
  }

  @SubscribeMessage(AGENT_EVENTS.confirm)
  async onConfirm(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId } = this.parse(ConfirmSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token },
        action: 'confirm',
      });
    });
  }

  @SubscribeMessage(AGENT_EVENTS.reject)
  async onReject(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId, notes } = this.parse(RejectSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token },
        action: 'reject',
        // Notes become an ordinary user message, which is how the rejection
        // node distinguishes "change this" from "discard it".
        content: notes,
      });
    });
  }

  private parse<T>(schema: ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-event-payload',
        422,
        'Event payload is not valid',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return parsed.data;
  }

  private async handle(
    socket: Socket,
    fn: (data: SocketData) => Promise<AgentStateSnapshot>,
  ): Promise<void> {
    const data = socket.data as SocketData;
    const traceId = randomUUID();
    try {
      const snapshot = await runWithTenant(data.principal, () => fn(data));
      socket.emit(AGENT_EVENTS.state, snapshot);
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) {
        this.logger.error({ err, traceId, tenantId: data?.principal?.tenantId }, 'socket handler failed');
      }
      socket.emit(AGENT_EVENTS.error, { ...problem, traceId });
    }
  }
}
