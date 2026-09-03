import { Injectable } from '@nestjs/common';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DEFAULT_PIPELINE, Pipeline, Stage, UpdatePipeline } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { PIPELINE_SK } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { assertAdmin } from '../common/roles';
import { failedTransactionIndexes } from '../common/transaction-errors';

@Injectable()
export class PipelineService {
  constructor(private readonly repo: DynamoRepository) {}

  /** Every signed-in user of the tenant may read it -- the storefront renders it. */
  async get(): Promise<Pipeline> {
    const found = await this.repo.get<Pipeline>(PIPELINE_SK);
    // Absence is a state, not an error: a shop that has never configured a
    // pipeline has one stage, and every order it has ever taken sits in it.
    return found ? { version: found.version, stages: found.stages } : DEFAULT_PIPELINE;
  }

  async update(input: UpdatePipeline): Promise<Pipeline> {
    assertAdmin('set the order stages');

    // A stage arriving without an id is one the owner just added; a stage that
    // brought its id keeps it, because its id is what pins existing orders and
    // addresses its messages.
    const stages: Stage[] = input.stages.map((stage) => ({
      id: stage.id ?? newId(),
      name: stage.name,
      cancellable: stage.cancellable,
      messaging: stage.messaging,
    }));
    const next: Pipeline = { version: input.version + 1, stages };

    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(PIPELINE_SK),
            UpdateExpression: 'SET #version = :next, #stages = :stages',
            // `attribute_not_exists` covers the first save, where there is no
            // record yet and the editor legitimately submits version 0.
            ConditionExpression: 'attribute_not_exists(#version) OR #version = :expected',
            ExpressionAttributeNames: { '#version': 'version', '#stages': 'stages' },
            ExpressionAttributeValues: {
              ':next': next.version,
              ':stages': stages,
              ':expected': input.version,
            },
          },
        },
      ]);
    } catch (err) {
      // Two admins editing at once: one commits, the other must re-read rather
      // than silently clobbering the save it never saw. This is the announcement
      // race (bug #9) one layer up, closed at the API instead of in the form.
      if (err instanceof ConditionalCheckFailedException || failedTransactionIndexes(err).includes(0)) {
        throw new ProblemException(
          'pipeline-version-conflict',
          409,
          'Order stages changed',
          'someone else saved the order stages while you were editing; reload and reapply',
          { expectedVersion: input.version },
        );
      }
      throw err;
    }

    return next;
  }
}
