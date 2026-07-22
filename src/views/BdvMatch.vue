<script setup lang="ts">
/**
 * The match page: 70 % board / 30 % game chat.
 *
 * Below the md breakpoint the layout stacks — the split is a desktop
 * affordance and must not be forced onto a phone.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { useBdvMatchStore } from '../stores/bdvMatch';
import BdvBoardCanvas from '../components/BdvBoardCanvas.vue';
import BdvOptionCards from '../components/BdvOptionCards.vue';
import BdvGameChat from '../components/BdvGameChat.vue';
import BdvRentModal from '../components/BdvRentModal.vue';
import BdvEstatePanel from '../components/BdvEstatePanel.vue';
import BdvTradeScreen from '../components/BdvTradeScreen.vue';

const route = useRoute();
const router = useRouter();
const store = useBdvMatchStore();
const pollTimer = ref<number | null>(null);
const actions = ref<any[]>([]);

const matchId = computed(() => String(route.params.matchId));
const seats = computed(() => store.matchState?.seats ?? []);
const seatMeta = computed(() => store.match?.seats ?? []);
const currencyLabel = computed(() => store.spec?.board?.currency_label ?? 'cr');
const boardName = computed(() => store.spec?.board?.game_display_name || 'BizDevVibes');

/** Lobby state: the table is open and still waiting for humans. */
const isWaiting = computed(() => store.match?.status === 'lobby');
const openSeats = computed(() => store.match?.open_seats ?? 0);
const now = ref(Date.now());
let clock: number | null = null;

const remaining = computed(() => {
  const deadline = store.match?.lobby_deadline_at;
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now.value;
  return ms > 0 ? ms : 0;
});
const countdown = computed(() => {
  const ms = remaining.value;
  if (ms === null) return null;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
});

const showEstate = ref(false);

/**
 * Leave the table. The match is server-side and keeps going without this
 * browser — walking away is not resigning, and a seat that wants OUT concedes
 * through the rent modal, where the rules can be enforced.
 */
function leaveMatch() {
  router.push('/dashboard/bdv');
}
/** Squares locked as collateral cannot be traded — the same rule the server applies. */
const pledged = computed(() =>
  (store.matchState?.loans ?? []).flatMap((loan: any) => loan.collateral),
);
const maxHouses = computed(() => store.spec?.board?.max_houses ?? 5);
/** How short you are on the outstanding demand, if any. */
const shortfall = computed(() => {
  const demand = store.demand;
  if (!demand || demand.debtor_seat !== store.yourSeat) return 0;
  return Math.max(0, (demand.due ?? demand.amount) - store.myCash);
});
const debtorCash = computed(() => {
  const demand = store.demand;
  if (!demand) return 0;
  return (
    (store.matchState?.seats ?? []).find((s: any) => s.index === demand.debtor_seat)
      ?.cash ?? 0
  );
});
/** Show the rent modal to the two seats it concerns. */
const showRentModal = computed(
  () => !!store.demand && (store.youOweRent || store.demand.owner_seat === store.yourSeat),
);

async function sendMessage(body: string) {
  // Human messages go to the match's meinchat room; the bridge posts there too.
  try {
    await api.post(`/bdv/matches/${matchId.value}/messages`, { body });
  } catch {
    /* the feed is additive — a failed send simply does not appear */
  }
  await loadEvents();
}

async function startNow() {
  await api.post(`/bdv/matches/${matchId.value}/start-now`, {});
  await refresh();
}

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
  // One bad poll must not stop every future poll. Before this, a single
  // rejected request escaped as an unhandled promise and the match simply
  // stopped updating — with nothing on screen to say why.
  try {
    await store.refreshState();
  } catch (err) {
    console.warn('[bdv] refresh failed, will retry on the next poll', err);
  }
  await loadEvents();
}

