import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({ imports: [PipelineModule], controllers: [OrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
