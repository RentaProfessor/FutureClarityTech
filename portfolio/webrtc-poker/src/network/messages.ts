import { HostMessage, PeerMessage, PlayerAction } from '../game/types';

export const MAX_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 200;
const PLAYER_ACTIONS: readonly PlayerAction[] = ['fold', 'check', 'call', 'raise', 'all-in'];

/**
 * Serialize a message for sending over WebRTC data channel.
 */
export function serialize(msg: HostMessage | PeerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Deserialize a message from the host. Clients trust the host: it runs the game.
 */
export function deserializeHostMessage(data: string): HostMessage {
  return JSON.parse(data) as HostMessage;
}

/**
 * Parse and validate a message from a peer. Peers are untrusted, so anything that isn't
 * exactly a well-formed message (wrong types, fractional or negative chip amounts,
 * unknown actions, oversized text) is rejected as null.
 */
export function parsePeerMessage(data: unknown): PeerMessage | null {
  let msg: unknown;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : null;
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;

  switch (m.type) {
    case 'join': {
      const name = cleanText(m.name, MAX_NAME_LENGTH);
      return name ? { type: 'join', name } : null;
    }
    case 'sit': {
      const name = cleanText(m.name, MAX_NAME_LENGTH);
      const seatIndex = m.seatIndex;
      if (!name || typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 5) {
        return null;
      }
      return { type: 'sit', seatIndex, name };
    }
    case 'stand':
    case 'ready':
      return { type: m.type };
    case 'action': {
      const action = m.action as PlayerAction;
      if (!PLAYER_ACTIONS.includes(action)) return null;
      if (m.amount === undefined) return { type: 'action', action };
      const amount = m.amount;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
      return { type: 'action', action, amount };
    }
    case 'chat': {
      const message = cleanText(m.message, MAX_CHAT_LENGTH);
      return message ? { type: 'chat', message } : null;
    }
    default:
      return null;
  }
}

/** Strips control characters, trims, and caps length. Empty results count as missing. */
function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return text || null;
}
