<script setup lang="ts">
/**
 * The board, rendered from the match's spec snapshot.
 *
 * Nothing is hard-coded to the seeded board: a spec with different squares
 * renders a different board with no code change. Funnel stages are colour-coded
 * from a fixed palette keyed by stage slug, so a board with new stages still
 * renders (it just falls back to neutral).
 *
 * Priced options are overlaid on their destination squares. Unaffordable ones
 * stay VISIBLE with their price — seeing what you cannot afford is the mechanic.
 */
import { computed } from 'vue';
import type { OptionQuote } from '../stores/bdvMatch';

const props = defineProps<{
  squares: any[];
  seats: any[];
  seatMeta: any[];
  ownership: Record<string, number | null>;
  optionByTarget: Record<number, OptionQuote>;
  yourSeat: number | null;
  turnSeat: number;
  currencyLabel?: string;
}>();

const emit = defineEmits<{ (e: 'choose', steps: number): void }>();

const SIDE = 11;

/** Funnel-stage palette, in pipeline order. */
const STAGE_COLOURS: Record<string, string> = {
  lead_gen: '#8e7cc3',
  outreach: '#6fa8dc',
  qualification: '#76a5af',
  pitch: '#93c47d',
  negotiation: '#ffd966',
  contract: '#f6b26b',
  delivery: '#e06666',
  expansion: '#c27ba0',
};

const SEAT_COLOURS = ['#3498db', '#e06666', '#28a745', '#f0a202', '#8e7cc3', '#17a2b8'];

const positioned = computed(() => {
  const total = props.squares.length;
  const perSide = Math.max(2, Math.round(total / 4));
  return props.squares.map((square) => {
    const index = square.index;
    let row: number;
    let col: number;
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
  });
});

function seatsOn(index: number) {
  return props.seats.filter((seat) => seat.position === index && !seat.bankrupt);
}
function ownerOf(index: number): number | null {
  const owner = props.ownership?.[String(index)];
  return owner === undefined ? null : owner;
}
function quoteFor(index: number): OptionQuote | undefined {
  return props.optionByTarget[index];
}
function stageColour(stage?: string | null) {
  return (stage && STAGE_COLOURS[stage]) || 'transparent';
}
function seatColour(i: number) {
  return SEAT_COLOURS[i % SEAT_COLOURS.length];
}
function onSquareClick(index: number) {
  const quote = quoteFor(index);
  if (quote && quote.affordable) emit('choose', quote.steps);
}
const isCorner = (kind: string) => ['go', 'jail', 'free', 'goto_jail'].includes(kind);
</script>

<template>
  <div class="bdv-board" data-testid="bdv-board">
    <div
      v-for="entry in positioned"
      :key="entry.square.index"
      class="bdv-square"
      :class="[
        `k-${entry.square.kind}`,
        {
          corner: isCorner(entry.square.kind),
          option: !!quoteFor(entry.square.index),
          locked: quoteFor(entry.square.index) && !quoteFor(entry.square.index)!.affordable,
          free: quoteFor(entry.square.index)?.is_sum,
          owned: ownerOf(entry.square.index) !== null,
        },
      ]"
      :style="{ gridRow: entry.row, gridColumn: entry.col }"
      :data-testid="`bdv-square-${entry.square.index}`"
      @click="onSquareClick(entry.square.index)"
    >
      <span
        v-if="entry.square.stage"
        class="bdv-stage"
        :style="{ background: stageColour(entry.square.stage) }"
      />
      <span
        v-if="ownerOf(entry.square.index) !== null"
        class="bdv-owner"
        :style="{ background: seatColour(ownerOf(entry.square.index)!) }"
      />

      <span class="bdv-name">{{ entry.square.name }}</span>
      <span v-if="entry.square.price" class="bdv-cost">{{ entry.square.price }}</span>

      <span v-if="quoteFor(entry.square.index)" class="bdv-price" data-testid="bdv-price">
        {{
          quoteFor(entry.square.index)!.is_sum
            ? 'FREE'
            : `${quoteFor(entry.square.index)!.price} ${currencyLabel || 'cr'}`
        }}
      </span>

      <span class="bdv-tokens">
        <span
          v-for="seat in seatsOn(entry.square.index)"
          :key="seat.index"
          class="bdv-token"
          :class="{ turn: seat.index === turnSeat }"
          :style="{ background: seatColour(seat.index) }"
          :title="seatMeta[seat.index]?.display_name"
          >{{ (seatMeta[seat.index]?.display_name || 'S')[0] }}</span
        >
      </span>
    </div>

    <div class="bdv-centre"><slot name="centre" /></div>
  </div>
</template>

<style scoped>
.bdv-board {
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  grid-template-rows: repeat(11, minmax(0, 1fr));
  gap: 3px;
  aspect-ratio: 1;
  width: 100%;
  max-height: 100%;
  padding: 6px;
  background: #eef1f4;
  border: 1px solid #e9ecef;
  border-radius: 10px;
}

.bdv-square {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1px;
  padding: 14px 4px 3px;
  font-size: 8.5px;
  line-height: 1.15;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e3e7ec;
  border-radius: 4px;
  cursor: default;
}

.bdv-square.corner {
  background: #f8f9fa;
  justify-content: center;
  text-align: center;
  font-weight: 700;
  padding-top: 4px;
}
.bdv-square.k-chance, .bdv-square.k-community { background: #fcfaf3; }
.bdv-square.k-tax { background: #fdf4f4; }

.bdv-square.option {
  cursor: pointer;
  border-color: #3498db;
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.35);
}
.bdv-square.option.free { border-color: #28a745; box-shadow: 0 0 0 2px rgba(40, 167, 69, 0.35); }
.bdv-square.option.locked { cursor: not-allowed; opacity: 0.6; box-shadow: none; border-color: #ced4da; }

.bdv-stage {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 9px;
}
.bdv-owner {
  position: absolute;
  top: 0; right: 0;
  width: 0; height: 0;
  border-left: 10px solid transparent;
  border-top: 10px solid currentColor;
}
.bdv-owner { width: 9px; height: 9px; border: none; border-bottom-left-radius: 4px; }

.bdv-name { font-weight: 600; color: #2c3e50; word-break: break-word; }
.bdv-cost { color: #98a2b0; font-size: 8px; }
.bdv-price {
  margin-top: auto;
  font-weight: 800;
  font-size: 9px;
  color: #3498db;
}
.bdv-square.free .bdv-price { color: #28a745; }

.bdv-tokens { display: flex; gap: 2px; margin-top: 2px; flex-wrap: wrap; }
.bdv-token {
  width: 13px;
  height: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  border: 1.5px solid #fff;
}
.bdv-token.turn { box-shadow: 0 0 0 2px #2c3e50; }

.bdv-centre {
  grid-row: 2 / 11;
  grid-column: 2 / 11;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}
</style>
