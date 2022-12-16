<script setup>
import { onMounted, ref, computed } from 'vue';
import Plugin from '../index';
import networks from '@snapshot-labs/snapshot.js/src/networks.json';
import { getInstance } from '@snapshot-labs/lock/plugins/vue3';
import { sleep } from '@snapshot-labs/snapshot.js/src/utils';
import { BigNumber } from '@ethersproject/bignumber';
import { formatUnits } from '@ethersproject/units';

import {
  useWeb3,
  useI18n,
  useIntl,
  useFlashNotification,
  useTxStatus,
  useSafe
} from '@/composables';

const { formatRelativeTime } = useIntl();
const { t } = useI18n();

const { clearBatchError, setBatchError } = useSafe();
const { web3 } = useWeb3();
const { pendingCount } = useTxStatus();
const { notify } = useFlashNotification();

const props = defineProps([
  'batches',
  'proposal',
  'network',
  'umaAddress',
  'multiSendAddress'
]);

const plugin = new Plugin();

const QuestionStates = {
  error: -1,
  noWalletConnection: 0,
  loading: 1,
  waitingForProposal: 2,
  proposalApproved: 3,
  proposalRejected: 4,
  completelyExecuted: 5,
  disputedButNotResolved: 6,
  disputedResolvedValid: 7
};
Object.freeze(QuestionStates);

const ensureRightNetwork = async chainId => {
  const chainIdInt = parseInt(chainId);
  const connectedToChainId = getInstance().provider.value?.chainId;
  if (connectedToChainId === chainIdInt) return; // already on right chain

  if (!window.ethereum || !getInstance().provider.value?.isMetaMask) {
    // we cannot switch automatically
    throw new Error(
      `Connected to wrong chain #${connectedToChainId}, required: #${chainId}`
    );
  }

  const network = networks[chainId];
  const chainIdHex = `0x${chainIdInt.toString(16)}`;

  try {
    // check if the chain to connect to is installed
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }] // chainId must be in hexadecimal numbers
    });
  } catch (error) {
    // This error code indicates that the chain has not been added to MetaMask. Let's add it.
    if (error.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: network.name,
              rpcUrls: network.rpc,
              blockExplorerUrls: [network.explorer.url]
            }
          ]
        });
      } catch (addError) {
        console.error(addError);
      }
    }
    console.error(error);
  }

  await sleep(1e3); // somehow the switch does not take immediate effect :/
  if (window.ethereum.chainId !== chainIdHex) {
    throw new Error(
      `Could not switch to the right chain on MetaMask (required: ${chainIdHex}, active: ${window.ethereum.chainId})`
    );
  }
};

const loading = ref(true);
const questionStates = ref(QuestionStates);
const actionInProgress = ref(false);
const action2InProgress = ref(false);
const questionDetails = ref(undefined);

const getTransactions = () => {
  return props.batches.map(batch => [
    batch.transactions[0].to,
    Number(batch.transactions[0].operation),
    batch.transactions[0].value,
    batch.transactions[0].data
  ]);
};

