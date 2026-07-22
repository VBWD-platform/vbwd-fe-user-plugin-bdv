<script setup lang="ts">
/**
 * The game chat — rich content over the match's own event stream.
 *
 * It renders the match's append-only action log as rich cards, plus
 * deterministic table talk derived from the same events. Every number shown
 * comes from the server; nothing here invents state.
 *
 * The bot bridge (S146-4) now exposes the SAME game over chat transports, using
 * `bot_choices` cards whose `hint` carries the price. This component is the
 * in-app rendering of that identical event stream — one game, two surfaces, one
 * service path behind both.
 *
 * Mentions: seats address each other as @nickname, rendered as chips. The
 * mention target is resolved from the seat list, so a rename follows through.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

interface Seat {
  seat_index: number;
  display_name: string;
  kind: string;
}

const props = defineProps<{
  actions: any[];
  seats: Seat[];
  yourSeat: number | null;
  currencyLabel: string;
  /** Human messages from the match's meinchat room. */
  messages?: Array<{ id: string; seat: number | null; body: string }>;
  cash?: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', body: string): void;
  (e: 'pay', toSeat: number, amount: number): void;
}>();

/** @nickname for a seat — spaces stripped so the chip is one token. */
function handleOf(seatIndex: number | null | undefined): string {
  if (seatIndex === null || seatIndex === undefined) return '@table';
  const seat = props.seats.find((s) => s.seat_index === seatIndex);
  const name = seat?.display_name ?? `Seat ${seatIndex + 1}`;
  return '@' + name.replace(/\s+/g, '');
}

function isYou(seatIndex: number | null | undefined) {
  return seatIndex !== null && seatIndex !== undefined && seatIndex === props.yourSeat;
}

interface ChatEntry {
  key: string;
  seat: number | null;
  kind: string;
  /** Segments so @mentions can be rendered as chips rather than raw text. */
  parts: Array<{ t: 'text' | 'mention'; v: string; you?: boolean }>;
  dice?: number[];
  options?: Array<{ steps: number; label: string; price: string; free: boolean }>;
  amount?: string;
  to?: string;
}

function text(v: string) {
  return { t: 'text' as const, v };
}
function mention(seatIndex: number | null | undefined) {
  return { t: 'mention' as const, v: handleOf(seatIndex), you: isYou(seatIndex) };
}

/**
 * Fold the action log into chat entries. Deterministic: the same log always
 * produces the same conversation, which keeps replays honest.
 */
