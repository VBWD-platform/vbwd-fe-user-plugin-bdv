<script setup lang="ts">
/**
 * The priced option set, as clickable cards — the centre panel of the board.
 *
 * Prices come from the server quote and are never computed here. Unaffordable
 * options are shown with their price and the reason; hiding them would hide
 * the game.
 */
import type { OptionQuote } from '../stores/bdvMatch';

defineProps<{
  options: OptionQuote[];
  phase: string;
  isYourTurn: boolean;
  currencyLabel: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  (e: 'roll'): void;
  (e: 'close-negotiation'): void;
  (e: 'choose', steps: number): void;
  (e: 'end-turn'): void;
  (e: 'buy'): void;
}>();

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
    <template v-if="isYourTurn && phase === 'await_roll'">
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
      <p class="bdv-lead">Resolve your turn</p>
      <div class="bdv-row">
        <button class="bdv-cta bdv-cta--ghost" data-testid="bdv-buy" :disabled="submitting" @click="emit('buy')">
          Buy this square
        </button>
        <button class="bdv-cta" data-testid="bdv-end-turn" :disabled="submitting" @click="emit('end-turn')">
          End turn
        </button>
      </div>
    </template>

    <p v-else class="bdv-waiting">Waiting for the other seats…</p>
  </div>
</template>

<style scoped>
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
