<script setup lang="ts">
/**
 * Your book: build, sell, borrow, repay (S146-10 / S146-11).
 *
 * Opens before the roll, and again when a rent demand leaves you short. It is
 * always skippable — a management screen that blocks the fun part is a tax.
 *
 * Every guard is enforced by the engine; this only decides what to OFFER, so a
 * disabled control here and a refused action there can never disagree.
 */
import { computed, ref } from 'vue';

const props = defineProps<{
  estate: any[];
  loans: any[];
  cash: number;
  currencyLabel: string;
  maxHouses: number;
  submitting: boolean;
  /** Set when opened because the player is short on a rent demand. */
  shortfall?: number;
}>();

const emit = defineEmits<{
  (e: 'build', square: number): void;
  (e: 'sell-house', square: number): void;
  (e: 'sell-square', square: number): void;
  (e: 'borrow', squares: number[], amount: number): void;
  (e: 'repay', loanId: number, amount: number): void;
  (e: 'close'): void;
}>();

const pledgeChoice = ref<number[]>([]);
const advance = ref(0);

const deals = computed(() => props.estate.filter((s) => s.kind === 'deal'));
const freeSquares = computed(() => props.estate.filter((s) => !s.pledged));
/** Half of mortgage value is the classic LTV; the server caps it anyway. */
const maxAdvance = computed(() =>
  Math.floor(
    pledgeChoice.value.reduce((sum, index) => {
      const square = props.estate.find((s) => s.index === index);
      return sum + (square?.mortgage_value ?? 0);
    }, 0) / 2,
  ),
);
const totalDebt = computed(() =>
  props.loans.reduce((sum: number, l: any) => sum + l.outstanding, 0),
);
/** What debt costs per lap — a number a player can act on, unlike "10 %". */
const perLap = computed(() =>
  props.loans.reduce(
    (sum: number, l: any) => sum + Math.ceil((l.outstanding * l.rate_bp) / 10000),
    0,
  ),
);

function togglePledge(index: number) {
  const at = pledgeChoice.value.indexOf(index);
  if (at >= 0) pledgeChoice.value.splice(at, 1);
  else pledgeChoice.value.push(index);
  advance.value = Math.min(advance.value, maxAdvance.value);
}
</script>

