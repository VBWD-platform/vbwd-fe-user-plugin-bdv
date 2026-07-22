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
const sessionSlug = ref('');
const findSlug = ref('');
const finding = ref(false);
const foundMatch = ref<any>(null);
const findError = ref<string | null>(null);
const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);

/* ------------------------------------------------- agent fight (S146-15) */
const agents = ref<any[]>([]);
const chosenAgents = ref<string[]>([]);
const price = ref(0);
const balance = ref(0);
const maxAgents = ref(4);
const fightError = ref<string | null>(null);
const starting = ref(false);

const canAfford = computed(() => balance.value >= price.value);

/* -------------------------------------------- your own table's line-up
 * Distinct from the fight roster above: here you TAKE a seat, so the picks
 * are your opponents. The same agent may be fielded more than once — three
 * copies of one personality is a real table, and the server numbers them so
 * the chat stays readable.
 */
const lineup = ref<string[]>([]);
const maxOpponents = computed(() => (selectedBoardMeta.value?.max_seats ?? 4) - 1);
const lineupFull = computed(() => lineup.value.length >= maxOpponents.value);

function addOpponent(agentId: string) {
  if (lineupFull.value) return;
  lineup.value = [...lineup.value, agentId];
}
function removeOpponent(position: number) {
  lineup.value = lineup.value.filter((_, index) => index !== position);
}
function agentById(id: string) {
  return agents.value.find((a) => a.id === id);
}
/** Repeats are numbered exactly as the server will name them. */
function lineupLabel(position: number) {
  const id = lineup.value[position];
  const seen = lineup.value.slice(0, position + 1).filter((a) => a === id).length;
  const name = agentById(id)?.name ?? 'Agent';
  return seen === 1 ? name : `${name} #${seen}`;
}
const enoughAgents = computed(
  () => chosenAgents.value.length >= 2 && chosenAgents.value.length <= maxAgents.value,
);

function toggleAgent(id: string) {
  if (chosenAgents.value.includes(id)) {
    chosenAgents.value = chosenAgents.value.filter((a) => a !== id);
  } else if (chosenAgents.value.length < maxAgents.value) {
    chosenAgents.value = [...chosenAgents.value, id];
  }
}

async function loadAgents() {
  try {
    const data = (await api.get('/bdv/agents')) as any;
    agents.value = data.items ?? [];
    price.value = data.price ?? 0;
    balance.value = data.balance ?? 0;
    maxAgents.value = data.max_agents ?? 4;
  } catch {
    /* the roster is optional — the rest of the lobby still works without it */
  }
}

async function startAgentFight() {
  if (starting.value || !enoughAgents.value || !canAfford.value) return;
  starting.value = true;
  fightError.value = null;
  try {
    const data = (await api.post('/bdv/agent-matches', {
      board_slug: selectedBoard.value,
      agent_ids: chosenAgents.value,
    })) as any;
    balance.value = data.balance ?? balance.value;
    router.push(`/dashboard/bdv/${data.id}`);
  } catch (err: any) {
    // 402 carries the live balance, so the number on screen stays honest even
    // when the charge is refused.
    balance.value = err?.data?.balance ?? balance.value;
    fightError.value = err?.data?.error ?? err?.message ?? 'Could not start the fight';
  } finally {
    starting.value = false;
  }
}

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
      // A chosen line-up decides the table size; the seat number is only the
      // fallback for "just give me opponents".
      seats: lineup.value.length ? lineup.value.length + 1 : seats.value,
      opponents: lineup.value.map((id) => ({ agent_profile_id: id })),
      fill_policy: fillPolicy.value,
      wait_minutes: fillPolicy.value === 'wait_then_agents' ? waitMinutes.value : null,
      slug: sessionSlug.value.trim() || undefined,
    })) as any;
    router.push(`/dashboard/bdv/${data.id}`);
  } catch (err: any) {
    error.value = err?.message ?? 'Could not start the match';
  } finally {
    creating.value = false;
  }
}

