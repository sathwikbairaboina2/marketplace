import { Module } from '@nestjs/common';
import { FlowsModule } from '../flows/flows.module';
import { SqsConsumerService } from './sqs-consumer.service';

@Module({ imports: [FlowsModule], providers: [SqsConsumerService] })
export class MessagingModule {}
