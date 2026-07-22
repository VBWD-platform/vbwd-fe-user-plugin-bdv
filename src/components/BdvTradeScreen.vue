<script setup lang="ts">
/**
 * The privatisation trading window (S146-13 / S146-14).
 *
 * It takes over the whole board pane rather than sitting in a modal, because
 * for these five minutes trading IS the game — nobody rolls, and a dialog over
 * a frozen board would suggest otherwise.
 *
 * Every price here is face value shown as a hint. Nothing is computed for the
 * server: a proposal carries the squares and the credits, and the server takes
 * the proposing seat from the session — which is why there is no "from" field
 * anywhere in this component.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  squares: any[];
  seats: any[];
  seatMeta: any[];
  ownership: Record<string, number | null>;
  houses: Record<string, number>;
  pledged: number[];
  offers: any[];
  yourSeat: number | null;
  cash: number;
  currencyLabel: string;
  deadlineAt: string | null;
  ready: boolean;
  submitting: boolean;
  /** seat index -> stage -> squares that seat still needs. */
  stageNeeds: Record<string, Record<string, number[]>>;
}>();

const emit = defineEmits<{
  (e: 'propose', terms: Record<string, unknown>): void;
  (e: 'accept', offerId: number): void;
  (e: 'decline', offerId: number): void;
  (e: 'counter', offerId: number, terms: Record<string, unknown>): void;
  (e: 'ready'): void;
}>();

const now = ref(Date.now());
let clock: number | null = null;
onMounted(() => {
  clock = window.setInterval(() => (now.value = Date.now()), 500);
});
onBeforeUnmount(() => {
  if (clock !== null) window.clearInterval(clock);
});

