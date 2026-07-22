<script setup lang="ts">
/**
 * The priced option set, as clickable cards — the centre panel of the board.
 *
 * Prices come from the server quote and are never computed here. Unaffordable
 * options are shown with their price and the reason; hiding them would hide
 * the game.
 */
import { computed } from 'vue';
import type { OptionQuote } from '../stores/bdvMatch';

const props = defineProps<{
  options: OptionQuote[];
  phase: string;
  isYourTurn: boolean;
  currencyLabel: string;
  submitting: boolean;
  /** Final standings, once the match is over. */
  seats?: Array<{ index: number; cash: number; bankrupt: boolean }>;
  seatMeta?: Array<{ display_name?: string }>;
  winnerSeat?: number | null;
  /** Null for a spectator — they hold no seat, which is the fight format. */
  yourSeat?: number | null;
  /** Server-computed. Null means this square simply cannot be bought. */
  purchaseOffer?: {
    square_index: number;
    name: string;
    price: number;
    affordable: boolean;
  } | null;
}>();

const emit = defineEmits<{
  (e: 'roll'): void;
  (e: 'close-negotiation'): void;
  (e: 'choose', steps: number): void;
  (e: 'end-turn'): void;
  (e: 'buy'): void;
  (e: 'exit'): void;
}>();

/** Survivors first, then the busted in the order they went out. */
const standings = computed(() =>
  [...(props.seats ?? [])].sort(
    (a, b) => Number(a.bankrupt) - Number(b.bankrupt) || b.cash - a.cash,
  ),
);

function nameOf(index: number) {
  return props.seatMeta?.[index]?.display_name ?? `Seat ${index + 1}`;
}

const REASON_TEXT: Record<string, string> = {
  unowned: 'unowned — you could buy it',
  completes_stage: 'completes your funnel stage',
  own_square: 'yours — nothing happens',
  pays_rent: 'opponent owns it — you pay rent',
  tax: 'a cost square',
  go: 'collect your quarterly budget',
  goto_jail: 'straight to compliance hold',
  draw_card: 'draw a card',
  jail_visiting: 'just visiting',
  neutral: 'neutral ground',
};
</script>

<template>
  <div class="bdv-panel" data-testid="bdv-options">
    <!-- The result outranks everything. A finished match that still says
         "waiting for the other seats" reads as a hung game rather than a won
         one — which is exactly how it looked when every opponent had gone
         bankrupt and the winner was already decided. -->
    <template v-if="phase === 'finished'">
      <p class="bdv-lead bdv-lead--win" data-testid="bdv-result">
        <template v-if="winnerSeat === null || winnerSeat === undefined">
          Everyone is out — no winner.
        </template>
        <template v-else-if="winnerSeat === yourSeat">🏆 You win.</template>
        <template v-else>🏆 {{ nameOf(winnerSeat) }} wins.</template>
      </p>
      <ol class="bdv-standings" data-testid="bdv-standings">
        <li v-for="seat in standings" :key="seat.index" :class="{ out: seat.bankrupt }">
          <span class="nm">{{ nameOf(seat.index) }}</span>
          <span v-if="seat.bankrupt" class="tag">bankrupt</span>
          <span v-else class="cash">{{ seat.cash }} {{ currencyLabel }}</span>
        </li>
      </ol>
      <button class="bdv-cta" data-testid="bdv-close-finished" @click="emit('exit')">
        Close
      </button>
    </template>

    <template v-else-if="isYourTurn && phase === 'await_roll'">
      <p class="bdv-lead">Two dice. Three ways to move.</p>
      <button class="bdv-cta" data-testid="bdv-roll" :disabled="submitting" @click="emit('roll')">
        🎲 Roll the dice
      </button>
    </template>

    <template v-else-if="isYourTurn && phase === 'negotiate'">
      <p class="bdv-lead">Negotiation window open</p>
      <p class="bdv-hint">Opponents may pay you to take the free sum. Close it to choose.</p>
      <button class="bdv-cta" data-testid="bdv-close-negotiation" :disabled="submitting" @click="emit('close-negotiation')">
        See my options →
      </button>
    </template>

    <template v-else-if="isYourTurn && phase === 'await_choice'">
      <p class="bdv-lead">Your move — the sum is free</p>
      <ul class="bdv-cards">
        <li v-for="option in options" :key="option.steps">
          <button
            class="bdv-card"
            :class="{ locked: !option.affordable, free: option.is_sum }"
            :data-testid="`bdv-option-${option.steps}`"
            :disabled="!option.affordable || submitting"
            @click="emit('choose', option.steps)"
          >
            <span class="mv">+{{ option.steps }}</span>
            <span class="tg">
              <strong>{{ option.target_name }}</strong>
              <em>{{ REASON_TEXT[option.reason] || option.reason }}</em>
            </span>
            <span class="pr" data-testid="bdv-option-price">
              <template v-if="option.is_sum">free<small>fate</small></template>
              <template v-else>
                {{ option.price }}<small>{{ currencyLabel }}</small>
              </template>
            </span>
          </button>
          <p v-if="!option.affordable" class="bdv-locked-note">over your 30 % cap</p>
        </li>
      </ul>
    </template>

    <template v-else-if="isYourTurn">
      <p class="bdv-lead">{{ purchaseOffer ? 'This square is for sale' : 'Resolving…' }}</p>

      <!-- Only offered when the server says the purchase would actually succeed.
           A button that always fails is worse than no button. -->
      <button
        v-if="purchaseOffer && purchaseOffer.affordable"
        class="bdv-cta bdv-cta--ghost"
        data-testid="bdv-buy"
        :disabled="submitting"
        @click="emit('buy')"
      >
        Buy {{ purchaseOffer.name }} — {{ purchaseOffer.price }} {{ currencyLabel }}
      </button>
      <p
        v-else-if="purchaseOffer"
        class="bdv-hint"
        data-testid="bdv-buy-unaffordable"
      >
        {{ purchaseOffer.name }} costs {{ purchaseOffer.price }} {{ currencyLabel }} — you cannot cover it.
      </p>

      <!-- Only reachable when there IS something to decide: a turn with no
           purchase on offer ends itself server-side, so this button is never
           the sole content of the panel. -->
      <button
        v-if="purchaseOffer"
        class="bdv-cta"
        data-testid="bdv-end-turn"
        :disabled="submitting"
        @click="emit('end-turn')"
      >
        {{ purchaseOffer.affordable ? 'Skip it' : 'End turn' }}
      </button>
      <p v-else class="bdv-hint">Nothing to decide — moving on.</p>
    </template>

    <p v-else-if="yourSeat === null" class="bdv-waiting" data-testid="bdv-watching">
      Watching — the agents are playing it out.
    </p>
    <p v-else class="bdv-waiting">Waiting for the other seats…</p>
  </div>