const entries = computed<ChatEntry[]>(() => {
  const out: ChatEntry[] = [];
  for (const action of props.actions ?? []) {
    for (const [i, ev] of (action.events ?? []).entries()) {
      const key = `${action.seq}-${i}`;
      const seat = ev.seat ?? action.seat_index ?? null;

      switch (ev.type) {
        case 'rolled':
          out.push({
            key,
            seat,
            kind: 'roll',
            dice: ev.dice,
            parts: [mention(seat), text(` rolled ${ev.dice?.join(' + ')} — three ways to move.`)],
          });
          break;

        case 'option_purchased':
          out.push({
            key,
            seat,
            kind: 'purchase',
            amount: `${ev.price} ${props.currencyLabel}`,
            parts: [
              mention(seat),
              text(` bought the +${ev.steps} move for ${ev.price} ${props.currencyLabel} — paid to `),
              ...Object.keys(ev.payouts || {}).flatMap((k, idx) => [
                ...(idx ? [text(', ')] : []),
                mention(Number(k)),
              ]),
              text('.'),
            ],
          });
          // The recipient answers — the redistribution made visible.
          for (const [recipient, amount] of Object.entries(ev.payouts || {})) {
            out.push({
              key: `${key}-thanks-${recipient}`,
              seat: Number(recipient),
              kind: 'talk',
              parts: [
                mention(seat),
                text(` keep dodging, that ${amount} ${props.currencyLabel} funds my next buy.`),
              ],
            });
          }
          break;

        case 'option_taken_free':
          out.push({
            key,
            seat,
            kind: 'fate',
            parts: [
              mention(seat),
              text(ev.is_sum ? ' took the sum — fate, free.' : ` moved +${ev.steps} for free.`),
            ],
          });
          break;

        case 'rent_demanded':
          out.push({
            key,
            seat,
            kind: 'demand',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [
              mention(ev.to),
              text(` demands ${ev.amount} ${props.currencyLabel} rent from `),
              mention(seat),
              text('.'),
            ],
          });
          break;

        case 'rent_countered':
          out.push({
            key,
            seat,
            kind: 'bribe',
            amount: `${ev.offered} ${props.currencyLabel}`,
            parts: [
              mention(seat),
              text(` offers `),
              mention(ev.to),
              text(` ${ev.offered} instead of ${ev.rent}.`),
            ],
          });
          break;

        case 'rent_insisted':
          out.push({
            key,
            seat,
            kind: 'rent',
            parts: [
              mention(seat),
              text(' insists on the full '),
              text(`${ev.amount} ${props.currencyLabel}.`),
            ],
          });
          break;

        case 'house_built':
          out.push({
            key,
            seat,
            kind: 'build',
            parts: [mention(seat), text(` built on square ${ev.square} for ${ev.cost}.`)],
          });
          break;

        case 'house_sold':
          out.push({
            key,
            seat,
            kind: 'build',
            parts: [mention(seat), text(` sold a building for ${ev.refund}.`)],
          });
          break;

        case 'square_sold':
          out.push({
            key,
            seat,
            kind: 'build',
            parts: [mention(seat), text(` sold square ${ev.square} back for ${ev.amount}.`)],
          });
          break;

        case 'loan_taken':
          out.push({
            key,
            seat,
            kind: 'loan',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [mention(seat), text(` borrowed ${ev.amount} against their book.`)],
          });
          break;

        case 'loan_repaid':
          out.push({
            key,
            seat,
            kind: 'loan',
            parts: [
              mention(seat),
              text(ev.cleared ? ' cleared a loan.' : ` repaid ${ev.amount}.`),
            ],
          });
          break;

        case 'interest_charged':
          out.push({
            key,
            seat,
            kind: 'interest',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [
              mention(seat),
              text(` paid ${ev.amount} interest — one lap, one cycle.`),
            ],
          });
          break;

        case 'collateral_seized':
          out.push({
            key,
            seat,
            kind: 'bust',
            parts: [mention(seat), text(' lost their collateral to the bank.')],
          });
          break;

        case 'credits_transferred':
          out.push({
            key,
            seat,
            kind: 'transfer',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [
              mention(seat),
              text(` sent ${ev.amount} ${props.currencyLabel} to `),
              mention(ev.to),
              text('.'),
            ],
          });
          break;

        case 'paid_rent':
          out.push({
            key,
            seat,
            kind: 'rent',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [
              mention(seat),
              text(` paid ${ev.amount} ${props.currencyLabel} rent to `),
              mention(ev.to),
              text('.'),
            ],
          });
          break;

        case 'property_bought':
          out.push({
            key,
            seat,
            kind: 'buy',
            parts: [mention(seat), text(` acquired square ${ev.square} for ${ev.price} ${props.currencyLabel}.`)],
          });
          break;

        case 'card_drawn':
          out.push({
            key,
            seat,
            kind: 'card',
            parts: [
              mention(seat),
              text(` drew a ${ev.deck === 'chance' ? 'Market Event' : 'Board Memo'}.`),
            ],
          });
          break;

        case 'bribe_accepted':
          out.push({
            key,
            seat,
            kind: 'bribe',
            amount: `${ev.amount} ${props.currencyLabel}`,
            parts: [
              mention(ev.from),
              text(` paid `),
              mention(seat),
              text(` ${ev.amount} ${props.currencyLabel} to take fate. Binding.`),
            ],
          });
          break;

        case 'paid_tax':
          out.push({
            key,
            seat,
            kind: 'tax',
            parts: [mention(seat), text(` lost ${ev.amount} ${props.currencyLabel} to costs.`)],
          });
          break;

        case 'jailed':
          out.push({ key, seat, kind: 'jail', parts: [mention(seat), text(' is on compliance hold.')] });
          break;

        case 'bankrupt':
          out.push({ key, seat, kind: 'bust', parts: [mention(seat), text(' is out — bankrupt.')] });
          break;

        case 'match_finished':
          out.push({
            key,
            seat: ev.winner,
            kind: 'win',
            parts: [mention(ev.winner), text(' wins the match.')],
          });
          break;
      }
    }
  }
  return out;
});

const kindIcon: Record<string, string> = {
  roll: '🎲',
  purchase: '💸',
  fate: '➡️',
  rent: '🏢',
  buy: '📈',
  card: '🃏',
  bribe: '🤝',
  tax: '📉',
  jail: '⚖️',
  bust: '💀',
  win: '🏆',
  talk: '💬',
  demand: '📨',
  build: '🏗️',
  loan: '🏦',
  interest: '⏳',
  transfer: '💰',
};

/**
 * Scroll behaviour.
 *
 * Stick to the bottom while the reader is already there — that is the normal
 * case and they want the newest move. The moment they scroll up they are
 * READING, so never yank them back; show a floating button with the unread
 * count instead, and let them choose to jump.
 */
