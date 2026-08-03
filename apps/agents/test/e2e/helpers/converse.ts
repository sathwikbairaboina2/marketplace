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
 * Drives the conversation until `predicate` holds, answering any clarifying
 * question with `followUp`. The turn budget exists because a local 7B model
 * may need more than one round to become specific — and because a test that
 * hangs is worse than one that fails.
 *
 * `label` is only used to describe what we were waiting for if the turn
 * budget runs out; it does not affect the predicate.
 */
export async function driveUntil(
  socket: Socket,
  threadId: string,
  opening: string,
  followUp: string,
  predicate: (snapshot: AgentStateSnapshot) => boolean,
  label: string,
  maxTurns = 4,
): Promise<AgentStateSnapshot> {
  let snapshot = await say(socket, threadId, opening);
  for (let turn = 1; turn < maxTurns && !predicate(snapshot); turn += 1) {
    snapshot = await say(socket, threadId, followUp);
  }
  if (!predicate(snapshot)) {
    throw new Error(
      `conversation reached ${snapshot.phase}, not ${label}, after ${maxTurns} turns; ` +
        `missing: ${snapshot.missingRequirements.join(', ')}`,
    );
  }
  return snapshot;
}

/**
 * Drives the conversation until it reaches phase `target`. A thin wrapper
 * over `driveUntil` for the common case of waiting on a bare phase match.
 */
export async function driveTo(
  socket: Socket,
  threadId: string,
  opening: string,
  followUp: string,
  target: AgentPhase,
  maxTurns = 4,
): Promise<AgentStateSnapshot> {
  return driveUntil(socket, threadId, opening, followUp, (s) => s.phase === target, target, maxTurns);
}
