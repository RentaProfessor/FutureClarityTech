import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, parsePeerMessage } from './messages';

const parse = (value: unknown) => parsePeerMessage(JSON.stringify(value));

describe('parsePeerMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parse({ type: 'join', name: 'Ana' })).toEqual({ type: 'join', name: 'Ana' });
    expect(parse({ type: 'sit', seatIndex: 3, name: 'Ana' })).toEqual({ type: 'sit', seatIndex: 3, name: 'Ana' });
    expect(parse({ type: 'action', action: 'raise', amount: 40 })).toEqual({ type: 'action', action: 'raise', amount: 40 });
    expect(parse({ type: 'action', action: 'fold' })).toEqual({ type: 'action', action: 'fold' });
    expect(parse({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('rejects chip amounts that are not whole, non-negative numbers', () => {
    expect(parse({ type: 'action', action: 'raise', amount: '10' })).toBeNull();
    expect(parse({ type: 'action', action: 'raise', amount: 4.5 })).toBeNull();
    expect(parse({ type: 'action', action: 'raise', amount: -20 })).toBeNull();
    expect(parse({ type: 'action', action: 'raise', amount: 1e300 })).toBeNull();
  });

  it('rejects unknown actions, seats and message types', () => {
    expect(parse({ type: 'action', action: 'win' })).toBeNull();
    expect(parse({ type: 'sit', seatIndex: 6, name: 'Ana' })).toBeNull();
    expect(parse({ type: 'sit', seatIndex: '1', name: 'Ana' })).toBeNull();
    expect(parse({ type: 'deal' })).toBeNull();
  });

  it('cleans names and chat text', () => {
    expect(parse({ type: 'join', name: '  Ana\u0007  ' })).toEqual({ type: 'join', name: 'Ana' });
    expect((parse({ type: 'join', name: 'x'.repeat(50) }) as { name: string }).name).toHaveLength(MAX_NAME_LENGTH);
    expect(parse({ type: 'chat', message: '   ' })).toBeNull();
  });

  it('rejects anything that is not a JSON object string', () => {
    expect(parsePeerMessage('not json')).toBeNull();
    expect(parsePeerMessage('null')).toBeNull();
    expect(parsePeerMessage({ type: 'ready' })).toBeNull();
  });
});
