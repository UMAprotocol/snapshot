<script setup lang="ts">
import { parseAmount } from '@/helpers/utils';
import { FunctionFragment } from '@ethersproject/abi';
import { isAddress } from '@ethersproject/address';
import { useDebounceFn } from '@vueuse/core';

import { ContractInteractionTransaction, Network } from '../../types';
import {
  createContractInteractionTransaction,
  fetchImplementationAddress,
  getABIWriteFunctions,
  getContractABI,
  validateTransaction
} from '../../utils';
import AddressInput from '../Input/Address.vue';
import MethodParameterInput from '../Input/MethodParameter.vue';

const props = defineProps<{
  network: Network;
  transaction: ContractInteractionTransaction;
}>();

const emit = defineEmits<{
  updateTransaction: [transaction: ContractInteractionTransaction];
}>();

const to = ref(props.transaction.to ?? '');
const isToValid = computed(() => {
  return to.value === '' || isAddress(to.value);
});
const abi = ref('');
const implementationAddress = ref('');
const showAbiChoiceModal = ref(false);

const isAbiValid = ref(true);
const value = ref(props.transaction.value ?? '0');
const isValueValid = ref(true);
const methods = ref<FunctionFragment[]>([]);
const selectedMethodName = ref(props.transaction.methodName ?? '');
const selectedMethod = computed(
  () =>
    methods.value.find(method => method.name === selectedMethodName.value) ??
    methods.value[0]
);
const parameters = ref<string[]>([]);

function updateTransaction() {
  if (!isValueValid || !isToValid || !isAbiValid || !abi.value) return;
  try {
    const transaction = createContractInteractionTransaction({
      to: to.value,
      value: value.value,
      abi: abi.value,
      method: selectedMethod.value,
      parameters: parameters.value
    });

    if (validateTransaction(transaction)) {
      emit('updateTransaction', transaction);
      return;
    }
  } catch (error) {
    console.warn('ContractInteraction - Invalid Transaction:', error);
  }
}

function updateParameter(index: number, value: string) {
  parameters.value[index] = value;
  updateTransaction();
}

function updateMethod(methodName: string) {
  parameters.value = [];
  selectedMethodName.value = methodName;
  updateTransaction();
}

function updateAbi(newAbi: string) {
  abi.value = newAbi;
  methods.value = [];

  try {
    methods.value = getABIWriteFunctions(abi.value);
    isAbiValid.value = true;
    updateMethod(methods.value[0].name);
  } catch (error) {
    isAbiValid.value = false;
    console.warn('error extracting useful methods', error);
  }
  updateTransaction();
}

const debouncedUpdateAddress = useDebounceFn(() => {
  if (isAddress(to.value)) {
    fetchABI();
  }
}, 300);

async function handleUseProxyAbi() {
  showAbiChoiceModal.value = false;
  try {
    const res = await getContractABI(props.network, to.value);
    if (res) {
      updateAbi(res);
    }
  } catch (error) {
    console.error(error);
  }
}

async function handleUseImplementationAbi() {
  showAbiChoiceModal.value = false;
  try {
    if (!implementationAddress.value) {
      throw new Error(' No Implementation address');
    }
    const res = await getContractABI(
      props.network,
      implementationAddress.value
    );
    if (res) {
      updateAbi(res);
    }
  } catch (error) {
    console.error(error);
  }
}

async function fetchABI() {
  try {
    const res = await fetchImplementationAddress(to.value, props.network);
    if (!res) {
      handleUseProxyAbi();
      return;
    }
    // if proxy, let user decide which ABI we should fetch
    implementationAddress.value = res;
    showAbiChoiceModal.value = true;
  } catch (error) {
    console.error(error);
  }
}

function updateValue(newValue: string) {
  value.value = newValue;
  try {
    parseAmount(newValue);
    isValueValid.value = true;
  } catch (error) {
    isValueValid.value = false;
  }
  updateTransaction();
}
</script>

<template>
  <div class="space-y-2">
    <AddressInput
      v-model="to"
      :label="$t('safeSnap.to')"
      @update:model-value="debouncedUpdateAddress()"
    />

    <UiInput
      :error="!isValueValid && $t('safeSnap.invalidValue')"
      :model-value="value"
      @update:model-value="updateValue($event)"
    >
      <template #label>{{ $t('safeSnap.value') }}</template>
    </UiInput>

    <UiInput
      :error="!isAbiValid && $t('safeSnap.invalidAbi')"
      :model-value="abi"
      @update:model-value="updateAbi($event)"
    >
      <template #label>ABI</template>
    </UiInput>

    <div v-if="methods.length">
      <UiSelect v-model="selectedMethodName" @change="updateMethod($event)">
        <template #label>function</template>
        <option v-for="(method, i) in methods" :key="i" :value="method.name">
          {{ method.name }}()
        </option>
      </UiSelect>

      <div v-if="selectedMethod && selectedMethod.inputs.length">
        <div class="divider"></div>

        <MethodParameterInput
          v-for="(input, index) in selectedMethod.inputs"
          :key="input.name"
          :parameter="input"
          :value="parameters[index]"
          @update-parameter-value="updateParameter(index, $event)"
        />
      </div>
    </div>
  </div>

  <BaseModal :open="showAbiChoiceModal" @close="showAbiChoiceModal = false">
    <template #header>
      <h3 class="text-left px-3">Use Implementation ABI?</h3>
    </template>
    <div class="flex flex-col gap-4 p-3">
      <p class="pr-8">
        This contract looks like a proxy. Would you like to use the
        implementation ABI?
      </p>
      <div class="flex gap-2 justify-center">
        <TuneButton @click="handleUseProxyAbi"> Keep proxy ABI </TuneButton>
        <TuneButton @click="handleUseImplementationAbi">
          Use Implementation ABI
        </TuneButton>
      </div>
    </div>
  </BaseModal>
</template>
