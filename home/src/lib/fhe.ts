import type { JsonRpcSigner } from 'ethers';

type FhevmInstance = {
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: string | number,
    durationDays: string | number,
  ) => {
    domain: any;
    types: any;
    message: any;
  };
  userDecrypt: (
    handles: { handle: Uint8Array | string; contractAddress: string }[],
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: string | number,
    durationDays: string | number,
  ) => Promise<{ clearValues: Record<`0x${string}`, bigint | boolean | `0x${string}`> }>;
};

export async function decryptU64(
  instance: FhevmInstance,
  signer: JsonRpcSigner,
  handle: `0x${string}`,
  contractAddress: `0x${string}`,
  userAddress: `0x${string}`,
): Promise<bigint> {
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000).toString();
  const durationDays = '1';
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signer.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays,
  );

  const clear = result.clearValues[handle];
  if (typeof clear !== 'bigint') {
    throw new Error('Unexpected decrypted value type');
  }
  return clear;
}

export function parseUnits6(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) return 0n;

  if (trimmed.startsWith('-')) throw new Error('Amount must be >= 0');

  const [whole, fracRaw] = trimmed.split('.');
  const frac = (fracRaw ?? '').slice(0, 6).padEnd(6, '0');
  const wholeDigits = whole === '' ? '0' : whole;

  if (!/^\d+$/.test(wholeDigits) || !/^\d*$/.test(fracRaw ?? '')) {
    throw new Error('Invalid decimal amount');
  }

  return BigInt(wholeDigits) * 1_000_000n + BigInt(frac || '0');
}

export function toUnits6String(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

