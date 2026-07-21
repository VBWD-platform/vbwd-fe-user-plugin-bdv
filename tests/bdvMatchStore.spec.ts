import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '@/api';
import { useBdvMatchStore } from '../src/stores/bdvMatch';

const MATCH = {
  id: 'm1',
  state_seq: 7,
  your_seat: 0,
  spec: { board: { currency_label: 'cr', game_display_name: 'BizDevVibes' }, squares: [] },
  state: {
    seats: [{ index: 0, cash: 10000, position: 34, in_jail: false, bankrupt: false }],
    ownership: {},
    houses: {},
    turn_seat: 0,
    phase: 'await_choice',
    pending_roll: [2, 3],
    seq: 7,
    winner_seat: null,
  },
  seats: [{ seat_index: 0, display_name: 'You' }],
};

const OPTIONS = {
  state_seq: 7,
  items: [
    { steps: 2, target_index: 36, target_name: 'Upsell Tier', ev: 300, ev_delta: 1200, price: 600, affordable: true, is_sum: false, reason: 'unowned', reason_params: {} },
    { steps: 3, target_index: 37, target_name: 'Analytics Stack', ev: 0, ev_delta: 900, price: 450, affordable: true, is_sum: false, reason: 'own_square', reason_params: {} },
    { steps: 5, target_index: 39, target_name: 'Enterprise Renewal', ev: -900, ev_delta: 0, price: 0, affordable: true, is_sum: true, reason: 'pays_rent', reason_params: { rent: 900 } },
  ],
};

describe('bdvMatch store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(MATCH),
    );
  });

  it('loads the match, spec and priced options', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.yourSeat).toBe(0);
    expect(store.stateSeq).toBe(7);
    expect(store.options).toHaveLength(3);
  });

  it('exposes the sum as the free option', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    const free = store.options.filter((o) => o.is_sum);
    expect(free).toHaveLength(1);
    expect(free[0].price).toBe(0);
  });

  it('maps options onto their destination squares for the board overlay', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.optionByTarget[36].price).toBe(600);
    expect(store.optionByTarget[39].is_sum).toBe(true);
  });

  it('NEVER sends a price — the server recomputes it', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    (api.post as any).mockResolvedValue({ state_seq: 8, state: MATCH.state, events: [] });

    await store.chooseOption(2);

    const body = (api.post as any).mock.calls[0][1];
    expect(body.payload).toEqual({ steps: 2 });
    expect(body.payload).not.toHaveProperty('price');
    expect(body.state_seq).toBe(7);
  });

  it('resyncs silently on a 409 instead of surfacing an error', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    (api.post as any).mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));

    await store.chooseOption(2);

    expect(store.error).toBeNull();
    // A refetch happened after the conflict.
    expect((api.get as any).mock.calls.length).toBeGreaterThan(2);
  });

  it('surfaces a genuine rejection', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    (api.post as any).mockRejectedValue(
      Object.assign(new Error('price exceeds the affordability cap'), { status: 422 }),
    );

    await store.chooseOption(2);
    expect(store.error).toContain('cap');
  });

  it('knows when it is your turn', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.isYourTurn).toBe(true);
  });
});