/** Find a table someone shared with you, by its slug. */
async function findBySlug() {
  const slug = findSlug.value.trim();
  if (!slug || finding.value) return;
  finding.value = true;
  findError.value = null;
  foundMatch.value = null;
  try {
    foundMatch.value = (await api.get(`/bdv/matches/by-slug/${encodeURIComponent(slug)}`)) as any;
  } catch (err: any) {
    findError.value = err?.status === 404 ? 'No game with that slug.' : err?.message ?? 'Lookup failed';
  } finally {
    finding.value = false;
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

onMounted(async () => {
  await load();
  await loadAgents();
});
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

      <section v-if="agents.length" class="fight" data-testid="bdv-agent-fight">
        <header class="fight-head">
          <div>
            <h3>Watch the agents fight</h3>
            <p class="sub">
              Pick two to {{ maxAgents }} agents and let them play it out. You take no
              seat — you watch. Their record is lifetime, across every table.
            </p>
          </div>
          <div class="price" data-testid="bdv-fight-price">
            <strong>{{ price }}</strong> token{{ price === 1 ? '' : 's' }}
            <small :class="{ short: !canAfford }">balance {{ balance }}</small>
          </div>
        </header>

        <ul class="roster">
          <li v-for="agent in agents" :key="agent.id">
            <button
              class="agent"
              :class="{ on: chosenAgents.includes(agent.id) }"
              :data-testid="`bdv-agent-${agent.slug}`"
              @click="toggleAgent(agent.id)"
            >
              <span class="nm">{{ agent.name }}</span>
              <span v-if="agent.persona" class="persona">{{ agent.persona }}</span>
              <span class="record">
                {{ agent.games_played }} played · {{ agent.games_won }} won ·
                {{ agent.net_capital }} net
              </span>
            </button>
          </li>
        </ul>

        <p v-if="fightError" class="alert" data-testid="bdv-fight-error">{{ fightError }}</p>
        <p v-else-if="!canAfford" class="alert alert--warn" data-testid="bdv-fight-short">
          You need {{ price - balance }} more token{{ price - balance === 1 ? '' : 's' }} to
          run a fight.
        </p>

        <button
          class="btn btn--primary"
          data-testid="bdv-start-fight"
          :disabled="!enoughAgents || !canAfford || starting"
          @click="startAgentFight"
        >
          {{ starting ? 'Starting…' : `Run the fight — ${price} tokens` }}
        </button>
      </section>

      <div class="new-match">
        <label class="field">
          <span>Board</span>
          <select v-model="selectedBoard" class="input" data-testid="bdv-board-select">
            <option v-for="board in boards" :key="board.slug" :value="board.slug">
              {{ board.name }}
            </option>
          </select>
          <small>The rules and squares this table plays under.</small>
        </label>

        <label class="field field--narrow">
          <span>Seats</span>
          <input
            v-model.number="seats"
            class="input"
            type="number"
            :min="selectedBoardMeta?.min_seats ?? 2"
            :max="selectedBoardMeta?.max_seats ?? 4"
            data-testid="bdv-seat-count"
          />
          <small>3 is the smallest real table.</small>
        </label>

        <div v-if="agents.length" class="field field--wide" data-testid="bdv-lineup">
          <span>Your opponents</span>
          <div class="pickers">
            <button
              v-for="agent in agents"
              :key="agent.id"
              class="pick"
              :disabled="lineupFull"
              :data-testid="`bdv-pick-${agent.slug}`"
              @click="addOpponent(agent.id)"
            >
              <span class="nm">{{ agent.name }}</span>
              <span class="rec">{{ agent.games_won }}/{{ agent.games_played }} won</span>
              <span class="plus">+</span>
            </button>
          </div>

          <ul v-if="lineup.length" class="chosen" data-testid="bdv-lineup-chosen">
            <li v-for="(id, position) in lineup" :key="`${id}-${position}`">
              <span>{{ lineupLabel(position) }}</span>
              <button
                class="drop"
                :data-testid="`bdv-drop-${position}`"
                @click="removeOpponent(position)"
              >
                ×
              </button>
            </li>
          </ul>
          <small v-if="lineup.length">
            You plus {{ lineup.length }} — pick the same agent again to field it twice.
          </small>
          <small v-else>
            Pick who you are up against, or leave empty for anonymous agents.
          </small>
        </div>

        <label class="field">
          <span>Session slug</span>
          <input
            v-model="sessionSlug"
            class="input"
            type="text"
            placeholder="auto — e.g. amber-hawk-42"
            data-testid="bdv-session-slug"
          />
          <small>How friends find this table. Leave blank for a generated one.</small>
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

    <div class="bdv-card" data-testid="bdv-find">
      <header class="head">
        <h2>Find a game</h2>
        <p class="sub">Someone shared a slug with you? Type it here.</p>
      </header>
      <div class="find-row">
        <input
          v-model="findSlug"
          class="input"
          type="text"
          placeholder="amber-hawk-42"
          data-testid="bdv-find-slug"
          @keyup.enter="findBySlug"
        />
        <button class="btn" data-testid="bdv-find-btn" :disabled="finding || !findSlug.trim()" @click="findBySlug">
          {{ finding ? 'Looking…' : 'Find' }}
        </button>
      </div>

      <p v-if="findError" class="alert" data-testid="bdv-find-error">{{ findError }}</p>

      <div v-if="foundMatch" class="found" data-testid="bdv-find-result">
        <div>
          <strong>{{ foundMatch.slug }}</strong>
          <span class="badge" :class="foundMatch.status === 'lobby' ? 'badge--live' : 'badge--done'">
            {{ foundMatch.status }}
          </span>
          <p class="sub">
            {{ foundMatch.seats?.length }} seats · {{ foundMatch.open_seats }} open
          </p>
        </div>
        <button
          v-if="foundMatch.can_join"
          class="btn btn--primary"
          data-testid="bdv-find-join"
          @click="joinMatch(foundMatch.id)"
        >
          Join this table
        </button>
        <router-link
          v-else-if="foundMatch.your_seat !== null"
          class="btn"
          :to="`/dashboard/bdv/${foundMatch.id}`"
          >Open</router-link
        >
        <span v-else class="muted">No open seats.</span>
      </div>
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
          <tr><th>Slug</th><th>Status</th><th>Seats</th><th>Moves</th><th>Result</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="match in matches" :key="match.id" data-testid="bdv-match-row">
            <td class="slug">{{ match.slug }}</td>
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
.bdv-lobby { padding: 24px; display: flex; flex-direction: column; gap: 24px; max-width: 960px; }

.bdv-card { background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
.head { margin-bottom: 18px; }
.head h2 { margin: 0; color: #2c3e50; }
.sub { color: #666; font-size: 0.9rem; margin: 6px 0 0; }

.alert { padding: 10px 14px; background: #fff5f5; color: #c0392b; border-radius: 4px; font-size: 14px; }

.field { display: block; margin: 0; }
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
.slug { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #6c757d; }
.muted { color: #6c757d; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 12px; font-size: 12px; font-weight: 600; color: #fff; }
.badge--live { background: #3498db; }
.badge--done { background: #6f42c1; }

.empty { padding: 30px; text-align: center; color: #6c757d; }

/* A real grid so every label sits on the same baseline regardless of hint
   length — the previous flex + align-items:flex-end staggered them. */
.new-match {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px 20px;
  align-items: start;
  margin-bottom: 20px;
}
.field--narrow { max-width: 150px; }
.field .input { width: 100%; }
.field small { min-height: 15px; }

.policy { border: 1px solid #e9ecef; border-radius: 6px; padding: 14px 16px; margin: 0 0 20px; }
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

.find-row { display: flex; gap: 10px; align-items: center; }
.find-row .input { max-width: 280px; }
.found {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin-top: 14px; padding: 12px 14px; background: #f8f9fa;
  border: 1px solid #e9ecef; border-radius: 6px;
}
.found strong { color: #2c3e50; margin-right: 8px; font-family: ui-monospace, Menlo, monospace; }
.found .sub { margin: 4px 0 0; }

/* ------------------------------------------------------------ agent fight */
.fight {
  margin: 18px 0;
  padding: 16px 18px;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  background: #fdfdfe;
}
.fight-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
}
.fight-head h3 { margin: 0; color: #2c3e50; font-size: 15px; }
.price { text-align: right; color: #2c3e50; font-size: 15px; white-space: nowrap; }
.price small { display: block; color: #6c757d; font-size: 11px; }
.price small.short { color: #c0392b; font-weight: 600; }
.roster {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}
.agent {
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.agent:hover { border-color: #3498db; }
.agent.on { border-color: #3498db; background: #eef7fd; }
.agent .nm { display: block; font-weight: 600; color: #2c3e50; font-size: 13px; }
.agent .persona { display: block; font-size: 12px; color: #6c757d; margin-top: 2px; }
.agent .record { display: block; font-size: 11px; color: #8a949e; margin-top: 4px; }
.alert--warn { background: #fff8e6; color: #7a5b00; }

/* --------------------------------------------------------- opponent picker */
.field--wide { grid-column: 1 / -1; }
.pickers { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid #ced4da;
  border-radius: 16px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #2c3e50;
}
.pick:hover:not(:disabled) { border-color: #3498db; background: #f4fafe; }
.pick:disabled { opacity: 0.5; cursor: not-allowed; }
.pick .nm { font-weight: 600; }
.pick .rec { font-size: 11px; color: #8a949e; }
.pick .plus { color: #3498db; font-weight: 700; }
.chosen { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chosen li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 14px;
  background: #eef7fd;
  border: 1px solid #d6e9f8;
  font-size: 12px;
  color: #2c3e50;
}
.chosen .drop { border: 0; background: none; cursor: pointer; color: #c0392b; font-size: 14px; line-height: 1; }
</style>