</template>

<style scoped>
.bdv-lead--win { font-size: 18px; color: #1e7e34; font-weight: 700; }
.bdv-standings {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  width: 100%;
  max-width: 320px;
}
.bdv-standings li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  margin-bottom: 6px;
  background: #fff;
  font-size: 13px;
  color: #2c3e50;
}
.bdv-standings li.out { opacity: 0.6; }
.bdv-standings .nm { font-weight: 600; }
.bdv-standings .cash { font-variant-numeric: tabular-nums; color: #1e7e34; font-weight: 600; }
.bdv-standings .tag { font-size: 11px; color: #c0392b; }

.bdv-panel {
  width: 100%;
  max-width: 340px;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 2px 10px rgba(44, 62, 80, 0.06);
  text-align: center;
}

.bdv-lead { margin: 0 0 4px; font-weight: 700; color: #2c3e50; font-size: 14px; }
.bdv-hint { margin: 0 0 10px; font-size: 12px; color: #6c757d; }
.bdv-waiting { margin: 0; color: #6c757d; font-size: 13px; }

.bdv-cta {
  width: 100%;
  padding: 10px 16px;
  margin-top: 8px;
  background: #3498db;
  color: #fff;
  border: 1px solid #3498db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.bdv-cta:hover:not(:disabled) { background: #2c85c4; }
.bdv-cta:disabled { opacity: 0.55; cursor: not-allowed; }
.bdv-cta--ghost { background: #fff; color: #2c3e50; border-color: #ced4da; }
.bdv-cta--ghost:hover:not(:disabled) { background: #f8f9fa; }

.bdv-row { display: flex; gap: 8px; }

.bdv-cards { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }

.bdv-card {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  text-align: left;
  background: #fff;
  border: 1px solid #ced4da;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.bdv-card:hover:not(:disabled) { border-color: #3498db; background: #f4faff; }
.bdv-card.free { border-color: #28a745; }
.bdv-card.free:hover:not(:disabled) { background: #f3fbf5; }
.bdv-card.locked { opacity: 0.55; cursor: not-allowed; }

.mv {
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: #2c3e50; color: #fff;
  font-weight: 800; font-size: 13px;
}
.bdv-card.free .mv { background: #28a745; }

.tg { display: flex; flex-direction: column; min-width: 0; }
.tg strong { font-size: 13px; color: #2c3e50; }
.tg em { font-style: normal; font-size: 11px; color: #6c757d; }

.pr { font-size: 15px; font-weight: 800; color: #3498db; white-space: nowrap; }
.bdv-card.free .pr { color: #28a745; }
.pr small { display: block; font-size: 9px; font-weight: 600; color: #98a2b0; text-transform: uppercase; }

.bdv-locked-note { margin: 2px 0 0 40px; font-size: 10px; color: #c0392b; text-align: left; }
</style>