<template>
  <div class="bdv-modal-backdrop" data-testid="bdv-estate-panel">
    <div class="bdv-modal">
      <header>
        <h3>Your book</h3>
        <span class="cash">{{ cash }} {{ currencyLabel }}</span>
      </header>

      <p v-if="shortfall" class="warn" data-testid="bdv-estate-shortfall">
        You need {{ shortfall }} {{ currencyLabel }} more. Sell something, or borrow
        against a square and keep it earning.
      </p>

      <p v-if="!estate.length" class="muted">You own nothing yet.</p>

      <table v-else class="tbl">
        <thead>
          <tr><th>Square</th><th>Houses</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="square in estate" :key="square.index">
            <td>
              {{ square.name }}
              <span v-if="square.pledged" class="tag" title="pledged as collateral">pledged</span>
            </td>
            <td>
              <span v-if="square.kind === 'deal'">
                {{ square.houses >= maxHouses ? 'hotel' : square.houses }}
              </span>
              <span v-else class="muted">—</span>
            </td>
            <td class="right">
              <!-- Every affordance below is the SERVER's answer, not a guess
                   made here. The panel used to offer Build on any deal square,
                   so building on an incomplete funnel stage looked available
                   and failed on every click. -->
              <button
                v-if="square.can_build"
                class="btn btn--sm"
                :data-testid="`bdv-build-${square.index}`"
                :disabled="submitting"
                @click="emit('build', square.index)"
              >
                Build {{ square.house_cost }}
              </button>
              <span
                v-else-if="square.build_blocked_because && square.kind === 'deal'"
                class="why"
                :data-testid="`bdv-build-blocked-${square.index}`"
              >
                {{ square.build_blocked_because }}
              </span>
              <button
                v-if="square.can_sell_house"
                class="btn btn--sm"
                :data-testid="`bdv-sell-house-${square.index}`"
                :disabled="submitting"
                @click="emit('sell-house', square.index)"
              >
                Sell house +{{ square.house_refund ?? Math.floor(square.house_cost / 2) }}
              </button>
              <button
                v-if="square.can_sell_square"
                class="btn btn--sm btn--danger"
                :data-testid="`bdv-sell-square-${square.index}`"
                :disabled="submitting"
                @click="emit('sell-square', square.index)"
              >
                Sell +{{ square.mortgage_value }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="freeSquares.length" class="borrow">
        <h4>Borrow against your book</h4>
        <p class="muted">Pledged squares keep earning you rent — that is the point.</p>
        <div class="chips">
          <button
            v-for="square in freeSquares"
            :key="square.index"
            class="chip"
            :class="{ on: pledgeChoice.includes(square.index) }"
            :data-testid="`bdv-pledge-${square.index}`"
            @click="togglePledge(square.index)"
          >
            {{ square.name }}
          </button>
        </div>
        <div v-if="pledgeChoice.length" class="borrow-row">
          <label>
            Advance (max {{ maxAdvance }})
            <input v-model.number="advance" type="number" min="1" :max="maxAdvance" class="input" data-testid="bdv-advance" />
          </label>
          <button
            class="btn btn--primary"
            data-testid="bdv-borrow"
            :disabled="submitting || advance < 1 || advance > maxAdvance"
            @click="emit('borrow', pledgeChoice, advance)"
          >
            Borrow
          </button>
        </div>
      </section>

      <section v-if="loans.length" class="loans" data-testid="bdv-loans">
        <h4>Outstanding debt</h4>
        <p class="cost">
          {{ totalDebt }} {{ currencyLabel }} owed —
          <strong>{{ perLap }} {{ currencyLabel }} every lap</strong> you pass New Quarter.
        </p>
        <div v-for="loan in loans" :key="loan.loan_id" class="loan-row">
          <span>#{{ loan.loan_id }} · {{ loan.outstanding }} {{ currencyLabel }}</span>
          <button
            class="btn btn--sm"
            :data-testid="`bdv-repay-${loan.loan_id}`"
            :disabled="submitting || cash < loan.outstanding"
            @click="emit('repay', loan.loan_id, loan.outstanding)"
          >
            Repay in full
          </button>
        </div>
      </section>

      <footer>
        <button class="btn" data-testid="bdv-estate-close" @click="emit('close')">Done</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.bdv-modal-backdrop {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(44, 62, 80, 0.35); border-radius: 10px; z-index: 20;
}
.bdv-modal {
  width: min(560px, 94%); max-height: 88%; overflow-y: auto; background: #fff;
  border: 1px solid #e9ecef; border-radius: 10px; padding: 18px 20px;
  box-shadow: 0 8px 28px rgba(44, 62, 80, 0.25);
}
header { display: flex; justify-content: space-between; align-items: center; }
header h3 { margin: 0; color: #2c3e50; font-size: 16px; }
.cash { font-weight: 800; color: #3498db; }
h4 { margin: 18px 0 4px; color: #2c3e50; font-size: 14px; }
.muted { margin: 4px 0 0; font-size: 12px; color: #6c757d; }
.warn {
  margin: 10px 0 0; padding: 8px 10px; background: #fff8e6;
  border-left: 3px solid #f0a202; border-radius: 4px; font-size: 13px; color: #7a5b00;
}
.tbl { width: 100%; border-collapse: collapse; margin-top: 12px; }
.tbl th {
  padding: 6px 8px; text-align: left; font-size: 11px; text-transform: uppercase;
  color: #6c757d; border-bottom: 2px solid #e9ecef;
}
.tbl td { padding: 6px 8px; border-bottom: 1px solid #e9ecef; font-size: 13px; color: #2c3e50; }
.right { text-align: right; white-space: nowrap; }
.why { font-size: 11px; color: #8a949e; font-style: italic; }
.tag {
  margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: #f1f3f5;
  font-size: 10px; color: #6c757d;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chip {
  padding: 4px 10px; border: 1px solid #ced4da; border-radius: 14px; background: #fff;
  font-size: 12px; cursor: pointer; color: #2c3e50;
}
.chip.on { background: #3498db; border-color: #3498db; color: #fff; font-weight: 600; }
.borrow-row { display: flex; gap: 10px; align-items: flex-end; margin-top: 10px; }
.borrow-row label { font-size: 12px; color: #2c3e50; }
.input {
  display: block; margin-top: 3px; padding: 6px 9px; width: 130px;
  border: 1px solid #ced4da; border-radius: 4px; font-size: 14px;
}
.cost { margin: 4px 0 0; font-size: 13px; color: #c0392b; }
.loan-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0; border-bottom: 1px solid #e9ecef; font-size: 13px; color: #2c3e50;
}
footer { margin-top: 18px; text-align: right; }
.btn {
  padding: 7px 13px; border: 1px solid #ced4da; border-radius: 4px; background: #fff;
  color: #2c3e50; font-size: 13px; cursor: pointer; margin-left: 4px;
}
.btn:hover:not(:disabled) { background: #f8f9fa; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--sm { padding: 3px 9px; font-size: 12px; }
.btn--primary { background: #3498db; border-color: #3498db; color: #fff; }
.btn--danger { color: #c0392b; border-color: #f0c4bf; }
</style>
