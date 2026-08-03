import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';

export async function ensureQueues(): Promise<{ queueUrl: string; dlqUrl: string }> {
  const sqs = new SQSClient({ endpoint: process.env.SQS_ENDPOINT });

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'marketplace-engine-jobs-dlq.fifo',
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
    }),
  );
  const dlqUrl = dlq.QueueUrl!;

  const dlqArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes!.QueueArn!;

  const main = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'marketplace-engine-jobs.fifo',
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
    }),
  );
  const queueUrl = main.QueueUrl!;

  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
        VisibilityTimeout: '30',
      },
    }),
  );

  return { queueUrl, dlqUrl };
}
