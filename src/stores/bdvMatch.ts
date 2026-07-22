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
  trade_offers?: TradeOffer[];
  trading_ready?: number[];
  loans?: any[];
  pending_demand?: any;
}

export interface TradeOffer {
  id: number;
  from_seat: number;
  to_seat: number;
  give_squares: number[];
  give_credits: number;
  want_squares: number[];
  want_credits: number;
  note: string;
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
    /** Server clock for the 60s rent auto-agree; display only. */
    rentDeadlineAt: null as string | null,
    /** Server clock for the 5-minute privatisation window; display only. */
    turnDeadlineAt: null as string | null,
    /** Server-computed: what you owe and whether you can still do anything. */
    settlement: null as
      | {
          due: number;
          cash: number;
          shortfall: number;
          can_raise_cash: boolean;
          liquidation_value: number;
          must_concede: boolean;
        }
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
    /** The outstanding rent demand, if any. */
    demand(state): any | null {
      return state.matchState?.pending_demand ?? null;
    },
    /** True when YOU are the one who owes. */
    youOweRent(state): boolean {
      const d = state.matchState?.pending_demand;
      return !!d && d.debtor_seat === state.yourSeat;
    },
    /** True when someone has countered YOUR rent and you must answer. */
    awaitingYourAnswer(state): boolean {
      const d = state.matchState?.pending_demand;
      return !!d && d.owner_seat === state.yourSeat && d.offered !== null;
    },
    myLoans(state): any[] {
      return (state.matchState?.loans ?? []).filter((l: any) => l.seat === state.yourSeat);
    },
    myDebt(): number {
      return this.myLoans.reduce((sum: number, l: any) => sum + l.outstanding, 0);
    },
    /** Squares you own, with build/sell context for the manage popup. */
    myEstate(state): any[] {
      const ownership = state.matchState?.ownership ?? {};
      const houses = state.matchState?.houses ?? {};
      const pledged = new Set(
        (state.matchState?.loans ?? []).flatMap((l: any) => l.collateral),
      );
      return (state.spec?.squares ?? [])
        .filter((sq: any) => ownership[String(sq.index)] === state.yourSeat)
        .map((sq: any) => ({
          ...sq,
          houses: houses[String(sq.index)] ?? 0,
          pledged: pledged.has(sq.index),
        }));
    },
    myCash(state): number {
      const seat = (state.matchState?.seats ?? []).find(
        (s: any) => s.index === state.yourSeat,
      );
      return seat?.cash ?? 0;
    },
    /** True while the board is frozen for the privatisation window. */
    isTrading(state): boolean {
      return state.matchState?.phase === 'trading';
    },
    /** Offers put to you, awaiting your answer. */
    incomingOffers(state): any[] {
      return (state.matchState?.trade_offers ?? []).filter(
        (offer: any) => offer.to_seat === state.yourSeat,
      );
    },
    /** Offers you have made and nobody has answered yet. */
    outgoingOffers(state): any[] {
      return (state.matchState?.trade_offers ?? []).filter(
        (offer: any) => offer.from_seat === state.yourSeat,
      );
    },
    /** True only when the server says nothing can be sold, borrowed or paid. */
    mustConcede(state): boolean {
      return state.settlement?.must_concede === true;
    },
    youAreReady(state): boolean {
      return (state.matchState?.trading_ready ?? []).includes(state.yourSeat as number);
    },
    /** What each seat still needs to complete a stage — served during trading. */
    stageNeeds(state): Record<string, Record<string, number[]>> {
      return state.match?.stage_needs ?? {};
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
        this.rentDeadlineAt = data.rent_deadline_at ?? null;
        this.turnDeadlineAt = data.turn_deadline_at ?? null;
        this.settlement = data.settlement ?? null;
        await this.refreshOptions();
      } catch (err: any) {
        this.error = err?.message ?? 'Failed to load match';
      } finally {
        this.loading = false;
      }
    },

    async refreshOptions() {
      if (!this.matchId) return;
      // A watcher holds no seat and therefore has no options. Asking anyway is
      // a pointless round-trip on every poll of an agent fight.
      if (this.yourSeat === null) {
        this.options = [];
        return;
      }
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
      this.rentDeadlineAt = data.rent_deadline_at ?? null;
      this.turnDeadlineAt = data.turn_deadline_at ?? null;
      this.settlement = data.settlement ?? null;
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
        // The server recomputes this after every action. Not refreshing it was
        // the cause of a stale "Buy X" button that 422'd: the offer survived the
        // move that made it invalid.
        this.purchaseOffer = data.purchase_offer ?? null;
        this.rentDeadlineAt = data.rent_deadline_at ?? null;
        this.settlement = data.settlement ?? null;
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
    // --- rent demand (S146-9)
    agreeToPay() {
      return this.submit('agree_to_pay');
    },
    offerRent(amount: number) {
      return this.submit('offer_rent', { amount });
    },
    /** Settle the debt with a square instead of cash. */
    offerRentProperty(square: number) {
      return this.submit('offer_rent_property', { square });
    },
    acceptRentOffer() {
      return this.submit('accept_rent_offer');
    },
    insistOnFullRent() {
      return this.submit('insist_on_full_rent');
    },
    /**
     * Concede. The server refuses this unless the seat genuinely cannot settle,
     * so the button is only ever shown when `settlement.must_concede` is true —
     * otherwise it would be a way to deny the landlord their rent.
     */
    declareBankrupt() {
      return this.submit('declare_bankrupt');
    },
    // --- solvency + assets (S146-10 / S146-11)
    buildHouse(square: number) {
      return this.submit('build_house', { square });
    },
    sellHouse(square: number) {
      return this.submit('sell_house', { square });
    },
    sellSquare(square: number) {
      return this.submit('sell_square', { square });
    },
    borrow(squares: number[], amount: number) {
      return this.submit('borrow', { squares, amount });
    },
    repayLoan(loanId: number, amount: number) {
      return this.submit('repay_loan', { loan_id: loanId, amount });
    },
    // --- table economy (S146-12)
    transferCredits(toSeat: number, amount: number) {
      return this.submit('transfer_credits', { to_seat: toSeat, amount });
    },
    // --- privatisation trading window (S146-13 / S146-14)
    /**
     * Terms are always FROM you — the server takes the proposing seat from your
     * session and ignores any seat in the body, so there is nothing to send.
     */
    proposeTrade(terms: {
      to_seat: number;
      give_squares?: number[];
      give_credits?: number;
      want_squares?: number[];
      want_credits?: number;
      note?: string;
    }) {
      return this.submit('propose_trade', terms as Record<string, unknown>);
    },
    acceptTrade(offerId: number) {
      return this.submit('accept_trade', { offer_id: offerId });
    },
    /** Also how you withdraw your own offer — same verb, either side. */
    declineTrade(offerId: number) {
      return this.submit('decline_trade', { offer_id: offerId });
    },
    counterTrade(offerId: number, terms: Record<string, unknown>) {
      return this.submit('counter_trade', { offer_id: offerId, ...terms });
    },
    tradingReady() {
      return this.submit('trading_ready');
    },
  },
});
