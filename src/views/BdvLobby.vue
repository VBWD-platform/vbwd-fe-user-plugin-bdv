<script setup lang="ts">
/** Lobby: my matches + start a new one against agent seats. */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '@/api/client';

const router = useRouter();
const matches = ref<any[]>([]);
const boards = ref<any[]>([]);
const seats = ref(3);
const selectedBoard = ref<string>('');
const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);

const selectedBoardMeta = computed(() =>
  boards.value.find((b) => b.slug === selectedBoard.value),
);

async function load() {
  loading.value = true;
  try {
    const [matchRes, boardRes] = await Promise.all([
      apiClient.get('/bdv/matches'),
      apiClient.get('/bdv/boards'),
    ]);
    matches.value = matchRes.data.items ?? [];
    boards.value = boardRes.data.items ?? [];
    if (!selectedBoard.value && boards.value.length) {
      selectedBoard.value = boards.value[0].slug;
      seats.value = boards.value[0].default_seats ?? 3;
    }
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function createMatch() {
  if (creating.value || !selectedBoard.value) return;
  creating.value = true;
  error.value = null;
  try {
    const { data } = await apiClient.post('/bdv/matches', {
      board_slug: selectedBoard.value,
      seats: seats.value,
    });
    router.push(`/dashboard/bdv/${data.id}`);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? 'Could not start the match';
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="bdv-lobby" data-testid="bdv-lobby">
    <header>
      <h1>{{ $t('bdv.lobby.title') }}</h1>
      <p>{{ $t('bdv.lobby.subtitle') }}</p>
    </header>

    <p v-if="error" class="bdv-error" data-testid="bdv-error">{{ error }}</p>

    <section class="bdv-new">
      <h2>{{ $t('bdv.lobby.newMatch') }}</h2>
      <label>
        {{ $t('bdv.lobby.board') }}
        <select v-model="selectedBoard" data-testid="bdv-board-select">
          <option v-for="board in boards" :key="board.slug" :value="board.slug">
            {{ board.name }}
          </option>
        </select>
      </label>
      <label>
        {{ $t('bdv.lobby.seats') }}
        <input
          v-model.number="seats"
          type="number"
          :min="selectedBoardMeta?.min_seats ?? 2"
          :max="selectedBoardMeta?.max_seats ?? 4"
          data-testid="bdv-seat-count"
        />
      </label>
      <button
        class="bdv-btn-primary"
        data-testid="bdv-start-match"
        :disabled="creating || !selectedBoard"
        @click="createMatch"
      >
        {{ $t('bdv.lobby.start') }}
      </button>
    </section>

    <section class="bdv-matches">
      <h2>{{ $t('bdv.lobby.activeMatches') }}</h2>
      <p v-if="!loading && !matches.length" data-testid="bdv-empty">
        {{ $t('bdv.lobby.noMatches') }}
      </p>
      <ul>
        <li v-for="match in matches" :key="match.id" data-testid="bdv-match-row">
          <router-link :to="`/dashboard/bdv/${match.id}`">
            <strong>{{ match.status === 'finished' ? $t('bdv.lobby.finished') : $t('bdv.lobby.inProgress') }}</strong>
            <span>{{ match.seats?.length }} {{ $t('bdv.lobby.seats') }}</span>
            <span v-if="match.winner_seat_index !== null">
              {{ $t('bdv.lobby.winner', { seat: match.winner_seat_index + 1 }) }}
            </span>
          </router-link>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.bdv-lobby {
  padding: 16px;
  max-width: 720px;
}
.bdv-new,
.bdv-matches {
  margin-top: 20px;
  padding: 12px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d8dee6);
  border-radius: 8px;
}
.bdv-new label {
  display: block;
  margin-bottom: 8px;
}
.bdv-btn-primary {
  padding: 8px 14px;
  background: var(--color-primary, #3b6fd4);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.bdv-matches ul {
  padding: 0;
  margin: 0;
  list-style: none;
}
.bdv-matches li a {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border, #d8dee6);
  text-decoration: none;
  color: inherit;
}
.bdv-error {
  color: var(--color-danger, #c0392b);
}
</style>
