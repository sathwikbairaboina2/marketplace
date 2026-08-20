import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ThreadsModule } from '../threads/threads.module';
import { GraphModule } from '../graph/graph.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

// GraphModule is imported directly (not just via ThreadsModule) because
// ThreadsModule does not re-export it: ChatGateway injects GraphService
// itself, and Nest's module encapsulation only makes an imported module's
// exports visible to modules that import it directly. OnboardingModule for
// the same reason: the gateway routes onboarding threads to its graph.
@Module({ imports: [ThreadsModule, GraphModule, OnboardingModule], providers: [ChatGateway] })
export class ChatModule {}
