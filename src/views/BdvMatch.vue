<script setup lang="ts">
/**
 * The match page: 70 % board / 30 % game chat.
 *
 * Below the md breakpoint the layout stacks — the split is a desktop
 * affordance and must not be forced onto a phone.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBdvMatchStore } from '../stores/bdvMatch';
import BdvBoardCanvas from '../components/BdvBoardCanvas.vue';
import BdvOptionCards from '../components/BdvOptionCards.vue';

const route = useRoute();
const store = useBdvMatchStore();
const pollTimer = ref<number | null>(null);

const matchId = computed(() => String(route.params.matchId));
const seats = computed(() => store.matchState?.seats ?? []);
const currencyLabel = computed(() => store.spec?.board?.currency_label ?? 'cr');

async function refresh() {
  await store.refreshState();
}

function startPolling() {
  stopPolling();
  // Poll only while it is NOT our turn, and never while the tab is hidden.
  // Deliberately not SSE: a turn-based game does not need a long-lived stream,
  // and SSE behind the proxy has bitten this platform twice.
  pollTimer.value = window.setInterval(() => {
    if (document.hidden || store.isYourTurn || store.isFinished) return;
    refresh();
  }, 2500);
}

function stopPolling() {
  if (pollTimer.value !== null) {
    window.clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

onMounted(async () => {
  await store.load(matchId.value);
  startPolling();
});

watch(matchId, async (id) => {
  await store.load(id);
});

onBeforeUnmount(stopPolling);

/** Board click and chat-card tap funnel into the SAME action. */
function choose(steps: number) {
  return store.chooseOption(steps);
}
</script>

<template>
  <div class="bdv-match" data-testid="bdv-match">
    <section class="bdv-pane-board">
      <header class="bdv-header">
        <h1>{{ store.spec?.board?.game_display_name || 'BizDevVibes' }}</h1>
        <p v-if="store.isFinished" data-testid="bdv-finished">
          {{ $t('bdv.match.finished') }}
        </p>
        <p v-else-if="store.isYourTurn" data-testid="bdv-your-turn">
          {{ $t('bdv.match.yourMove') }}
        </p>
      </header>

      <BdvBoardCanvas
        v-if="store.spec"
        :squares="store.squares"
        :seats="seats"
        :ownership="store.matchState?.ownership ?? {}"
        :option-by-target="store.optionByTarget"
        :your-seat="store.yourSeat"
        :turn-seat="store.matchState?.turn_seat ?? 0"
        :currency-label="currencyLabel"
        @choose="choose"
      >
        <template #centre>
          <BdvOptionCards
            :options="store.options"
            :phase="store.phase"
            :is-your-turn="store.isYourTurn"
            :currency-label="currencyLabel"
            :submitting="store.submitting"
            @roll="store.roll()"
            @close-negotiation="store.closeNegotiation()"
            @choose="choose"
            @end-turn="store.endTurn()"
            @buy="store.buyProperty()"
          />
        </template>
      </BdvBoardCanvas>

      <ul class="bdv-seats" data-testid="bdv-seats">
        <li v-for="seat in seats" :key="seat.index" :class="{ 'is-you': seat.index === store.yourSeat }">
          <strong>{{ store.match?.seats?.[seat.index]?.display_name || `Seat ${seat.index + 1}` }}</strong>
          <span>{{ seat.cash }} {{ currencyLabel }}</span>
          <span v-if="seat.bankrupt" class="bdv-bankrupt">bankrupt</span>
        </li>
      </ul>
    </section>

    <aside class="bdv-pane-chat" data-testid="bdv-chat">
      <h2>{{ $t('bdv.match.chat') }}</h2>
      <!--
        The chat pane mounts the existing meinchat room widget when the bot
        bridge is installed. It is deliberately NOT a second chat implementation
        — that renderer already handles bot_choices cards.
      -->
      <div v-if="store.match?.chat_room_id" class="bdv-chat-mount">
        <component :is="'meinchat-room'" :room-id="store.match.chat_room_id" />
      </div>
      <p v-else class="bdv-chat-fallback">
        {{ $t('bdv.match.board') }} — {{ $t('bdv.match.yourMove') }}
      </p>
    </aside>
  </div>
</template>

<style scoped>
.bdv-match {
  display: grid;
  grid-template-columns: 70% 30%;
  gap: 12px;
  height: calc(100vh - 120px);
  padding: 12px;
}
.bdv-pane-board {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}
.bdv-pane-chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 8px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d8dee6);
  border-radius: 8px;
  overflow-y: auto;
}
.bdv-header h1 {
  margin: 0;
  font-size: 1.1rem;
}
.bdv-seats {
  display: flex;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
  font-size: 0.8rem;
}
.bdv-seats li {
  display: flex;
  gap: 6px;
  padding: 4px 8px;
  background: var(--color-surface-2, #eceff3);
  border-radius: 6px;
}
.bdv-seats li.is-you {
  outline: 2px solid var(--color-primary, #3b6fd4);
}
.bdv-bankrupt {
  color: var(--color-danger, #c0392b);
}
@media (max-width: 900px) {
  .bdv-match {
    grid-template-columns: 1fr;
    height: auto;
  }
  .bdv-pane-chat {
    max-height: 40vh;
  }
}
</style>
