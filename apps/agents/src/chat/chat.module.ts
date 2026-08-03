import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ThreadsModule } from '../threads/threads.module';
import { GraphModule } from '../graph/graph.module';

// GraphModule is imported directly (not just via ThreadsModule) because
// ThreadsModule does not re-export it: ChatGateway injects GraphService
// itself, and Nest's module encapsulation only makes an imported module's
// exports visible to modules that import it directly.
@Module({ imports: [ThreadsModule, GraphModule], providers: [ChatGateway] })
export class ChatModule {}
