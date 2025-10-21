import { describe, it, expect, beforeEach, vi } from "vitest";

interface Decision {
  owner: string;
  metadataUri: string;
  contentHash: Buffer;
  timestamp: bigint;
  submissionId: bigint;
  approved: boolean;
}

interface Result<T> {
  isOk: boolean;
  value: T;
}

class NFTMinterMock {
  state = {
    nextNftId: 0n,
    archiverRole: "ST1ARCHIVER",
    submissionContract: null as string | null,
    approvalContract: null as string | null,
    timestampContract: null as string | null,
    decisionRegistry: new Map<bigint, Decision>(),
    mintedSubmissions: new Map<bigint, boolean>(),
  };
  caller = "ST1CALLER";
  blockHeight = 1000n;

  reset() {
    this.state = {
      nextNftId: 0n,
      archiverRole: "ST1ARCHIVER",
      submissionContract: null,
      approvalContract: null,
      timestampContract: null,
      decisionRegistry: new Map(),
      mintedSubmissions: new Map(),
    };
    this.caller = "ST1CALLER";
    this.blockHeight = 1000n;
  }

  setArchiverRole(newArchiver: string): Result<boolean> {
    if (this.caller !== this.state.archiverRole) return { isOk: false, value: false };
    this.state.archiverRole = newArchiver;
    return { isOk: true, value: true };
  }

  setSubmissionContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.archiverRole) return { isOk: false, value: false };
    this.state.submissionContract = contract;
    return { isOk: true, value: true };
  }

  setApprovalContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.archiverRole) return { isOk: false, value: false };
    this.state.approvalContract = contract;
    return { isOk: true, value: true };
  }

  setTimestampContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.archiverRole) return { isOk: false, value: false };
    this.state.timestampContract = contract;
    return { isOk: true, value: true };
  }

  validateSubmission(submissionId: bigint, contentHash: Buffer): Result<boolean> {
    if (!this.state.submissionContract) return { isOk: false, value: false };
    if (contentHash.length !== 32) return { isOk: false, value: false };
    return { isOk: true, value: true };
  }

  isApproved(submissionId: bigint): Result<boolean> {
    if (!this.state.approvalContract) return { isOk: true, value: true };
    const approved = this.state.approvalContract === "ST2APPROVAL" && submissionId % 2n === 0n;
    return { isOk: true, value: approved };
  }

  getCurrentTimestamp(): Result<bigint> {
    if (!this.state.timestampContract) return { isOk: false, value: 0n };
    return { isOk: true, value: this.blockHeight * 60n };
  }

  mintDecision(
    recipient: string,
    submissionId: bigint,
    metadataUri: string,
    contentHash: Buffer
  ): Result<bigint> {
    if (recipient === this.caller) return { isOk: false, value: 101n };
    if (!metadataUri || metadataUri.length === 0 || metadataUri.length > 256) return { isOk: false, value: 102n };
    if (contentHash.length !== 32) return { isOk: false, value: 103n };
    if (!this.state.submissionContract || !this.state.timestampContract) return { isOk: false, value: 100n };
    if (this.state.mintedSubmissions.has(submissionId)) return { isOk: false, value: 107n };

    const validate = this.validateSubmission(submissionId, contentHash);
    if (!validate.isOk) return { isOk: false, value: 104n };

    const approval = this.state.approvalContract ? this.isApproved(submissionId) : { isOk: true, value: true };
    if (!approval.isOk || !approval.value) return { isOk: false, value: 105n };

    const ts = this.getCurrentTimestamp();
    if (!ts.isOk) return { isOk: false, value: 108n };

    const id = this.state.nextNftId;
    this.state.decisionRegistry.set(id, {
      owner: recipient,
      metadataUri,
      contentHash,
      timestamp: ts.value,
      submissionId,
      approved: true,
    });
    this.state.mintedSubmissions.set(submissionId, true);
    this.state.nextNftId++;
    return { isOk: true, value: id };
  }

  getDecision(id: bigint): Decision | null {
    return this.state.decisionRegistry.get(id) ?? null;
  }

  getNextNftId(): bigint {
    return this.state.nextNftId;
  }
}

describe("NFTMinter Core Contract", () => {
  let contract: NFTMinterMock;

  beforeEach(() => {
    contract = new NFTMinterMock();
    contract.reset();
    contract.setSubmissionContract("ST2SUBMISSION");
    contract.setTimestampContract("ST2TIMESTAMP");
  });

  describe("mint-decision", () => {
    const validHash = Buffer.from("a".repeat(64), "hex");
    const validUri = "ipfs://QmXyZ123456789abcdef";

    it("rejects self-minting to prevent accidental burns", () => {
      contract.caller = "ST1GOV";
      const result = contract.mintDecision("ST1GOV", 1n, validUri, validHash);
      expect(result.isOk).toBe(false);
      expect(result.value).toBe(101n);
    });

    it("rejects empty metadata URI", () => {
      const result = contract.mintDecision("ST1GOV", 1n, "", validHash);
      expect(result.isOk).toBe(false);
      expect(result.value).toBe(102n);
    });

    it("rejects metadata URI over 256 characters", () => {
      const longUri = "a".repeat(257);
      const result = contract.mintDecision("ST1GOV", 1n, longUri, validHash);
      expect(result.isOk).toBe(false);
      expect(result.value).toBe(102n);
    });

    it("rejects content hash not exactly 32 bytes", () => {
      const short = Buffer.from("short");
      const long = Buffer.alloc(33, 0);
      expect(contract.mintDecision("ST1GOV", 1n, validUri, short).value).toBe(103n);
      expect(contract.mintDecision("ST1GOV", 1n, validUri, long).value).toBe(103n);
    });
  });

  describe("external contract dependencies", () => {
    const hash = Buffer.from("b".repeat(64), "hex");

    it("requires submission contract to be set", () => {
      contract.state.submissionContract = null;
      const result = contract.mintDecision("ST1GOV", 1n, "ipfs://test", hash);
      expect(result.isOk).toBe(false);
      expect(result.value).toBe(100n);
    });

    it("requires timestamp contract to be set", () => {
      contract.state.timestampContract = null;
      const result = contract.mintDecision("ST1GOV", 1n, "ipfs://test", hash);
      expect(result.isOk).toBe(false);
      expect(result.value).toBe(100n);
    });
  });

  describe("admin configuration", () => {
    it("rejects unauthorized config changes", () => {
      contract.caller = "ST1HACKER";
      expect(contract.setArchiverRole("ST1FAKE").isOk).toBe(false);
      expect(contract.setSubmissionContract("ST2FAKE").isOk).toBe(false);
    });
  });
});