const feed = ref<HTMLElement | null>(null);
const atBottom = ref(true);
const unread = ref(0);

/** A few px of slack so a sub-pixel scroll position still counts as "bottom". */
const BOTTOM_SLACK = 24;

function updateAtBottom() {
  const element = feed.value;
  if (!element) return;
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  atBottom.value = distance <= BOTTOM_SLACK;
  if (atBottom.value) unread.value = 0;
}

function scrollToBottom(smooth = true) {
  const element = feed.value;
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  unread.value = 0;
  atBottom.value = true;
}

watch(
  () => entries.value.length,
  async (next, previous) => {
    await nextTick();
    if (atBottom.value) {
      scrollToBottom(previous !== undefined);
    } else if (previous !== undefined && next > previous) {
      unread.value += next - previous;
    }
  },
);

onMounted(async () => {
  await nextTick();
  scrollToBottom(false);
});

/**
 * The composer. `/pay @name 500` is parsed here into the engine's
 * `transfer_credits` action — money is a MOVE, not a message, so it goes
 * through the match rather than the chat.
 */
const draft = ref('');
const composerError = ref<string | null>(null);

function seatByHandle(handle: string): number | null {
  const wanted = handle.replace(/^@/, '').toLowerCase();
  const seat = props.seats.find(
    (s) => s.display_name.replace(/\s+/g, '').toLowerCase() === wanted,
  );
  return seat ? seat.seat_index : null;
}

function send() {
  const body = draft.value.trim();
  if (!body) return;
  composerError.value = null;

  const pay = body.match(/^\/pay\s+(\S+)\s+(\d+)$/i);
  if (pay) {
    const seat = seatByHandle(pay[1]);
    const amount = Number(pay[2]);
    if (seat === null) {
      composerError.value = `No seat called ${pay[1]}.`;
      return;
    }
    if (seat === props.yourSeat) {
      composerError.value = 'You cannot pay yourself.';
      return;
    }
    if (props.cash !== undefined && amount > props.cash) {
      composerError.value = `You only have ${props.cash} ${props.currencyLabel}.`;
      return;
    }
    emit('pay', seat, amount);
    draft.value = '';
    return;
  }

  emit('send', body);
  draft.value = '';
}

