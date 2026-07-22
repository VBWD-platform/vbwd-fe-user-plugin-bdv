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

describe('the privatisation trading window', () => {
  const TRADING = {
    ...MATCH,
    stage_needs: { '0': { lead_gen: [3] } },
    turn_deadline_at: '2026-07-22T10:05:00Z',
    state: {
      ...MATCH.state,
      phase: 'trading',
      trading_ready: [1],
      trade_offers: [
        {
          id: 1,
          from_seat: 1,
          to_seat: 0,
          give_squares: [3],
          give_credits: 0,
          want_squares: [],
          want_credits: 400,
          note: 'completing a stage',
        },
        {
          id: 2,
          from_seat: 0,
          to_seat: 1,
          give_squares: [],
          give_credits: 200,
          want_squares: [6],
          want_credits: 0,
          note: '',
        },
      ],
    },
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(TRADING),
    );
  });

  it('splits offers into the ones you must answer and the ones you are waiting on', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.isTrading).toBe(true);
    expect(store.incomingOffers.map((o: any) => o.id)).toEqual([1]);
    expect(store.outgoingOffers.map((o: any) => o.id)).toEqual([2]);
  });

  it('knows whether you have already declared yourself done', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.youAreReady).toBe(false);
    store.yourSeat = 1;
    expect(store.youAreReady).toBe(true);
  });

  it('surfaces the window deadline and what your stages still need', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.turnDeadlineAt).toBe('2026-07-22T10:05:00Z');
    expect(store.stageNeeds['0'].lead_gen).toEqual([3]);
  });

  it('never sends a proposing seat — the server takes it from the session', async () => {
    // The first cut read from_seat off the body, which let any seat author a
    // trade giving away someone else's squares.
    const store = useBdvMatchStore();
    await store.load('m1');
    (api.post as any).mockResolvedValue({ state_seq: 8, state: TRADING.state, events: [] });
    await store.proposeTrade({ to_seat: 1, want_squares: [3], give_credits: 500 });

    const [, body] = (api.post as any).mock.calls[0];
    expect(body.type).toBe('propose_trade');
    expect(body.payload).not.toHaveProperty('from_seat');
    expect(body.payload.to_seat).toBe(1);
  });

  it('answers an offer by id alone', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    (api.post as any).mockResolvedValue({ state_seq: 8, state: TRADING.state, events: [] });

    await store.acceptTrade(1);
    expect((api.post as any).mock.calls[0][1]).toMatchObject({
      type: 'accept_trade',
      payload: { offer_id: 1 },
    });

    await store.counterTrade(1, { give_squares: [6], want_squares: [3] });
    expect((api.post as any).mock.calls[1][1]).toMatchObject({
      type: 'counter_trade',
      payload: { offer_id: 1, give_squares: [6], want_squares: [3] },
    });
  });
});

describe('conceding', () => {
  const FINISHED_OFF = {
    ...MATCH,
    settlement: {
      due: 18000,
      cash: 7139,
      shortfall: 10861,
      can_raise_cash: false,
      liquidation_value: 0,
      must_concede: true,
    },
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('offers the exit only when the server says nothing is left', async () => {
    // The verdict is never computed here: a concede button shown to a seat that
    // could simply pay would be a way to deny the landlord their rent.
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(FINISHED_OFF),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.mustConcede).toBe(true);
    expect(store.settlement?.shortfall).toBe(10861);
  });

  it('stays hidden while cash or assets remain', async () => {
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options')
        ? Promise.resolve(OPTIONS)
        : Promise.resolve({
            ...MATCH,
            settlement: {
              ...FINISHED_OFF.settlement,
              can_raise_cash: true,
              must_concede: false,
            },
          }),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.mustConcede).toBe(false);
  });

  it('is refreshed by every action, not only on load', async () => {
    // The stale-state family of bugs: a verdict that outlives the move that
    // changed it leaves a dead button on screen.
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(MATCH),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.mustConcede).toBe(false);

    (api.post as any).mockResolvedValue({
      state_seq: 8,
      state: MATCH.state,
      events: [],
      settlement: FINISHED_OFF.settlement,
    });
    await store.sellSquare(3);
    expect(store.mustConcede).toBe(true);
  });
});

