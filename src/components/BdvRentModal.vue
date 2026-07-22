<script setup lang="ts">
/**
 * The rent demand (S146-9).
 *
 * Debtor: agree, or counter once. Owner: accept the counter, or insist.
 *
 * The countdown is DISPLAY ONLY — the server owns the 60-second auto-agree and
 * records it as an action. A tab that is asleep must not get a different
 * outcome from one that is awake.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  demand: any;
  seats: any[];
  yourSeat: number | null;
  cash: number;
  currencyLabel: string;
  deadlineAt: string | null;
  submitting: boolean;
  /** What the debtor could raise by selling/borrowing — informs the owner. */
  debtorCash: number;
  /** The debtor's tradeable squares, for settling in kind. */
  estate?: Array<{ index: number; name: string; mortgage_value: number; houses: number; pledged: boolean }>;
}>();

const emit = defineEmits<{
  (e: 'agree'): void;
  (e: 'offer', amount: number): void;
  (e: 'offer-property', square: number): void;
  (e: 'accept'): void;
  (e: 'insist'): void;
  (e: 'raise-cash'): void;
}>();

const now = ref(Date.now());
let clock: number | null = null;
onMounted(() => {
  clock = window.setInterval(() => (now.value = Date.now()), 500);
});
onBeforeUnmount(() => {
  if (clock !== null) window.clearInterval(clock);
});

const secondsLeft = computed(() => {
  if (!props.deadlineAt) return null;
  const ms = new Date(props.deadlineAt).getTime() - now.value;
  return Math.max(0, Math.ceil(ms / 1000));
});

const isDebtor = computed(() => props.demand?.debtor_seat === props.yourSeat);
const isOwner = computed(() => props.demand?.owner_seat === props.yourSeat);
const due = computed(() => props.demand?.due ?? props.demand?.amount ?? 0);
const shortfall = computed(() => Math.max(0, due.value - props.cash));

/** Default to half — a sensible opening bid, so the field is never empty. */
const counter = ref(Math.max(1, Math.floor((props.demand?.amount ?? 2) / 2)));
const counterValid = computed(
  () => counter.value > 0 && counter.value < (props.demand?.amount ?? 0),
);

/** One-tap counters. Typing a number was the friction. */
const presets = computed(() => {
  const rent = props.demand?.amount ?? 0;
  return [0.25, 0.5, 0.75]
    .map((share) => Math.max(1, Math.floor(rent * share)))
    .filter((value, index, all) => value < rent && all.indexOf(value) === index);
});

