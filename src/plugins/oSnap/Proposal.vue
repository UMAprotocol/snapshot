<script setup lang="ts">
import { ExtendedSpace, Proposal, Results } from '@/helpers/interfaces';
import { objectFromEntriesSorted, pickFromObject } from '@/helpers/utils';
import { isBigNumberish } from '@ethersproject/bignumber/lib/bignumber';
import { formatEther, formatUnits } from '@ethersproject/units';
import HandleOutcome from './components/HandleOutcome/HandleOutcome.vue';
import ReadOnly from './components/Input/ReadOnly.vue';
import SafeLinkWithAvatar from './components/SafeLinkWithAvatar.vue';
import { GnosisSafe, Transaction } from './types';
import OsnapMarketingWidget from './components/OsnapMarketingWidget.vue';
import TenderlySimulation from './components/TransactionBuilder/TenderlySimulation.vue';
import BotSupportWarning from './components/BotSupportWarning.vue';

const keyOrder = ['to', 'recipient', 'amount', 'value', 'token', 'data'];

const props = defineProps<{
  space: ExtendedSpace;
  proposal: Proposal;
  results: Results;
}>();

const safe = props.proposal.plugins.oSnap?.safe as GnosisSafe;
const transactionsForDisplay = enrichTransactionsForDisplay(safe.transactions);

function enrichTransactionsForDisplay(transactions: Transaction[]) {
  // handle here
  return transactions.map(enrichTransactionForDisplay);
}

function enrichTransactionForDisplay(transaction: Transaction) {
  const { to, value, data } = transaction;
  const commonProperties = { to, value: formatEther(value), data };

  if (transaction.type === 'raw') {
    return { ...commonProperties, type: 'Raw' };
  }
  if (transaction.type === 'contractInteraction') {
    const { method, parameters } = transaction;
    return {
      ...commonProperties,
      type: 'Contract interaction',
      'method name': method.name,
      ...Object.fromEntries(
        method.inputs.map((input, i) => {
          return [`${input.name} (param ${i + 1}): `, parameters[i]];
        })
      )
    };
  }
  if (transaction.type === 'transferFunds') {
    const { token, amount: unformattedAmount } = transaction;
    const amount =
      isBigNumberish(unformattedAmount) && !!token?.decimals
        ? formatUnits(unformattedAmount, token.decimals)
        : unformattedAmount;

    const isNativeTransfer = token?.address === 'main';

    if (isNativeTransfer) {
      return {
        ...pickFromObject(commonProperties, ['data']), // "to" & "value" redundant
        recipient: commonProperties.to,
        type: 'Transfer funds',
        token: `Native token (${token.symbol})`,
        amount
      };
    }
    return {
      ...pickFromObject(commonProperties, ['data', 'to']),
      recipient: transaction.recipient,
      type: 'Transfer funds',
      token: `${token?.name} token (${token?.symbol})`,
      amount
    };
  }
  if (transaction.type === 'transferNFT') {
    const { recipient, collectable } = transaction;
    return {
      ...commonProperties,
      type: 'Transfer NFT',
      recipient,
      collectable: `${collectable?.tokenName} #${collectable?.id}`,
      'collectible address': collectable?.address
    };
  }
  return { ...commonProperties, type: 'Raw' };
}
</script>

<template>
  <template v-if="safe.transactions.length > 0">
    <div
      class="flex w-full flex-col gap-4 rounded-2xl border border-skin-border p-3 relative"
    >
      <OsnapMarketingWidget class="absolute top-[-16px] right-[16px]" />
      <h2 class="text-lg">oSnap Transactions</h2>
      <div class="flex flex-col items-center gap-3 md:flex-row">
        <SafeLinkWithAvatar :safe="safe" />
      </div>

      <BotSupportWarning
        :chain-id="safe.network"
        :safe-address="safe.safeAddress"
      />

      <div class="divider mx-auto h-[1px] w-full bg-skin-border" />
      <div
        v-for="({ type, ...details }, index) in transactionsForDisplay"
        class="flex flex-col gap-2"
      >
        <h4 class="mb-2">Transaction #{{ index + 1 }} — {{ type }}</h4>

        <ReadOnly
          v-for="[key, value] in objectFromEntriesSorted(details, keyOrder)"
        >
          <strong
            class="mr-2 inline-block whitespace-nowrap first-letter:capitalize"
            >{{ key }}</strong
          >
          <span class="break-all">{{ value }}</span>
        </ReadOnly>
      </div>

      <TenderlySimulation
        :transactions="safe.transactions"
        :safe="safe"
        :network="safe.network"
      />

      <HandleOutcome
        v-if="!!results"
        :space="space"
        :proposal="proposal"
        :transactions="safe.transactions"
        :results="results"
        :module-address="safe.moduleAddress"
        :network="safe.network"
      />
    </div>
  </template>

  <template v-else>
    <p>There are no transactions associated with this proposal.</p>
  </template>
</template>
