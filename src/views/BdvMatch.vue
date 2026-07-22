<script setup lang="ts">
/**
 * The match page: 70 % board / 30 % game chat.
 *
 * Below the md breakpoint the layout stacks — the split is a desktop
 * affordance and must not be forced onto a phone.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api';
import { useBdvMatchStore } from '../stores/bdvMatch';
import BdvBoardCanvas from '../components/BdvBoardCanvas.vue';
import BdvOptionCards from '../components/BdvOptionCards.vue';
import BdvGameChat from '../components/BdvGameChat.vue';

const route = useRoute();
const store = useBdvMatchStore();
const pollTimer = ref<number | null>(null);
const actions = ref<any[]>([]);

const matchId = computed(() => String(route.params.matchId));
const seats = computed(() => store.matchState?.seats ?? []);
const seatMeta = computed(() => store.match?.seats ?? []);
const currencyLabel = computed(() => store.spec?.board?.currency_label ?? 'cr');
const boardName = computed(() => store.spec?.board?.game_display_name || 'BizDevVibes');

const SEAT_COLOURS = ['#3498db', '#e06666', '#28a745', '#f0a202', '#8e7cc3', '#17a2b8'];
const seatColour = (i: number) => SEAT_COLOURS[i % SEAT_COLOURS.length];

async function loadEvents() {
  if (!matchId.value) return;
  try {
    const data = (await api.get(`/bdv/matches/${matchId.value}/events`)) as any;
    actions.value = data.items ?? [];
  } catch {
    /* the feed is additive — a failed poll simply shows the last state */
  }
}

async function refresh() {
  await store.refreshState();
  await loadEvents();
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
  await loadEvents();
  startPolling();
});
watch(matchId, async (id) => {
  await store.load(id);
  await loadEvents();
});
onBeforeUnmount(stopPolling);

/** Board click and chat-card tap funnel into the SAME action. */
async function act(fn: () => Promise<unknown>) {
  await fn();
  await loadEvents();
}
const choose = (steps: number) => act(() => store.chooseOption(steps));
</script>

<template>
  <div class="bdv-match" data-testid="bdv-match">
    <section class="bdv-pane-board">
      <header class="bdv-topbar">
        <div>
          <h2>{{ boardName }}</h2>
          <p class="bdv-phase" data-testid="bdv-phase">
            <span v-if="store.isFinished">Match finished</span>
            <span v-else-if="store.isYourTurn">Your move — {{ store.phase.replace('_', ' ') }}</span>
            <span v-else>Waiting for {{ seatMeta[store.matchState?.turn_seat ?? 0]?.display_name }}</span>
          </p>
        </div>
        <ul class="bdv-seatstrip" data-testid="bdv-seats">
          <li
            v-for="seat in seats"
            :key="seat.index"
            :class="{ you: seat.index === store.yourSeat, turn: seat.index === store.matchState?.turn_seat }"
          >
            <span class="dot" :style="{ background: seatColour(seat.index) }" />
            <span class="nm">{{ seatMeta[seat.index]?.display_name || `Seat ${seat.index + 1}` }}</span>
            <span class="cash">{{ seat.cash }} {{ currencyLabel }}</span>
            <span v-if="seat.bankrupt" class="bust">out</span>
          </li>
        </ul>
      </header>

      <BdvBoardCanvas
        v-if="store.spec"
        :squares="store.squares"
        :seats="seats"
        :seat-meta="seatMeta"
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
            @roll="act(() => store.roll())"
            @close-negotiation="act(() => store.closeNegotiation())"
            @choose="choose"
            @end-turn="act(() => store.endTurn())"
            @buy="act(() => store.buyProperty())"
          />
        </template>
      </BdvBoardCanvas>
    </section>

    <aside class="bdv-pane-chat">
      <BdvGameChat
        :actions="actions"
        :seats="seatMeta"
        :your-seat="store.yourSeat"
        :currency-label="currencyLabel"
      />
    </aside>
  </div>
</template>

<style scoped>
.bdv-match {
  display: grid;
  grid-template-columns: 70% 30%;
  gap: 14px;
  height: calc(100vh - 96px);
  padding: 14px;
  box-sizing: border-box;
}

.bdv-pane-board {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 14px;
}

.bdv-pane-chat { min-height: 0; }

.bdv-topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.bdv-topbar h2 { margin: 0; color: #2c3e50; font-size: 18px; }
.bdv-phase { margin: 2px 0 0; color: #666; font-size: 13px; }

.bdv-seatstrip {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  flex-wrap: wrap;
}
.bdv-seatstrip li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #e9ecef;
  border-radius: 20px;
  font-size: 12px;
  color: #2c3e50;
  background: #fff;
}
.bdv-seatstrip li.you { border-color: #3498db; background: #e3f2fd; }
.bdv-seatstrip li.turn { box-shadow: 0 0 0 2px rgba(44, 62, 80, 0.18); }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.nm { font-weight: 600; }
.cash { color: #6c757d; }
.bust { color: #c0392b; font-weight: 700; }

@media (max-width: 1000px) {
  .bdv-match { grid-template-columns: 1fr; height: auto; }
  .bdv-pane-chat { height: 50vh; }
}
</style>
