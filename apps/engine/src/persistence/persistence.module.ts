import { Global, Module } from '@nestjs/common';
import { DynamoRepository } from './dynamo.repository';

@Global()
@Module({ providers: [DynamoRepository], exports: [DynamoRepository] })
export class PersistenceModule {}
