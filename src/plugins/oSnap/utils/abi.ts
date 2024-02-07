import { FunctionFragment, Interface, ParamType } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';
import { memoize } from 'lodash';
import { ERC20_ABI, ERC721_ABI, EXPLORER_API_URLS } from '../constants';
import {
  mustBeEthereumAddress,
  mustBeEthereumContractAddress
} from './validators';
import { isErrorWithMessage } from '../types';
import { fetchImplementationAddress } from './getters';

/**
 * Checks if the `parameter` of a contract method `method` takes an array or tuple as input, based on the `baseType` of the parameter.
 *
 * If this is the case, we must parse the value as JSON and verify that it is valid.
 */
export function isArrayParameter(parameter: string): boolean {
  return ['tuple', 'array'].includes(parameter);
}

const fetchContractABI = memoize(
  async (url: string, contractAddress: string) => {
    const params = new URLSearchParams({
      module: 'contract',
      action: 'getAbi',
      address: contractAddress
    });

    const response = await fetch(`${url}?${params}`);

    if (!response.ok) {
      return { status: 0, result: '' };
    }

    return response.json();
  },
  (url, contractAddress) => `${url}_${contractAddress}`
);

/**
 * Returns the ABI of a contract at the given address
 */
export async function getContractABI(
  network: string,
  contractAddress: string
): Promise<string> {
  const apiUrl = EXPLORER_API_URLS[network as keyof typeof EXPLORER_API_URLS];

  if (!apiUrl) {
    return '';
  }

  const isEthereumAddress = mustBeEthereumAddress(contractAddress);
  const isEthereumContractAddress = await mustBeEthereumContractAddress(
    network,
    contractAddress
  );

  if (!isEthereumAddress || !isEthereumContractAddress) {
    return '';
  }

  try {
    const { result, status } = await fetchContractABI(apiUrl, contractAddress);

    if (status === '0') {
      return '';
    }

    return result;
  } catch (e) {
    console.error('Failed to retrieve ABI', e);
    return '';
  }
}

export type AbiResult =
  | {
      success: true;
      isProxy: true;
      proxyAbi: string;
      implementationAbi: string;
    }
  | {
      success: true;
      isProxy: false;
      abi: string;
    }
  | {
      success: false;
      error: string;
    };

/**
 * Attempts to fetch ABIs at a particular address, from a block explorer.
 *
 * Checks if the contract is a proxy contract, and if so, returns both
 */
export async function fetchProxyAndImplementationAbis(
  network: string,
  contractAddress: string
): Promise<AbiResult> {
  try {
    const abi = await getContractABI(network, contractAddress);
    if (!abi) {
      throw new Error('unable to fetch ABI');
    }
    if (!isProxyContract(abi)) {
      return {
        success: true,
        isProxy: false,
        abi
      };
    }
    const implementationAddress = await fetchImplementationAddress(
      abi,
      contractAddress,
      network
    );

    if (!implementationAddress) {
      throw new Error('Failed to fetch implementation address');
    }
    const implementationAbi = await getContractABI(
      network,
      implementationAddress
    );
    if (!implementationAbi) {
      throw new Error('failed to fetch implementation ABI');
    }

    return {
      success: true,
      isProxy: true,
      proxyAbi: abi,
      implementationAbi
    };
  } catch (error) {
    return {
      success: false,
      error: isErrorWithMessage(error)
        ? error.message
        : "Failed to fetch ABI's for this address"
    };
  }
}

/**
 * Checks an ABI statically to see if it is a proxy contract.
 *
 * This is very rudimentary, it only checks if the contract has a function called "implementation"
 */
function isProxyContract(abi: string): boolean {
  const contract = new Interface(abi);
  if (
    contract.fragments.find(
      fragment =>
        fragment.type === 'function' && fragment.name === 'implementation'
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a method is a write function.
 *
 * Only write functions can be executed by the Optimistic Governor.
 */
export function isWriteFunction(method: FunctionFragment) {
  if (!method.stateMutability) return true;
  return !['view', 'pure'].includes(method.stateMutability);
}

/**
 * Returns the write functions of a contract ABI.
 */
export function getABIWriteFunctions(abi: string) {
  const abiInterface = new Interface(abi);
  return (
    abiInterface.fragments
      // Return only contract's functions
      .filter(FunctionFragment.isFunctionFragment)
      .map(FunctionFragment.fromObject)
      // Return only write functions
      .filter(isWriteFunction)
      // Sort by name
      .sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1))
  );
}

/**
 * Handles the extraction of the method's arguments from the `values` array.
 *
 * If the parameter is an array or tuple, we parse the value as JSON.
 */
function extractMethodArgs(values: string[]) {
  return (param: ParamType, index: number) => {
    const value = values[index];
    if (isArrayParameter(param.baseType)) {
      return JSON.parse(value);
    }
    return value;
  };
}

/**
 * Encodes the method and parameters of a contract interaction.
 */
export function encodeMethodAndParams(
  abi: string,
  method: FunctionFragment,
  values: string[]
) {
  const contractInterface = new Interface(abi);
  const parameterValues = method.inputs.map(extractMethodArgs(values));
  return contractInterface.encodeFunctionData(method, parameterValues);
}

/**
 * Returns the transaction data for an ERC20 transfer.
 */
export function getERC20TokenTransferTransactionData(
  recipientAddress: string,
  amount: BigNumberish
): string {
  const contractInterface = new Interface(ERC20_ABI);
  return contractInterface.encodeFunctionData('transfer', [
    recipientAddress,
    amount
  ]);
}

/**
 * Returns the transaction data for an ERC721 transfer.
 */
export function getERC721TokenTransferTransactionData(
  fromAddress: string,
  recipientAddress: string,
  id: BigNumberish
): string {
  const contractInterface = new Interface(ERC721_ABI);
  return contractInterface.encodeFunctionData('safeTransferFrom', [
    fromAddress,
    recipientAddress,
    id
  ]);
}
