<script setup lang="ts">
/**
 * The priced option set, as clickable cards.
 *
 * Prices come from the server quote and are never computed here. Unaffordable
 * options are shown with their price and a reason — hiding them would hide the
 * game.
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
</script>

<template>
  <div class="bdv-options" data-testid="bdv-options">
    <button
      v-if="isYourTurn && phase === 'await_roll'"
      class="bdv-btn bdv-btn-primary"
      data-testid="bdv-roll"
      :disabled="submitting"
      @click="emit('roll')"
    >
      {{ $t('bdv.match.roll') }}
    </button>

    <button
      v-else-if="isYourTurn && phase === 'negotiate'"
      class="bdv-btn"
      data-testid="bdv-close-negotiation"
      :disabled="submitting"
      @click="emit('close-negotiation')"
    >
      {{ $t('bdv.match.yourMove') }}
    </button>

    <template v-else-if="isYourTurn && phase === 'await_choice'">
      <button
        v-for="option in options"
        :key="option.steps"
        class="bdv-card"
        :class="{ 'is-locked': !option.affordable, 'is-free': option.is_sum }"
        :data-testid="`bdv-option-${option.steps}`"
        :disabled="!option.affordable || submitting"
        @click="emit('choose', option.steps)"
      >
        <span class="bdv-card-move">+{{ option.steps }}</span>
        <span class="bdv-card-target">{{ option.target_name }}</span>
        <span class="bdv-card-reason">
          {{ $t(`bdv.reason.${option.reason}`, option.reason_params as any) }}
        </span>
        <span class="bdv-card-price" data-testid="bdv-option-price">
          <template v-if="option.is_sum">{{ $t('bdv.match.free') }}</template>
          <template v-else>
            {{ option.price }} {{ currencyLabel }}
            <em v-if="!option.affordable">— {{ $t('bdv.match.over_cap') }}</em>
          </template>
        </span>
      </button>
    </template>

    <div v-else-if="isYourTurn" class="bdv-turn-actions">
      <button class="bdv-btn" data-testid="bdv-buy" :disabled="submitting" @click="emit('buy')">
        {{ $t('bdv.match.buy', { price: '' }) }}
      </button>
      <button class="bdv-btn" data-testid="bdv-end-turn" :disabled="submitting" @click="emit('end-turn')">
        {{ $t('bdv.match.endTurn') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.bdv-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 320px;
}
.bdv-card {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: 'move target' 'move reason' 'move price';
  gap: 0 8px;
  padding: 8px 10px;
  text-align: left;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d8dee6);
  border-radius: 6px;
  cursor: pointer;
}
.bdv-card.is-free {
  border-color: var(--color-success, #3a9d5d);
}
.bdv-card.is-locked {
  cursor: not-allowed;
  opacity: 0.6;
}
.bdv-card-move {
  grid-area: move;
  align-self: center;
  font-size: 1.2rem;
  font-weight: 700;
}
.bdv-card-target {
  grid-area: target;
  font-weight: 600;
}
.bdv-card-reason {
  grid-area: reason;
  font-size: 0.75rem;
  color: var(--color-text-muted, #7b8794);
}
.bdv-card-price {
  grid-area: price;
  font-weight: 700;
  color: var(--color-primary, #3b6fd4);
}
.bdv-btn {
  padding: 8px 12px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d8dee6);
  border-radius: 6px;
  cursor: pointer;
}
.bdv-btn-primary {
  background: var(--color-primary, #3b6fd4);
  color: var(--color-surface, #fff);
  border-color: var(--color-primary, #3b6fd4);
}
.bdv-turn-actions {
  display: flex;
  gap: 6px;
}
</style>