function nameOf(seatIndex: number | null) {
  if (seatIndex === null) return 'Table';
  return props.seats.find((s) => s.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`;
}
</script>

<template>
  <div class="bdv-chat" data-testid="bdv-chat">
    <header class="bdv-chat-head">
      <h3>Game chat</h3>
      <span class="bdv-chat-sub">{{ entries.length }} messages</span>
    </header>

    <ol
      ref="feed"
      class="bdv-chat-feed"
      data-testid="bdv-chat-feed"
      @scroll.passive="updateAtBottom"
    >
      <li v-if="!entries.length" class="bdv-chat-empty">
        The table is quiet. Roll to start the round.
      </li>

      <li
        v-for="entry in entries"
        :key="entry.key"
        class="bdv-msg"
        :class="[`is-${entry.kind}`, { 'is-you': entry.seat === yourSeat }]"
        data-testid="bdv-chat-msg"
      >
        <span class="bdv-avatar">{{ kindIcon[entry.kind] || '•' }}</span>
        <div class="bdv-bubble">
          <span class="bdv-author">{{ nameOf(entry.seat) }}</span>
          <p class="bdv-body">
            <template v-for="(part, i) in entry.parts" :key="i">
              <span
                v-if="part.t === 'mention'"
                class="bdv-mention"
                :class="{ 'is-you': part.you }"
                data-testid="bdv-mention"
                >{{ part.v }}</span
              ><span v-else>{{ part.v }}</span>
            </template>
          </p>

          <div v-if="entry.dice" class="bdv-dice" data-testid="bdv-dice">
            <span v-for="(d, i) in entry.dice" :key="i" class="bdv-die">{{ d }}</span>
            <span class="bdv-die bdv-die--sum">{{ entry.dice[0] + entry.dice[1] }}</span>
          </div>

          <span v-if="entry.amount" class="bdv-amount">{{ entry.amount }}</span>
        </div>
      </li>

      <li
        v-for="message in messages ?? []"
        :key="message.id"
        class="bdv-msg is-talk"
        :class="{ 'is-you': message.seat === yourSeat }"
        data-testid="bdv-chat-human"
      >
        <span class="bdv-avatar">🗨️</span>
        <div class="bdv-bubble">
          <span class="bdv-author">{{ nameOf(message.seat) }}</span>
          <p class="bdv-body">{{ message.body }}</p>
        </div>
      </li>
    </ol>

    <form class="bdv-composer" data-testid="bdv-chat-composer" @submit.prevent="send">
      <input
        v-model="draft"
        class="bdv-input"
        type="text"
        maxlength="500"
        :disabled="disabled"
        placeholder="Say something, or /pay @name 500"
        data-testid="bdv-chat-input"
      />
      <button class="bdv-send" type="submit" :disabled="disabled || !draft.trim()" data-testid="bdv-chat-send">
        Send
      </button>
    </form>
    <p v-if="composerError" class="bdv-composer-error" data-testid="bdv-composer-error">
      {{ composerError }}
    </p>

    <button
      v-if="!atBottom"
      class="bdv-jump"
      :class="{ 'has-unread': unread > 0 }"
      data-testid="bdv-jump-to-latest"
      :title="unread ? `${unread} new message${unread === 1 ? '' : 's'}` : 'Jump to latest'"
      @click="scrollToBottom()"
    >
      <span class="arrow">↓</span>
      <span v-if="unread" class="count" data-testid="bdv-unread-count">{{ unread > 99 ? '99+' : unread }}</span>
    </button>
  </div>
</template>

<style scoped>
.bdv-chat {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  overflow: hidden;
}

.bdv-chat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e9ecef;
  background: #f8f9fa;
}
.bdv-chat-head h3 { margin: 0; font-size: 15px; color: #2c3e50; }
.bdv-chat-sub { font-size: 12px; color: #6c757d; }

.bdv-chat-feed {
  list-style: none;
  margin: 0;
  padding: 12px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bdv-chat-empty { color: #6c757d; font-size: 13px; text-align: center; padding: 24px 8px; }

.bdv-msg { display: flex; gap: 8px; align-items: flex-start; }

.bdv-avatar {
  flex: none;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f1f3f5;
  font-size: 13px;
}

.bdv-bubble {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  border-top-left-radius: 2px;
  padding: 7px 11px;
  max-width: 100%;
}

.bdv-msg.is-you .bdv-bubble { background: #e3f2fd; border-color: #bee0f7; }
.bdv-msg.is-purchase .bdv-bubble { border-left: 3px solid #3498db; }
.bdv-msg.is-bribe .bdv-bubble { border-left: 3px solid #f0a202; }
.bdv-msg.is-rent .bdv-bubble { border-left: 3px solid #c0392b; }
.bdv-msg.is-win .bdv-bubble { border-left: 3px solid #28a745; }

.bdv-author {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #6c757d;
  margin-bottom: 1px;
}

.bdv-body { margin: 0; font-size: 13px; line-height: 1.45; color: #2c3e50; }

.bdv-mention {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  background: #dfe7ef;
  color: #2c5d8a;
  font-weight: 600;
}
.bdv-mention.is-you { background: #3498db; color: #fff; }

.bdv-dice { display: flex; gap: 5px; margin-top: 6px; }
.bdv-die {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #ced4da;
  border-radius: 5px;
  background: #fff;
  font-size: 12px;
  font-weight: 700;
  color: #2c3e50;
}
.bdv-die--sum { background: #2c3e50; color: #fff; border-color: #2c3e50; }

.bdv-amount {
  display: inline-block;
  margin-top: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #3498db;
}

/* Floating "there are updates" button — only while the reader has scrolled up. */
.bdv-composer {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid #e9ecef;
  background: #fff;
}
.bdv-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 13px;
  color: #2c3e50;
}
.bdv-input:focus { outline: none; border-color: #80bdff; box-shadow: 0 0 0 2px rgba(0,123,255,.2); }
.bdv-send {
  padding: 7px 13px; border: 1px solid #3498db; border-radius: 6px;
  background: #3498db; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bdv-send:disabled { opacity: .5; cursor: not-allowed; }
.bdv-composer-error {
  margin: 0; padding: 4px 10px 8px; font-size: 12px; color: #c0392b; background: #fff;
}

.bdv-jump {
  position: absolute;
  right: 14px;
  bottom: 62px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #2c85c4;
  border-radius: 18px;
  background: #3498db;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(44, 62, 80, 0.28);
  transition: transform 0.12s ease, background 0.15s;
}
.bdv-jump:hover { background: #2c85c4; transform: translateY(-1px); }
.bdv-jump .arrow { line-height: 1; }
.bdv-jump .count {
  font-size: 12px;
  padding-left: 2px;
}
.bdv-jump.has-unread { animation: bdv-nudge 1.6s ease-in-out 2; }

@keyframes bdv-nudge {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

@media (prefers-reduced-motion: reduce) {
  .bdv-jump { animation: none; transition: none; }
}
</style>