function startPolling() {
  stopPolling();
  // Poll only while it is NOT our turn, and never while the tab is hidden.
  // Deliberately not SSE: a turn-based game does not need a long-lived stream,
  // and SSE behind the proxy has bitten this platform twice.
  pollTimer.value = window.setInterval(() => {
    if (document.hidden || store.isFinished) return;
    // During trading everyone is acting at once, so the usual "poll only when
    // it is not your turn" rule would leave the turn-holder staring at a stale
    // offer list for the whole window.
    if (store.isYourTurn && !store.isTrading) return;
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
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
watch(matchId, async (id) => {
  await store.load(id);
  await loadEvents();
});
onBeforeUnmount(() => {
  stopPolling();
  if (clock !== null) window.clearInterval(clock);
});

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
          <h2>
            {{ boardName }}
            <span v-if="store.match?.slug" class="slug" data-testid="bdv-match-slug">
              {{ store.match.slug }}
            </span>
          </h2>
          <p class="bdv-phase" data-testid="bdv-phase">
            <span v-if="store.isFinished">Match finished</span>
            <span v-else-if="store.isYourTurn">Your move — {{ store.phase.replace('_', ' ') }}</span>
            <span v-else>Waiting for {{ seatMeta[store.matchState?.turn_seat ?? 0]?.display_name }}</span>
          </p>
        </div>
        <div class="bdv-topbar-actions">
          <button
            v-if="!isWaiting && !store.isFinished"
            class="bdv-manage"
            data-testid="bdv-manage"
            @click="showEstate = true"
          >
            Manage book
            <span v-if="store.myDebt" class="debt">{{ store.myDebt }} owed</span>
          </button>
          <button class="bdv-exit" data-testid="bdv-exit-game" @click="leaveMatch">
            {{ store.isFinished ? 'Back to games' : 'Exit game' }}
          </button>
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

      <BdvRentModal
        v-if="showRentModal"
        :demand="store.demand"
        :seats="seatMeta"
        :your-seat="store.yourSeat"
        :cash="store.myCash"
        :debtor-cash="debtorCash"
        :currency-label="currencyLabel"
        :deadline-at="store.rentDeadlineAt"
        :submitting="store.submitting"
        :estate="store.myEstate"
        :must-concede="store.mustConcede"
        @concede="act(() => store.declareBankrupt())"
        @agree="act(() => store.agreeToPay())"
        @offer-property="(sq) => act(() => store.offerRentProperty(sq))"
        @offer="(amount) => act(() => store.offerRent(amount))"
        @accept="act(() => store.acceptRentOffer())"
        @insist="act(() => store.insistOnFullRent())"
        @raise-cash="showEstate = true"
      />

      <BdvEstatePanel
        v-if="showEstate"
        :estate="store.myEstate"
        :loans="store.myLoans"
        :cash="store.myCash"
        :currency-label="currencyLabel"
        :max-houses="maxHouses"
        :submitting="store.submitting"
        :shortfall="shortfall"
        @build="(sq) => act(() => store.buildHouse(sq))"
        @sell-house="(sq) => act(() => store.sellHouse(sq))"
        @sell-square="(sq) => act(() => store.sellSquare(sq))"
        @borrow="(sqs, amount) => act(() => store.borrow(sqs, amount))"
        @repay="(id, amount) => act(() => store.repayLoan(id, amount))"
        @close="showEstate = false"
      />

      <section v-if="isWaiting" class="bdv-waiting-room" data-testid="bdv-waiting-room">
        <h3>Waiting for players</h3>
        <p class="seats-left">
          <strong>{{ openSeats }}</strong> seat{{ openSeats === 1 ? '' : 's' }} still open.
        </p>

        <p v-if="countdown" class="countdown" data-testid="bdv-countdown">
          Agents take over in <strong>{{ countdown }}</strong>
        </p>
        <p v-else class="countdown muted" data-testid="bdv-wait-forever">
          No time limit — this table waits until someone joins.
        </p>

        <button class="start-now" data-testid="bdv-start-now" @click="startNow">
          Start now with agents
        </button>
        <p class="hint">
          Share the slug
          <code v-if="store.match?.slug">{{ store.match.slug }}</code>
          so friends can find this table — or start now and let agents fill the rest.
        </p>
      </section>

      <BdvTradeScreen
        v-else-if="store.isTrading && store.yourSeat !== null"
        :squares="store.squares"
        :seats="seats"
        :seat-meta="seatMeta"
        :ownership="store.matchState?.ownership ?? {}"
        :houses="store.matchState?.houses ?? {}"
        :pledged="pledged"
        :offers="store.matchState?.trade_offers ?? []"
        :your-seat="store.yourSeat"
        :cash="store.myCash"
        :currency-label="currencyLabel"
        :deadline-at="store.turnDeadlineAt"
        :ready="store.youAreReady"
        :submitting="store.submitting"
        :stage-needs="store.stageNeeds"
        @propose="(terms) => act(() => store.proposeTrade(terms as any))"
        @accept="(id) => act(() => store.acceptTrade(id))"
        @decline="(id) => act(() => store.declineTrade(id))"
        @counter="(id, terms) => act(() => store.counterTrade(id, terms))"
        @ready="act(() => store.tradingReady())"
      />

      <BdvBoardCanvas
        v-else-if="store.spec"
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
            :purchase-offer="store.purchaseOffer"
            :seats="seats"
            :seat-meta="seatMeta"
            :winner-seat="store.matchState?.winner_seat ?? null"
            :your-seat="store.yourSeat"
            @roll="act(() => store.roll())"
            @close-negotiation="act(() => store.closeNegotiation())"
            @choose="choose"
            @end-turn="act(() => store.endTurn())"
            @buy="act(() => store.buyProperty())"
            @exit="leaveMatch"
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
        :cash="store.myCash"
        :disabled="store.isFinished"
        @send="sendMessage"
        @pay="(seat, amount) => act(() => store.transferCredits(seat, amount))"
      />
    </aside>
  </div>
</template>

<style scoped>
.bdv-topbar-actions { display: flex; gap: 8px; align-items: center; }
.bdv-exit {
  padding: 7px 14px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  background: #fff;
  color: #6c757d;
  font-size: 13px;
  cursor: pointer;
}
.bdv-exit:hover { background: #f8f9fa; color: #2c3e50; }

.bdv-match {
  display: grid;
  grid-template-columns: 70% 30%;
  gap: 14px;
  height: calc(100vh - 96px);
  padding: 14px;
  box-sizing: border-box;
}

.bdv-pane-board {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 14px;
}

.bdv-pane-chat { position: relative; min-height: 0; }

.bdv-manage {
  align-self: center;
  padding: 6px 12px;
  border: 1px solid #ced4da;
  border-radius: 16px;
  background: #fff;
  color: #2c3e50;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.bdv-manage:hover { background: #f8f9fa; }
.bdv-manage .debt {
  margin-left: 6px; padding: 1px 7px; border-radius: 9px;
  background: #fff5f5; color: #c0392b; font-weight: 700;
}

.bdv-topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.bdv-topbar h2 { margin: 0; color: #2c3e50; font-size: 18px; }
.slug {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f1f3f5;
  color: #6c757d;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  font-weight: 500;
}
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

.bdv-waiting-room {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  background: #f8f9fa;
  border: 1px dashed #ced4da;
  border-radius: 10px;
  padding: 40px 20px;
}
.bdv-waiting-room h3 { margin: 0; color: #2c3e50; }
.seats-left { margin: 0; color: #2c3e50; }
.countdown { margin: 0; font-size: 15px; color: #3498db; }
.countdown.muted { color: #6c757d; }
.start-now {
  margin-top: 10px;
  padding: 9px 18px;
  background: #3498db;
  color: #fff;
  border: 1px solid #3498db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.start-now:hover { background: #2c85c4; }
.hint { margin: 4px 0 0; font-size: 12px; color: #6c757d; }
.hint code {
  padding: 2px 7px; border-radius: 4px; background: #fff;
  border: 1px solid #ced4da; color: #2c3e50; font-weight: 600;
}

@media (max-width: 1000px) {
  .bdv-match { grid-template-columns: 1fr; height: auto; }
  .bdv-pane-chat { height: 50vh; }
}
</style>
