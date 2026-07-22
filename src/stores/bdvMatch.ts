import { defineStore } from 'pinia';
import { api } from '@/api';

/**
 * One store for the whole match surface.
 *
 * Two rules it enforces on the client side:
 *  - prices are NEVER computed here; they come from the server quote;
 *  - every mutating call carries `state_seq`, and a 409 refetches silently
 *    instead of surfacing an error (someone else simply moved first).
 */

export interface OptionQuote {
  steps: number;
  target_index: number;
  target_name: string;
  ev: number;
  ev_delta: number;
  price: number;
  affordable: boolean;
  is_sum: boolean;
  reason: string;
  reason_params: Record<string, unknown>;
}

export interface SeatView {
  index: number;
  cash: number;
  position: number;
  in_jail: boolean;
  bankrupt: boolean;
}

interface MatchState {
  seats: SeatView[];
  ownership: Record<string, number | null>;
  houses: Record<string, number>;
  turn_seat: number;
  phase: string;
  pending_roll: number[] | null;
  seq: number;
  winner_seat: number | null;
}

export const useBdvMatchStore = defineStore('bdvMatch', {
  state: () => ({
    matchId: null as string | null,
    spec: null as any,
    match: null as any,
    matchState: null as MatchState | null,
    options: [] as OptionQuote[],
    offers: [] as any[],
    yourSeat: null as number | null,
    /** Server-computed: the square you could buy right now, or null. */
    purchaseOffer: null as
      | { square_index: number; name: string; price: number; affordable: boolean }
      | null,
    stateSeq: 0,
    loading: false,
    submitting: false,
    error: null as string | null,
  }),

  getters: {
    isYourTurn(state): boolean {
      return (
        state.matchState !== null &&
        state.yourSeat !== null &&
        state.matchState.turn_seat === state.yourSeat &&
        state.matchState.phase !== 'finished'
      );
    },
    phase(state): string {
      return state.matchState?.phase ?? 'await_roll';
    },
    /** Only offer the button when the server says the move would succeed. */
    canBuy(state): boolean {
      return !!state.purchaseOffer && state.purchaseOffer.affordable;
    },
    isFinished(state): boolean {
      return state.matchState?.phase === 'finished';
    },
    squares(state): any[] {
      return state.spec?.squares ?? [];
    },
    /** Target squares highlighted on the board, keyed by square index. */
    optionByTarget(state): Record<number, OptionQuote> {
      const map: Record<number, OptionQuote> = {};
      state.options.forEach((option) => {
        map[option.target_index] = option;
      });
      return map;
    },
  },

  actions: {
    async load(matchId: string) {
      this.loading = true;
      this.error = null;
      try {
        const data = (await api.get(`/bdv/matches/${matchId}`)) as any;
        this.matchId = matchId;
        this.match = data;
        this.spec = data.spec;
        this.matchState = data.state;
        this.stateSeq = data.state_seq;
        this.yourSeat = data.your_seat;
        this.purchaseOffer = data.purchase_offer ?? null;
        await this.refreshOptions();
      } catch (err: any) {
        this.error = err?.message ?? 'Failed to load match';
      } finally {
        this.loading = false;
      }
    },

    async refreshOptions() {
      if (!this.matchId) return;
      const data = (await api.get(`/bdv/matches/${this.matchId}/options`)) as any;
      this.options = data.items;
      this.stateSeq = data.state_seq;
    },

    async refreshState() {
      if (!this.matchId) return;
      const data = (await api.get(`/bdv/matches/${this.matchId}`)) as any;
      this.match = data;
      this.matchState = data.state;
      this.stateSeq = data.state_seq;
      this.purchaseOffer = data.purchase_offer ?? null;
      await this.refreshOptions();
    },

    /**
     * The single mutating path. A board click and a chat-card tap both land
     * here, so the two surfaces cannot diverge.
     */
    async submit(type: string, payload: Record<string, unknown> = {}) {
      if (!this.matchId || this.submitting) return;
      this.submitting = true;
      this.error = null;
      try {
        const data = (await api.post(`/bdv/matches/${this.matchId}/actions`, {
          type,
          payload,
          state_seq: this.stateSeq,
        })) as any;
        this.matchState = data.state;
        this.stateSeq = data.state_seq;
        await this.refreshOptions();
        return data.events;
      } catch (err: any) {
        if (err?.status === 409) {
          // Someone moved first — resync quietly rather than shouting.
          await this.refreshState();
          return [];
        }
        this.error = err?.message ?? 'Move rejected';
        return [];
      } finally {
        this.submitting = false;
      }
    },

    roll() {
      return this.submit('roll');
    },
    closeNegotiation() {
      return this.submit('open_negotiation');
    },
    chooseOption(steps: number) {
      // NOTE: no price is sent. The server recomputes it from the current seq.
      return this.submit('choose_option', { steps });
    },
    buyProperty() {
      return this.submit('buy_property');
    },
    endTurn() {
      return this.submit('end_turn');
    },
  },
});
