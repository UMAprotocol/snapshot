<script setup lang="ts">
import { parseAmount } from '@/helpers/utils';
import { FunctionFragment } from '@ethersproject/abi';
import { isAddress } from '@ethersproject/address';
import { useDebounceFn } from '@vueuse/core';

import { ContractInteractionTransaction, Network } from '../../types';
import {
  AbiResult,
  createContractInteractionTransaction,
  fetchProxyAndImplementationAbis,
  getABIWriteFunctions,
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
const abi = ref<Extract<AbiResult, { success: true }> | undefined>();
const selectedAbi = ref<string | undefined>();

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
  if (!isValueValid || !isToValid || !isAbiValid || !selectedAbi.value) return;
  try {
    const transaction = createContractInteractionTransaction({
      to: to.value,
      value: value.value,
      abi: selectedAbi.value,
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
  selectedAbi.value = newAbi;
  methods.value = [];

  try {
    methods.value = getABIWriteFunctions(selectedAbi.value);
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
    fetchABIs();
  }
}, 300);

async function fetchABIs() {
  const result = await fetchProxyAndImplementationAbis(props.network, to.value);
  if (result.success) {
    abi.value = result;
    // defaults to implementation if proxy
    abi.value?.isProxy
      ? updateAbi(abi.value.implementationAbi)
      : updateAbi(abi.value.abi);
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

    <UiSelect
      v-if="abi?.success && abi.isProxy"
      v-model="selectedAbi"
      @change="updateAbi($event)"
    >
      <template #label>Choose ABI</template>
      <option :value="abi.implementationAbi">Write Contract</option>
      <option :value="abi.proxyAbi">Write Proxy</option>
    </UiSelect>

    <UiInput
      v-if="!abi?.success"
      :error="!isAbiValid && $t('safeSnap.invalidAbi')"
      :model-value="selectedAbi"
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
</template>
