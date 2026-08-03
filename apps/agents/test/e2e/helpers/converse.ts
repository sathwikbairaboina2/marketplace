import { Socket } from 'socket.io-client';
import { AgentPhase, AgentStateSnapshot } from '@marketplace/contracts';
import { waitForState } from './socket';

export async function startThread(socket: Socket): Promise<string> {
  const pending = waitForState(socket, () => true, 15_000);
  socket.emit('thread.start', {});
  return (await pending).threadId;
}

export async function say(
  socket: Socket,
  threadId: string,
  content: string,
): Promise<AgentStateSnapshot> {
  const pending = waitForState(socket);
  socket.emit('message', { threadId, content });
  return pending;
}

/**
 * Drives the conversation until it reaches `target`, answering any clarifying
 * question with `followUp`. The turn budget exists because a local 7B model
 * may need more than one round to become specific — and because a test that
 * hangs is worse than one that fails.
 */
export async function driveTo(
  socket: Socket,
  threadId: string,
  opening: string,
  followUp: string,
  target: AgentPhase,
  maxTurns = 4,
): Promise<AgentStateSnapshot> {
  let snapshot = await say(socket, threadId, opening);
  for (let turn = 1; turn < maxTurns && snapshot.phase !== target; turn += 1) {
    snapshot = await say(socket, threadId, followUp);
  }
  if (snapshot.phase !== target) {
    throw new Error(
      `conversation reached ${snapshot.phase}, not ${target}, after ${maxTurns} turns; ` +
        `missing: ${snapshot.missingRequirements.join(', ')}`,
    );
  }
  return snapshot;
}