describe('watching a real agent fight', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('a viewer with no seat still loads the match', async () => {
    // An agents-only fight has no seat for its buyer — that is the format. The
    // store must not treat "no seat" as "not allowed".
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options')
        ? Promise.resolve(OPTIONS)
        : Promise.resolve({ ...MATCH, your_seat: null }),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.yourSeat).toBeNull();
    expect(store.isYourTurn).toBe(false);
    expect(store.matchState?.phase).toBe('await_choice');
  });
});

describe('a watcher polling an agent fight', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('never asks for options it cannot have', async () => {
    // The 403 that killed the poll loop came from asking at all. A seatless
    // watcher has nothing to choose, so the request is skipped outright.
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options')
        ? Promise.reject(new Error('should never be called'))
        : Promise.resolve({ ...MATCH, your_seat: null }),
    );
    const store = useBdvMatchStore();
    await store.load('m1');

    expect(store.yourSeat).toBeNull();
    expect(store.options).toEqual([]);
    const optionCalls = (api.get as any).mock.calls.filter((c: any[]) =>
      String(c[0]).endsWith('/options'),
    );
    expect(optionCalls).toHaveLength(0);
  });

  it('still refreshes state on every poll', async () => {
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options')
        ? Promise.reject(new Error('should never be called'))
        : Promise.resolve({ ...MATCH, your_seat: null, state_seq: 9 }),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    await store.refreshState();
    expect(store.stateSeq).toBe(9);
  });
});

describe('a finished fight', () => {
  const FINISHED = {
    ...MATCH,
    your_seat: null,
    state: {
      ...MATCH.state,
      phase: 'finished',
      winner_seat: 0,
      seats: [
        { index: 0, cash: 730, position: 3, in_jail: false, bankrupt: false },
        { index: 1, cash: 0, position: 8, in_jail: false, bankrupt: true },
        { index: 2, cash: 0, position: 12, in_jail: false, bankrupt: true },
      ],
    },
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(FINISHED),
    );
  });

  it('is over as soon as one seat is left standing', async () => {
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.isFinished).toBe(true);
    expect(store.matchState?.winner_seat).toBe(0);
    const survivors = (store.matchState?.seats ?? []).filter((s: any) => !s.bankrupt);
    expect(survivors).toHaveLength(1);
  });

  it('is never anyone\'s turn once it is finished', async () => {
    // isYourTurn gating the centre panel is what left a decided match showing
    // "waiting for the other seats".
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.isYourTurn).toBe(false);
  });
});

describe('the manage-book panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('takes its affordances from the server, not from the board spec', async () => {
    // Re-deriving them here put a Build button on every owned square, and
    // building on an incomplete funnel stage 500'd on every click.
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options')
        ? Promise.resolve(OPTIONS)
        : Promise.resolve({
            ...MATCH,
            spec: { ...MATCH.spec, squares: [{ index: 3, name: 'Cold List', kind: 'deal' }] },
            estate: [
              {
                index: 3,
                name: 'Cold List',
                houses: 0,
                house_cost: 500,
                can_build: false,
                build_blocked_because: 'you must own the whole funnel stage first',
                can_sell_house: false,
                can_sell_square: true,
                mortgage_value: 300,
              },
            ],
          }),
    );
    const store = useBdvMatchStore();
    await store.load('m1');

    expect(store.myEstate).toHaveLength(1);
    const square = store.myEstate[0];
    expect(square.can_build).toBe(false);
    expect(square.build_blocked_because).toContain('whole funnel stage');
    expect(square.can_sell_square).toBe(true);
    // Display fields still come from the spec.
    expect(square.kind).toBe('deal');
  });

  it('is empty rather than guessed when the server sends nothing', async () => {
    (api.get as any).mockImplementation((url: string) =>
      url.endsWith('/options') ? Promise.resolve(OPTIONS) : Promise.resolve(MATCH),
    );
    const store = useBdvMatchStore();
    await store.load('m1');
    expect(store.myEstate).toEqual([]);
  });
});
