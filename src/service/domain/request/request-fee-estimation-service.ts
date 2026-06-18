import * as application from '../../../constants/application';
import type {
  RequestFeeBatchProjection,
  RequestFeeEstimate,
  RequestFeeEstimateConfig,
  RequestFeeStateReader
} from '../../../model/ethereum';

/**
 * Parameters for estimating how long a request fee needs to drain to a target fee.
 */
interface FeeDropEstimateConfig {
  currentExcess: bigint;
  targetFee: bigint;
  systemContractAddress: string;
}

/**
 * Service for estimating execution layer request fees without broadcasting.
 */
export class RequestFeeEstimationService {
  /**
   * Create a request-fee estimation service.
   *
   * @param stateReader - Ethereum state reader for current fee and network fee state
   * @param systemContractAddress - Request contract address
   */
  constructor(
    private readonly stateReader: RequestFeeStateReader,
    private readonly systemContractAddress: string
  ) {}

  /**
   * Estimate current request and gas fee state.
   *
   * @param maxRequestFee - Cap used to mark whether the current fee is acceptable
   * @returns Current fee estimate
   */
  async estimateCurrentFees(maxRequestFee: bigint): Promise<RequestFeeEstimate> {
    return this.estimateRequestFees({
      totalRequestCount: 1,
      maxRequestsPerBlock: 1,
      maxRequestFee
    });
  }

  /**
   * Estimate request fees for an idealized batch plan.
   *
   * @param config - Request count, batch size, and cap
   * @returns Current state plus per-batch projection
   */
  async estimateBatchFees(config: RequestFeeEstimateConfig): Promise<RequestFeeEstimate> {
    return this.estimateRequestFees(config);
  }

  /**
   * Estimate request fees for a planned operation.
   *
   * @param config - Request count, batch size, and cap
   * @returns Current state plus per-batch projection
   */
  async estimateRequestFees(config: RequestFeeEstimateConfig): Promise<RequestFeeEstimate> {
    const [feeState, maxNetworkFees] = await Promise.all([
      this.stateReader.fetchContractFeeWithExcess(),
      this.stateReader.getMaxNetworkFees()
    ]);
    const gasCost = maxNetworkFees.maxFeePerGas * application.TRANSACTION_GAS_LIMIT;

    return {
      currentExcess: feeState.excess,
      currentRequestFee: feeState.fee,
      maxNetworkFees,
      gasLimit: application.TRANSACTION_GAS_LIMIT,
      gasCost,
      exceedsCap: feeState.fee > config.maxRequestFee,
      estimatedBlocksUntilCap: estimateBlocksUntilRequestFeeDrops({
        currentExcess: feeState.excess,
        targetFee: config.maxRequestFee,
        systemContractAddress: this.systemContractAddress
      }),
      batches: projectBatchFees({
        ...config,
        currentExcess: feeState.excess,
        systemContractAddress: this.systemContractAddress
      })
    };
  }
}

/**
 * Calculate the EIP-7002/EIP-7251 fake exponential request fee.
 *
 * @param excess - Current request excess from storage slot 0
 * @returns Request fee in wei
 */
export function calculateRequestFee(excess: bigint): bigint {
  let i = 1n;
  let output = 0n;
  let numeratorAccum =
    application.MIN_CONSOLIDATION_REQUEST_FEE *
    application.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;

  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum =
      (numeratorAccum * excess) / (application.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION * i);
    i += 1n;
  }

  return output / application.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;
}

/**
 * Estimate blocks until the request fee drops to or below a target.
 *
 * @param config - Current excess, target fee, and contract address
 * @returns Estimated blocks assuming no new requests
 */
export function estimateBlocksUntilRequestFeeDrops(config: FeeDropEstimateConfig): bigint {
  const targetPerBlock = getTargetPerBlock(config.systemContractAddress);

  if (config.targetFee <= 0n) {
    return config.currentExcess / targetPerBlock + 1n;
  }

  const targetExcess = findMaxExcessForRequestFee(config.targetFee);
  if (config.currentExcess <= targetExcess) {
    return 0n;
  }

  const excessDelta = config.currentExcess - targetExcess;
  return (excessDelta + targetPerBlock - 1n) / targetPerBlock;
}

interface BatchProjectionConfig extends RequestFeeEstimateConfig {
  currentExcess: bigint;
  systemContractAddress: string;
}

function projectBatchFees(config: BatchProjectionConfig): RequestFeeBatchProjection[] {
  const batches: RequestFeeBatchProjection[] = [];
  const targetPerBlock = getTargetPerBlock(config.systemContractAddress);
  let remaining = config.totalRequestCount;
  let excess = config.currentExcess;
  let batchNumber = 1;

  while (remaining > 0) {
    const requestCount = Math.min(remaining, config.maxRequestsPerBlock);
    const requestFee = calculateRequestFee(excess);
    batches.push({
      batchNumber,
      requestCount,
      requestFee,
      capExceeded: requestFee > config.maxRequestFee
    });

    const nextExcess = excess + BigInt(requestCount);
    excess = nextExcess > targetPerBlock ? nextExcess - targetPerBlock : 0n;
    remaining -= requestCount;
    batchNumber++;
  }

  return batches;
}

function findMaxExcessForRequestFee(targetFee: bigint): bigint {
  let low = 0n;
  let high = 1n;

  while (calculateRequestFee(high) <= targetFee) {
    high *= 2n;
  }

  while (low < high - 1n) {
    const mid = (low + high) / 2n;
    if (calculateRequestFee(mid) <= targetFee) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

function getTargetPerBlock(systemContractAddress: string): bigint {
  return (
    application.TARGET_PER_BLOCK_BY_CONTRACT[systemContractAddress.toLowerCase()] ??
    application.CONSOLIDATION_TARGET_PER_BLOCK
  );
}