const countdown = computed(() => {
  if (!props.deadlineAt) return null;
  const seconds = Math.max(
    0,
    Math.ceil((new Date(props.deadlineAt).getTime() - now.value) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});

const counterparties = computed(() =>
  props.seats.filter((seat: any) => seat.index !== props.yourSeat && !seat.bankrupt),
);
const partner = ref<number | null>(null);
const activePartner = computed(() =>
  partner.value ?? counterparties.value[0]?.index ?? null,
);

const giveSquares = ref<number[]>([]);
const wantSquares = ref<number[]>([]);
const giveCredits = ref(0);
const wantCredits = ref(0);
/** Set when answering an offer with different terms rather than starting fresh. */
const counteringOffer = ref<number | null>(null);

function nameOf(seatIndex: number) {
  return props.seatMeta?.[seatIndex]?.display_name ?? `Seat ${seatIndex + 1}`;
}

/**
 * A seat's tradeable book. Built squares and pledged squares are excluded
 * here as well as server-side — offering one only to have it refused on accept
 * wastes the one window the table gets.
 */
function bookOf(seatIndex: number | null) {
  if (seatIndex === null) return [];
  const blocked = new Set(props.pledged);
  return props.squares
    .filter((square: any) => props.ownership[String(square.index)] === seatIndex)
    .filter((square: any) => !(props.houses[String(square.index)] > 0))
    .filter((square: any) => !blocked.has(square.index))
    .map((square: any) => ({
      ...square,
      wantedBy: whoNeeds(square.index),
    }));
}

const yourBook = computed(() => bookOf(props.yourSeat));
const theirBook = computed(() => bookOf(activePartner.value));

/** Which seats are one square away from a stage that includes this one. */
function whoNeeds(squareIndex: number): number[] {
  const seats: number[] = [];
  Object.entries(props.stageNeeds ?? {}).forEach(([seatIndex, stages]) => {
    const needed = Object.values(stages ?? {}).flat();
    if (needed.includes(squareIndex)) seats.push(Number(seatIndex));
  });
  return seats;
}

function toggle(list: { value: number[] }, index: number) {
  list.value = list.value.includes(index)
    ? list.value.filter((i) => i !== index)
    : [...list.value, index];
}

const valueOf = (indices: number[]) =>
  indices.reduce(
    (total, index) =>
      total + (props.squares.find((s: any) => s.index === index)?.mortgage_value ?? 0),
    0,
  );

/** Face-value balance of what is on the table — a sanity check, not a price. */
const balance = computed(
  () =>
    valueOf(wantSquares.value) +
    Number(wantCredits.value || 0) -
    valueOf(giveSquares.value) -
    Number(giveCredits.value || 0),
);

const canPropose = computed(
  () =>
    activePartner.value !== null &&
    !props.submitting &&
    Number(giveCredits.value || 0) <= props.cash &&
    (giveSquares.value.length > 0 ||
      wantSquares.value.length > 0 ||
      Number(giveCredits.value || 0) > 0 ||
      Number(wantCredits.value || 0) > 0),
);

function terms() {
  return {
    to_seat: activePartner.value,
    give_squares: [...giveSquares.value],
    give_credits: Number(giveCredits.value || 0),
    want_squares: [...wantSquares.value],
    want_credits: Number(wantCredits.value || 0),
  };
}

function clear() {
  giveSquares.value = [];
  wantSquares.value = [];
  giveCredits.value = 0;
  wantCredits.value = 0;
  counteringOffer.value = null;
}

function send() {
  if (!canPropose.value) return;
  if (counteringOffer.value !== null) {
    emit('counter', counteringOffer.value, terms());
  } else {
    emit('propose', terms());
  }
  clear();
}

/** Load an incoming offer into the builder, mirrored, ready to be edited. */
function startCounter(offer: any) {
  partner.value = offer.from_seat;
  counteringOffer.value = offer.id;
  giveSquares.value = [...offer.want_squares];
  wantSquares.value = [...offer.give_squares];
  giveCredits.value = offer.want_credits;
  wantCredits.value = offer.give_credits;
}

const incoming = computed(() =>
  props.offers.filter((offer: any) => offer.to_seat === props.yourSeat),
);
const outgoing = computed(() =>
  props.offers.filter((offer: any) => offer.from_seat === props.yourSeat),
);

function squareName(index: number) {
  return props.squares.find((s: any) => s.index === index)?.name ?? `#${index}`;
}

/** "2 squares + 300 cr" — the terms in one readable line. */
function describe(indices: number[], credits: number) {
  const parts = indices.map(squareName);
  if (credits) parts.push(`${credits} ${props.currencyLabel}`);
  return parts.length ? parts.join(' + ') : 'nothing';
}

/** What YOUR stages are still missing — the reason to be here at all. */
const yourNeeds = computed(() => {
  const stages = props.stageNeeds?.[String(props.yourSeat)] ?? {};
  return Object.entries(stages).map(([stage, indices]) => ({
    stage,
    indices: indices as number[],
  }));
});
</script>

<template>
  <section class="bdv-trade" data-testid="bdv-trade-screen">
    <header class="head">
      <div>
        <h3>Everything is owned — trading window</h3>
        <p class="sub">
          Buildings need a complete stage. Swap squares, credits or both while the
          board is frozen.
        </p>
      </div>
      <div class="head-right">
        <span v-if="countdown" class="clock" data-testid="bdv-trade-countdown">
          {{ countdown }}
        </span>
        <button
          class="btn"
          :class="{ on: ready }"
          data-testid="bdv-trade-ready"
          :disabled="submitting || ready"
          @click="emit('ready')"
        >
          {{ ready ? 'Ready ✓' : "I'm done" }}
        </button>
      </div>
    </header>

    <p v-if="yourNeeds.length" class="needs" data-testid="bdv-your-needs">
      <span v-for="need in yourNeeds" :key="need.stage" class="need">
        <strong>{{ need.stage.replace('_', ' ') }}</strong>
        needs {{ need.indices.map(squareName).join(', ') }}
      </span>
    </p>
    <p v-else class="needs muted">
      No stage is within reach — sell into someone else's, or sit this one out.
    </p>

    <!-- ----------------------------------------------------- offers to you -->
    <div v-if="incoming.length" class="offers" data-testid="bdv-incoming-offers">
      <h4>On the table for you</h4>
      <article v-for="offer in incoming" :key="offer.id" class="offer">
        <p class="terms">
          <strong>{{ nameOf(offer.from_seat) }}</strong> gives
          <em>{{ describe(offer.give_squares, offer.give_credits) }}</em>
          for
          <em>{{ describe(offer.want_squares, offer.want_credits) }}</em>
        </p>
        <p v-if="offer.note" class="note">“{{ offer.note }}”</p>
        <div class="row">
          <button
            class="btn btn--primary"
            :data-testid="`bdv-accept-${offer.id}`"
            :disabled="submitting"
            @click="emit('accept', offer.id)"
          >
            Accept
          </button>
          <button
            class="btn"
            :data-testid="`bdv-counter-${offer.id}`"
            :disabled="submitting"
            @click="startCounter(offer)"
          >
            Counter
          </button>
          <button
            class="btn btn--quiet"
            :data-testid="`bdv-decline-${offer.id}`"
            :disabled="submitting"
            @click="emit('decline', offer.id)"
          >
            Decline
          </button>
        </div>
      </article>
    </div>

    <!-- ---------------------------------------------------------- builder -->
    <div class="builder">
      <div class="side">
        <h4>You give</h4>
        <ul class="book" data-testid="bdv-your-book">
          <li v-for="square in yourBook" :key="square.index">
            <button
              class="chip"
              :class="{ on: giveSquares.includes(square.index) }"
              :data-testid="`bdv-give-${square.index}`"
              @click="toggle(giveSquares as any, square.index)"
            >
              {{ square.name }}
              <em>{{ square.mortgage_value }}</em>
            </button>
            <span
              v-if="square.wantedBy.length"
              class="wanted"
              :title="square.wantedBy.map(nameOf).join(', ') + ' need this'"
            >
              wanted by {{ square.wantedBy.map(nameOf).join(', ') }}
            </span>
          </li>
        </ul>
        <label class="credits">
          plus
          <input
            v-model.number="giveCredits"
            type="number"
            min="0"
            :max="cash"
            data-testid="bdv-give-credits"
          />
          {{ currencyLabel }}
          <span class="muted">of {{ cash }}</span>
        </label>
      </div>

      <div class="side">
        <div class="partner-row">
          <h4>You get from</h4>
          <select v-model.number="partner" data-testid="bdv-partner">
            <option
              v-for="seat in counterparties"
              :key="seat.index"
              :value="seat.index"
            >
              {{ nameOf(seat.index) }} · {{ seat.cash }} {{ currencyLabel }}
            </option>
          </select>
        </div>
        <ul class="book" data-testid="bdv-their-book">
          <li v-for="square in theirBook" :key="square.index">
            <button
              class="chip"
              :class="{ on: wantSquares.includes(square.index) }"
              :data-testid="`bdv-want-${square.index}`"
              @click="toggle(wantSquares as any, square.index)"
            >
              {{ square.name }}
              <em>{{ square.mortgage_value }}</em>
            </button>
            <span
              v-if="square.wantedBy.includes(yourSeat as number)"
              class="wanted mine"
            >
              completes your stage
            </span>
          </li>
        </ul>
        <label class="credits">
          plus
          <input
            v-model.number="wantCredits"
            type="number"
            min="0"
            data-testid="bdv-want-credits"
          />
          {{ currencyLabel }}
        </label>
      </div>
    </div>

    <footer class="foot">
      <span class="balance" :class="{ up: balance > 0, down: balance < 0 }">
        face value {{ balance > 0 ? '+' : '' }}{{ balance }} {{ currencyLabel }}
      </span>
      <span v-if="counteringOffer !== null" class="countering">
        countering {{ nameOf(activePartner as number) }}'s offer
      </span>
      <button class="btn btn--quiet" :disabled="submitting" @click="clear">
        Clear
      </button>
      <button
        class="btn btn--primary"
        data-testid="bdv-propose"
        :disabled="!canPropose"
        @click="send"
      >
        {{ counteringOffer !== null ? 'Send counter' : 'Propose' }}
      </button>
    </footer>

    <div v-if="outgoing.length" class="offers out" data-testid="bdv-outgoing-offers">
      <h4>Waiting on an answer</h4>
      <article v-for="offer in outgoing" :key="offer.id" class="offer">
        <p class="terms">
          To <strong>{{ nameOf(offer.to_seat) }}</strong>:
          <em>{{ describe(offer.give_squares, offer.give_credits) }}</em> for
          <em>{{ describe(offer.want_squares, offer.want_credits) }}</em>
        </p>
        <button
          class="btn btn--quiet"
          :data-testid="`bdv-withdraw-${offer.id}`"
          :disabled="submitting"
          @click="emit('decline', offer.id)"
        >
          Withdraw
        </button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.bdv-trade {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 18px 20px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  border-bottom: 1px solid #e9ecef;
  padding-bottom: 12px;
}
.head h3 { margin: 0; color: #2c3e50; font-size: 17px; }
.sub { margin: 4px 0 0; font-size: 13px; color: #6c757d; }
.head-right { display: flex; align-items: center; gap: 10px; }
.clock {
  font-weight: 800; font-size: 18px; color: #c0392b;
  font-variant-numeric: tabular-nums; background: #fff5f5;
  padding: 4px 12px; border-radius: 14px;
}
.needs { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }
.need {
  background: #eef7fd; border: 1px solid #d6e9f8; color: #2c3e50;
  padding: 4px 10px; border-radius: 12px;
}
.muted { color: #6c757d; font-size: 12px; }

.offers { margin-top: 16px; }
.offers h4, .side h4 { margin: 0 0 8px; font-size: 13px; color: #2c3e50; }
.offer {
  border: 1px solid #e9ecef; border-left: 3px solid #3498db;
  border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-wrap: wrap;
}
.offers.out .offer { border-left-color: #ced4da; }
.terms { margin: 0; font-size: 13px; color: #2c3e50; }
.terms em { font-style: normal; font-weight: 600; }
.note { margin: 4px 0 0; font-size: 12px; color: #6c757d; }
.row { display: flex; gap: 6px; }

.builder {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px;
}
@media (max-width: 900px) { .builder { grid-template-columns: 1fr; } }
.side {
  border: 1px solid #e9ecef; border-radius: 8px; padding: 12px; background: #fdfdfe;
}
.partner-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.partner-row select {
  padding: 5px 8px; border: 1px solid #ced4da; border-radius: 4px;
  font-size: 13px; color: #2c3e50; background: #fff;
}
.book { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.book li { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.chip {
  flex: 1; text-align: left; padding: 6px 10px; border: 1px solid #ced4da;
  border-radius: 14px; background: #fff; font-size: 12px; color: #2c3e50;
  cursor: pointer;
}
.chip:hover { border-color: #3498db; }
.chip.on { background: #3498db; border-color: #3498db; color: #fff; font-weight: 600; }
.chip em { float: right; font-style: normal; opacity: 0.7; }
.wanted { font-size: 11px; color: #7a5b00; background: #fff8e6; padding: 2px 7px; border-radius: 9px; }
.wanted.mine { color: #1e7e34; background: #eaf7ee; }
.credits { display: block; margin-top: 10px; font-size: 12px; color: #6c757d; }
.credits input {
  width: 100px; padding: 5px 8px; border: 1px solid #ced4da;
  border-radius: 4px; font-size: 13px; margin: 0 5px;
}

.foot {
  display: flex; align-items: center; gap: 10px; margin-top: 14px;
  padding-top: 12px; border-top: 1px solid #e9ecef;
}
.balance { font-size: 12px; color: #6c757d; margin-right: auto; }
.balance.up { color: #1e7e34; }
.balance.down { color: #c0392b; }
.countering { font-size: 12px; color: #3498db; }

.btn {
  padding: 7px 14px; border: 1px solid #ced4da; border-radius: 4px;
  background: #fff; color: #2c3e50; font-size: 13px; cursor: pointer;
}
.btn:hover:not(:disabled) { background: #f8f9fa; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn--primary { background: #3498db; border-color: #3498db; color: #fff; }
.btn--primary:hover:not(:disabled) { background: #2c85c4; }
.btn--quiet { color: #6c757d; }
.btn.on { background: #eaf7ee; border-color: #b7e0c4; color: #1e7e34; }
</style>