const updateDetails = async () => {
  loading.value = true;
  try {
    console.log('transactions:', getTransactions());
    questionDetails.value = await plugin.getExecutionDetails(
      props.network,
      props.umaAddress,
      props.proposal.id,
      getTransactions()
    );
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const approveBond = async () => {
  if (!questionDetails.value.oracle) return;
  try {
    actionInProgress.value = 'approve-bond';

    await ensureRightNetwork(props.network);

    const approveBond = await plugin.approveBond(
      props.network,
      getInstance().web3,
      props.umaAddress
    );
    await approveBond.next();
    actionInProgress.value = null;
    pendingCount.value++;
    await approveBond.next();
    notify(t('notify.youDidIt'));
    pendingCount.value--;
    await sleep(3e3);
    await updateDetails();
  } catch (e) {
    console.error(e);
    actionInProgress.value = null;
  }
};

const submitProposal = async () => {
  if (!getInstance().isAuthenticated.value) return;
  actionInProgress.value = 'submit-proposal';
  try {
    await ensureRightNetwork(props.network);
    const proposalSubmission = plugin.submitProposal(
      getInstance().web3,
      props.umaAddress,
      getTransactions()
    );
    await proposalSubmission.next();
    actionInProgress.value = null;
    pendingCount.value++;
    await proposalSubmission.next();
    notify(t('notify.youDidIt'));
    pendingCount.value--;
    await sleep(3e3);
    await updateDetails();
  } catch (e) {
    console.error(e);
  } finally {
    actionInProgress.value = null;
  }
};

const executeProposal = async () => {
  if (!getInstance().isAuthenticated.value) return;
  action2InProgress.value = 'execute-proposal';
  try {
    await ensureRightNetwork(props.network);
  } catch (e) {
    console.error(e);
    action2InProgress.value = null;
    return;
  }

  try {
    clearBatchError();
    const executingProposal = plugin.executeProposal(
      getInstance().web3,
      props.umaAddress,
      getTransactions()
    );
    await executingProposal.next();
    action2InProgress.value = null;
    pendingCount.value++;
    await executingProposal.next();
    notify(t('notify.youDidIt'));
    pendingCount.value--;
    await sleep(3e3);
    await updateDetails();
  } catch (err) {
    pendingCount.value--;
    action2InProgress.value = null;
  }
};

const usingMetaMask = computed(() => {
  return window.ethereum && getInstance().provider.value?.isMetaMask;
});

const connectedToRightChain = computed(() => {
  return getInstance().provider.value?.chainId === parseInt(props.network);
});

const networkName = computed(() => {
  return networks[props.network].name;
});

const questionState = computed(() => {
  if (!web3.value.account) return QuestionStates.noWalletConnection;

  if (loading.value) return QuestionStates.loading;

  if (!questionDetails.value) return QuestionStates.error;

  const ts = (Date.now() / 1e3).toFixed();
  const { proposalEvent } = questionDetails.value;

  // Proposal can be made if it has not been made already.
  if (!proposalEvent) return QuestionStates.waitingForProposal;

  // Proposal is approved if it expires without a dispute and hasn't been settled.
  if (proposalEvent.isExpired && !proposalEvent.isSettled)
    return QuestionStates.proposalApproved;

  // Proposal is approved if it has been settled without a disputer and hasn't been executed.
  if (
    proposalEvent.isSettled &&
    !proposalEvent.isDisputed /* && has not been executed */
  )
    return QuestionStates.proposalApproved;

  // Proposal can not be re-proposed if it has been executed.
  if (proposalEvent.isSettled /* && has been executed */)
    return QuestionStates.completelyExecuted;

  // Proposal can be re-proposed if it has been disputed but not resolved.
  if (proposalEvent.isDisputed && !proposalEvent.resolvedPrice)
    return QuestionStates.waitingForProposal;
  // question: does this create new proposal event?
  // you can do two proposals with duplicate transactions at different times, will they
  // have different question ids?

  // Proposal can be deleted if it has been rejected.
  if (proposalEvent.isDisputed && proposalEvent.resolvedPrice == 0)
    return QuestionStates.proposalRejected;

  return QuestionStates.error;
});

onMounted(async () => {
  await updateDetails();
});
</script>

<template>
  <div v-if="questionState === questionStates.error" class="my-4">
    {{ $t('safeSnap.labels.error') }}
  </div>

  <div v-if="questionState === questionStates.noWalletConnection" class="my-4">
    {{ $t('safeSnap.labels.connectWallet') }}
  </div>

  <div v-if="questionState === questionStates.loading" class="my-4">
    <LoadingSpinner />
  </div>

  <div v-if="connectedToRightChain || usingMetaMask">
    <div
      v-if="
        questionState === questionStates.waitingForProposal &&
        questionDetails.needsBondApproval === true
      "
      class="my-4"
    >
      <BaseButton
        :loading="actionInProgress === 'approve-bond'"
        @click="approveBond"
      >
        {{ $t('safeSnap.labels.approveBond') }}
      </BaseButton>
    </div>
    <div
      v-if="
        questionState === questionStates.waitingForProposal &&
        questionDetails.needsBondApproval === false
      "
      class="my-4"
    >
      <BaseButton
        :loading="actionInProgress === 'submit-proposal'"
        @click="submitProposal"
      >
        {{ $t('safeSnap.labels.request') }}
      </BaseButton>
    </div>

    <div v-if="questionState === questionStates.proposalApproved" class="my-4">
      <BaseButton
        :loading="action2InProgress === 'execute-proposal'"
        @click="executeProposal"
      >
        {{
          $t('safeSnap.labels.executeTxs', [
            questionDetails.nextTxIndex + 1,
            batches.length
          ])
        }}
      </BaseButton>
    </div>
  </div>
  <div
    v-else-if="
      questionState !== questionStates.loading &&
      questionState !== questionStates.noWalletConnection
    "
    class="my-4"
  >
    {{ $t('safeSnap.labels.switchChain', [networkName]) }}
  </div>

  <div v-if="questionState === questionStates.completelyExecuted" class="my-4">
    {{ $t('safeSnap.labels.executed') }}
  </div>

  <div v-if="questionState === questionStates.proposalRejected" class="my-4">
    {{ $t('safeSnap.labels.rejected') }}
  </div>
</template>
