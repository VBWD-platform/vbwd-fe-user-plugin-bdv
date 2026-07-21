<script setup lang="ts">
/**
 * The board, rendered from the match's spec snapshot.
 *
 * Nothing here is hard-coded to the seeded board: a spec with different squares
 * renders a different board with no code change. Priced options are overlaid on
 * their destination squares — unaffordable ones stay VISIBLE with their price,
 * because seeing what you cannot afford is the mechanic, not an error state.
 */
import { computed } from 'vue';
import type { OptionQuote } from '../stores/bdvMatch';

const props = defineProps<{
  squares: any[];
  seats: any[];
  ownership: Record<string, number | null>;
  optionByTarget: Record<number, OptionQuote>;
  yourSeat: number | null;
  turnSeat: number;
  currencyLabel?: string;
}>();

const emit = defineEmits<{ (e: 'choose', steps: number): void }>();

const SIDE = 11;

/** Perimeter layout: bottom row right-to-left from GO, then up the left side. */
const positioned = computed(() =>
  props.squares.map((square) => {
    const index = square.index;
    const total = props.squares.length;
    const perSide = Math.max(2, Math.round(total / 4));
    let row = SIDE - 1;
    let col = SIDE - 1;
    if (index <= perSide) {
      row = SIDE - 1;
      col = SIDE - 1 - index;
    } else if (index <= perSide * 2) {
      row = SIDE - 1 - (index - perSide);
      col = 0;
    } else if (index <= perSide * 3) {
      row = 0;
      col = index - perSide * 2;
    } else {
      row = index - perSide * 3;
      col = SIDE - 1;
    }
    return { square, row: row + 1, col: col + 1 };
  }),
);

function seatsOn(index: number) {
  return props.seats.filter((seat) => seat.position === index && !seat.bankrupt);
}

function ownerOf(index: number): number | null {
  return props.ownership?.[String(index)] ?? null;
}

function quoteFor(index: number): OptionQuote | undefined {
  return props.optionByTarget[index];
}

function onSquareClick(index: number) {
  const quote = quoteFor(index);
  if (quote && quote.affordable) emit('choose', quote.steps);
}
</script>

<template>
  <div class="bdv-board" data-testid="bdv-board">
    <div
      v-for="entry in positioned"
      :key="entry.square.index"
      class="bdv-square"
      :class="[
        `bdv-kind-${entry.square.kind}`,
        {
          'is-option': !!quoteFor(entry.square.index),
          'is-locked': quoteFor(entry.square.index) && !quoteFor(entry.square.index)!.affordable,
          'is-owned': ownerOf(entry.square.index) !== null,
        },
      ]"
      :style="{ gridRow: entry.row, gridColumn: entry.col }"
      :data-testid="`bdv-square-${entry.square.index}`"
      @click="onSquareClick(entry.square.index)"
    >
      <span v-if="entry.square.stage" class="bdv-stage" :data-stage="entry.square.stage" />
      <span class="bdv-name">{{ entry.square.name }}</span>

      <span v-if="quoteFor(entry.square.index)" class="bdv-price" data-testid="bdv-price">
        {{
          quoteFor(entry.square.index)!.is_sum
            ? $t('bdv.match.free')
            : `${quoteFor(entry.square.index)!.price} ${currencyLabel || 'cr'}`
        }}
      </span>

      <span class="bdv-tokens">
        <span
          v-for="seat in seatsOn(entry.square.index)"
          :key="seat.index"
          class="bdv-token"
          :class="{ 'is-you': seat.index === yourSeat, 'is-turn': seat.index === turnSeat }"
          >{{ seat.index + 1 }}</span
        >
      </span>
    </div>

    <div class="bdv-centre">
      <slot name="centre" />
    </div>
  </div>
</template>

<style scoped>
.bdv-board {
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  grid-template-rows: repeat(11, minmax(0, 1fr));
  gap: 2px;
  aspect-ratio: 1;
  width: 100%;
  max-height: 100%;
  background: var(--color-surface-2, #eceff3);
  padding: 4px;
  border-radius: 8px;
}
.bdv-square {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 3px;
  font-size: 0.58rem;
  line-height: 1.1;
  overflow: hidden;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d8dee6);
  border-radius: 3px;
  cursor: default;
}
.bdv-square.is-option {
  cursor: pointer;
  border-color: var(--color-primary, #3b6fd4);
  box-shadow: inset 0 0 0 2px var(--color-primary, #3b6fd4);
}
.bdv-square.is-locked {
  cursor: not-allowed;
  opacity: 0.55;
}
.bdv-square.is-owned {
  background: var(--color-surface-3, #f4f7fb);
}
.bdv-stage {
  display: block;
  height: 5px;
  margin: -3px -3px 2px;
  background: var(--color-accent, #8fa9d8);
}
.bdv-name {
  font-weight: 500;
  word-break: break-word;
}
.bdv-price {
  font-weight: 700;
  color: var(--color-primary, #3b6fd4);
}
.bdv-tokens {
  display: flex;
  gap: 2px;
}
.bdv-token {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  font-size: 0.5rem;
  border-radius: 50%;
  background: var(--color-text-muted, #7b8794);
  color: var(--color-surface, #fff);
}
.bdv-token.is-you {
  background: var(--color-primary, #3b6fd4);
}
.bdv-token.is-turn {
  outline: 2px solid var(--color-warning, #e2a03f);
}
.bdv-centre {
  grid-row: 2 / 11;
  grid-column: 2 / 11;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
</style>
