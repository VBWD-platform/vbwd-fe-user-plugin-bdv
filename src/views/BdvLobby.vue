<script setup lang="ts">
/** Lobby: my matches + start a new one against agent seats. */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';

const router = useRouter();
const matches = ref<any[]>([]);
const boards = ref<any[]>([]);
const seats = ref(3);
const selectedBoard = ref<string>('');
/** What happens to the seats you do not fill yourself. */
const fillPolicy = ref<'agents_now' | 'wait_forever' | 'wait_then_agents'>('agents_now');
const waitMinutes = ref(10);
const WAIT_CHOICES = [3, 5, 10, 20, 60];
const openMatches = ref<any[]>([]);
const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);

const selectedBoardMeta = computed(() =>
  boards.value.find((b) => b.slug === selectedBoard.value),
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    // NOTE: the shared ApiClient returns the parsed BODY, not an axios-style
    // { data } envelope — reading `.data` here yields undefined.
    const [matchRes, boardRes, openRes] = await Promise.all([
      api.get('/bdv/matches') as Promise<any>,
      api.get('/bdv/boards') as Promise<any>,
      api.get('/bdv/matches/open') as Promise<any>,
    ]);
    matches.value = matchRes.items ?? [];
    boards.value = boardRes.items ?? [];
    openMatches.value = openRes.items ?? [];
    if (!selectedBoard.value && boards.value.length) {
      selectedBoard.value = boards.value[0].slug;
      seats.value = boards.value[0].default_seats ?? 3;
    }
  } catch (err: any) {
    error.value = err?.message ?? 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function createMatch() {
  if (creating.value || !selectedBoard.value) return;
  creating.value = true;
  error.value = null;
  try {
    const data = (await api.post('/bdv/matches', {
      board_slug: selectedBoard.value,
      seats: seats.value,
      fill_policy: fillPolicy.value,
      wait_minutes: fillPolicy.value === 'wait_then_agents' ? waitMinutes.value : null,
    })) as any;
    router.push(`/dashboard/bdv/${data.id}`);
  } catch (err: any) {
    error.value = err?.message ?? 'Could not start the match';
  } finally {
    creating.value = false;
  }
}

async function joinMatch(id: string) {
  try {
    await api.post(`/bdv/matches/${id}/join`, { display_name: 'Player' });
    router.push(`/dashboard/bdv/${id}`);
  } catch (err: any) {
    error.value = err?.message ?? 'Could not join';
  }
}

onMounted(load);
</script>

<template>
  <div class="bdv-lobby" data-testid="bdv-lobby">
    <div class="bdv-card">
      <header class="head">
        <h2>BizDevVibes</h2>
        <p class="sub">
          Roll two dice. The <strong>sum is always free</strong> — choosing a single die is a
          purchase, priced from the game state, and the fee goes to your opponents rather
          than the bank.
        </p>
      </header>

      <p v-if="error" class="alert" data-testid="bdv-error">{{ error }}</p>

      <div class="new-match">
        <label class="field">
          <span>Board</span>
          <select v-model="selectedBoard" class="input" data-testid="bdv-board-select">
            <option v-for="board in boards" :key="board.slug" :value="board.slug">
              {{ board.name }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Seats</span>
          <input
            v-model.number="seats"
            class="input"
            type="number"
            :min="selectedBoardMeta?.min_seats ?? 2"
            :max="selectedBoardMeta?.max_seats ?? 4"
            data-testid="bdv-seat-count"
          />
          <small>Agents fill the remaining seats. 3 is the smallest real table.</small>
        </label>
      </div>

      <fieldset class="policy" data-testid="bdv-fill-policy">
        <legend>Who fills the other seats?</legend>

        <label class="opt" :class="{ on: fillPolicy === 'agents_now' }">
          <input v-model="fillPolicy" type="radio" value="agents_now" data-testid="bdv-policy-agents" />
          <span>
            <strong>Play against agents now</strong>
            <em>Start immediately. Agents take every seat you did not fill.</em>
          </span>
        </label>

        <label class="opt" :class="{ on: fillPolicy === 'wait_forever' }">
          <input v-model="fillPolicy" type="radio" value="wait_forever" data-testid="bdv-policy-wait" />
          <span>
            <strong>Wait for real players</strong>
            <em>Seats stay open until humans join. No time limit.</em>
          </span>
        </label>

        <label class="opt" :class="{ on: fillPolicy === 'wait_then_agents' }">
          <input v-model="fillPolicy" type="radio" value="wait_then_agents" data-testid="bdv-policy-timed" />
          <span>
            <strong>Wait a while, then start with agents</strong>
            <em>Hold the seats open for a set time; agents take whatever is left.</em>
            <span v-if="fillPolicy === 'wait_then_agents'" class="minutes">
              <button
                v-for="m in WAIT_CHOICES"
                :key="m"
                type="button"
                class="chip"
                :class="{ on: waitMinutes === m }"
                :data-testid="`bdv-wait-${m}`"
                @click.prevent="waitMinutes = m"
              >
                {{ m }} min
              </button>
            </span>
          </span>
        </label>
      </fieldset>

      <button
        class="btn btn--primary"
        data-testid="bdv-start-match"
        :disabled="creating || !selectedBoard"
        @click="createMatch"
      >
        {{ creating ? 'Starting…' : fillPolicy === 'agents_now' ? 'Start match' : 'Open the table' }}
      </button>
    </div>

    <div v-if="openMatches.length" class="bdv-card" data-testid="bdv-open-tables">
      <header class="head">
        <h2>Tables waiting for players</h2>
        <p class="sub">Someone opened a table and is waiting. Take a seat.</p>
      </header>
      <table class="table">
        <thead><tr><th>Seats</th><th>Open</th><th>Waiting policy</th><th></th></tr></thead>
        <tbody>
          <tr v-for="m in openMatches" :key="m.id" data-testid="bdv-open-row">
            <td>{{ m.seats?.length }}</td>
            <td>{{ m.open_seats }}</td>
            <td class="muted">
              {{ m.fill_policy === 'wait_forever' ? 'waiting indefinitely' : 'agents take over at the deadline' }}
            </td>
            <td class="right">
              <button class="btn btn--sm" data-testid="bdv-join" @click="joinMatch(m.id)">Join</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="bdv-card">
      <header class="head"><h2>Your matches</h2></header>
      <p v-if="loading" class="empty">Loading…</p>
      <p v-else-if="!matches.length" class="empty" data-testid="bdv-empty">
        No matches yet — start one above.
      </p>
      <table v-else class="table">
        <thead>
          <tr><th>Status</th><th>Seats</th><th>Moves</th><th>Result</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="match in matches" :key="match.id" data-testid="bdv-match-row">
            <td>
              <span class="badge" :class="match.status === 'finished' ? 'badge--done' : 'badge--live'">
                {{ match.status }}
              </span>
            </td>
            <td>{{ match.seats?.length }}</td>
            <td>{{ match.state_seq }}</td>
            <td>
              <span v-if="match.winner_seat_index !== null">
                {{ match.seats?.[match.winner_seat_index]?.display_name || `Seat ${match.winner_seat_index + 1}` }} won
              </span>
              <span v-else class="muted">in progress</span>
            </td>
            <td class="right">
              <router-link class="btn btn--sm" :to="`/dashboard/bdv/${match.id}`">Open</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* Mirrors the core admin settings pages: white 8px cards, #3498db primary,
   #e9ecef rules, #2c3e50 headings. */
.bdv-lobby { padding: 20px; display: flex; flex-direction: column; gap: 20px; max-width: 900px; }

.bdv-card { background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
.head { margin-bottom: 16px; }
.head h2 { margin: 0; color: #2c3e50; }
.sub { color: #666; font-size: 0.9rem; margin: 6px 0 0; }

.alert { padding: 10px 14px; background: #fff5f5; color: #c0392b; border-radius: 4px; font-size: 14px; }

.new-match { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; }
.field { display: block; }
.field > span { display: block; font-size: 13px; font-weight: 600; color: #2c3e50; margin-bottom: 4px; }
.field small { display: block; color: #6c757d; font-size: 12px; margin-top: 3px; }

.input {
  padding: 8px 12px; border: 1px solid #ced4da; border-radius: 4px;
  font-size: 14px; background: #fff; color: #2c3e50; min-width: 190px; box-sizing: border-box;
}
.input:focus { outline: none; border-color: #80bdff; box-shadow: 0 0 0 2px rgba(0,123,255,.25); }

.btn {
  display: inline-block; padding: 8px 16px; border: 1px solid #ced4da; border-radius: 4px;
  background: #fff; color: #2c3e50; font-size: 14px; cursor: pointer; text-decoration: none;
}
.btn:hover:not(:disabled) { background: #f8f9fa; }
.btn--primary { background: #3498db; border-color: #3498db; color: #fff; }
.btn--primary:hover:not(:disabled) { background: #2c85c4; }
.btn--primary:disabled { opacity: .55; cursor: not-allowed; }
.btn--sm { padding: 4px 12px; font-size: 13px; }

.table { width: 100%; border-collapse: collapse; }
.table th {
  padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase;
  letter-spacing: .04em; color: #6c757d; border-bottom: 2px solid #e9ecef;
}
.table td { padding: 10px 12px; border-bottom: 1px solid #e9ecef; color: #2c3e50; font-size: 14px; }
.table tbody tr:hover { background: #f8f9fa; }
.right { text-align: right; }
.muted { color: #6c757d; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 12px; font-size: 12px; font-weight: 600; color: #fff; }
.badge--live { background: #3498db; }
.badge--done { background: #6f42c1; }

.empty { padding: 30px; text-align: center; color: #6c757d; }

.policy { border: 1px solid #e9ecef; border-radius: 6px; padding: 12px 14px; margin: 4px 0 16px; }
.policy legend { font-size: 13px; font-weight: 600; color: #2c3e50; padding: 0 6px; }
.opt {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 9px 10px; border: 1px solid transparent; border-radius: 6px; cursor: pointer;
}
.opt:hover { background: #f8f9fa; }
.opt.on { background: #e3f2fd; border-color: #bee0f7; }
.opt strong { display: block; font-size: 14px; color: #2c3e50; }
.opt em { font-style: normal; font-size: 12px; color: #6c757d; }
.minutes { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.chip {
  padding: 4px 10px; border: 1px solid #ced4da; border-radius: 14px;
  background: #fff; font-size: 12px; cursor: pointer; color: #2c3e50;
}
.chip.on { background: #3498db; border-color: #3498db; color: #fff; font-weight: 600; }
</style>