/** Squares that could settle the debt in kind, best match first. */
const tradeable = computed(() =>
  (props.estate ?? [])
    .filter((square) => !square.pledged && square.houses === 0)
    .map((square) => ({
      ...square,
      delta: Math.abs(square.mortgage_value - (props.demand?.amount ?? 0)),
    }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 4),
);

function nameOf(seatIndex: number) {
  return props.seats?.[seatIndex]?.display_name ?? `Seat ${seatIndex + 1}`;
}
</script>

<template>
  <div class="bdv-modal-backdrop" data-testid="bdv-rent-modal">
    <div class="bdv-modal">
      <header>
        <h3 v-if="isDebtor">Rent demanded</h3>
        <h3 v-else-if="isOwner">Your rent</h3>
        <h3 v-else>Rent under negotiation</h3>
        <span v-if="secondsLeft !== null" class="clock" data-testid="bdv-rent-countdown">
          {{ secondsLeft }}s
        </span>
      </header>

      <p class="line">
        <strong>{{ nameOf(demand.debtor_seat) }}</strong> owes
        <strong>{{ nameOf(demand.owner_seat) }}</strong>
        <span class="amount">{{ demand.amount }} {{ currencyLabel }}</span>
      </p>
      <p v-if="demand.offered !== null" class="line offered" data-testid="bdv-rent-offer">
        Counter-offer on the table: <strong>{{ demand.offered }} {{ currencyLabel }}</strong>
      </p>

      <!-- ---------------------------------------------------------- debtor -->
      <template v-if="isDebtor">
        <p v-if="shortfall > 0" class="warn" data-testid="bdv-rent-short">
          You are {{ shortfall }} {{ currencyLabel }} short. Sell something or borrow
          against your book first.
        </p>

        <div class="actions">
          <button
            class="btn btn--primary"
            data-testid="bdv-rent-agree"
            :disabled="submitting || shortfall > 0"
            @click="emit('agree')"
          >
            Agree to pay {{ due }} {{ currencyLabel }}
            <span v-if="secondsLeft !== null" class="pill" data-testid="bdv-agree-countdown">
              {{ secondsLeft }}s
            </span>
          </button>
          <button
            v-if="shortfall > 0"
            class="btn"
            data-testid="bdv-rent-raise"
            @click="emit('raise-cash')"
          >
            Raise cash…
          </button>
        </div>

        <div v-if="!demand.countered" class="negotiate">
          <p class="label">Or offer less — one tap:</p>
          <div class="presets">
            <button
              v-for="value in presets"
              :key="value"
              class="chip"
              :class="{ on: counter === value }"
              :data-testid="`bdv-rent-preset-${value}`"
              :disabled="submitting"
              @click="counter = value"
            >
              {{ value }}
            </button>
            <input
              v-model.number="counter"
              type="number"
              min="1"
              :max="demand.amount - 1"
              class="input"
              data-testid="bdv-rent-counter"
            />
            <button
              class="btn"
              data-testid="bdv-rent-offer-btn"
              :disabled="!counterValid || submitting"
              @click="emit('offer', counter)"
            >
              Offer
            </button>
          </div>

          <template v-if="tradeable.length">
            <p class="label">Or settle with a square instead of cash:</p>
            <div class="presets">
              <button
                v-for="square in tradeable"
                :key="square.index"
                class="chip chip--wide"
                :data-testid="`bdv-rent-property-${square.index}`"
                :disabled="submitting"
                @click="emit('offer-property', square.index)"
              >
                {{ square.name }}
                <em>~{{ square.mortgage_value }}</em>
              </button>
            </div>
          </template>
        </div>
        <p v-else class="muted">You have made your counter — it is their call now.</p>

        <p v-if="secondsLeft !== null" class="muted">
          Doing nothing agrees to the full amount when the timer runs out.
        </p>
      </template>

      <!-- ----------------------------------------------------------- owner -->
      <template v-else-if="isOwner && (demand.offered !== null || demand.offered_square !== null)">
        <p class="muted">
          They hold {{ debtorCash }} {{ currencyLabel }}. Forcing a sale can destroy
          value you might rather buy.
        </p>
        <p v-if="demand.offered_square !== null" class="line offered">
          They offer a square instead of cash.
        </p>
        <div class="actions">
          <button
            class="btn btn--primary"
            data-testid="bdv-rent-accept"
            :disabled="submitting"
            @click="emit('accept')"
          >
            <template v-if="demand.offered_square !== null">Take the square</template>
            <template v-else>Accept {{ demand.offered }} {{ currencyLabel }}</template>
          </button>
          <button
            class="btn"
            data-testid="bdv-rent-insist"
            :disabled="submitting"
            @click="emit('insist')"
          >
            Insist on {{ demand.amount }}
          </button>
        </div>
      </template>

      <p v-else class="muted" data-testid="bdv-rent-waiting">
        Waiting for {{ nameOf(demand.debtor_seat) }} to answer…
      </p>
    </div>
  </div>
</template>

<style scoped>
.bdv-modal-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(44, 62, 80, 0.35);
  border-radius: 10px;
  z-index: 20;
}
.bdv-modal {
  width: min(420px, 92%);
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 8px 28px rgba(44, 62, 80, 0.25);
}
header { display: flex; justify-content: space-between; align-items: center; }
header h3 { margin: 0; color: #2c3e50; font-size: 16px; }
.clock {
  font-weight: 800; color: #c0392b; font-variant-numeric: tabular-nums;
  background: #fff5f5; padding: 2px 9px; border-radius: 12px; font-size: 13px;
}
.line { margin: 10px 0 0; color: #2c3e50; font-size: 14px; }
.amount { font-weight: 800; color: #c0392b; margin-left: 6px; }
.offered { color: #6c757d; }
.warn {
  margin: 10px 0 0; padding: 8px 10px; background: #fff8e6;
  border-left: 3px solid #f0a202; border-radius: 4px; font-size: 13px; color: #7a5b00;
}
.muted { margin: 8px 0 0; font-size: 12px; color: #6c757d; }
.actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.negotiate { margin-top: 14px; }
.label { margin: 10px 0 5px; font-size: 12px; font-weight: 600; color: #2c3e50; }
.presets { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.chip {
  padding: 5px 11px; border: 1px solid #ced4da; border-radius: 14px; background: #fff;
  font-size: 12px; cursor: pointer; color: #2c3e50;
}
.chip:hover:not(:disabled) { border-color: #3498db; }
.chip.on { background: #3498db; border-color: #3498db; color: #fff; font-weight: 600; }
.chip--wide em { font-style: normal; color: #6c757d; margin-left: 5px; }
.pill {
  margin-left: 7px; padding: 1px 7px; border-radius: 9px;
  background: rgba(255,255,255,.25); font-size: 11px; font-variant-numeric: tabular-nums;
}
.input {
  padding: 5px 9px; width: 92px;
  border: 1px solid #ced4da; border-radius: 4px; font-size: 14px;
}
.btn {
  padding: 8px 14px; border: 1px solid #ced4da; border-radius: 4px;
  background: #fff; color: #2c3e50; font-size: 14px; cursor: pointer;
}
.btn:hover:not(:disabled) { background: #f8f9fa; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn--primary { background: #3498db; border-color: #3498db; color: #fff; }
.btn--primary:hover:not(:disabled) { background: #2c85c4; }
</style>
